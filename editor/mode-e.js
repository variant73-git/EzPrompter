// RepixBridge — Mode E: Papel Vegetal (chunked pipeline)
// Extract sections → per-section screenshot → per-section LLM call → stitch.
// The user edits a representation of the site, not the site itself.

(function() {
  'use strict';

  // Build the rebuild prompt for VIEWPORT mode (legacy fallback when
  // extractSections() returns no chunks — e.g., weird single-page sites).
  function buildPrompt(designMD, cleanHTML) {
    var designContext = designMD
      ? '\n\n--- DESIGN.MD (typography and asset inventory reference) ---\n' + designMD.slice(0, 14000)
      : '';

    var structureContext = cleanHTML
      ? '\n\n--- CAPTURED PAGE STRUCTURE (structural reference) ---\n' + cleanHTML.slice(0, 12000)
      : '';

    return [
      'You are a pixel-perfect front-end developer. I will give you a screenshot of ONE viewport section of a website.',
      'Recreate EXACTLY what you see as clean HTML with inline CSS styles.',
      '',
      'SOURCE HIERARCHY (follow this priority order):',
      '1. SCREENSHOT: Primary visual reference — colors, layout, composition, spacing.',
      '2. CAPTURED PAGE STRUCTURE: Structural source — use for text content, semantic tags, hierarchy.',
      '3. DESIGN.MD: Secondary reference — use ONLY for font families, font weights, typographic tone, and asset URLs.',
      '   If DESIGN.MD conflicts with the screenshot on colors, surfaces, layout, or composition, follow the screenshot.',
      '',
      'CRITICAL RULES:',
      '- Reproduce the layout, spacing, colors, typography, and proportions EXACTLY as shown in the screenshot.',
      '- Use a single wrapper: <div class="rb-section" style="...">',
      '- ALL styling must be inline (style="..."). No <style> tags, no external CSS.',
      '- Use semantic tags: header, nav, section, h1-h6, p, a, button, img, span, ul, li.',
      '- Give every element a descriptive class: hero-title, cta-button, nav-logo, etc.',
      '- COLORS: Match every color exactly using hex values from the screenshot. Check DESIGN.MD for exact values.',
      '- FONTS: Use the exact font-family from DESIGN.MD. Include font-weight as specified.',
      '- FONT SIZES: Match sizes carefully. Use px values that match the screenshot.',
      '- SPACING: Match all padding, margins, and gaps precisely in px.',
      '- LAYOUT: Use flexbox. Match the exact positioning (centered, left-aligned, etc.).',
      '- BACKGROUNDS: If a section has a solid color or gradient background, reproduce it exactly with CSS.',
      '  For photo/image backgrounds, use the actual image URL from DESIGN.MD Assets if available,',
      '  otherwise use a solid color that matches the dominant color of the image.',
      '- LOGOS AND BRAND MARKS: NEVER recreate logos as HTML, CSS, SVG, or text. Always use <img src="REAL_URL"> with the URL marked as "logo" in DESIGN.MD Assets.',
      '- IMAGES: Use actual image URLs from DESIGN.MD Assets section. Match by context (logo, hero, photo, avatar). Never generate SVG or HTML approximations of images.',
      '- TEXT: Reproduce ALL visible text content exactly. Use CAPTURED PAGE STRUCTURE for accurate text.',
      '- The section should be full-width (width:100%) with content centered via max-width + margin:0 auto.',
      '- Preserve motion cues from the screenshot (marquee, animations) when visible.',
      '- Do NOT include <html>, <head>, <body> tags.',
      '- Do NOT include any JavaScript.',
      '- Do NOT add comments or explanations.',
      designContext,
      structureContext,
      '',
      'OUTPUT: Return ONLY the raw HTML. No markdown, no code fences, no explanation.',
      'Start directly with <div class="rb-section"'
    ].join('\n');
  }

  // Build the rebuild prompt for CHUNKED mode (one section at a time).
  // The shared designMD ensures all chunks use the same tokens/fonts/colors.
  // Per-chunk cleanHTML gives structural context for this specific section.
  function buildChunkPrompt(designMD, section, sectionIdx, totalSections) {
    var designContext = designMD
      ? '\n\n--- DESIGN.MD (shared across all sections — use for consistency) ---\n' + designMD.slice(0, 14000)
      : '';

    var sectionContext = section.cleanHTML
      ? '\n\n--- THIS SECTION\'S CAPTURED HTML (structural reference for text content and hierarchy) ---\n' + section.cleanHTML.slice(0, 8000)
      : '';

    var role;
    if (section.isSticky) role = 'the sticky HEADER';
    else if (section.isFooter) role = 'the FOOTER';
    else role = 'a content SECTION';

    return [
      'You are reconstructing ' + role + ' of a website as production-ready Tailwind CSS.',
      'This is section ' + (sectionIdx + 1) + ' of ' + totalSections + '. Other sections are being reconstructed separately and will be stitched together.',
      '',
      'SOURCE HIERARCHY:',
      '1. SCREENSHOT (primary): visual fidelity — exact colors, layout, composition, spacing shown in the image.',
      '2. THIS SECTION\'S HTML (secondary): use for text content, semantic tags, hierarchy only.',
      '3. DESIGN.MD (shared): use for font families, weights, color tokens, asset URLs, and MOST IMPORTANTLY the Responsive Behavior section which tells you how to generate Tailwind responsive prefixes (md:, lg:, xl:).',
      '',
      'CONSISTENCY RULES (critical — other chunks depend on this):',
      '- Use EXACT hex values from DESIGN.md Color Palette. Do not improvise colors.',
      '- Use EXACT font-family values from DESIGN.md Typography. Do not substitute system fonts.',
      '- Follow DESIGN.md Source Implementation Cues literally (e.g., "use text-[Nvw]" means do that).',
      '- If DESIGN.md has a Responsive Behavior section, TRANSLATE those CSS rules into Tailwind responsive classes (md:, lg:, xl:).',
      '',
      'OUTPUT RULES:',
      '- Produce ONE root element for this section (<header>, <section>, <nav>, <footer>, or <div>).',
      '- Use Tailwind CSS classes for all styling. No inline style="...", no <style> tags.',
      '- Include responsive classes where DESIGN.md indicates behavior differences per breakpoint.',
      '- Use semantic tags throughout (h1-h6, p, a, button, nav, ul/li).',
      '- For logos and images: use actual URLs from DESIGN.md Assets. Never recreate logos as SVG/CSS.',
      '- Preserve motion cues (marquee, animations) — implement with CSS @keyframes OR Tailwind animate utilities.',
      '- Match every visible text string exactly from the captured HTML.',
      '- Do NOT include <html>, <head>, <body>. Do NOT re-declare global styles or Tailwind directives.',
      '- Do NOT include comments, explanations, or markdown fences.',
      '',
      'Section metadata: ' + JSON.stringify({
        id: section.id,
        tag: section.tag,
        bounds: section.bounds,
        isSticky: section.isSticky,
        isFooter: section.isFooter
      }),
      designContext,
      sectionContext,
      '',
      'OUTPUT: Return ONLY the HTML for this single section. Start directly with the opening tag.'
    ].join('\n');
  }

  // Capture visible viewport as base64 PNG
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

  // Scroll to a position and wait for render
  function scrollToAndWait(y) {
    return new Promise(function(resolve) {
      window.scrollTo(0, y);
      setTimeout(resolve, 800); // longer wait for lazy-loaded content + animations to settle
    });
  }

  // Capture the entire page as an array of viewport screenshots
  var MAX_VIEWPORTS = 8; // Safety limit — prevents excessive API calls on very long pages
  async function captureFullPage() {
    var viewportH = window.innerHeight;
    var pageH = document.documentElement.scrollHeight;
    var screenshots = [];
    var originalScroll = window.scrollY;

    // Hide ALL editor UI during capture
    var editorEls = document.querySelectorAll('[id^="rb-editor"], [id^="rb-ed-"]');
    editorEls.forEach(function(el) { el.style.setProperty('display', 'none', 'important'); });

    var totalViewports = Math.min(Math.ceil(pageH / viewportH), MAX_VIEWPORTS);

    for (var i = 0; i < totalViewports; i++) {
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
        console.error('[Mode E] Capture failed at y=' + y, e);
      }
    }

    // Restore scroll and editor UI
    window.scrollTo(0, originalScroll);
    editorEls.forEach(function(el) { el.style.removeProperty('display'); });

    return screenshots;
  }

  // Send a screenshot to Gemini Vision and get HTML back (viewport mode, legacy)
  function screenshotToHTML(screenshotDataUrl, designMD, cleanHTML) {
    return new Promise(function(resolve, reject) {
      chrome.runtime.sendMessage(
        {
          action: 'modeERebuild',
          imageDataUrl: screenshotDataUrl,
          prompt: buildPrompt(designMD, cleanHTML)
        },
        function(response) {
          if (response && response.html) {
            resolve(response.html);
          } else if (response && response.error) {
            reject(new Error(response.error));
          } else {
            reject(new Error('No response from AI'));
          }
        }
      );
    });
  }

  // Send a section screenshot + context to Gemini Vision (chunked mode)
  function chunkToHTML(screenshotDataUrl, designMD, section, idx, total) {
    return new Promise(function(resolve, reject) {
      chrome.runtime.sendMessage(
        {
          action: 'modeERebuild',
          imageDataUrl: screenshotDataUrl,
          prompt: buildChunkPrompt(designMD, section, idx, total)
        },
        function(response) {
          if (response && response.html) {
            resolve(response.html);
          } else if (response && response.error) {
            reject(new Error(response.error));
          } else {
            reject(new Error('No response from AI'));
          }
        }
      );
    });
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

  // Clean AI output — strip markdown fences if present
  function cleanHTML(raw) {
    var html = raw.trim();
    // Remove ```html ... ``` wrappers
    html = html.replace(/^```(?:html)?\s*/i, '').replace(/\s*```$/i, '');
    // Remove any leading/trailing whitespace
    html = html.trim();
    return html;
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

    return wrapper;
  }

  // Restore original page
  function restoreOriginalPage() {
    if (window.__rbOriginalPage) {
      // Remove the rebuilt page
      var rebuilt = document.getElementById('rb-rebuilt-page');
      if (rebuilt) rebuilt.remove();
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
        var html = await chunkToHTML(cap.dataUrl, designMD, cap.section, idx, captures.length);
        var cleaned = cleanHTML(html);
        completed++;
        log({
          step: 'rebuild',
          message: 'Reconstructing with AI (' + completed + '/' + captures.length + ')...',
          current: 4, total: 8
        });
        return {section: cap.section, html: cleaned, idx: idx};
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
      log({step: 'error', message: 'All chunks failed. Check API key and try again.', current: 8, total: 8});
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

    // Step 3: Extract DESIGN.MD + page structure BEFORE capture (from the live site)
    var designMD = '';
    var pageStructure = '';
    if (window.__rbExtractor) {
      try { designMD = window.__rbExtractor.generateDesignMD() || ''; } catch(e) {}
      try { pageStructure = window.__rbExtractor.extractCleanHTML() || ''; } catch(e) {}
      var lineCount = designMD.split('\n').length;
      log({step: 'tokens', message: 'Generated DESIGN.MD (' + lineCount + ' lines) + structure (' + Math.round(pageStructure.length / 1024) + 'KB)', current: 2, total: 6});
    }

    // Step 4: Capture page
    log({step: 'capture', message: 'Capturing page (' + MAX_VIEWPORTS + ' viewports max)...', current: 3, total: 6});
    var screenshots = await captureFullPage();
    log({step: 'capture', message: 'Captured ' + screenshots.length + ' viewports', current: 3, total: 6});

    // Step 5: Send each screenshot + tokens to Gemini Vision
    log({step: 'rebuild', message: 'Rebuilding with AI (0/' + screenshots.length + ')...', current: 4, total: 6});
    var sectionsHTML = [];
    for (var i = 0; i < screenshots.length; i++) {
      try {
        var html = await screenshotToHTML(screenshots[i].dataUrl, designMD, pageStructure);
        var cleaned = cleanHTML(html);
        if (cleaned.length > 10) {
          sectionsHTML.push(cleaned);
        }
        log({
          step: 'rebuild',
          message: 'Rebuilding with AI (' + (i + 1) + '/' + screenshots.length + ')...',
          current: 4,
          total: 6
        });
      } catch(err) {
        console.error('[Mode E] Rebuild failed for viewport ' + i + ':', err);
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

    // Step 6: Replace page content
    log({step: 'replace', message: 'Replacing page content...', current: 5, total: 6});
    var rebuilt = replacePageContent(sectionsHTML);
    log({step: 'done', message: 'Rebuild complete! ' + sectionsHTML.length + ' sections.', current: 6, total: 6});

    return rebuilt;
  }

  // Expose to global scope
  // run() goes through the chunked path by default; runViewport() is the legacy fallback
  window.__rbModeE = {
    run: runModeEChunked,
    runChunked: runModeEChunked,
    runViewport: runModeE,
    restore: restoreOriginalPage,
    captureFullPage: captureFullPage
  };
})();
