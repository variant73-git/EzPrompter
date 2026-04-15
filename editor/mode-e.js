// RepixBridge — Mode E: Papel Vegetal (chunked pipeline)
// Extract sections → per-section screenshot → per-section LLM call → stitch.
// The user edits a representation of the site, not the site itself.

(function() {
  'use strict';

  // Build the rebuild prompt for VIEWPORT mode (legacy fallback when
  // extractSections() returns no chunks — e.g., weird single-page sites).
  // Mirrors the chunked prompt structure (Aura "EXACTLY mode" style) but
  // reconstructs an entire viewport at once instead of a single section.
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
      'CRITICAL OUTPUT CONSTRAINT (absolute — any violation makes your response unusable):',
      '- Your response MUST contain ONLY raw HTML markup starting with `<div class="rb-section"`.',
      '- NO reasoning, thinking, commentary, "Let me consider", "Wait, let me", or any prose.',
      '- NO markdown code fences: no ```html, no ```xml, no triple backticks.',
      '- NO echoing of these rules back to me.',
      '- If you would have included SVG icons but they risk breaking the output, OMIT the icons.',
      '- The FIRST character of your response MUST be "<".',
      '- If you cannot follow these constraints, return the empty string instead of broken output.',
      '',
      'Start the HTML now:'
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
      'CRITICAL OUTPUT CONSTRAINT (absolute — any violation makes your response unusable):',
      '- Your response MUST contain ONLY raw HTML markup. Nothing else.',
      '- NO reasoning, thinking, commentary, "Let me consider", "Wait, let me", "Looking at", or any prose.',
      '- NO markdown code fences: no ```html, no ```xml, no ```markdown, no triple backticks of any kind.',
      '- NO echoing of these rules back to me. NO quoting of the prompt.',
      '- NO explanations before or after the HTML.',
      '- If you feel uncertain, produce your best-guess HTML silently. Do NOT explain your uncertainty.',
      '- If you would have included SVG icons but they risk breaking the output, OMIT the icons. A missing icon is always better than malformed markup.',
      '- The FIRST character of your response MUST be "<".',
      '- The LAST character of your response MUST be ">".',
      '- If you cannot follow these constraints, return the empty string instead of broken output.',
      '',
      'Start the HTML now:'
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
  // Low-level LLM call for a single chunk (no validation, used by the
  // retry wrapper below).
  function chunkToHTMLRaw(screenshotDataUrl, prompt) {
    return new Promise(function(resolve, reject) {
      chrome.runtime.sendMessage(
        {
          action: 'modeERebuild',
          imageDataUrl: screenshotDataUrl,
          prompt: prompt
        },
        function(response) {
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
      console.warn('[Mode E] chunk ' + idx + ' validator failed (' + check.reason + '), retrying with stricter prompt');
      var strictPrompt = basePrompt
        + '\n\nRETRY INSTRUCTION: Your previous response was REJECTED because ' + check.reason + '.'
        + '\nThis time, output ONLY the raw HTML. Start with `<`. End with `>`.'
        + '\nDo NOT include markdown code fences, reasoning, explanations, or any prose.'
        + '\nIf the previous failure was caused by SVG icons, OMIT the icons entirely — a missing icon is better than broken markup.';
      raw = await chunkToHTMLRaw(screenshotDataUrl, strictPrompt);
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
      'CRITICAL OUTPUT CONSTRAINT (absolute — any violation makes your response unusable):',
      '- Your response MUST contain ONLY the markdown document starting with `# Design System`.',
      '- NO reasoning, thinking, "Let me analyze", "Looking at this", or any prose before the document.',
      '- NO wrapping code fences (no ```markdown, no ```md, no triple backticks surrounding the whole response).',
      '- NO explanations after the document.',
      '- The FIRST 15 characters of your response MUST be exactly "# Design System".',
      '- Do NOT include the reference example in your output. Produce a NEW DESIGN.md for the ATTACHED screenshot.',
      '',
      'Start the markdown now:'
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
      var strictPrompt = basePrompt
        + '\n\nRETRY INSTRUCTION: Your previous response was REJECTED because ' + check.reason + '.'
        + '\nThis time, output ONLY the markdown document. Start with `# Design System`. Do NOT include reasoning, explanations, or wrapping code fences.';
      raw = await callOnce(strictPrompt);
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
    runFromImage: runModeEFromImage,
    generateDesignMDFromImage: generateDesignMDFromImage,
    restore: restoreOriginalPage,
    captureFullPage: captureFullPage
  };
})();
