// RepixBridge — Mode E Classic (checkpoint 033 baseline, commit 2d23d3d)
//
// Isolated copy of the Mode E Vision pipeline as it existed at checkpoint
// 033 (feat/smart-text-cascade head). Lives in its own namespace so we can
// A/B test against the current modernized Mode E without removing today's
// improvements.
//
// What's NOT in this module by design (preserves 033 behavior):
//   - No asset manifest / placeholder system
//   - No floater detection / hiding
//   - No viewport parallelism (sequential await loop)
//   - No watchdog / cancel / abort controller
//   - No tab-focus hardening or rate-limit retry on the pipeline side
//     (the background captureScreenshot + modeERebuild handlers still have
//     today's hardening — this module only avoids the in-pipeline additions)
//   - No diagnostic console.log
//
// What IS reused from the current code (deliberately, no point reverting):
//   - extractor.extractCleanHTML() — slightly bigger cap (60KB vs 30KB) but
//     this module's prompt slices to 12KB anyway, so LLM sees identical input
//   - extractor.generateDesignMD() — unchanged
//   - background.js modeERebuild + captureScreenshot — already-shipped fixes
//
// Entry: window.__rbModeEClassic.run(onProgress) and .restore()
// Reuses window.__rbPushUndo so Cmd+Z works the same.

