// RepixBridge — Mode E: Papel Vegetal (chunked pipeline)
// Extract sections → per-section screenshot → per-section LLM call → stitch.
// The user edits a representation of the site, not the site itself.

(function() {
  'use strict';

  // ─── Cancel + wallclock watchdog ───────────────────────────────────────
  // A cancel controller lets the user abort a runaway Mode E / E+ run. The
  // watchdog is a wallclock-based timeout (setInterval + Date.now()) that
  // survives Chrome's intensive-throttling of backgrounded tabs, which was
  // masking a stuck diff call for 80 minutes in the field.
  var _abortCtrl = null;
  function beginRun() {
    _abortCtrl = { aborted: false, listeners: [] };
  }
  function endRun() {
    if (_abortCtrl) _abortCtrl.listeners.length = 0;
    _abortCtrl = null;
  }
  function isAborted() { return !!(_abortCtrl && _abortCtrl.aborted); }
  function checkAbort() {
    if (isAborted()) throw new Error('Cancelled by user');
  }
  function cancelRun() {
    if (!_abortCtrl) return;
    _abortCtrl.aborted = true;
    var listeners = _abortCtrl.listeners.slice();
    listeners.forEach(function(fn) { try { fn(); } catch(e) {} });
  }
  // Race a promise against (a) cancellation and (b) a wallclock timeout.
  // The wallclock uses setInterval + Date.now() so it fires correctly even
  // when the tab is backgrounded and setTimeout has been intensively throttled.
  function withAbortAndTimeout(promise, timeoutMs, label) {
    return new Promise(function(resolve, reject) {
      var settled = false;
      var start = Date.now();
      var iv = setInterval(function() {
        if (settled) return;
        if (isAborted()) {
          settled = true;
          clearInterval(iv);
          reject(new Error('Cancelled by user'));
          return;
        }
        if (Date.now() - start >= timeoutMs) {
          settled = true;
          clearInterval(iv);
          reject(new Error((label || 'LLM call') + ' timed out after ' + Math.round((Date.now() - start) / 1000) + 's'));
        }
      }, 1000);
      if (_abortCtrl) _abortCtrl.listeners.push(function() {
        if (settled) return;
        settled = true;
        clearInterval(iv);
        reject(new Error('Cancelled by user'));
      });
      promise.then(
        function(v) { if (!settled) { settled = true; clearInterval(iv); resolve(v); } },
        function(e) { if (!settled) { settled = true; clearInterval(iv); reject(e); } }
      );
    });
  }

  // Build the rebuild prompt for VIEWPORT mode (legacy fallback when
  // extractSections() returns no chunks — e.g., weird single-page sites).
  // Mirrors the chunked prompt structure (Aura "EXACTLY mode" style) but
  // reconstructs an entire viewport at once instead of a single section.
  function buildPrompt(designMD, cleanHTML, manifestText) {
    var designContext = designMD
      ? '\n\n--- DESIGN.MD (secondary typography and asset inventory reference) ---\n' + designMD.slice(0, 14000)
      : '';

    var structureContext = cleanHTML
      ? '\n\n--- CAPTURED PAGE STRUCTURE (structural source of truth) ---\n' + cleanHTML.slice(0, 50000)
      : '';

    var manifestContext = manifestText
      ? '\n\n--- ' + manifestText + '\n'
      : '';

    var assetRule = manifestText
      ? '- ASSETS: The page\'s images, large SVGs, and CSS background images have been extracted as placeholders in CAPTURED PAGE STRUCTURE — look for <img data-rb-asset="N">, <svg data-rb-asset="N">, and [data-rb-asset-bg="N"] markers. WHEN a visual element in the screenshot has a corresponding placeholder, emit the placeholder verbatim (same tag, same data-rb-asset value, no children). You may add class/style for sizing/layout but DO NOT change the marker attribute. Small UI icons (hamburger, chevron, arrow, X, plus, search, etc.) typically have NO placeholder by design — for those, inline <svg> with paths is fine. Do NOT recreate logos, photographs, illustrations, or large decorative SVGs as inline markup — those ALWAYS have placeholders, find and use them. Do NOT invent new placeholder markers outside the manifest.'
      : '- IMAGES: Use actual image URLs from DESIGN.MD Assets section. Match by context (logo, hero, photo, avatar). Never generate SVG or HTML approximations of images.';

    var logoRule = manifestText
      ? '- LOGOS AND BRAND MARKS: Logos and brand marks are in the ASSET MANIFEST as placeholders — find the matching placeholder and emit it. If a logo somehow lacks a placeholder, prefer plain text wordmark over hand-crafted SVG <path> reconstruction.'
      : '- LOGOS AND BRAND MARKS: NEVER recreate logos as HTML, CSS, SVG, or text. Always use <img src="REAL_URL"> with the URL marked as "logo" in DESIGN.MD Assets.';

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
      logoRule,
      assetRule,
      '- The section should be full-width (width:100%) with content centered via max-width + margin:0 auto.',
      '- Avoid long inline SVG markup unless absolutely necessary.',
      '- Do NOT include <html>, <head>, <body> tags.',
      '- Do NOT include any JavaScript.',
      '- Do NOT add comments or explanations.',
      '',
      'Conflict resolution reminder (this rule is repeated because the LLM tends to drift): if anything in DESIGN.md disagrees with the screenshot on visual properties — colors, surfaces, layout, composition — the screenshot wins.',
      designContext,
      manifestContext,
      structureContext,
      '',
      'OUTPUT: Return ONLY the raw HTML. No markdown, no code fences, no explanation. Start directly with <div class="rb-section"'
    ].join('\n');
  }

  // Build the rebuild prompt for CHUNKED mode (one section at a time).
  // Merges the Aura "EXACTLY mode" prompt structure (assertive, repeated
  // conflict resolution, no-house-style-drift directives) with the
  // chunked-specific context (per-section role, metadata, partial HTML,
  // shared DESIGN.md, Responsive Behavior translation).
  //
  // The shared designMD ensures all chunks use the same tokens/fonts/colors.
  // Per-chunk cleanHTML gives structural context for this specific section.
  function buildChunkPrompt(designMD, section, sectionIdx, totalSections) {
    var designContext = designMD
      ? '\n\n--- DESIGN.MD (shared across all sections — secondary typography and asset inventory reference) ---\n' + designMD.slice(0, 14000)
      : '';

    var sectionContext = section.cleanHTML
      ? '\n\n--- CAPTURED PAGE STRUCTURE FOR THIS SECTION (structural source of truth) ---\n' + section.cleanHTML.slice(0, 8000)
      : '';

    var role;
    if (section.isSticky) role = 'the sticky HEADER';
    else if (section.isFooter) role = 'the FOOTER';
    else role = 'a content SECTION';

    // Pull out the Source Implementation Cues block from DESIGN.md so we can
    // surface it explicitly at the end of the prompt (Aura technique).
    var detectedCues = '';
    if (designMD) {
      var cuesMatch = designMD.match(/## Source Implementation Cues[\s\S]*?(?=\n## |$)/);
      if (cuesMatch) {
        // Strip the heading and the explanatory blurb, keep the bullet list
        var cuesBody = cuesMatch[0]
          .replace(/^## Source Implementation Cues\s*\n?/, '')
          .replace(/^These are MUST-preserve.*\n\n?/, '')
          .trim();
        if (cuesBody) detectedCues = cuesBody;
      }
    }

    return [
      'Recreate ' + role + ' of the attached webpage EXACTLY like the screenshot as an HTML implementation using Tailwind CSS.',
      'This is section ' + (sectionIdx + 1) + ' of ' + totalSections + '. Other sections are being reconstructed separately and stitched together — produce ONLY the HTML for this section.',
      '',
      'This import is in EXACTLY mode. Treat the screenshot as the primary visual reference, the captured page structure as the structural source of truth, and the attached DESIGN.md as a secondary typography and asset inventory reference.',
      '',
      'SOURCE HIERARCHY (follow this priority order):',
      '1. SCREENSHOT (primary): visual fidelity — exact colors, surfaces, layout, composition, spacing, motion as shown in the image.',
      '2. CAPTURED PAGE STRUCTURE (secondary): use for text content, semantic tags, hierarchy, original brand references.',
      '3. DESIGN.MD (tertiary): use ONLY for font families, font weights, typographic tone, asset URLs, color hex values, and Responsive Behavior rules.',
      '',
      'CONFLICT RESOLUTION:',
      '- If DESIGN.MD conflicts with the screenshot on colors, surfaces, layout, or composition, FOLLOW THE SCREENSHOT.',
      '- If the captured structure conflicts with the screenshot on layout or composition, FOLLOW THE SCREENSHOT.',
      '- Use DESIGN.md only for what the screenshot cannot directly reveal (exact hex values, font family names, asset URLs).',
      '',
      'PRESERVATION RULES (do not deviate from the source):',
      '- Match the original texts, names, numbers, and brand references exactly from the captured page structure. Do NOT paraphrase or invent.',
      '- Preserve motion cues from the screenshot when present (marquee, scroll-triggered animations, hover states). Implement marquee with CSS @keyframes + duplicated content, never as a static block.',
      '- Preserve the source CSS custom properties and theme tokens for backgrounds, text, buttons, and contrast instead of swapping in generic defaults.',
      '- Typography is explicitly defined in DESIGN.md. Match the original font families, weights, and headline/body hierarchy instead of defaulting to a system stack.',
      '- Do NOT replace the imported design with a new house style or generic Tailwind defaults.',
      '- Do NOT add design interpretation beyond what is visible in the screenshot.',
      '',
      'CONSISTENCY RULES (other chunks depend on this — they share the same DESIGN.md):',
      '- Use EXACT hex values from the DESIGN.MD Color Palette. Do not improvise colors or round to "close enough" values.',
      '- Use EXACT font-family names from DESIGN.MD Typography. Do not substitute system fonts.',
      '- Follow DESIGN.MD Source Implementation Cues literally (e.g., "use text-[Nvw]" means do that).',
      '- If DESIGN.MD has a Responsive Behavior section, TRANSLATE those CSS rules into Tailwind responsive prefixes (sm:, md:, lg:, xl:). Base styles match the desktop screenshot; smaller breakpoints come from the @media rules.',
      '',
      'OUTPUT RULES:',
      '- Produce ONE root element for this section (<header>, <section>, <nav>, <footer>, or <div>).',
      '- Use Tailwind CSS classes for all styling. NO inline style="...", NO <style> tags, NO long inline SVG markup unless absolutely necessary.',
      '- Use semantic tags throughout (h1-h6, p, a, button, nav, ul/li).',
      '- For logos and brand marks: use actual <img src="REAL_URL"> from DESIGN.md Assets section. NEVER recreate logos as inline SVG, CSS shapes, or text.',
      '- For decorative shapes (rounded blocks, tall pills, rotated elements): reproduce with <div> elements + Tailwind border-radius/transform classes, NOT inline SVG.',
      '- Match every visible text string exactly from the captured page structure.',
      '- Do NOT include <html>, <head>, <body>. Do NOT re-declare global styles or Tailwind directives.',
      '- Do NOT include comments, explanations, or markdown code fences.',
      '',
      'Conflict resolution reminder (this rule is repeated because the LLM tends to drift): if anything in DESIGN.md disagrees with the screenshot on visual properties — colors, surfaces, layout, composition — the screenshot wins.',
      '',
      'Section metadata: ' + JSON.stringify({
        id: section.id,
        tag: section.tag,
        bounds: section.bounds,
        isSticky: section.isSticky,
        isFooter: section.isFooter
      }),
      detectedCues ? '\n\n--- DETECTED SOURCE IMPLEMENTATION CUES (MUST be preserved when supported by the source) ---\n' + detectedCues : '',
      designContext,
      sectionContext,
      '',
      'OUTPUT: Return only the raw HTML for this single section. No markdown code fences, no preamble, no explanations. Start directly with the opening tag of the root element.'
    ].join('\n');
  }

  // Capture visible viewport as base64 PNG. Wrapped in the wallclock watchdog
  // so a stuck service worker / frozen captureVisibleTab call can't hang the
  // whole capture loop (observed on shopify.com/br where the widget locked
  // up mid-scroll with no way out).
  var VIEWPORT_CAPTURE_TIMEOUT_MS = 30000; // 30s per single capture
  function captureViewport() {
    var p = new Promise(function(resolve) {
      chrome.runtime.sendMessage(
        {action: 'captureScreenshot', format: 'png', returnData: true},
        function(response) {
          resolve(response && response.dataUrl ? response.dataUrl : null);
        }
      );
    });
    if (window.__rbModeE && window.__rbModeE._guardCall) {
      return window.__rbModeE._guardCall(p, VIEWPORT_CAPTURE_TIMEOUT_MS, 'Viewport capture');
    }
    return p;
  }

  // Scroll to a position and wait for render.
  // 500ms is the empirical sweet spot: enough for most lazy-loaded content
  // and scroll-triggered animations to settle, short enough that the capture
  // loop doesn't spend 5-7s just on scroll settle when doing 7 viewports.
  function scrollToAndWait(y) {
    return new Promise(function(resolve) {
      window.scrollTo(0, y);
      setTimeout(resolve, 500);
    });
  }

  // Capture the entire page as an array of viewport screenshots
  // Cached after the most recent runModeE call so the refinement orchestrator
  // can restore assets in regenerated section HTML without having to re-scan
  // the DOM (which has since been replaced with the clone).
  var _lastAssetManifest = [];

  var MAX_VIEWPORTS = 8; // Safety limit — prevents excessive API calls on very long pages

  // ─── Capture guard ─────────────────────────────────────────────────────
  // Shows a prominent banner during capture phases AND tracks tab visibility.
  // If the user switches away from the tab mid-capture, chrome.tabs.captureVisibleTab
  // will silently grab whatever's visible in the window — causing content from
  // OTHER tabs to leak into the rebuild (we lived this bug on shopify.com/br
  // when content from a separate Shopify tab got mixed into a gistr.so rebuild).
  // The guard prevents that contamination by aborting hard when the tab loses
  // visibility, with a clear error message instead of silent garbage.
  function installCaptureGuard() {
    var state = { wasHidden: document.hidden };

    // Banner overlay — high z-index, non-interactive, dismissed on cleanup.
    var banner = document.createElement('div');
    banner.id = 'rb-capture-guard-banner';
    banner.style.cssText = [
      'all: initial',
      'position: fixed',
      'top: 16px',
      'left: 50%',
      'transform: translateX(-50%)',
      'z-index: 2147483647',
      'background: rgba(245, 158, 11, 0.96)',
      'color: #1a1a1a',
      'padding: 10px 18px',
      'border-radius: 10px',
      'font: 600 13px "Instrument Sans", system-ui, -apple-system, sans-serif',
      'box-shadow: 0 6px 20px rgba(0,0,0,0.25)',
      'pointer-events: none',
      'display: flex',
      'align-items: center',
      'gap: 10px',
      'white-space: nowrap'
    ].join(';');
    banner.innerHTML = '<span style="font-size:16px">📸</span><span>Capturing screenshots — keep this tab in the foreground (~10s)</span>';
    try { (document.body || document.documentElement).appendChild(banner); } catch (_) {}

    function onVisibility() {
      if (document.hidden) state.wasHidden = true;
    }
    document.addEventListener('visibilitychange', onVisibility);

    state.assertVisible = function() {
      if (state.wasHidden) {
        throw new Error('Capture aborted: tab lost focus mid-capture. Keep this tab in the foreground for the first ~10 seconds of any rebuild — switching tabs causes the screenshot API to grab content from the wrong tab.');
      }
    };

    state.cleanup = function() {
      document.removeEventListener('visibilitychange', onVisibility);
      if (banner && banner.parentNode) banner.remove();
    };

    return state;
  }


  // Detect elements that are visually fixed to the viewport (stick-to-top navs,
  // floating CTAs, cookie banners, chat widgets, etc). These get duplicated
  // in every viewport screenshot because they scroll with the user, which
  // confuses the LLM: it emits one copy per section output, and the assembled
  // page has a ghost nav at every scroll offset.
  // Capture each floater's outerHTML with URLs absolutized, scripts stripped,
  // and event handlers removed. The output is injected verbatim into the
  // final rebuilt page BEFORE the LLM-generated sections — the LLM never sees
  // floaters in the first place (they're hidden from every viewport capture),
  // so the nav/cta/cookie-banner arrives 1:1 instead of being re-invented.
  // The "Lean" mode is the primary consumer; this function is a no-op returning
  // '' when there are no floaters.
  function captureFloatersAsStaticHtml() {
    var floaters = findFloatingElements();
    if (floaters.length === 0) return '';
    var pageBase = location.href;
    function abs(url) {
      if (!url) return url;
      try { return new URL(url, pageBase).href; } catch(e) { return url; }
    }
    var out = [];
    floaters.forEach(function(el) {
      var clone = el.cloneNode(true);
      // Absolutize URLs so the snapshot survives when the rebuilt page is
      // hosted on a different origin (export, share, etc).
      clone.querySelectorAll('[src]').forEach(function(n) {
        var s = n.getAttribute('src'); if (s) n.setAttribute('src', abs(s));
      });
      clone.querySelectorAll('[href]').forEach(function(n) {
        var s = n.getAttribute('href'); if (s) n.setAttribute('href', abs(s));
      });
      // Strip embedded scripts + on* handlers — the floater is a display-only
      // fragment in the rebuilt page, no live behavior expected.
      clone.querySelectorAll('script').forEach(function(n) { n.remove(); });
      var walker = [clone].concat([].slice.call(clone.querySelectorAll('*')));
      walker.forEach(function(n) {
        if (!n.attributes) return;
        [].slice.call(n.attributes).forEach(function(a) {
          if (a.name.toLowerCase().indexOf('on') === 0) n.removeAttribute(a.name);
        });
      });
      // Ensure the floater keeps its fixed/sticky position in the rebuilt
      // page by forcing the computed position into inline style (the original
      // CSS selectors may not match our rebuilt class names).
      try {
        var cs = window.getComputedStyle(el);
        if (cs) {
          var existingStyle = clone.getAttribute('style') || '';
          var posDecl = 'position:' + cs.position + ';' +
            'top:' + cs.top + ';' + 'left:' + cs.left + ';' +
            'right:' + cs.right + ';' + 'bottom:' + cs.bottom + ';' +
            'z-index:' + cs.zIndex + ';';
          clone.setAttribute('style', (existingStyle ? existingStyle + ';' : '') + posDecl);
        }
      } catch (e) {}
      out.push(clone.outerHTML);
    });
    return out.join('\n');
  }

  function findFloatingElements() {
    var out = [];
    // Cap the walk: complex sites (Shopify, enterprise SaaS) can have 20k+
    // body descendants, and a synchronous getComputedStyle pass over that
    // many nodes was freezing the main thread for 3-8 seconds — making the
    // widget look hung even though we were still in setup. Most legitimate
    // fixed/sticky elements (nav, cookie banner, chat widget, CTAs) are in
    // the first few thousand DOM nodes.
    var MAX_SCAN = 3000;
    var all = document.querySelectorAll('body *');
    var limit = Math.min(all.length, MAX_SCAN);
    for (var i = 0; i < limit; i++) {
      var el = all[i];
      if (el.id && (el.id.indexOf('rb-editor') === 0 || el.id.indexOf('rb-ed-') === 0)) continue;
      var cs;
      try { cs = window.getComputedStyle(el); } catch (e) { continue; }
      if (!cs) continue;
      var pos = cs.position;
      if (pos !== 'fixed' && pos !== 'sticky') continue;
      var r = el.getBoundingClientRect();
      if (r.width < 20 || r.height < 20) continue;
      out.push(el);
    }
    return out;
  }

  async function captureFullPage(onProgress, captureOpts) {
    var log = onProgress || function() {};
    captureOpts = captureOpts || {};
    // When true, floaters are hidden in EVERY viewport (not just 2+). The
    // Lean path uses this — it captures floaters separately as static HTML
    // snapshots and injects them at stitch time, so the LLM never needs to
    // regenerate them.
    var hideFloatersAlways = !!captureOpts.hideFloatersAlways;
    var viewportH = window.innerHeight;
    var pageH = document.documentElement.scrollHeight;
    var screenshots = [];
    var originalScroll = window.scrollY;

    // Hide ALL editor UI during capture
    var editorEls = document.querySelectorAll('[id^="rb-editor"], [id^="rb-ed-"]');
    editorEls.forEach(function(el) { el.style.setProperty('display', 'none', 'important'); });

    // Identify floaters BEFORE scroll — some elements only become sticky after
    // scroll, but we care about those that ARE fixed/sticky in the initial
    // state (the ones the LLM will think exist at every Y position).
    var floaters = findFloatingElements();

    var totalViewports = Math.min(Math.ceil(pageH / viewportH), MAX_VIEWPORTS);

    var guard = installCaptureGuard();
    try {
      // Initial check — if the tab was already hidden when we started, abort
      // immediately instead of capturing 8 viewports of the wrong tab.
      guard.assertVisible();
      for (var i = 0; i < totalViewports; i++) {
        // Re-check before EVERY viewport — between scroll + capture is exactly
        // when a tab switch causes contamination.
        guard.assertVisible();
        var y = i * viewportH;
        await scrollToAndWait(y);
        log({step: 'capture', message: 'Capturing viewport ' + (i + 1) + '/' + totalViewports + '…', current: 3, total: 6});
        var shouldHide = hideFloatersAlways || (i > 0);
        if (shouldHide) {
          floaters.forEach(function(el) { el.style.setProperty('visibility', 'hidden', 'important'); });
        }
        try {
          var dataUrl = await captureViewport();
          if (dataUrl) {
            screenshots.push({
              y: y,
              height: Math.min(viewportH, pageH - y),
              dataUrl: dataUrl
            });
          } else {
            log({step: 'capture', message: 'Viewport ' + (i + 1) + ' returned empty — continuing', current: 3, total: 6});
          }
        } catch(e) {
          console.error('[Mode E] Capture failed at y=' + y, e);
          log({step: 'capture', message: 'Viewport ' + (i + 1) + ' timed out — continuing with ' + screenshots.length, current: 3, total: 6});
        } finally {
          if (shouldHide) {
            floaters.forEach(function(el) { el.style.removeProperty('visibility'); });
          }
        }
      }
    } finally {
      guard.cleanup();
      // Guarantee editor UI + scroll restore even if the loop throws — without
      // this a crash mid-capture leaves the editor invisible.
      window.scrollTo(0, originalScroll);
      editorEls.forEach(function(el) { el.style.removeProperty('display'); });
    }

    return screenshots;
  }

  // Send a screenshot to Gemini Vision and get HTML back (viewport mode, legacy).
  // Wrapped in withAbortAndTimeout so the user can cancel and a stuck service
  // worker / long-tail Gemini call can't hang the pipeline forever.
  // `opts.model` lets callers force a specific model (Mode E Lean uses this
  // to route the viewport path to Flash instead of Pro).
  var VIEWPORT_CALL_TIMEOUT_MS = 180000; // 3 min per viewport
  function screenshotToHTML(screenshotDataUrl, designMD, cleanHTML, manifestText, opts) {
    opts = opts || {};
    // Returns the FULL response object so the caller can aggregate provider /
    // model / tokens / cost across viewports. Previously this resolved to the
    // bare html string — pipeline lost all per-call metrics.
    var p = new Promise(function(resolve, reject) {
      chrome.runtime.sendMessage(
        {
          action: 'modeERebuild',
          imageDataUrl: screenshotDataUrl,
          prompt: buildPrompt(designMD, cleanHTML, manifestText),
          model: opts.model || null
        },
        function(response) {
          if (response && response.html) resolve(response);
          else if (response && response.error) reject(new Error(response.error));
          else reject(new Error('No response from AI'));
        }
      );
    });
    return withAbortAndTimeout(p, VIEWPORT_CALL_TIMEOUT_MS, 'Viewport Gemini call');
  }

  // Send a section screenshot + context to Gemini Vision (chunked mode)
  // Low-level LLM call for a single chunk (no validation, used by the
  // retry wrapper below). Wraps chrome.runtime.sendMessage in a 90-second
  // timeout so stuck or silently-failing calls surface as errors instead
  // of leaving the user staring at "Reconstructing with AI..." forever.
  var CHUNK_CALL_TIMEOUT_MS = 90000;
  function chunkToHTMLRaw(screenshotDataUrl, prompt) {
    return new Promise(function(resolve, reject) {
      var settled = false;
      var timer = setTimeout(function() {
        if (settled) return;
        settled = true;
        reject(new Error('Gemini call timed out after ' + Math.round(CHUNK_CALL_TIMEOUT_MS / 1000) + 's (check extension service worker or network)'));
      }, CHUNK_CALL_TIMEOUT_MS);
      chrome.runtime.sendMessage(
        {
          action: 'modeERebuild',
          imageDataUrl: screenshotDataUrl,
          prompt: prompt
        },
        function(response) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (response && response.html) resolve(response.html);
          else if (response && response.error) reject(new Error(response.error));
          else reject(new Error('No response from AI'));
        }
      );
    });
  }

  // Chunk-to-HTML with output validation + automatic retry on validator
  // failure. When the first attempt trips the validator, the retry uses an
  // even stricter prompt suffix that tells the LLM exactly what went wrong.
  async function chunkToHTML(screenshotDataUrl, designMD, section, idx, total) {
    var basePrompt = buildChunkPrompt(designMD, section, idx, total);
    var raw = await chunkToHTMLRaw(screenshotDataUrl, basePrompt);
    var cleaned = cleanHTML(raw);
    var check = validateLLMOutput(cleaned, {expectedKind: 'html'});

    if (!check.valid && check.severity === 'fatal') {
      console.warn('[Mode E] chunk ' + idx + ' validator failed (' + check.reason + '), retrying');
      // Gentle retry: just append a brief note. The original prompt is
      // already clear about output format; an aggressive "REJECTED"
      // retry prompt tends to produce even more conservative output.
      var retryPrompt = basePrompt
        + '\n\nNote: please return only the raw HTML for this section, starting with the opening tag. No prose, no code fences.';
      raw = await chunkToHTMLRaw(screenshotDataUrl, retryPrompt);
      cleaned = cleanHTML(raw);
      var recheck = validateLLMOutput(cleaned, {expectedKind: 'html'});
      if (!recheck.valid && recheck.severity === 'fatal') {
        console.error('[Mode E] chunk ' + idx + ' retry also failed: ' + recheck.reason);
        throw new Error('LLM output validation failed twice: ' + recheck.reason);
      }
    }
    return cleaned;
  }

  // Capture a single section screenshot.
  // Strategy: scroll so the section top is at viewport top. Optionally hide
  // the sticky header to prevent duplication on every chunk.
  // The chrome.tabs.captureVisibleTab API only captures what's visible, so
  // for sections taller than the viewport we capture the first viewport only
  // (the LLM gets context that this is a larger section via bounds metadata).
  async function captureSectionScreenshot(section, stickyHeaderEl) {
    var targetY = section.bounds.y;

    // If this section IS the sticky header, scroll to top and don't hide it
    var hiding = !section.isSticky && stickyHeaderEl;

    // Scroll so the section's top is at (or near) the viewport top
    window.scrollTo(0, targetY);
    await new Promise(function(r) { setTimeout(r, 600); });

    // Temporarily hide the sticky header to prevent overlap on this chunk
    var restoreHeader = null;
    if (hiding) {
      var prev = stickyHeaderEl.style.cssText;
      stickyHeaderEl.style.setProperty('visibility', 'hidden', 'important');
      restoreHeader = function() { stickyHeaderEl.style.cssText = prev; };
      // Give the browser a tick to apply
      await new Promise(function(r) { setTimeout(r, 100); });
    }

    // Capture the visible tab
    var dataUrl = null;
    try {
      dataUrl = await captureViewport();
    } finally {
      if (restoreHeader) restoreHeader();
    }
    return dataUrl;
  }

  // Resolve the actual DOM element for a section returned by extractSections().
  // We pass only a selector in the serialized form, so re-find it at capture time.
  function resolveSectionElement(section) {
    if (!section || !section.selector) return null;
    try {
      return document.querySelector(section.selector);
    } catch(e) {
      return null;
    }
  }

  // ─── Run cost / token / wall-time accumulator ────────────────────────────
  // Per-pipeline totals so the final toast can summarize "what just ran".
  // Shared between Mode E, E+, EL — anything that fans out viewport calls
  // and wants a consolidated tally.
  function makeRunTotals() {
    return {
      tokensIn: 0,
      tokensOut: 0,
      costUSD: 0,
      costUnknown: false, // true if any call lacked pricing data
      model: '',
      provider: '',
      startMs: Date.now()
    };
  }
  function accumulateCall(totals, resp) {
    if (!resp) return;
    if (resp.usage) {
      totals.tokensIn += resp.usage.in || 0;
      totals.tokensOut += resp.usage.out || 0;
    }
    if (resp.costUSD == null) totals.costUnknown = true;
    else totals.costUSD += resp.costUSD;
    if (resp.model) totals.model = resp.model;
    if (resp.provider) totals.provider = resp.provider;
  }
  function fmtTokens(n) {
    if (n < 1000) return String(n);
    if (n < 1000000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
    return (n / 1000000).toFixed(2).replace(/\.?0+$/, '') + 'M';
  }
  function fmtCostShort(usd) {
    if (usd < 0.01) return '$' + usd.toFixed(4);
    if (usd < 1)    return '$' + usd.toFixed(3);
    return '$' + usd.toFixed(2);
  }
  function fmtElapsedShort(ms) {
    var s = Math.round(ms / 1000);
    var m = Math.floor(s / 60);
    var rs = s % 60;
    return m + ':' + (rs < 10 ? '0' : '') + rs;
  }
  function formatRunSummary(totals) {
    var elapsed = fmtElapsedShort(Date.now() - totals.startMs);
    var modelLabel = totals.model || 'unknown model';
    var costLabel = totals.costUnknown ? '$?' : fmtCostShort(totals.costUSD);
    return modelLabel + ', ' + elapsed + ', ' +
           fmtTokens(totals.tokensIn) + ' in / ' +
           fmtTokens(totals.tokensOut) + ' out, ' + costLabel;
  }

  // Queue-based parallel runner that respects rate limits. Processes up to
  // `concurrency` items simultaneously with a minimum delay between starts.
  async function runWithQueue(items, concurrency, delayMs, work) {
    var results = new Array(items.length);
    var cursor = 0;
    var inflight = 0;

    return new Promise(function(resolve, reject) {
      function launchNext() {
        if (cursor >= items.length && inflight === 0) {
          resolve(results);
          return;
        }
        while (inflight < concurrency && cursor < items.length) {
          var idx = cursor++;
          inflight++;
          Promise.resolve(work(items[idx], idx))
            .then(function(idx_) {
              return function(r) { results[idx_] = r; };
            }(idx))
            .catch(function(idx_) {
              return function(e) { results[idx_] = {error: e}; };
            }(idx))
            .then(function() {
              inflight--;
              setTimeout(launchNext, delayMs);
            });
        }
      }
      launchNext();
    });
  }

  // Clean AI output — strip markdown fences if present.
  // Also attempts to extract HTML from reasoning-leaked responses by finding
  // the first `<` and last `>` if the content between them parses as HTML.
  function cleanHTML(raw) {
    var html = (raw || '').trim();
    // Remove ```html ... ``` wrappers at extremes (the common case)
    html = html.replace(/^```(?:html|xml)?\s*/i, '').replace(/\s*```$/i, '');
    html = html.trim();

    // If the result still has internal code fences, try to extract HTML
    // between the first `<` and last `>`. This rescues outputs that started
    // with reasoning prose but eventually produced HTML.
    if (/```/.test(html)) {
      var firstLt = html.indexOf('<');
      var lastGt = html.lastIndexOf('>');
      if (firstLt !== -1 && lastGt > firstLt) {
        var extracted = html.slice(firstLt, lastGt + 1);
        // Only use the extracted version if it itself has no fences
        if (!/```/.test(extracted)) html = extracted;
      }
    }

    return html.trim();
  }

  // Swap each <img data-rb-asset="N"> / <svg data-rb-asset="N"> placeholder
  // with the corresponding original asset from the manifest. Any class/style
  // the LLM applied to the placeholder is carried over (so layout sticks).
  // Idempotent and safe when the LLM dropped placeholders entirely.
  function restoreAssets(html, assets) {
    if (!html || !assets || !assets.length) return html;
    var byId = {};
    for (var k = 0; k < assets.length; k++) byId[String(assets[k].id)] = assets[k];

    var wrap = document.createElement('div');
    wrap.innerHTML = html;

    var placeholders = wrap.querySelectorAll('[data-rb-asset]');
    var bgPlaceholders = wrap.querySelectorAll('[data-rb-asset-bg]');
    var dropped = 0, restored = 0;

    // Background-image restore: merge a background-image: url(...) declaration
    // into the element's existing inline style. Runs first so LLM-applied
    // style= for things like padding/size is preserved alongside the bg URL.
    for (var b = 0; b < bgPlaceholders.length; b++) {
      var bgEl = bgPlaceholders[b];
      var bgIdStr = bgEl.getAttribute('data-rb-asset-bg');
      var bgAsset = byId[bgIdStr];
      if (!bgAsset || bgAsset.type !== 'bg') {
        bgEl.removeAttribute('data-rb-asset-bg');
        dropped++;
        continue;
      }
      var existingBgStyle = bgEl.getAttribute('style') || '';
      var bgDecl = "background-image: url('" + bgAsset.src.replace(/'/g, "%27") + "');";
      bgEl.setAttribute('style', (existingBgStyle ? existingBgStyle + ';' : '') + bgDecl);
      bgEl.removeAttribute('data-rb-asset-bg');
      restored++;
    }

    for (var i = 0; i < placeholders.length; i++) {
      var el = placeholders[i];
      var id = el.getAttribute('data-rb-asset');
      var a = byId[id];
      if (!a) { el.removeAttribute('data-rb-asset'); dropped++; continue; }

      if (a.type === 'img') {
        // Tag-preserving replace: keep the LLM's class/style/width/height
        // (it sized the slot for layout); set src/srcset/alt from the manifest.
        // If the LLM put the marker on the wrong tag (e.g. <div data-rb-asset>),
        // swap it for a real <img> so the asset actually renders.
        var target = el;
        if (el.tagName !== 'IMG') {
          target = document.createElement('img');
          var carryClass = el.getAttribute('class');
          var carryStyle = el.getAttribute('style');
          if (carryClass) target.setAttribute('class', carryClass);
          if (carryStyle) target.setAttribute('style', carryStyle);
          if (el.parentNode) el.parentNode.replaceChild(target, el);
        }
        target.setAttribute('src', a.src);
        if (a.srcset) target.setAttribute('srcset', a.srcset);
        if (a.alt && !target.getAttribute('alt')) target.setAttribute('alt', a.alt);
        target.removeAttribute('data-rb-asset');
        restored++;
      } else if (a.type === 'svg') {
        // Re-parse the original SVG outerHTML and merge the LLM's class/style
        // into it (the LLM may have positioned the slot via class/style).
        var holder = document.createElement('div');
        holder.innerHTML = a.outerHTML;
        var orig = holder.firstElementChild;
        if (!orig) { el.removeAttribute('data-rb-asset'); continue; }
        var llmClass = el.getAttribute('class');
        var llmStyle = el.getAttribute('style');
        if (llmClass) {
          var existingCls = orig.getAttribute('class') || '';
          orig.setAttribute('class', (existingCls ? existingCls + ' ' : '') + llmClass);
        }
        if (llmStyle) {
          var existingStyle = orig.getAttribute('style') || '';
          orig.setAttribute('style', (existingStyle ? existingStyle + ';' : '') + llmStyle);
        }
        if (el.parentNode) el.parentNode.replaceChild(orig, el);
        restored++;
      }
    }

    // Light diagnostic — useful to see in DevTools whether the LLM honored
    // the manifest. No throw: rebuild always proceeds with whatever was
    // restored (the LLM may have legitimately dropped some placeholders if
    // the screenshot didn't include them).
    if (assets.length > 0) {
      var totalMarkers = placeholders.length + bgPlaceholders.length;
      console.log('[Mode E] Asset restore: ' + restored + '/' + totalMarkers +
        ' placeholders matched, ' + dropped + ' unknown id, ' +
        (assets.length - restored) + ' assets unused.');
    }

    return wrap.innerHTML;
  }

  // Structural validator for per-section regen output. The refine step asks
  // the LLM to rewrite one section of the clone; LLMs drift and sometimes
  // drop critical semantic tags (e.g. the page <header> vanishes because the
  // regen output focused on the hero copy and silently omitted the nav bar).
  // This function compares the ORIGINAL section HTML against the REGEN HTML
  // and rejects the update when:
  //   (a) a critical structural tag (header/nav/footer/main/h1) that existed
  //       in the original is missing from the regen
  //   (b) the new HTML is drastically smaller than the original (heuristic:
  //       < 30% element count on sections with 20+ elements)
  // Rejected updates fall back to keeping the original section — slower
  // refinement progress, but no visible regression.
  function validateSectionStructure(originalHtml, newHtml) {
    if (!newHtml || newHtml.length < 50) {
      return { ok: false, reason: 'regen HTML too small (' + (newHtml || '').length + ' bytes)' };
    }
    var tmpOrig = document.createElement('div');
    var tmpNew = document.createElement('div');
    try {
      tmpOrig.innerHTML = originalHtml || '';
      tmpNew.innerHTML = newHtml;
    } catch (e) {
      return { ok: false, reason: 'parse failed: ' + e.message };
    }

    var critical = ['header', 'nav', 'footer', 'main', 'h1'];
    for (var i = 0; i < critical.length; i++) {
      var tag = critical[i];
      var origHas = !!tmpOrig.querySelector(tag);
      var newHas = !!tmpNew.querySelector(tag);
      if (origHas && !newHas) {
        return { ok: false, reason: 'lost <' + tag + '> tag in regen' };
      }
    }

    var origCount = tmpOrig.querySelectorAll('*').length;
    var newCount = tmpNew.querySelectorAll('*').length;
    if (origCount >= 20 && newCount < origCount * 0.3) {
      return {
        ok: false,
        reason: 'element count collapsed (' + origCount + ' → ' + newCount + ')'
      };
    }
    return { ok: true };
  }

  function cleanMarkdown(raw) {
    var md = (raw || '').trim();
    // Strip ```markdown or ```md or ``` wrappers if the model added them
    md = md.replace(/^```(?:markdown|md)?\s*/i, '').replace(/\s*```$/i, '');
    return md.trim();
  }

  // ─── Output validator ─────────────────────────────────────────────────
  // Detects failure modes where the LLM returned reasoning/markdown instead
  // of clean HTML. These patterns were observed in production on gistr.so
  // (2026-04-15): code fences inside the body, self-quoted prompt rules,
  // SVG path data leaking as text, markdown headers, etc.
  //
  // Returns {valid: bool, reason: string, severity: 'fatal'|'warn'}.
  // 'fatal' → retry the LLM call
  // 'warn'  → use the output but log for telemetry
  function validateLLMOutput(raw, opts) {
    opts = opts || {};
    var expectedKind = opts.expectedKind || 'html'; // 'html' or 'markdown'
    var text = (raw || '').trim();

    if (text.length === 0) {
      return {valid: false, reason: 'empty response', severity: 'fatal'};
    }

    // Pattern 1: internal code fences (after cleanup, these should be gone).
    // If there are still ``` markers in the middle, the output has prose +
    // code blocks which means the LLM was reasoning.
    var fenceCount = (text.match(/```/g) || []).length;
    if (expectedKind === 'html' && fenceCount >= 2) {
      return {valid: false, reason: 'internal code fences present (' + fenceCount + ')', severity: 'fatal'};
    }
    if (expectedKind === 'markdown' && fenceCount >= 4) {
      // Markdown can legitimately have 2 fences for a code block; 4+ means nested
      return {valid: false, reason: 'excessive code fences (' + fenceCount + ')', severity: 'warn'};
    }

    // Pattern 2: reasoning phrases (the LLM thinking out loud).
    // These appeared in the gistr.so bug: "Wait, let me reconsider", etc.
    var reasoningPhrases = [
      /\bwait,?\s+(let me|the|let's)/i,
      /\blet me (think|reconsider|check|verify|analyze)/i,
      /\bactually,?\s+(i|the|let's|looking)/i,
      /\bhmm,?/i,
      /\bso for (row|column|section) \d/i,
      /\bi (notice|see|think|believe|need to)/i,
      /\bthe user (wants|said|asked|indicated)/i,
      /\blooking at (the|this) (screenshot|image|design)/i
    ];
    for (var i = 0; i < reasoningPhrases.length; i++) {
      if (reasoningPhrases[i].test(text)) {
        return {
          valid: false,
          reason: 'reasoning phrase detected: ' + reasoningPhrases[i].toString().slice(0, 60),
          severity: 'fatal'
        };
      }
    }

    // Pattern 3: LLM echoing our own prompt rules back
    // ("FOLLOW THE SCREENSHOT!", "DOES NOT have", etc).
    var echoedRules = [
      /FOLLOW THE SCREENSHOT[!.]?/i,
      /DOES NOT have/i,
      /EXACTLY mode/i,
      /CONFLICT RESOLUTION/i,
      /PRESERVATION RULES/i,
      /conflict resolution reminder/i
    ];
    for (var j = 0; j < echoedRules.length; j++) {
      if (echoedRules[j].test(text)) {
        return {
          valid: false,
          reason: 'LLM echoed prompt rule: ' + echoedRules[j].toString().slice(0, 60),
          severity: 'fatal'
        };
      }
    }

    // Pattern 4: SVG path data leaking as text node content.
    // The gistr.so bug: `M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z">`
    // These fragments render as visible text when the SVG tag is malformed.
    var pathLeakRe = /[Mm]\d+[\s,-]+\d+(?:[\s,-]+[AaCcHhVvLlSsTtQqZz\d.-]+){4,}/;
    if (pathLeakRe.test(text)) {
      return {valid: false, reason: 'SVG path data leaking as text', severity: 'fatal'};
    }

    // Pattern 5 (HTML only): must contain at least one tag
    if (expectedKind === 'html' && !/<\w+[\s>]/.test(text)) {
      return {valid: false, reason: 'no HTML tags found', severity: 'fatal'};
    }

    // Pattern 6 (HTML only): must start with `<` after cleanup
    if (expectedKind === 'html' && text.charAt(0) !== '<') {
      return {valid: false, reason: 'does not start with `<`', severity: 'fatal'};
    }

    // Pattern 7 (HTML only): basic tag balance sanity. Count `<` vs matched closing `>`.
    if (expectedKind === 'html') {
      var openCount = (text.match(/<[^\/!][^>]*[^\/]>/g) || []).length; // opening tags
      var closeCount = (text.match(/<\/[^>]+>/g) || []).length;         // closing tags
      var selfClose = (text.match(/<[^>]+\/>/g) || []).length;          // self-closing
      // Allow some tolerance: opening count should be within 2x of closing + self-closing
      if (openCount > 0 && closeCount + selfClose < openCount * 0.5) {
        return {valid: false, reason: 'tag imbalance (open=' + openCount + ' close=' + closeCount + ' self=' + selfClose + ')', severity: 'warn'};
      }
    }

    // Pattern 8 (markdown only): DESIGN.md must have at least the Overview section
    if (expectedKind === 'markdown') {
      if (!/^# Design System/m.test(text)) {
        return {valid: false, reason: 'missing `# Design System` heading', severity: 'fatal'};
      }
      if (!/## Overview/m.test(text)) {
        return {valid: false, reason: 'missing `## Overview` section', severity: 'fatal'};
      }
    }

    return {valid: true, reason: 'ok', severity: 'ok'};
  }

  // ─── Vision-based DESIGN.md generator ────────────────────────────────
  // Produces a DESIGN.md from a screenshot alone, no DOM access needed.
  // The prompt uses a synthetic high-quality example as few-shot guidance,
  // so the LLM reproduces the exact format our downstream chunked pipeline
  // expects (same format as extractor.js generateDesignMD() output).
  //
  // This is the "image upload" counterpart to the DOM-based path — together
  // they let Mode E work on both live sites AND standalone screenshots.

  var DESIGN_MD_TEMPLATE_EXAMPLE = [
    '# Design System',
    '',
    '## Overview',
    '- **Tone**: A brutalist-leaning yet friendly design that relies on oversized display typography, thin visible borders, and decorative CSS shapes — warm, earthy color palette.',
    '- **Theme**: light mode (background: `#f0eee4`, text: `#1b3115`)',
    '- **Primary font**: Inter',
    '- **Viewport**: 1440 x 900',
    '',
    '## Layout & Grid',
    '',
    '- **Sticky header**: height 64px (`h-16`), backdrop-filter `blur(12px)` (`backdrop-blur-md`), bg `rgba(240,238,228,0.8)`',
    '- **Graph-paper background** on `body`: size `80px 80px` (use `bg-[size:80px_80px]`)',
    '- **Dominant section paddings**: 96px (`py-24`), 128px (`py-32`)',
    '- **Separation strategy**: thin 1px borders between sections, use `border border-[#dcdacd]`',
    '',
    '## Color Palette',
    '',
    '- **Background (Base)**: `#f0eee4` (off-white beige) — used for body surface',
    '- **Primary Text & Elements**: `#1b3115` (deep forest green) — used for headings, body text, borders',
    '- **Borders & Grid Lines**: `#dcdacd` (light greige) — used for section dividers and grid patterns',
    '- **Accent 1 (Brand Primary)**: `#5ee37f` (vibrant mint green) — used for selection, section backgrounds, shapes',
    '- **Accent 2 (Decorative)**: `#ffb5d9` (soft pink) — used for decorative pills and dots',
    '',
    '## Typography',
    '',
    '### Sans-Serif: Inter',
    '- **Weights**: 400 (`font-normal`), 500 (`font-medium`), 600 (`font-semibold`)',
    '- **Used in**: headings, body text, links, UI elements',
    '- **Sizes**: 14px (`text-sm`), 16px (`text-base`), 18px (`text-lg`), 48px (`text-5xl`), 180px (`text-[18vw]`)',
    '- **Letter-spacing**: -0.03em (`tracking-tight`) on headings',
    '',
    '### Hierarchy',
    '- **H1**: 180px (`text-[18vw]`), weight 600 (`font-semibold`), line-height 0.88 (`leading-[0.88]`), (`tracking-tight`)',
    '- **H2**: 48px (`text-5xl`), weight 600 (`font-semibold`)',
    '- **H3**: 32px (`text-3xl`), weight 600 (`font-semibold`)',
    '',
    '## Components',
    '',
    '### Buttons',
    '- **Variant 1** (primary, 3 instances): `bg-[#1b3115] text-[#f0eee4] rounded-full px-5 py-2 font-medium`, inner icon container `rounded-full bg-white/20`',
    '- **Variant 2** (text link, 5 instances): `text-[#1b3115] font-medium hover:opacity-70`',
    '',
    '### Pills / Tags',
    '- **Variant 1** (12 instances): `border border-[#1b3115] rounded-full px-4 py-1.5 text-xs font-medium bg-transparent`',
    '',
    '### Header',
    '- **header**: `sticky top-0 z-50 h-16 backdrop-blur-md bg-[#f0eee4]/80 border-b border-[#dcdacd]`',
    '',
    '## Graphic Elements & Shapes',
    '',
    '- The design uses CSS-drawn decorative shapes (not images) placed around headings and sections.',
    '- **Tall pill shapes** (2): vertical rounded-full bars, likely decorative punctuation between words. Example: `w-[30px] h-[70px] rounded-full bg-[#ffb5d9]`',
    '- **Abstract blocks with extreme border-radii** (4): `rounded-[4rem] bg-[#5ee37f]`, `rounded-full bg-[#1b3115]`',
    '- **Implementation guidance**: reproduce each shape as a `<div>` with Tailwind classes. Do NOT use inline SVG for these — CSS `border-radius` + `transform` is the source technique.',
    '',
    '## Animations & Interactions',
    '',
    '- **Custom text selection**: `selection:bg-[#5ee37f]` `selection:text-[#1b3115]`',
    '- **Hover states detected** (preserve these interactions):',
    '  - `a:hover` → `hover:bg-black/5`',
    '  - `button:hover` → `hover:opacity-90`',
    '- **Marquee motion**: continuous scrolling text detected at footer. Implement with `@keyframes` + `animation: marquee <duration> linear infinite` on a track with duplicated content.',
    '',
    '## Source Implementation Cues',
    '',
    'These are MUST-preserve behaviors detected in the source. They are often invisible in the screenshot alone:',
    '',
    '- Source uses a sticky `header` (height 64px, with `backdrop-filter: blur(12px)`). Preserve this positioning and the blur effect exactly.',
    '- Source uses a graph-paper background pattern (size `80px 80px`). Reproduce with linear-gradient, not images.',
    '- Source defines custom text selection colors. Preserve this rule.',
    '- Marquee-style motion is present in the source. Implement it with CSS `@keyframes` + duplicated content, not a static section.',
    '- Source uses tall `rounded-full` vertical pill shapes as decorative typographic punctuation (not circles).',
    '- Source uses fluid viewport-relative display typography (>120px rendered). Use `text-[Nvw]` or `clamp()`.',
    '',
    "## Do's and Don'ts",
    '',
    '- **Do**: Use Tailwind `font-semibold` (600) for all headings, not `font-black` (900). Weight matters for this aesthetic.',
    "- **Don't**: Use heavy box shadows; the source uses thin borders for elevation.",
    "- **Don't**: Replace the source's font families with system defaults.",
    "- **Don't**: Add design interpretation beyond what's visible in the screenshot."
  ].join('\n');

  function buildDesignMDVisionPrompt() {
    return [
      'ROLE: You are an expert design system analyst. You specialize in looking at website screenshots and producing precise, Tailwind-aware design system documentation.',
      '',
      'TASK: Analyze the attached screenshot and produce a DESIGN.md document in markdown. This document will be consumed by another LLM to reconstruct the website as HTML + Tailwind CSS, so every value you produce directly influences the quality of the final clone.',
      '',
      'CRITICAL RULES:',
      '- Look at the screenshot carefully before writing. Sample actual pixel values for colors.',
      '- Infer hex values precisely — do NOT approximate to round values. If you see a soft pink, it might be `#ffb5d9` or `#f5b9d1`, not generic `#ffb0d0`.',
      '- Identify the primary font family when possible (Inter, Fraunces, Geist, Satoshi, Instrument Serif, etc). If unsure, describe as "sans-serif (Inter-like)" or similar.',
      '- Use Tailwind class annotations wherever relevant: `bg-[#hex]`, `text-[#hex]`, `border-[#hex]`, `text-7xl`, `font-semibold`, `rounded-full`, `py-24`, etc.',
      '- Be specific and concrete. Avoid vague descriptions like "modern" or "clean".',
      '- OMIT sections that you cannot reasonably infer from the screenshot. For example, if there are no visible decorative shapes, OMIT the Graphic Elements & Shapes section entirely.',
      '- DO NOT fabricate interactions you cannot observe. Hover states and animations are often invisible in a static screenshot — only mention them if there is clear visual evidence (e.g., a pill that looks interactive, a blur that suggests a sticky header, a marquee edge suggesting scrolling text).',
      '- Follow the EXACT section order, headings, and formatting shown in the reference example below.',
      '',
      'REFERENCE EXAMPLE (match this format exactly):',
      '',
      '```markdown',
      DESIGN_MD_TEMPLATE_EXAMPLE,
      '```',
      '',
      'FORMAT REQUIREMENTS:',
      '- Start with `# Design System`',
      '- Use `##` for top-level sections and `###` for subsections',
      '- Use hex colors in lowercase (`#f0eee4` not `#F0EEE4`)',
      '- Always annotate numeric values with their Tailwind equivalents in backticks when possible',
      '- For colors, describe them in parentheses using natural language (e.g., "off-white beige", "deep forest green", "vibrant mint green")',
      '- The Tone line in the Overview should be 1 sentence summarizing the design personality',
      '',
      'NOW ANALYZE THE ATTACHED SCREENSHOT AND PRODUCE THE DESIGN.MD:',
      '',
      'Return ONLY the markdown document. No explanations, no preamble, no code fences wrapping the whole output. Do not include the reference example in your output — produce a NEW DESIGN.md for the ATTACHED screenshot. Start directly with `# Design System`.'
    ].join('\n');
  }

  // Generate a DESIGN.md from a screenshot alone (1 LLM call).
  // imageDataUrl: base64 data URL (PNG or JPG).
  // Returns: Promise<string> — the generated markdown.
  async function generateDesignMDFromImage(imageDataUrl) {
    if (!imageDataUrl || typeof imageDataUrl !== 'string' || imageDataUrl.indexOf('data:') !== 0) {
      throw new Error('generateDesignMDFromImage: imageDataUrl must be a base64 data URL');
    }

    function callOnce(prompt) {
      return new Promise(function(resolve, reject) {
        chrome.runtime.sendMessage(
          {action: 'modeERebuild', imageDataUrl: imageDataUrl, prompt: prompt},
          function(response) {
            if (response && response.html) resolve(response.html);
            else if (response && response.error) reject(new Error(response.error));
            else reject(new Error('No response from vision API'));
          }
        );
      });
    }

    var basePrompt = buildDesignMDVisionPrompt();
    var raw = await callOnce(basePrompt);
    var cleaned = cleanMarkdown(raw);
    var check = validateLLMOutput(cleaned, {expectedKind: 'markdown'});

    if (!check.valid && check.severity === 'fatal') {
      console.warn('[Mode E] DESIGN.md validator failed (' + check.reason + '), retrying');
      var retryPrompt = basePrompt
        + '\n\nNote: please return only the markdown document, starting with `# Design System`. No preamble or code fences around the whole thing.';
      raw = await callOnce(retryPrompt);
      cleaned = cleanMarkdown(raw);
      var recheck = validateLLMOutput(cleaned, {expectedKind: 'markdown'});
      if (!recheck.valid && recheck.severity === 'fatal') {
        throw new Error('DESIGN.md validation failed twice: ' + recheck.reason);
      }
    }
    return cleaned;
  }

  // Full pipeline from an uploaded image: generate DESIGN.md → reconstruct HTML.
  // This is the standalone-image equivalent of runModeEChunked().
  async function runModeEFromImage(imageDataUrl, onProgress) {
    var log = onProgress || function() {};
    if (!imageDataUrl) {
      log({step: 'error', message: 'No image provided', current: 0, total: 1});
      return null;
    }

    // Step 1: Generate DESIGN.md from the image (vision call)
    log({step: 'designmd', message: 'Analyzing screenshot with vision...', current: 0, total: 4});
    var designMD;
    try {
      designMD = await generateDesignMDFromImage(imageDataUrl);
    } catch(e) {
      log({step: 'error', message: 'Vision analysis failed: ' + e.message, current: 0, total: 4});
      return null;
    }
    log({
      step: 'designmd',
      message: 'DESIGN.md generated (' + Math.round(designMD.length / 1024) + 'KB)',
      current: 1, total: 4
    });

    // Step 2: Reconstruct HTML using the DESIGN.md + the same screenshot
    // Since we have a single image (not a live DOM), we treat the whole image
    // as one "section" and skip the chunked per-section loop.
    log({step: 'rebuild', message: 'Reconstructing HTML...', current: 2, total: 4});
    var syntheticSection = {
      id: 'image-full',
      selector: '',
      tag: 'div',
      className: '',
      bounds: {x: 0, y: 0, w: 0, h: 0},
      isSticky: false,
      isFooter: false,
      cleanHTML: ''
    };
    var html;
    try {
      html = await chunkToHTML(imageDataUrl, designMD, syntheticSection, 0, 1);
    } catch(e) {
      log({step: 'error', message: 'Reconstruction failed: ' + e.message, current: 2, total: 4});
      return {designMD: designMD, html: null, error: e.message};
    }
    log({
      step: 'rebuild',
      message: 'HTML generated (' + Math.round(html.length / 1024) + 'KB)',
      current: 3, total: 4
    });

    // Step 3: Save as a project (same persistence path as chunked runs)
    log({step: 'persist', message: 'Saving project...', current: 3, total: 4});
    var projectMeta = null;
    if (window.__rbPersist) {
      try {
        var created = await window.__rbPersist.createProject({
          url: 'image://upload-' + Date.now(),
          title: 'Image import — ' + new Date().toLocaleString(),
          designMD: designMD,
          stitchedHTML: html,
          sourceScreenshot: imageDataUrl.slice(0, 80000), // capped thumbnail
          chunks: [{sectionId: 'image-full', html: html}]
        });
        projectMeta = created.project;
        window.__rbActiveProjectId = projectMeta.id;
      } catch(e) {
        console.warn('[Mode E] image persist failed:', e);
      }
    }

    log({step: 'done', message: 'Image import complete', current: 4, total: 4});
    return {designMD: designMD, html: html, project: projectMeta};
  }

  // Replace page content with rebuilt sections
  function replacePageContent(sectionsHTML) {
    // Collect editor elements to preserve
    var editorEls = [];
    Array.from(document.body.children).forEach(function(child) {
      if (child.id && (child.id.indexOf('rb-editor') === 0 || child.id.indexOf('rb-ed-') === 0)) {
        editorEls.push(child);
      }
    });

    // Save original non-editor content for undo
    var originalChildren = [];
    Array.from(document.body.children).forEach(function(child) {
      if (editorEls.indexOf(child) === -1) {
        originalChildren.push(child);
      }
    });
    window.__rbOriginalPage = {
      children: originalChildren,
      scrollY: window.scrollY
    };

    // Reference kept so the undo entry below can restore it (we push the
    // entry after the wrapper is actually inserted in the DOM).
    var savedOriginalChildren = originalChildren.slice();
    var savedScrollY = window.scrollY;

    // Build the rebuilt page
    var wrapper = document.createElement('div');
    wrapper.id = 'rb-rebuilt-page';
    wrapper.style.cssText = [
      'max-width: 100%;',
      'margin: 0 auto;',
      'background: #ffffff;',
      'min-height: 100vh;',
      'font-family: system-ui, -apple-system, sans-serif;'
    ].join('');

    sectionsHTML.forEach(function(html) {
      var section = document.createElement('div');
      section.innerHTML = html;
      if (section.children.length === 1) {
        wrapper.appendChild(section.children[0]);
      } else {
        var wrap = document.createElement('div');
        wrap.className = 'rb-section';
        wrap.innerHTML = html;
        wrapper.appendChild(wrap);
      }
    });

    // Load Tailwind Play CDN so Tailwind classes in chunked output resolve.
    // Without this, classes like text-5xl, py-24, font-semibold do nothing.
    var tailwindId = 'rb-tailwind-cdn';
    if (!document.getElementById(tailwindId)) {
      var tw = document.createElement('script');
      tw.id = tailwindId;
      tw.src = 'https://cdn.tailwindcss.com/3.4.17';
      document.head.appendChild(tw);
    }

    // Remove original content but keep editor elements
    originalChildren.forEach(function(child) {
      if (child.parentElement) child.parentElement.removeChild(child);
    });

    // Insert rebuilt page before editor elements
    if (editorEls.length > 0) {
      document.body.insertBefore(wrapper, editorEls[0]);
    } else {
      document.body.appendChild(wrapper);
    }

    document.body.style.margin = '0';
    document.body.style.padding = '0';

    // Push a __modeERun entry to the editor's undoStack so Cmd+Z can
    // revert the entire page replacement. This is the critical fix for
    // Priority 1 (catastrophic Mode E output).
    if (typeof window.__rbPushUndo === 'function') {
      try {
        window.__rbPushUndo({
          prop: '__modeERun',
          originalChildren: savedOriginalChildren,
          scrollY: savedScrollY,
          rebuiltWrapper: wrapper
        });
      } catch(e) { console.warn('[mode-e] pushUndo failed:', e); }
    }

    return wrapper;
  }

  // Restore original page
  function restoreOriginalPage() {
    if (window.__rbOriginalPage) {
      // Remove the rebuilt page and Tailwind CDN
      var rebuilt = document.getElementById('rb-rebuilt-page');
      if (rebuilt) rebuilt.remove();
      var twCdn = document.getElementById('rb-tailwind-cdn');
      if (twCdn) twCdn.remove();
      // Re-insert original children before editor elements
      var editorEls = [];
      Array.from(document.body.children).forEach(function(child) {
        if (child.id && (child.id.indexOf('rb-editor') === 0 || child.id.indexOf('rb-ed-') === 0)) {
          editorEls.push(child);
        }
      });
      var insertBefore = editorEls.length > 0 ? editorEls[0] : null;
      window.__rbOriginalPage.children.forEach(function(child) {
        if (insertBefore) {
          document.body.insertBefore(child, insertBefore);
        } else {
          document.body.appendChild(child);
        }
      });
      window.scrollTo(0, window.__rbOriginalPage.scrollY);
      window.__rbOriginalPage = null;
    }
  }

  // ─── Chunked pipeline (new) ──────────────────────────────────────────
  // Per-section capture + LLM call + stitch. This is the primary path
  // when extractSections() returns >= 2 sections. Uses a shared DESIGN.md
  // across chunks for token consistency, deduplicates the sticky header,
  // and saves the final project to IndexedDB via persist.js.
  async function runModeEChunked(onProgress) {
    var log = onProgress || function() {};
    if (!window.__rbExtractor) {
      log({step: 'error', message: 'Extractor not loaded', current: 0, total: 1});
      return null;
    }

    // Step 1: detect builder + freeze animations
    var builderInfo = window.__rbDetectBuilder ? window.__rbDetectBuilder() : {builder: 'generic'};
    log({step: 'detect', message: 'Detected: ' + builderInfo.builder, current: 0, total: 8});

    if (builderInfo.builder !== 'generic' && window.__rbFreeze) {
      window.__rbFreeze(builderInfo);
      log({step: 'freeze', message: 'Freezing animations...', current: 1, total: 8});
      await new Promise(function(r) { setTimeout(r, 2000); });
    }

    // Step 2: extract sections + DESIGN.md (once, shared across all chunks)
    log({step: 'extract', message: 'Extracting sections and design tokens...', current: 2, total: 8});
    var sectionInfo;
    var designMD = '';
    try {
      sectionInfo = window.__rbExtractor.extractSections();
      designMD = window.__rbExtractor.generateDesignMD() || '';
    } catch(e) {
      log({step: 'error', message: 'Extraction failed: ' + e.message, current: 2, total: 8});
      return null;
    }

    if (!sectionInfo || !sectionInfo.sections || sectionInfo.sections.length < 2) {
      // Fall back to viewport mode for sites where section detection failed
      log({step: 'fallback', message: 'Few sections detected — using viewport fallback', current: 2, total: 8});
      return runModeEViewport(onProgress);
    }

    var sections = sectionInfo.sections;
    log({step: 'extract', message: 'Detected ' + sections.length + ' sections (' + Math.round(designMD.length/1024) + 'KB design)', current: 2, total: 8});

    // Step 3: Capture screenshot per section
    log({step: 'capture', message: 'Capturing ' + sections.length + ' sections...', current: 3, total: 8});
    var originalScroll = window.scrollY;

    // Hide ALL editor UI during capture (not just the sticky header)
    var editorEls = document.querySelectorAll('[id^="rb-editor"], [id^="rb-ed-"]');
    editorEls.forEach(function(el) { el.style.setProperty('display', 'none', 'important'); });

    // Resolve the sticky header element once
    var stickyHeaderEl = null;
    if (sectionInfo.stickyHeader) {
      stickyHeaderEl = resolveSectionElement(sectionInfo.stickyHeader);
    }

    var captures = [];
    try {
      for (var i = 0; i < sections.length; i++) {
        var sec = sections[i];
        var dataUrl = null;
        try {
          dataUrl = await captureSectionScreenshot(sec, sec.isSticky ? null : stickyHeaderEl);
        } catch(e) {
          console.warn('[Mode E] capture failed for section', sec.id, e);
        }
        captures.push({section: sec, dataUrl: dataUrl});
        log({
          step: 'capture',
          message: 'Captured ' + (i + 1) + '/' + sections.length + ' sections',
          current: 3, total: 8
        });
      }
    } finally {
      window.scrollTo(0, originalScroll);
      editorEls.forEach(function(el) { el.style.removeProperty('display'); });
    }

    // Step 4: Send captures to Gemini in a queue (parallel with rate-limit)
    log({step: 'rebuild', message: 'Reconstructing with AI (0/' + captures.length + ')...', current: 4, total: 8});
    var completed = 0;
    var results = await runWithQueue(captures, 2, 500, async function(cap, idx) {
      if (!cap.dataUrl) return {error: new Error('no screenshot'), section: cap.section, idx: idx};
      try {
        // chunkToHTML now validates and retries internally; returns cleaned HTML
        var html = await chunkToHTML(cap.dataUrl, designMD, cap.section, idx, captures.length);
        completed++;
        log({
          step: 'rebuild',
          message: 'Reconstructing with AI (' + completed + '/' + captures.length + ')...',
          current: 4, total: 8
        });
        return {section: cap.section, html: html, idx: idx};
      } catch(err) {
        var msg = err && err.message ? err.message : String(err);
        console.error('[Mode E] chunk ' + idx + ' failed:', msg);
        if (msg.indexOf('No API key') !== -1 || msg.indexOf('unregistered callers') !== -1) {
          throw err; // hard stop
        }
        return {error: err, section: cap.section, idx: idx};
      }
    });

    // Step 5: Filter successful results and sort by visual order
    var successful = results.filter(function(r) { return r && r.html && !r.error; });
    if (successful.length === 0) {
      // Surface the actual error from the first failed chunk instead of a
      // generic "Check API key". The real cause is often a bad payload
      // field or a rate limit — blaming the API key sends users on a wild
      // goose chase.
      var firstErr = results.find(function(r) { return r && r.error; });
      var errMsg = 'All chunks failed';
      if (firstErr && firstErr.error && firstErr.error.message) {
        errMsg += ' — ' + firstErr.error.message;
      }
      console.error('[Mode E] ' + errMsg);
      if (firstErr) console.error('[Mode E] first failure detail:', firstErr.error);
      log({step: 'error', message: errMsg, current: 8, total: 8});
      return null;
    }
    successful.sort(function(a, b) { return a.idx - b.idx; });
    log({step: 'rebuild', message: 'Rebuilt ' + successful.length + '/' + captures.length + ' sections', current: 5, total: 8});

    // Step 6: Stitch results
    log({step: 'stitch', message: 'Stitching sections...', current: 6, total: 8});
    var sectionsHTML = successful.map(function(r) { return r.html; });
    var rebuilt = replacePageContent(sectionsHTML);
    var stitchedHTML = rebuilt ? rebuilt.outerHTML : '';

    // Step 7: Persist project + initial snapshot
    log({step: 'persist', message: 'Saving project...', current: 7, total: 8});
    var projectMeta = null;
    if (window.__rbPersist) {
      try {
        // Capture a small thumbnail from the first section if available
        var thumb = captures.length > 0 && captures[0].dataUrl ? captures[0].dataUrl : '';
        var created = await window.__rbPersist.createProject({
          url: location.href,
          title: (document.title || '').slice(0, 80),
          designMD: designMD,
          stitchedHTML: stitchedHTML,
          sourceScreenshot: thumb,
          chunks: successful.map(function(r) {
            return { sectionId: r.section.id, html: r.html };
          })
        });
        projectMeta = created.project;
        window.__rbActiveProjectId = projectMeta.id;
      } catch(e) {
        console.warn('[Mode E] persist failed:', e);
      }
    }

    log({step: 'done', message: 'Chunking complete (' + successful.length + ' sections saved)', current: 8, total: 8});
    return {rebuilt: rebuilt, project: projectMeta, sections: successful};
  }

  // Alias for clarity — the viewport path is the fallback.
  function runModeEViewport(onProgress) {
    return runModeE(onProgress);
  }

  // Progress callback type: { step: string, current: number, total: number }
  // Main entry point (legacy viewport mode — kept as fallback)
  async function runModeE(onProgress) {
    var log = onProgress || function() {};

    // Step 1: Detect builder
    var builderInfo = window.__rbDetectBuilder ? window.__rbDetectBuilder() : {builder: 'generic'};
    log({step: 'detect', message: 'Detected: ' + builderInfo.builder, current: 0, total: 5});

    // Step 2: Freeze animations — wait for freeze to fully take effect
    if (builderInfo.builder !== 'generic' && window.__rbFreeze) {
      window.__rbFreeze(builderInfo);
      log({step: 'freeze', message: 'Freezing animations...', current: 1, total: 6});
      // Wait 2 seconds for all animations/GSAP/Lenis to fully stop
      await new Promise(function(r) { setTimeout(r, 2000); });
      log({step: 'freeze', message: 'Animations frozen', current: 1, total: 6});
    } else {
      log({step: 'freeze', message: 'No animations to freeze', current: 1, total: 6});
    }

    // Step 3: Extract DESIGN.MD + page structure + asset manifest BEFORE capture
    // (the manifest replaces every <img>/large <svg> with a tag-preserving
    // placeholder; we restore the originals post-gen so the LLM never has to
    // regenerate real assets — see restoreAssets() below).
    var designMD = '';
    var pageStructure = '';
    var assetManifestText = '';
    var assetManifest = [];
    if (window.__rbExtractor) {
      try { designMD = window.__rbExtractor.generateDesignMD() || ''; } catch(e) {}
      try {
        if (window.__rbExtractor.buildAssetManifest) {
          var bundle = window.__rbExtractor.buildAssetManifest();
          pageStructure = (bundle && bundle.cleanHTML) || '';
          assetManifestText = (bundle && bundle.manifestText) || '';
          assetManifest = (bundle && bundle.assets) || [];
          // Cache so runModeEWithRefine's per-section regen can restore assets
          // in the regenerated HTML without re-scanning the DOM (which would
          // see the clone, not the original).
          _lastAssetManifest = assetManifest;
        } else {
          pageStructure = window.__rbExtractor.extractCleanHTML() || '';
        }
      } catch(e) {
        // Last-resort fallback so a broken extractor never blocks rebuild.
        try { pageStructure = window.__rbExtractor.extractCleanHTML() || ''; } catch(_) {}
      }
      var lineCount = designMD.split('\n').length;
      log({
        step: 'tokens',
        message: 'Generated DESIGN.MD (' + lineCount + ' lines) + structure (' + Math.round(pageStructure.length / 1024) + 'KB) + ' + assetManifest.length + ' assets',
        current: 2,
        total: 6
      });
    }

    // Step 4: Capture page
    log({step: 'capture', message: 'Capturing page (' + MAX_VIEWPORTS + ' viewports max)...', current: 3, total: 6});
    var screenshots = await captureFullPage(log);
    log({step: 'capture', message: 'Captured ' + screenshots.length + ' viewports', current: 3, total: 6});

    // Step 5: Send each screenshot + tokens to Gemini Vision IN PARALLEL.
    // The viewport calls are independent — each one reconstructs one vertical
    // slice. Concurrency=3 is the safer default: paid tier (60 RPM) handles it
    // easily, and empirically 5 was triggering occasional 429 backoffs that
    // serialized the whole wave. 3 with 200ms stagger buys stability without
    // much wallclock cost (4 waves instead of 1 for 8 viewports, but each
    // wave still dominates at ~max-call-latency).
    var VIEWPORT_CONCURRENCY = 3;
    var VIEWPORT_STAGGER_MS = 200;
    var completed = 0;
    var totals = makeRunTotals();
    log({step: 'rebuild', message: 'Rebuilding with AI (0/' + screenshots.length + ', concurrency=' + VIEWPORT_CONCURRENCY + ')...', current: 4, total: 6});

    var viewportResults = await runWithQueue(screenshots, VIEWPORT_CONCURRENCY, VIEWPORT_STAGGER_MS, async function(shot, idx) {
      try {
        var resp = await screenshotToHTML(shot.dataUrl, designMD, pageStructure, assetManifestText);
        accumulateCall(totals, resp);
        var cleaned = cleanHTML(resp.html);
        if (cleaned.length > 10) {
          cleaned = restoreAssets(cleaned, assetManifest);
        } else {
          cleaned = '';
        }
        completed++;
        log({
          step: 'rebuild',
          message: 'Rebuilding with AI (' + completed + '/' + screenshots.length + ')...',
          current: 4,
          total: 6
        });
        return { idx: idx, html: cleaned, error: null };
      } catch (err) {
        completed++;
        log({
          step: 'rebuild',
          message: 'Rebuilding with AI (' + completed + '/' + screenshots.length + ', some failed)...',
          current: 4,
          total: 6
        });
        return { idx: idx, html: '', error: err };
      }
    });

    // Propagate cancellation up the stack so wrapTopLevel emits a clean
    // "Cancelled by user" step instead of falling through to "No sections
    // rebuilt" with a misleading API-key message.
    var cancelled = viewportResults.some(function(r) {
      if (!r || !r.error) return false;
      return ((r.error.message || '') + '').indexOf('Cancelled') !== -1;
    });
    if (cancelled) throw new Error('Cancelled by user');

    // Fail-fast for auth errors (no point surfacing per-viewport spam).
    var authErr = viewportResults.find(function(r) {
      if (!r || !r.error) return false;
      var m = (r.error.message || '') + '';
      return m.indexOf('No API key') !== -1 || m.indexOf('unregistered callers') !== -1;
    });
    if (authErr) {
      log({step: 'error', message: 'API key not configured. Open the Repix extension popup → Settings to add your key.', current: 6, total: 6});
      return null;
    }

    // Preserve viewport order so the page stitches top-to-bottom correctly.
    var sectionsHTML = [];
    var failedCount = 0;
    viewportResults
      .slice()
      .sort(function(a, b) { return (a && b) ? a.idx - b.idx : 0; })
      .forEach(function(r) {
        if (!r) return;
        if (r.error) {
          failedCount++;
          console.error('[Mode E] Rebuild failed for viewport ' + r.idx + ':', r.error);
          return;
        }
        if (r.html) sectionsHTML.push(r.html);
      });

    if (failedCount > 0) {
      log({
        step: 'rebuild',
        message: failedCount + ' of ' + screenshots.length + ' viewports failed — continuing with ' + sectionsHTML.length,
        current: 4,
        total: 6
      });
    }

    if (sectionsHTML.length === 0) {
      log({step: 'error', message: 'No sections rebuilt. Open the Repix extension popup → Settings to check your API key.', current: 6, total: 6});
      return null;
    }

    // Step 6: Replace page content
    log({step: 'replace', message: 'Replacing page content...', current: 5, total: 6});
    var rebuilt = replacePageContent(sectionsHTML);
    var summary = formatRunSummary(totals);
    console.log('[Mode E] Run summary: ' + summary +
      ' (' + sectionsHTML.length + ' sections' +
      (failedCount ? ', ' + failedCount + ' failed' : '') + ')');
    log({step: 'done', message: 'Rebuild complete! ' + sectionsHTML.length + ' sections — ' + summary, current: 6, total: 6});

    return rebuilt;
  }

  // ─── Mode E Lean ──────────────────────────────────────────────────────────
  // Aggressive speed variant of Mode E. Trades per-call quality (Flash instead
  // of Pro) and some prompt context (drops DESIGN.MD) for ~4x faster viewport
  // calls. Adds the "floater-as-static-clone" pattern: fixed/sticky elements
  // are captured verbatim from the original DOM and injected post-stitch,
  // giving 100% fidelity on navigation/CTAs while cutting the LLM's workload.
  //
  // Rough budget versus plain Mode E on a 5-viewport site:
  //   Plain E:  5 × Pro @ ~45s parallel concurrency=5 = ~50-70s  (was 5min sequential)
  //   Lean:     5 × Flash @ ~12s parallel concurrency=5 + floater copy = ~20-35s
  async function runModeELean(onProgress) {
    var log = onProgress || function() {};
    var LEAN_MODEL = 'gemini-2.5-flash';

    var builderInfo = window.__rbDetectBuilder ? window.__rbDetectBuilder() : {builder: 'generic'};
    log({step: 'detect', message: 'Detected: ' + builderInfo.builder + ' (Lean/Flash)', current: 0, total: 5});

    if (builderInfo.builder !== 'generic' && window.__rbFreeze) {
      window.__rbFreeze(builderInfo);
      log({step: 'freeze', message: 'Freezing animations...', current: 1, total: 6});
      await new Promise(function(r) { setTimeout(r, 2000); });
      log({step: 'freeze', message: 'Animations frozen', current: 1, total: 6});
    } else {
      log({step: 'freeze', message: 'No animations to freeze', current: 1, total: 6});
    }

    // Page structure + asset manifest (DESIGN.MD intentionally skipped — inline
    // styles already carry font/color info, and the prompt size drop cuts
    // Flash latency meaningfully).
    var pageStructure = '';
    var assetManifestText = '';
    var assetManifest = [];
    if (window.__rbExtractor) {
      try {
        if (window.__rbExtractor.buildAssetManifest) {
          var bundle = window.__rbExtractor.buildAssetManifest();
          pageStructure = (bundle && bundle.cleanHTML) || '';
          assetManifestText = (bundle && bundle.manifestText) || '';
          assetManifest = (bundle && bundle.assets) || [];
          _lastAssetManifest = assetManifest;
        } else {
          pageStructure = window.__rbExtractor.extractCleanHTML() || '';
        }
      } catch (e) {
        try { pageStructure = window.__rbExtractor.extractCleanHTML() || ''; } catch (_) {}
      }
      log({
        step: 'tokens',
        message: 'Structure (' + Math.round(pageStructure.length / 1024) + 'KB) + ' + assetManifest.length + ' assets (DESIGN.MD skipped)',
        current: 2,
        total: 6
      });
    }

    // Snapshot floaters BEFORE capture. These are injected raw post-stitch.
    var floatersHTML = captureFloatersAsStaticHtml();
    if (floatersHTML) {
      log({step: 'floaters', message: 'Snapshotted ' + (floatersHTML.match(/^/gm) || []).length + ' floater element(s) as static clones', current: 2, total: 6});
    }

    // Capture with ALL floaters hidden so the LLM never sees them.
    log({step: 'capture', message: 'Capturing page (Flash pipeline, ' + MAX_VIEWPORTS + ' viewports max)...', current: 3, total: 6});
    var screenshots = await captureFullPage(log, { hideFloatersAlways: true });
    log({step: 'capture', message: 'Captured ' + screenshots.length + ' viewports (floaters hidden)', current: 3, total: 6});

    // Fire viewport LLM calls in parallel. Flash is faster per call AND cheaper,
    // so we can keep concurrency=5 (same as Pro path) without worrying about
    // input token throttling on the typical prompt size.
    var VIEWPORT_CONCURRENCY = 5;
    var VIEWPORT_STAGGER_MS = 100;
    var completed = 0;
    var totals = makeRunTotals();
    log({step: 'rebuild', message: 'Rebuilding with Flash (0/' + screenshots.length + ', concurrency=' + VIEWPORT_CONCURRENCY + ')...', current: 4, total: 6});

    var viewportResults = await runWithQueue(screenshots, VIEWPORT_CONCURRENCY, VIEWPORT_STAGGER_MS, async function(shot, idx) {
      try {
        // DESIGN.MD passed as '' — prompt skips the design section entirely.
        var resp = await screenshotToHTML(shot.dataUrl, '', pageStructure, assetManifestText, { model: LEAN_MODEL });
        accumulateCall(totals, resp);
        var cleaned = cleanHTML(resp.html);
        if (cleaned.length > 10) cleaned = restoreAssets(cleaned, assetManifest);
        else cleaned = '';
        completed++;
        log({
          step: 'rebuild',
          message: 'Rebuilding with Flash (' + completed + '/' + screenshots.length + ')...',
          current: 4,
          total: 6
        });
        return { idx: idx, html: cleaned, error: null };
      } catch (err) {
        completed++;
        log({
          step: 'rebuild',
          message: 'Rebuilding with Flash (' + completed + '/' + screenshots.length + ', some failed)...',
          current: 4,
          total: 6
        });
        return { idx: idx, html: '', error: err };
      }
    });

    var cancelled = viewportResults.some(function(r) {
      if (!r || !r.error) return false;
      return ((r.error.message || '') + '').indexOf('Cancelled') !== -1;
    });
    if (cancelled) throw new Error('Cancelled by user');

    var authErr = viewportResults.find(function(r) {
      if (!r || !r.error) return false;
      var m = (r.error.message || '') + '';
      return m.indexOf('No API key') !== -1 || m.indexOf('unregistered callers') !== -1;
    });
    if (authErr) {
      log({step: 'error', message: 'API key not configured. Open the Repix extension popup → Settings to add your key.', current: 6, total: 6});
      return null;
    }

    var sectionsHTML = [];
    var failedCount = 0;
    viewportResults
      .slice()
      .sort(function(a, b) { return (a && b) ? a.idx - b.idx : 0; })
      .forEach(function(r) {
        if (!r) return;
        if (r.error) {
          failedCount++;
          console.error('[Mode E Lean] Rebuild failed for viewport ' + r.idx + ':', r.error);
          return;
        }
        if (r.html) sectionsHTML.push(r.html);
      });

    if (sectionsHTML.length === 0) {
      log({step: 'error', message: 'No sections rebuilt. Check your API key or try plain Mode E.', current: 6, total: 6});
      return null;
    }

    // Prepend floaters as the FIRST section. replacePageContent wraps the
    // input in the editor's rebuild wrapper, so floaters inside that wrapper
    // with `position: fixed` + z-index will sit above the rebuilt sections.
    log({step: 'replace', message: 'Stitching with ' + (floatersHTML ? 'floaters + ' : '') + sectionsHTML.length + ' sections...', current: 5, total: 6});
    var finalSections = floatersHTML ? [floatersHTML].concat(sectionsHTML) : sectionsHTML;
    var rebuilt = replacePageContent(finalSections);
    var summary = formatRunSummary(totals);
    console.log('[Mode E Lean] Run summary: ' + summary +
      ' (' + sectionsHTML.length + ' sections' +
      (failedCount ? ', ' + failedCount + ' failed' : '') +
      (floatersHTML ? ', + floaters' : '') + ')');
    log({step: 'done', message: 'Lean rebuild complete — ' + sectionsHTML.length + ' sections' + (failedCount ? ' (' + failedCount + ' failed)' : '') + (floatersHTML ? ' + floaters' : '') + ' — ' + summary, current: 6, total: 6});
    return rebuilt;
  }

  // Orchestrated entry: runModeE + one refinement pass.
  // Keeps the original screenshot + generated HTML, pipes them into
  // __rbModeERefine.runRefine. If refinement returns new HTML, swap page
  // content via replacePageContent([newHtml]).
  async function runModeEWithRefine(onProgress) {
    var log = onProgress || function() {};

    if (!window.__rbModeERefine || !window.__rbModeEDiff) {
      log({step: 'refine-fallback', message: 'Refinement modules missing — falling back to plain Mode E', current: 0, total: 1});
      return runModeE(onProgress);
    }

    // Capture the original screenshot BEFORE runModeE injects the clone.
    // (runModeE takes its own screenshots internally but does not expose them;
    // grabbing one here is cheap and keeps the contract simple.)
    log({step: 'refine-pre', message: 'Capturing original…', current: 0, total: 8});
    var originalScreenshot = null;
    var originalGuard = installCaptureGuard();
    try {
      originalGuard.assertVisible();
      var capP = new Promise(function(resolve, reject) {
        chrome.runtime.sendMessage({action: 'captureScreenshot', returnData: true}, function(r) {
          if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
          if (r && r.dataUrl) resolve(r.dataUrl);
          else reject(new Error('captureScreenshot returned no data'));
        });
      });
      originalScreenshot = await withAbortAndTimeout(capP, 30000, 'Original capture');
      originalGuard.assertVisible();
    } catch (e) {
      log({step: 'refine-fallback', message: 'Could not capture original (' + e.message + ') — running plain Mode E', current: 0, total: 1});
      return runModeE(onProgress);
    } finally {
      originalGuard.cleanup();
    }

    // Snapshot DESIGN.MD from the ORIGINAL site before runModeE swaps the DOM.
    // Reading it after inject would read the AI clone's computed styles, which
    // could reinforce hallucinations in the regen prompt.
    var designMD = '';
    try { if (window.__rbExtractor && window.__rbExtractor.generateDesignMD) designMD = window.__rbExtractor.generateDesignMD() || ''; } catch (e) {}

    // Run main Mode E.
    var rebuilt = await runModeE(log);
    if (!rebuilt) return null;

    // Extract the current injected HTML (wrapper.innerHTML).
    var currentHtml = '';
    try { currentHtml = rebuilt.innerHTML || ''; } catch (e) {}
    if (!currentHtml) {
      log({step: 'refine-skip', message: 'No current HTML to refine', current: 8, total: 8});
      return rebuilt;
    }

    // Collect per-section bounds so refine can target only affected sections
    // (per-section regen is much faster than full-page regen and runs in
    // parallel across affected sections).
    var sectionList = [];
    try {
      var secEls = rebuilt.children || [];
      for (var si = 0; si < secEls.length; si++) {
        var sEl = secEls[si];
        if (!(sEl instanceof Element)) continue;
        var r = sEl.getBoundingClientRect();
        sectionList.push({
          idx: si,
          el: sEl,
          html: sEl.outerHTML,
          topY: r.top + window.scrollY,
          height: r.height
        });
      }
    } catch (e) { sectionList = []; }

    // Run refinement.
    var result;
    try {
      result = await window.__rbModeERefine.runRefine({
        originalScreenshot: originalScreenshot,
        currentHtml: currentHtml,
        designMD: designMD,
        sections: sectionList,
        onProgress: log
      });
    } catch (e) {
      log({step: 'refine-skip', message: 'Refinement threw (' + e.message + ') — keeping Mode E output', current: 8, total: 8});
      return rebuilt;
    }

    if (!result || !result.changed) return rebuilt;

    // Per-section update path: swap outerHTML for each regenerated section
    // and run restoreAssets on the new HTML so placeholders become real URLs.
    // Every update passes through validateSectionStructure — if the regen
    // dropped a critical structural tag (<header>, <nav>, <footer>, <main>,
    // <h1>) that existed in the original section, we reject the update and
    // keep the original. Observed in the field: regen stripping the page
    // header when the section in question contained it.
    if (result.sectionUpdates && result.sectionUpdates.length > 0) {
      log({step: 'refine-inject', message: 'Applying ' + result.sectionUpdates.length + ' section update(s)…', current: 8, total: 8});
      var applied = 0, rejected = 0;
      result.sectionUpdates.forEach(function(u) {
        var section = sectionList[u.idx];
        if (!section || !section.el || !section.el.parentNode) return;
        var cleaned = cleanHTML(u.html);
        cleaned = restoreAssets(cleaned, _lastAssetManifest || []);

        var validation = validateSectionStructure(section.html, cleaned);
        if (!validation.ok) {
          console.warn('[Mode E refine] Rejected section ' + u.idx + ': ' + validation.reason + ' — keeping original');
          rejected++;
          return;
        }

        var tmp = document.createElement('div');
        tmp.innerHTML = cleaned;
        var newEl = tmp.firstElementChild;
        if (newEl) {
          section.el.parentNode.replaceChild(newEl, section.el);
          applied++;
        }
      });
      if (rejected > 0) {
        log({step: 'refine-inject', message: 'Applied ' + applied + ' section(s), rejected ' + rejected + ' (structural regression)', current: 8, total: 8});
      }
      return rebuilt;
    }

    // Full-page update path (legacy fallback when sections weren't used).
    if (result.html) {
      log({step: 'refine-inject', message: 'Injecting refined HTML…', current: 8, total: 8});
      return replacePageContent([result.html]);
    }

    return rebuilt;
  }

  // Wrap the exposed entry points so they own an abort controller for the
  // duration of the run. Nested calls (e.g. runWithRefine → runModeE) share
  // the outer controller — nested wraps are no-ops.
  function wrapTopLevel(fn) {
    return async function(onProgress) {
      var owned = false;
      if (!_abortCtrl) { beginRun(); owned = true; }
      // Wrap the caller's onProgress so we can see EVERY event the pipeline
      // emits in DevTools. Hard to diagnose a "widget stuck silent" bug
      // without observing whether the callback fires at all.
      var wrappedProgress = function(p) {
        try {
          console.log('[Mode E progress]', p && p.step, '-', p && p.message, '(', p && p.current, '/', p && p.total, ')');
        } catch (_) {}
        if (typeof onProgress === 'function') onProgress(p);
      };
      try {
        console.log('[Mode E] pipeline START:', fn && fn.name);
        var result = await fn(wrappedProgress);
        console.log('[Mode E] pipeline END:', fn && fn.name, '→', result ? 'result' : 'null');
        return result;
      } catch (e) {
        // CRITICAL: any uncaught error must surface as step:'error' so the
        // activator's loader stops. Without this, non-Cancel throws were
        // being rethrown and becoming unhandled rejections — the widget
        // stayed "running" with spinner forever.
        var msg = (e && e.message) || String(e || 'Unknown error');
        console.error('[Mode E] pipeline THREW:', e);
        if (msg.indexOf('Cancelled') >= 0) {
          wrappedProgress({ step: 'error', message: 'Cancelled by user', current: 0, total: 0 });
        } else {
          wrappedProgress({ step: 'error', message: 'Pipeline error — ' + msg, current: 0, total: 0 });
        }
        return null;
      } finally {
        if (owned) endRun();
      }
    };
  }

  // Expose to global scope
  // run() uses the viewport path (fast, inline styles, no CDN dependency).
  // Chunked path is available via runChunked() but not default — section
  // detection + Tailwind CDN dependency need more work before it's reliable.
  window.__rbModeE = {
    run: wrapTopLevel(runModeE),
    runWithRefine: wrapTopLevel(runModeEWithRefine),
    runLean: wrapTopLevel(runModeELean),
    runChunked: runModeEChunked,
    runViewport: wrapTopLevel(runModeE),
    runFromImage: runModeEFromImage,
    generateDesignMDFromImage: generateDesignMDFromImage,
    restore: restoreOriginalPage,
    captureFullPage: captureFullPage,
    // Cancel the active run. Safe to call anytime; a no-op if nothing is
    // in flight. Propagates through withAbortAndTimeout (below) so in-flight
    // LLM calls reject immediately, the pipeline surfaces a step:'error'
    // 'Cancelled by user' to the activator, and the loader stops.
    cancel: cancelRun,
    isActive: function() { return !!_abortCtrl; },
    // Shared helper for satellite modules (mode-e-diff, mode-e-refine) that
    // need to inherit the same cancel signal + wallclock timeout behavior.
    _guardCall: withAbortAndTimeout,
    _runWithQueue: runWithQueue,
    // Capture guard — banner + visibility detection + hard abort on tab switch.
    // Exposed so satellite modules (refine, classic) can wrap their captures
    // with the same protection.
    _captureGuard: installCaptureGuard
  };
})();
