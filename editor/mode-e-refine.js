/**
 * Repix Mode E — Refinement orchestrator.
 *
 * Called after Mode E's main generation + inject succeeds. Captures the
 * current tab (the injected clone), diffs against the original screenshot
 * Mode E already captured, and if significant issues are found, asks the
 * main Mode E generator for a corrected HTML.
 *
 * MVP: single pass. Returns { html: string|null, issues: Array, changed: bool }.
 *
 * html === null means "no refinement — keep current". changed === true
 * means caller should re-inject the returned html.
 */
(function() {
  if (window.__rbModeERefine) return;

  var REGEN_TIMEOUT_MS = 120000;
  var PAINT_WAIT_MS = 600; // give the browser time to paint the injected HTML

  /** Capture the current visible tab via background. Returns data URL. */
  function captureOutput() {
    return new Promise(function(resolve, reject) {
      chrome.runtime.sendMessage({
        action: 'captureScreenshot',
        returnData: true
      }, function(response) {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (response && response.dataUrl) resolve(response.dataUrl);
        else if (response && response.error) reject(new Error(response.error));
        else reject(new Error('Capture returned no data'));
      });
    });
  }

  /**
   * Wait for paint + an optional delay, then capture.
   * Uses 2x rAF + setTimeout to ride out React/Framer re-renders.
   */
  function waitAndCapture(extraMs) {
    return new Promise(function(resolve) {
      requestAnimationFrame(function() {
        requestAnimationFrame(function() {
          setTimeout(function() {
            captureOutput().then(resolve).catch(function(e) {
              console.warn('[refine] capture failed:', e);
              resolve(null);
            });
          }, typeof extraMs === 'number' ? extraMs : PAINT_WAIT_MS);
        });
      });
    });
  }

  function buildRegenPrompt(currentHtml, issues, designMD) {
    var issuesList = issues
      .filter(function(i) { return i.severity === 'high' || i.severity === 'medium'; })
      .map(function(i) { return '- [' + i.severity + '] ' + i.region + ': ' + (i.issue || 'visual mismatch'); })
      .join('\n');

    var tokens = designMD && designMD.length > 6000 ? designMD.substring(0, 6000) : (designMD || '');
    // Cap currentHtml to keep the regen prompt under Gemini's effective
    // context limit (screenshot + prompt + html). 60KB leaves room for the
    // image tokens + tokens cap and avoids silent mid-document truncation
    // on the output side. The cap is generous (most Mode E outputs are
    // ~15-40KB); if it triggers, the model receives a truncation marker
    // so it can still produce coherent output for the uncapped portion.
    var html = currentHtml;
    if (html && html.length > 60000) {
      html = html.substring(0, 60000) + '\n<!-- ...truncated; refine the portion above only -->';
    }

    return [
      'You previously generated this HTML as a clone of a website. The attached image is the ORIGINAL site.',
      '',
      'A visual diff found these issues when comparing your generated clone with the original:',
      issuesList,
      '',
      'Fix ALL issues listed above. Match the original screenshot exactly for layout, colors, typography, and content.',
      '',
      'OUTPUT RULES:',
      '- Return ONLY the full corrected HTML. No prose, no markdown fences, no <html>/<head>/<body> wrappers.',
      '- Preserve any parts of the current HTML that were NOT flagged as issues.',
      '- Keep the same inline-style approach as the current HTML (no Tailwind CDN, no external CSS).',
      '- If unsure about a text/image, copy it VERBATIM from the current HTML below.',
      '',
      '==== DESIGN TOKENS (from original) ====',
      tokens,
      '',
      '==== CURRENT HTML (to refine) ====',
      html
    ].join('\n');
  }

  /** Call the existing modeERebuild endpoint (Gemini Pro Vision, one image + prompt → HTML). */
  function callRegen(originalScreenshot, prompt) {
    return new Promise(function(resolve, reject) {
      var timer = setTimeout(function() {
        reject(new Error('Regen call timed out after ' + Math.round(REGEN_TIMEOUT_MS / 1000) + 's'));
      }, REGEN_TIMEOUT_MS);
      chrome.runtime.sendMessage({
        action: 'modeERebuild',
        imageDataUrl: originalScreenshot,
        prompt: prompt
      }, function(response) {
        clearTimeout(timer);
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (response && response.html) resolve(response.html);
        else if (response && response.error) reject(new Error(response.error));
        else reject(new Error('Empty response from regen'));
      });
    });
  }

  function stripHtmlFence(raw) {
    if (!raw) return '';
    var s = raw.trim();
    s = s.replace(/^```(?:html)?\s*/i, '').replace(/```\s*$/, '').trim();
    return s;
  }

  /**
   * Run one refinement pass.
   * @param {object} opts
   * @param {string} opts.originalScreenshot - dataUrl captured before inject
   * @param {string} opts.currentHtml        - the HTML currently on the page
   * @param {string} [opts.designMD]         - tokens for the regen prompt
   * @param {function} [opts.onProgress]     - log({step,message,current,total})
   * @returns {Promise<{html: string|null, issues: Array, changed: boolean}>}
   */
  async function runRefine(opts) {
    opts = opts || {};
    var log = opts.onProgress || function() {};
    if (!opts.originalScreenshot) throw new Error('runRefine requires originalScreenshot');
    if (!opts.currentHtml) throw new Error('runRefine requires currentHtml');
    if (!window.__rbModeEDiff || !window.__rbModeEDiff.runVisionDiff) {
      throw new Error('__rbModeEDiff not loaded');
    }

    log({step: 'refine-capture', message: 'Capturing output…', current: 1, total: 4});
    var outputScreenshot = await waitAndCapture();
    if (!outputScreenshot) {
      log({step: 'refine-skip', message: 'Output capture failed — skipping refinement', current: 4, total: 4});
      return {html: null, issues: [], changed: false};
    }

    log({step: 'refine-diff', message: 'Diffing vs original…', current: 2, total: 4});
    var issues = [];
    try {
      issues = await window.__rbModeEDiff.runVisionDiff(opts.originalScreenshot, outputScreenshot);
    } catch (e) {
      log({step: 'refine-skip', message: 'Diff failed (' + e.message + ') — skipping', current: 4, total: 4});
      return {html: null, issues: [], changed: false};
    }

    var toFix = issues.filter(function(i) { return i.severity === 'high' || i.severity === 'medium'; });
    if (toFix.length === 0) {
      log({step: 'refine-clean', message: 'Clean — no significant issues', current: 4, total: 4});
      return {html: null, issues: issues, changed: false};
    }

    log({step: 'refine-regen', message: 'Regenerating with ' + toFix.length + ' fixes…', current: 3, total: 4});
    var prompt = buildRegenPrompt(opts.currentHtml, toFix, opts.designMD);
    var newHtmlRaw;
    try {
      newHtmlRaw = await callRegen(opts.originalScreenshot, prompt);
    } catch (e) {
      log({step: 'refine-skip', message: 'Regen failed (' + e.message + ') — keeping current', current: 4, total: 4});
      return {html: null, issues: issues, changed: false};
    }

    var newHtml = stripHtmlFence(newHtmlRaw);
    if (!newHtml || newHtml.length < 100) {
      log({step: 'refine-skip', message: 'Regen returned empty/too short — keeping current', current: 4, total: 4});
      return {html: null, issues: issues, changed: false};
    }

    // No-op guard: if regen echoed back an identical (or near-identical) doc,
    // treat as unchanged instead of wasting an undo slot re-injecting the same
    // content. Exact equality first, then trimmed equality for whitespace-only
    // differences.
    if (newHtml === opts.currentHtml || newHtml.trim() === opts.currentHtml.trim()) {
      log({step: 'refine-skip', message: 'Regen returned identical HTML — keeping current', current: 4, total: 4});
      return {html: null, issues: issues, changed: false};
    }

    log({step: 'refine-done', message: 'Refined — ' + toFix.length + ' issues fixed', current: 4, total: 4});
    return {html: newHtml, issues: issues, changed: true};
  }

  window.__rbModeERefine = {
    runRefine: runRefine,
    // Exposed for tests / manual diagnostics:
    _buildRegenPrompt: buildRegenPrompt,
    _stripHtmlFence: stripHtmlFence
  };
})();