(function() {
  'use strict';

  // Mode E Classic operates on TARGET (the site). Public API on the
  // script's window so editor.js can invoke it directly.
  function _target() {
    return (window.__rbTarget && window.__rbTarget.doc) || document;
  }
  function _targetWin() {
    return (window.__rbTarget && window.__rbTarget.win) || window;
  }

  if (window.__rbModeEClassic) return;

  // ─── Prompt (verbatim from 033) ────────────────────────────────────────
  function buildPrompt(designMD, cleanHTML) {
    var designContext = designMD
      ? '\n\n--- DESIGN.MD (secondary typography and asset inventory reference) ---\n' + designMD.slice(0, 14000)
      : '';

    var structureContext = cleanHTML
      ? '\n\n--- CAPTURED PAGE STRUCTURE (structural source of truth) ---\n' + cleanHTML.slice(0, 12000)
      : '';

    return [
      'Recreate the attached webpage EXACTLY like the screenshot as an HTML implementation.',
      '',
      'This import is in EXACTLY mode. Treat the screenshot as the primary visual reference, the captured page structure as the structural source of truth, and the attached DESIGN.md as a secondary typography and asset inventory reference.',
      '',
      'SOURCE HIERARCHY (follow this priority order):',
      '1. SCREENSHOT (primary): visual fidelity — exact colors, surfaces, layout, composition, spacing, motion as shown in the image.',
      '2. CAPTURED PAGE STRUCTURE (secondary): use for text content, semantic tags, hierarchy, original brand references.',
      '3. DESIGN.MD (tertiary): use ONLY for font families, font weights, typographic tone, asset URLs, color hex values.',
      '',
      'CONFLICT RESOLUTION:',
      '- If DESIGN.MD conflicts with the screenshot on colors, surfaces, layout, or composition, FOLLOW THE SCREENSHOT.',
      '- If the captured structure conflicts with the screenshot on layout or composition, FOLLOW THE SCREENSHOT.',
      '- Use DESIGN.md only for what the screenshot cannot directly reveal (exact hex values, font family names, asset URLs).',
      '',
      'PRESERVATION RULES (do not deviate from the source):',
      '- Match the original texts, names, numbers, and brand references exactly from the captured page structure. Do NOT paraphrase or invent.',
      '- Preserve motion cues from the screenshot when present (marquee, animations).',
      '- Preserve the source CSS custom properties and theme tokens for backgrounds, text, buttons, and contrast instead of swapping in generic defaults.',
      '- Typography is explicitly defined in DESIGN.md. Match the original font families, weights, and headline/body hierarchy instead of defaulting to a system stack.',
      '- Do NOT replace the imported design with a new house style or generic defaults.',
      '- Do NOT add design interpretation beyond what is visible in the screenshot.',
      '',
      'OUTPUT RULES:',
      '- Use a single wrapper: <div class="rb-section" style="...">',
      '- ALL styling must be inline (style="..."). No <style> tags, no external CSS.',
      '- Use semantic tags: header, nav, section, h1-h6, p, a, button, img, span, ul, li.',
      '- Give every element a descriptive class: hero-title, cta-button, nav-logo, etc.',
      '- COLORS: Match every color exactly using hex values from the screenshot. Check DESIGN.MD for exact values.',
      '- FONTS: Use the exact font-family from DESIGN.MD. Include font-weight as specified.',
      '- FONT SIZES: Match sizes carefully. Use px values that match the screenshot.',
      '- SPACING: Match all padding, margins, and gaps precisely in px.',
      '- BACKGROUNDS: If a section has a solid color or gradient background, reproduce it exactly with CSS. For photo/image backgrounds, use the actual image URL from DESIGN.MD Assets if available.',
      '- LOGOS AND BRAND MARKS: NEVER recreate logos as HTML, CSS, SVG, or text. Always use <img src="REAL_URL"> with the URL marked as "logo" in DESIGN.MD Assets.',
      '- IMAGES: Use actual image URLs from DESIGN.MD Assets section. Match by context (logo, hero, photo, avatar). Never generate SVG or HTML approximations of images.',
      '- The section should be full-width (width:100%) with content centered via max-width + margin:0 auto.',
      '- Avoid long inline SVG markup unless absolutely necessary.',
      '- Do NOT include <html>, <head>, <body> tags.',
      '- Do NOT include any JavaScript.',
      '- Do NOT add comments or explanations.',
      '',
      'Conflict resolution reminder (this rule is repeated because the LLM tends to drift): if anything in DESIGN.md disagrees with the screenshot on visual properties — colors, surfaces, layout, composition — the screenshot wins.',
      designContext,
      structureContext,
      '',
      'OUTPUT: Return ONLY the raw HTML. No markdown, no code fences, no explanation. Start directly with <div class="rb-section"'
    ].join('\n');
  }

  // ─── Capture helpers (verbatim from 033, no abort/timeout wrappers) ───
  function captureViewport() {
    return new Promise(function(resolve) {
      chrome.runtime.sendMessage(
        {action: 'captureScreenshot', format: 'png', returnData: true},
        function(response) {
          resolve(response && response.dataUrl ? response.dataUrl : null);
        }
      );
    });
  }

  function scrollToAndWait(y) {
    return new Promise(function(resolve) {
      _targetWin().scrollTo(0, y);
      setTimeout(resolve, 800);
    });
  }

  var MAX_VIEWPORTS = 8;
  async function captureFullPage() {
    var viewportH = _targetWin().innerHeight;
    var pageH = _target().documentElement.scrollHeight;
    var screenshots = [];
    var originalScroll = _targetWin().scrollY;

    var editorEls = _target().querySelectorAll('[id^="rb-editor"], [id^="rb-ed-"]');
    editorEls.forEach(function(el) { el.style.setProperty('display', 'none', 'important'); });

    var totalViewports = Math.min(Math.ceil(pageH / viewportH), MAX_VIEWPORTS);

    // Use the shared capture guard if available — protects against tab-switch
    // contamination just like the modern Mode E. Fallback to no-op if the
    // current Mode E module didn't load (shouldn't happen given injection
    // order, but be defensive).
    var guard = (window.__rbModeE && window.__rbModeE._captureGuard)
      ? window.__rbModeE._captureGuard()
      : { assertVisible: function(){}, cleanup: function(){} };

    try {
      guard.assertVisible();
      for (var i = 0; i < totalViewports; i++) {
        guard.assertVisible();
        var y = i * viewportH;
        await scrollToAndWait(y);
        try {
          var dataUrl = await captureViewport();
          if (dataUrl) {
            screenshots.push({
              y: y,
              height: Math.min(viewportH, pageH - y),
              dataUrl: dataUrl
            });
          }
        } catch(e) {
          console.error('[Mode E Classic] Capture failed at y=' + y, e);
        }
      }
    } finally {
      guard.cleanup();
      _targetWin().scrollTo(0, originalScroll);
      editorEls.forEach(function(el) { el.style.removeProperty('display'); });
    }

    return screenshots;
  }

  function screenshotToHTML(screenshotDataUrl, designMD, cleanHTML) {
    return new Promise(function(resolve, reject) {
      chrome.runtime.sendMessage(
        {
          action: 'modeERebuild',
          imageDataUrl: screenshotDataUrl,
          prompt: buildPrompt(designMD, cleanHTML)
        },
        function(response) {
          if (response && response.html) resolve(response.html);
          else if (response && response.error) reject(new Error(response.error));
          else reject(new Error('No response from AI'));
        }
      );
    });
  }

  // ─── Output cleanup (verbatim from 033) ────────────────────────────────
  function cleanHTML(raw) {
    var html = (raw || '').trim();
    html = html.replace(/^```(?:html|xml)?\s*/i, '').replace(/\s*```$/i, '');
    html = html.trim();
    if (/```/.test(html)) {
      var firstLt = html.indexOf('<');
      var lastGt = html.lastIndexOf('>');
      if (firstLt !== -1 && lastGt > firstLt) {
        var extracted = html.slice(firstLt, lastGt + 1);
        if (!/```/.test(extracted)) html = extracted;
      }
    }
    return html.trim();
  }

  // ─── Replace + restore (uses a CLASSIC-specific wrapper id and stash) ──
  // Same shape as the 033 implementation but uses `rb-rebuilt-page-classic`
  // and `window.__rbOriginalPageClassic` so it cannot collide with the
  // current Mode E (which uses `rb-rebuilt-page` + `__rbOriginalPage`).
  function replacePageContent(sectionsHTML) {
    var editorEls = [];
    Array.from(_target().body.children).forEach(function(child) {
      if (child.id && (child.id.indexOf('rb-editor') === 0 || child.id.indexOf('rb-ed-') === 0)) {
        editorEls.push(child);
      }
    });

    var originalChildren = [];
    Array.from(_target().body.children).forEach(function(child) {
      if (editorEls.indexOf(child) === -1) {
        originalChildren.push(child);
      }
    });
    window.__rbOriginalPageClassic = {
      children: originalChildren,
      scrollY: _targetWin().scrollY
    };

    var savedOriginalChildren = originalChildren.slice();
    var savedScrollY = _targetWin().scrollY;

    var wrapper = _target().createElement('div');
    wrapper.id = 'rb-rebuilt-page-classic';
    wrapper.style.cssText = [
      'max-width: 100%;',
      'margin: 0 auto;',
      'background: #ffffff;',
      'min-height: 100vh;',
      'font-family: system-ui, -apple-system, sans-serif;'
    ].join('');

    sectionsHTML.forEach(function(html) {
      var section = _target().createElement('div');
      section.innerHTML = html;
      if (section.children.length === 1) {
        wrapper.appendChild(section.children[0]);
      } else {
        var wrap = _target().createElement('div');
        wrap.className = 'rb-section';
        wrap.innerHTML = html;
        wrapper.appendChild(wrap);
      }
    });

    originalChildren.forEach(function(child) {
      if (child.parentElement) child.parentElement.removeChild(child);
    });

    if (editorEls.length > 0) {
      _target().body.insertBefore(wrapper, editorEls[0]);
    } else {
      _target().body.appendChild(wrapper);
    }

    _target().body.style.margin = '0';
    _target().body.style.padding = '0';

    // Reuse the existing __modeERun undo handler — it just restores children
    // and removes the wrapper, so it works for any rebuild origin. We pass
    // our own wrapper element so undo targets the right one.
    if (typeof window.__rbPushUndo === 'function') {
      try {
        window.__rbPushUndo({
          prop: '__modeERun',
          originalChildren: savedOriginalChildren,
          scrollY: savedScrollY,
          rebuiltWrapper: wrapper
        });
      } catch(e) { console.warn('[Mode E Classic] pushUndo failed:', e); }
    }

    return wrapper;
  }

  function restoreOriginalPage() {
    if (window.__rbOriginalPageClassic) {
      var rebuilt = _target().getElementById('rb-rebuilt-page-classic');
      if (rebuilt) rebuilt.remove();
      var editorEls = [];
      Array.from(_target().body.children).forEach(function(child) {
        if (child.id && (child.id.indexOf('rb-editor') === 0 || child.id.indexOf('rb-ed-') === 0)) {
          editorEls.push(child);
        }
      });
      var insertBefore = editorEls.length > 0 ? editorEls[0] : null;
      window.__rbOriginalPageClassic.children.forEach(function(child) {
        if (insertBefore) _target().body.insertBefore(child, insertBefore);
        else _target().body.appendChild(child);
      });
      _targetWin().scrollTo(0, window.__rbOriginalPageClassic.scrollY);
      window.__rbOriginalPageClassic = null;
    }
  }

  // ─── Pipeline (verbatim sequential from 033) ───────────────────────────
  async function runModeEClassic(onProgress) {
    var log = onProgress || function() {};

    var builderInfo = window.__rbDetectBuilder ? window.__rbDetectBuilder() : {builder: 'generic'};
    log({step: 'detect', message: 'Detected: ' + builderInfo.builder + ' (Classic/033)', current: 0, total: 5});

    if (builderInfo.builder !== 'generic' && window.__rbFreeze) {
      window.__rbFreeze(builderInfo);
      log({step: 'freeze', message: 'Freezing animations...', current: 1, total: 6});
      await new Promise(function(r) { setTimeout(r, 2000); });
      log({step: 'freeze', message: 'Animations frozen', current: 1, total: 6});
    } else {
      log({step: 'freeze', message: 'No animations to freeze', current: 1, total: 6});
    }

    var designMD = '';
    var pageStructure = '';
    if (window.__rbExtractor) {
      try { designMD = window.__rbExtractor.generateDesignMD() || ''; } catch(e) {}
      try { pageStructure = window.__rbExtractor.extractCleanHTML() || ''; } catch(e) {}
      var lineCount = designMD.split('\n').length;
      log({step: 'tokens', message: 'Generated DESIGN.MD (' + lineCount + ' lines) + structure (' + Math.round(pageStructure.length / 1024) + 'KB)', current: 2, total: 6});
    }

    log({step: 'capture', message: 'Capturing page (' + MAX_VIEWPORTS + ' viewports max, sequential)...', current: 3, total: 6});
    var screenshots = await captureFullPage();
    log({step: 'capture', message: 'Captured ' + screenshots.length + ' viewports', current: 3, total: 6});

    log({step: 'rebuild', message: 'Rebuilding with AI (0/' + screenshots.length + ', sequential)...', current: 4, total: 6});
    var sectionsHTML = [];
    for (var i = 0; i < screenshots.length; i++) {
      try {
        var html = await screenshotToHTML(screenshots[i].dataUrl, designMD, pageStructure);
        var cleaned = cleanHTML(html);
        if (cleaned.length > 10) sectionsHTML.push(cleaned);
        log({
          step: 'rebuild',
          message: 'Rebuilding with AI (' + (i + 1) + '/' + screenshots.length + ', sequential)...',
          current: 4,
          total: 6
        });
      } catch(err) {
        console.error('[Mode E Classic] Rebuild failed for viewport ' + i + ':', err);
        var errMsg = err.message || '';
        if (errMsg.indexOf('No API key') !== -1 || errMsg.indexOf('unregistered callers') !== -1) {
          log({step: 'error', message: 'API key not configured. Open the Repix extension popup → Settings to add your key.', current: 6, total: 6});
          return null;
        }
        log({step: 'error', message: 'Failed viewport ' + i + ': ' + errMsg, current: 4, total: 6});
      }
    }

    if (sectionsHTML.length === 0) {
      log({step: 'error', message: 'No sections rebuilt. Open the Repix extension popup → Settings to check your API key.', current: 6, total: 6});
      return null;
    }

    log({step: 'replace', message: 'Replacing page content...', current: 5, total: 6});
    var rebuilt = replacePageContent(sectionsHTML);
    log({step: 'done', message: 'Classic rebuild complete! ' + sectionsHTML.length + ' sections.', current: 6, total: 6});

    return rebuilt;
  }

  window.__rbModeEClassic = {
    run: runModeEClassic,
    restore: restoreOriginalPage
  };
})();
