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
  function _targetWin() { return (window.__rbTarget && window.__rbTarget.win) || window; }

  // Regen is a Gemini Pro vision call with a screenshot + big HTML prompt.
  // 120s was tight in practice (hit by users on medium pages). 240s is a
  // generous upper bound; the cancel button + wallclock watchdog make the
  // extended timeout safe — no more runaway pipelines.
  var REGEN_TIMEOUT_MS = 240000;
  var PAINT_WAIT_MS = 600; // give the browser time to paint the injected HTML

  /** Capture the current visible tab via background. Returns data URL. */
  var CAPTURE_TIMEOUT_MS = 30000;
  function captureOutput() {
    // Wrap in capture guard (banner + visibility detection) so a tab switch
    // mid-refine doesn't silently feed wrong-tab content into the diff prompt.
    var guard = (window.__rbModeE && window.__rbModeE._captureGuard)
      ? window.__rbModeE._captureGuard()
      : { assertVisible: function(){}, cleanup: function(){} };
    var p = new Promise(function(resolve, reject) {
      try { guard.assertVisible(); } catch (e) { reject(e); return; }
      chrome.runtime.sendMessage({
        action: 'captureScreenshot',
        returnData: true
      }, function(response) {
        try { guard.assertVisible(); } catch (e) { reject(e); return; }
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (response && response.dataUrl) resolve(response.dataUrl);
        else if (response && response.error) reject(new Error(response.error));
        else reject(new Error('Capture returned no data'));
      });
    }).finally(function() { guard.cleanup(); });
    if (window.__rbModeE && window.__rbModeE._guardCall) {
      return window.__rbModeE._guardCall(p, CAPTURE_TIMEOUT_MS, 'Refine capture');
    }
    return p;
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

  function buildRegenPrompt(currentHtml, issues /*, designMD — intentionally dropped */) {
    var issuesList = issues
      .filter(function(i) { return i.severity === 'high' || i.severity === 'medium'; })
      .map(function(i) { return '- [' + i.severity + '] ' + i.region + ': ' + (i.issue || 'visual mismatch'); })
      .join('\n');

    // Shrink the prompt aggressively: 30KB is enough for ~95% of Mode E
    // outputs, and every extra KB pushes total latency higher. DESIGN.MD is
    // deliberately omitted — its info (fonts, palette) is already baked into
    // the current HTML's inline styles, so repeating it doubles context for
    // no gain.
    var html = currentHtml || '';
    if (html.length > 30000) {
      html = html.substring(0, 30000) + '\n<!-- ...truncated; refine the portion above only -->';
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
      '- Preserve every <img data-rb-asset> / <svg data-rb-asset> placeholder exactly — those get swapped for real assets post-gen.',
      '',
      '==== CURRENT HTML (to refine) ====',
      html
    ].join('\n');
  }

  // Per-section regen prompt — smaller scope, faster, parallelizable.
  // The LLM rewrites ONE section's HTML, not the whole page. When multiple
  // issues hit the same section they are batched into this single call.
  function buildSectionRegenPrompt(sectionHtml, issues) {
    var issuesList = issues
      .filter(function(i) { return i.severity === 'high' || i.severity === 'medium'; })
      .map(function(i) { return '- [' + i.severity + '] ' + i.region + ': ' + (i.issue || 'visual mismatch'); })
      .join('\n');

    var html = sectionHtml || '';
    if (html.length > 20000) {
      html = html.substring(0, 20000) + '\n<!-- ...truncated; refine the portion above only -->';
    }

    return [
      'You previously generated this HTML SECTION as part of a website clone. The attached image is the ORIGINAL site (full page).',
      '',
      'A visual diff found these issues in this section:',
      issuesList,
      '',
      'Fix the issues. Match the original screenshot closely for layout, colors, typography, and content in the flagged region.',
      '',
      'OUTPUT RULES:',
      '- Return ONLY the corrected SECTION HTML (with its outer wrapper element). No prose, no markdown fences, no <html>/<head>/<body>.',
      '- This is a SECTION, not a full page — do not wrap it or rename the root element.',
      '- Keep inline-style approach (no Tailwind CDN, no external CSS, no <style> tags).',
      '- If unsure about a text/image, copy it VERBATIM from the current HTML below.',
      '- Preserve every <img data-rb-asset>, <svg data-rb-asset>, and [data-rb-asset-bg] marker EXACTLY — those get swapped for real assets post-gen.',
      '',
      '==== CURRENT SECTION HTML (to refine) ====',
      html
    ].join('\n');
  }

  /** Call the existing modeERebuild endpoint (Gemini Pro Vision, one image + prompt → HTML). */
  function callRegen(originalScreenshot, prompt) {
    var p = new Promise(function(resolve, reject) {
      chrome.runtime.sendMessage({
        action: 'modeERebuild',
        imageDataUrl: originalScreenshot,
        prompt: prompt
      }, function(response) {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (response && response.html) resolve(response.html);
        else if (response && response.error) reject(new Error(response.error));
        else reject(new Error('Empty response from regen'));
      });
    });
    // Prefer the shared wallclock watchdog + cancel gate (see mode-e.js).
    // The fallback keeps the original timeout behavior in the unlikely case
    // mode-e.js didn't load first.
    if (window.__rbModeE && window.__rbModeE._guardCall) {
      return window.__rbModeE._guardCall(p, REGEN_TIMEOUT_MS, 'Regen call');
    }
    return new Promise(function(resolve, reject) {
      var settled = false;
      var start = Date.now();
      var iv = setInterval(function() {
        if (settled) return;
        if (Date.now() - start >= REGEN_TIMEOUT_MS) {
          settled = true;
          clearInterval(iv);
          reject(new Error('Regen call timed out after ' + Math.round((Date.now() - start) / 1000) + 's'));
        }
      }, 1000);
      p.then(
        function(v) { if (!settled) { settled = true; clearInterval(iv); resolve(v); } },
        function(e) { if (!settled) { settled = true; clearInterval(iv); reject(e); } }
      );
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

    // Per-section regen path — when the caller gave us the rebuilt page's
    // section list (Y bounds + html), we map issues to sections and regen
    // each affected section in PARALLEL with a much smaller prompt. Massive
    // latency win when only the visible top viewport has issues (which is
    // the common case, since refine only captures the visible viewport).
    if (opts.sections && opts.sections.length > 0) {
      var viewportH = _targetWin().innerHeight || 800;
      var bucket = {};
      toFix.forEach(function(issue) {
        var absY = (issue.bbox && typeof issue.bbox.y === 'number' ? issue.bbox.y : 0) * viewportH;
        var matchIdx = 0;
        for (var si = 0; si < opts.sections.length; si++) {
          var s = opts.sections[si];
          if (absY >= s.topY && absY < s.topY + s.height) { matchIdx = si; break; }
        }
        (bucket[matchIdx] = bucket[matchIdx] || []).push(issue);
      });
      var affectedIdxs = Object.keys(bucket).map(Number);
      // Cap at 3 simultaneous regens so burst doesn't trip rate limits when
      // diff finds issues across many sections. Matches the viewport path's
      // ceiling and uses the same shared queue primitive.
      var REGEN_CONCURRENCY = 3;
      var REGEN_STAGGER_MS = 100;
      log({step: 'refine-regen', message: 'Regenerating ' + affectedIdxs.length + ' section(s) (concurrency=' + REGEN_CONCURRENCY + ')…', current: 3, total: 4});

      var workFn = function(idx /*, i */) {
        var section = opts.sections[idx];
        var secIssues = bucket[idx];
        var secPrompt = buildSectionRegenPrompt(section.html, secIssues);
        return callRegen(opts.originalScreenshot, secPrompt)
          .then(function(raw) {
            var c = stripHtmlFence(raw);
            if (!c || c.length < 50) return { idx: idx, html: null, failed: 'empty' };
            if (c === section.html || c.trim() === section.html.trim()) return { idx: idx, html: null, failed: 'identical' };
            return { idx: idx, html: c, failed: null };
          })
          .catch(function(e) { return { idx: idx, html: null, failed: e.message }; });
      };

      var sectionResults;
      if (window.__rbModeE && window.__rbModeE._runWithQueue) {
        sectionResults = await window.__rbModeE._runWithQueue(affectedIdxs, REGEN_CONCURRENCY, REGEN_STAGGER_MS, workFn);
      } else {
        sectionResults = await Promise.all(affectedIdxs.map(workFn));
      }

      var applied = sectionResults.filter(function(r) { return r.html; });
      if (applied.length === 0) {
        var reasons = sectionResults.map(function(r) { return r.failed; }).join(', ');
        log({step: 'refine-skip', message: 'All per-section regens bailed (' + reasons + ') — keeping current', current: 4, total: 4});
        return { html: null, issues: issues, changed: false };
      }

      log({step: 'refine-done', message: 'Refined ' + applied.length + '/' + affectedIdxs.length + ' sections', current: 4, total: 4});
      return {
        html: null,
        sectionUpdates: applied, // [{idx, html}]
        issues: issues,
        changed: true
      };
    }

    // Fallback: full-page regen (legacy path — used when caller didn't pass
    // sections, or for the image-upload entry which has no section layout).
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
