// RepixBridge — S2H: Screenshot-to-HTML pipeline
// Two-pass vision pipeline for high-fidelity reconstruction from screenshots.
//
// Pass 1 (Analysis): screenshot → vision model → structured visual brief
// Pass 2 (Reconstruction): screenshot + brief → vision model → HTML/CSS
//
// Separate from Mode E. This module is self-contained and operates on any
// screenshot — no DOM access, no live page required.

(function() {
  'use strict';

  // ─── PASS 1: Visual Analysis Prompt ─────────────────────────────────
  // The analysis prompt extracts structured data from the screenshot.
  // Key differences from Mode E's designMD prompt:
  //   - Demands EXACT text transcription (OCR quality)
  //   - Demands EXACT layout structure (grid, proportions)
  //   - Demands color hex sampled from pixels, not approximated
  //   - Maps visual regions with relative positions
  //   - Describes font characteristics, not guesses font names
  //
  // The output is a VISUAL BRIEF — a structured document that gives the
  // reconstruction pass all the data it needs alongside the screenshot.

  function buildAnalysisPrompt() {
    return [
      'You are an expert visual analyst. Your job is to produce a precise, structured brief from a website screenshot. This brief will be used by another AI alongside the same screenshot to reconstruct the page as HTML/CSS.',
      '',
      'CRITICAL: You must LOOK at the screenshot carefully. Sample colors from actual pixels. Read every word of text exactly as written. Describe the actual layout, not what you assume it should be.',
      '',
      'Produce a VISUAL BRIEF in this exact format:',
      '',
      '---',
      '',
      '# Visual Brief',
      '',
      '## Tone',
      'One rich paragraph describing the design personality, visual mood, and aesthetic direction. Be specific — mention the dominant color family, the typography style, the overall density, the feeling it evokes. This paragraph primes the reconstruction model.',
      '',
      '## Layout',
      'Describe the page composition section by section, top to bottom:',
      '- For each visual section, describe:',
      '  - Its role (nav, hero, content block, footer, etc.)',
      '  - Its background color or treatment (exact hex sampled from pixels)',
      '  - Its internal layout: single column? 2-column grid? What proportions? (e.g., "60/40 split, text left, image right")',
      '  - Approximate height relative to viewport (e.g., "~100vh", "~300px")',
      '  - Alignment: left-aligned? centered? asymmetric?',
      '- FOR THE NAVIGATION BAR, describe with precision:',
      '  - Horizontal arrangement: logo position, links position, CTA position (e.g., "logo left, links center, CTA right")',
      '  - How elements are spaced: flexbox with space-between? fixed gaps? centered group?',
      '  - Max-width constraint: is the nav full-width or constrained to a max-width container?',
      '  - Vertical alignment: centered? baseline-aligned?',
      '  - Any visual separators (borders, background change)',
      '',
      '## Colors',
      'List every distinct color visible in the screenshot:',
      '- Sample hex values from the actual pixels. Do NOT round to convenient values.',
      '- Format: `#hexval` — role (where it appears)',
      '- Group by: backgrounds, text colors, accent/brand colors, borders/subtle',
      '- Identify the DOMINANT background color (the one covering the most area)',
      '',
      '## Typography',
      'Describe the typographic system with HIGH PRECISION:',
      '- Do NOT guess font family names unless you are highly confident. Instead describe characteristics: "geometric sans-serif", "humanist sans", "condensed grotesque", "transitional serif", etc.',
      '- If you can confidently identify a font (e.g., Inter, Helvetica, Georgia), name it.',
      '- PAY SPECIAL ATTENTION TO HEADINGS (H1, H2):',
      '  - Measure the H1 font size PRECISELY relative to viewport width (e.g., "~72px at 1440px viewport" or "~5vw")',
      '  - Note if the heading uses a DIFFERENT font family than body text (serif vs sans-serif is common)',
      '  - Note exact weight — many hero headings use light/thin (300) or regular (400), NOT bold',
      '  - Note line-height (tight like 1.0-1.1, or loose like 1.3-1.5)',
      '  - Note letter-spacing (negative tracking is common in large headings)',
      '- List each distinct text style you see:',
      '  - Role (main heading, subheading, nav link, body, button label, badge, etc.)',
      '  - Approximate size in px (BE PRECISE for headings — measure against viewport)',
      '  - Weight (light/regular/medium/semibold/bold/black)',
      '  - Case (uppercase/lowercase/sentence case)',
      '  - Color (hex)',
      '  - Any notable properties (letter-spacing, italic, underline, line-height)',
      '',
      '## Content Transcription',
      'Transcribe ALL visible text in the screenshot, in reading order (top to bottom, left to right):',
      '- Use hierarchy markers: [H1], [H2], [NAV], [BUTTON], [BADGE], [BODY], [LABEL], [FOOTER]',
      '- Transcribe EXACTLY as written — preserve language, capitalization, punctuation, line breaks',
      '- If text is partially cut off, transcribe what is visible and mark with [...] for the hidden part',
      '- Do NOT translate, paraphrase, or "improve" any text',
      '',
      '## Images & Media',
      'For each image/photo visible in the screenshot:',
      '- Describe its content (what the image shows)',
      '- Its position in the layout (e.g., "right half of hero section")',
      '- Its approximate dimensions relative to its container',
      '- Its visual treatment (rounded corners? overlay? filter? border?)',
      '- Whether it is a photo, illustration, icon, logo, or pattern',
      '',
      '## Components',
      'List distinct UI components:',
      '- Buttons: shape, size, color, border, text style, any icons',
      '- Navigation: layout, link style, active state',
      '- Cards: if any, their structure and styling',
      '- Badges/Tags: shape, color, typography',
      '- Any other repeated or notable components',
      '',
      '---',
      '',
      'RULES:',
      '- Return ONLY the visual brief. No preamble, no commentary.',
      '- Start directly with `# Visual Brief`',
      '- Be precise and concrete. "Purple" is wrong — "#7c3aed (vibrant purple)" is right.',
      '- If you cannot determine something with confidence, say "UNCLEAR" rather than guessing.',
      '- The quality of the reconstruction depends entirely on your accuracy here.'
    ].join('\n');
  }

  // ─── PASS 2: Reconstruction Prompt ──────────────────────────────────
  // The reconstruction prompt receives BOTH the screenshot AND the visual
  // brief from Pass 1. The screenshot is the PRIMARY reference (visual
  // fidelity). The brief is the SECONDARY reference (structured data:
  // exact colors, exact text, layout description).

  function buildReconstructionPrompt(visualBrief) {
    return [
      'You are an expert frontend developer. Reconstruct the attached screenshot as pixel-perfect HTML + CSS.',
      '',
      'You have TWO inputs:',
      '1. THE SCREENSHOT (attached image) — your PRIMARY visual reference. Match it exactly.',
      '2. A VISUAL BRIEF (below) — structured data extracted from the same screenshot. Use it for exact hex colors, exact text content, and layout specifications.',
      '',
      'VISUAL BRIEF:',
      '---',
      visualBrief,
      '---',
      '',
      'RECONSTRUCTION RULES:',
      '',
      '1. LAYOUT FIDELITY:',
      '   - Match the exact layout structure from the screenshot: grid proportions, column splits, alignment.',
      '   - Use CSS Grid or Flexbox as appropriate for each section.',
      '   - Match spacing (padding, margins, gaps) visually — estimate px values by comparing to element sizes.',
      '   - Full-width sections with content constrained by max-width where appropriate.',
      '   - NAVIGATION: match the exact horizontal arrangement from the brief. If "logo left, links center, CTA right", use display:flex with justify-content:space-between or a 3-column layout. Do NOT collapse all items to one side.',
      '',
      '2. COLOR FIDELITY:',
      '   - Use the hex values from the Visual Brief.',
      '   - If the screenshot shows a color not in the brief, sample it yourself from the image.',
      '   - Background colors, text colors, and accent colors must match exactly.',
      '',
      '3. TYPOGRAPHY (CRITICAL — this is where most reconstructions fail):',
      '   - Use the font characteristics from the Visual Brief.',
      '   - If a specific font family was identified, use it (import from Google Fonts if available).',
      '   - If only characteristics were given ("geometric sans-serif"), choose the closest Google Font match.',
      '   - HEADINGS (H1, H2) MUST match the screenshot proportions exactly:',
      '     - Size: if the brief says "~72px", use 72px. Do NOT scale down.',
      '     - Weight: if the brief says "regular (400)", use font-weight:400. Do NOT default to bold.',
      '     - Line-height: match tightly. Large headings often use line-height:1.0 to 1.1.',
      '     - Letter-spacing: large headings often use negative tracking (e.g., -0.02em).',
      '     - If the heading uses a DIFFERENT font than body (e.g., serif heading + sans body), import BOTH.',
      '   - Match sizes, weights, letter-spacing, and text-transform exactly.',
      '',
      '4. TEXT CONTENT:',
      '   - Use the EXACT text from the Visual Brief Content Transcription section.',
      '   - Do NOT invent, translate, or paraphrase any text.',
      '   - Preserve the original language and capitalization.',
      '',
      '5. IMAGES:',
      '   - For photos/images in the screenshot, use a solid color placeholder that matches the dominant color of that image region.',
      '   - Add a comment above the placeholder with what image should go there: <!-- IMAGE: concert photo with golden stage lights -->',
      '   - Use the exact dimensions and position described in the Visual Brief.',
      '   - For logos/icons, attempt to recreate with CSS/SVG if simple, otherwise use a placeholder.',
      '',
      '6. OUTPUT FORMAT:',
      '   - Single HTML file with embedded <style> tag (NO inline styles — use classes).',
      '   - Include Google Fonts <link> imports in the output if needed.',
      '   - Use semantic HTML: header, nav, main, section, footer, h1-h6, p, a, button.',
      '   - Give every styled element a descriptive class name.',
      '   - The page must be full-width and responsive-ready (use relative units where appropriate).',
      '   - Do NOT include <html>, <head>, or <body> tags — start with the <style> block, then the markup.',
      '   - Do NOT include any JavaScript.',
      '   - Do NOT include any comments or explanations outside of image placeholders.',
      '',
      '7. ANTI-PATTERNS (do NOT do these):',
      '   - Do NOT default to a dark theme unless the screenshot is actually dark.',
      '   - Do NOT center everything — match the actual alignment from the screenshot.',
      '   - Do NOT use generic placeholder colors — match every color to the screenshot.',
      '   - Do NOT simplify the layout — if the screenshot shows an asymmetric 60/40 grid, build that.',
      '   - Do NOT add design interpretation beyond what is visible.',
      '   - Do NOT use inline styles. Use a <style> block with classes.',
      '',
      'OUTPUT: Return ONLY the HTML (starting with <style>). No markdown fences, no explanation, no preamble.'
    ].join('\n');
  }

  // ─── Utilities ──────────────────────────────────────────────────────

  function cleanHTML(raw) {
    var html = (raw || '').trim();
    // Strip markdown code fences if model wrapped them
    html = html.replace(/^```(?:html|css)?\s*/i, '').replace(/\s*```$/i, '');
    return html.trim();
  }

  function cleanMarkdown(raw) {
    var md = (raw || '').trim();
    md = md.replace(/^```(?:markdown|md)?\s*/i, '').replace(/\s*```$/i, '');
    return md.trim();
  }

  // Validate that the visual brief has the critical sections
  function validateBrief(text) {
    if (!text || text.trim().length < 200) {
      return { valid: false, reason: 'brief too short', severity: 'fatal' };
    }
    var required = ['# Visual Brief', '## Layout', '## Colors', '## Content Transcription'];
    for (var i = 0; i < required.length; i++) {
      if (text.indexOf(required[i]) === -1) {
        return { valid: false, reason: 'missing section: ' + required[i], severity: 'fatal' };
      }
    }
    return { valid: true, reason: 'ok', severity: 'ok' };
  }

  // Validate reconstruction output
  function validateHTML(text) {
    if (!text || text.trim().length < 100) {
      return { valid: false, reason: 'output too short', severity: 'fatal' };
    }
    if (!/<\w+[\s>]/.test(text)) {
      return { valid: false, reason: 'no HTML tags found', severity: 'fatal' };
    }
    // Check for reasoning phrases (LLM thinking out loud)
    var reasoning = [
      /\blet me (think|reconsider|check|analyze)/i,
      /\bactually,?\s+(i|the|let's)/i,
      /\bi (notice|see|think|believe|need to)/i,
      /\blooking at (the|this)/i
    ];
    for (var j = 0; j < reasoning.length; j++) {
      if (reasoning[j].test(text)) {
        return { valid: false, reason: 'reasoning detected', severity: 'fatal' };
      }
    }
    return { valid: true, reason: 'ok', severity: 'ok' };
  }

  // Call the Gemini Vision API via background.js
  function callVision(imageDataUrl, prompt) {
    return new Promise(function(resolve, reject) {
      chrome.runtime.sendMessage(
        { action: 'modeERebuild', imageDataUrl: imageDataUrl, prompt: prompt },
        function(response) {
          if (response && response.html) resolve(response.html);
          else if (response && response.error) reject(new Error(response.error));
          else reject(new Error('No response from vision API'));
        }
      );
    });
  }

  // ─── Main Pipeline ──────────────────────────────────────────────────

  async function runS2H(imageDataUrl, onProgress) {
    var log = onProgress || function() {};

    if (!imageDataUrl || typeof imageDataUrl !== 'string' || imageDataUrl.indexOf('data:') !== 0) {
      log({ step: 'error', message: 'Invalid image data', current: 0, total: 3 });
      return null;
    }

    // ── PASS 1: Visual Analysis ──
    log({ step: 'analysis', message: 'Pass 1/2: Analyzing screenshot...', current: 1, total: 3 });

    var analysisPrompt = buildAnalysisPrompt();
    var rawBrief;
    try {
      rawBrief = await callVision(imageDataUrl, analysisPrompt);
    } catch (e) {
      log({ step: 'error', message: 'Analysis failed: ' + e.message, current: 1, total: 3 });
      return null;
    }

    var brief = cleanMarkdown(rawBrief);
    var briefCheck = validateBrief(brief);

    if (!briefCheck.valid && briefCheck.severity === 'fatal') {
      console.warn('[S2H] Brief validation failed (' + briefCheck.reason + '), retrying...');
      log({ step: 'analysis', message: 'Retrying analysis...', current: 1, total: 3 });
      try {
        rawBrief = await callVision(imageDataUrl, analysisPrompt + '\n\nReminder: start directly with `# Visual Brief`. No code fences or preamble.');
        brief = cleanMarkdown(rawBrief);
        var recheck = validateBrief(brief);
        if (!recheck.valid && recheck.severity === 'fatal') {
          log({ step: 'error', message: 'Analysis failed twice: ' + recheck.reason, current: 1, total: 3 });
          return null;
        }
      } catch (e2) {
        log({ step: 'error', message: 'Analysis retry failed: ' + e2.message, current: 1, total: 3 });
        return null;
      }
    }

    console.log('[S2H] Visual brief generated (' + brief.length + ' chars)');

    // ── PASS 2: Reconstruction ──
    log({ step: 'reconstruct', message: 'Pass 2/2: Reconstructing HTML...', current: 2, total: 3 });

    var reconstructPrompt = buildReconstructionPrompt(brief);
    var rawHTML;
    try {
      rawHTML = await callVision(imageDataUrl, reconstructPrompt);
    } catch (e) {
      log({ step: 'error', message: 'Reconstruction failed: ' + e.message, current: 1, total: 3 });
      return null;
    }

    var html = cleanHTML(rawHTML);
    var htmlCheck = validateHTML(html);

    if (!htmlCheck.valid && htmlCheck.severity === 'fatal') {
      console.warn('[S2H] HTML validation failed (' + htmlCheck.reason + '), retrying...');
      log({ step: 'reconstruct', message: 'Retrying reconstruction...', current: 2, total: 3 });
      try {
        rawHTML = await callVision(imageDataUrl, reconstructPrompt + '\n\nReminder: return ONLY the HTML starting with <style>. No markdown fences, no explanation.');
        html = cleanHTML(rawHTML);
        var recheckHTML = validateHTML(html);
        if (!recheckHTML.valid && recheckHTML.severity === 'fatal') {
          log({ step: 'error', message: 'Reconstruction failed twice: ' + recheckHTML.reason, current: 2, total: 3 });
          return null;
        }
      } catch (e2) {
        log({ step: 'error', message: 'Reconstruction retry failed: ' + e2.message, current: 2, total: 3 });
        return null;
      }
    }

    console.log('[S2H] HTML reconstructed (' + html.length + ' chars)');
    log({ step: 'done', message: 'Reconstruction complete!', current: 3, total: 3 });

    return {
      brief: brief,
      html: html
    };
  }

  // ─── Page replacement (reuses Mode E wrapper logic) ─────────────────

  function replacePageWithS2H(html) {
    // Collect editor elements to preserve
    var editorEls = [];
    Array.from(document.body.children).forEach(function(child) {
      if (child.id && (child.id.indexOf('rb-editor') === 0 || child.id.indexOf('rb-ed-') === 0)) {
        editorEls.push(child);
      }
    });

    // Save original content for undo
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

    // Build wrapper
    var wrapper = document.createElement('div');
    wrapper.id = 'rb-rebuilt-page';
    wrapper.style.cssText = 'max-width:100%;margin:0 auto;min-height:100vh;';
    wrapper.innerHTML = html;

    // Remove original content
    originalChildren.forEach(function(child) {
      if (child.parentElement) child.parentElement.removeChild(child);
    });

    // Insert before editor elements
    if (editorEls.length > 0) {
      document.body.insertBefore(wrapper, editorEls[0]);
    } else {
      document.body.appendChild(wrapper);
    }

    document.body.style.margin = '0';
    document.body.style.padding = '0';

    // Push undo entry if editor is active
    if (typeof window.__rbPushUndo === 'function') {
      try {
        var saved = originalChildren.slice();
        var scrollY = window.scrollY;
        window.__rbPushUndo({
          type: '__modeERun',
          apply: function() {
            if (wrapper.parentElement) wrapper.parentElement.removeChild(wrapper);
            saved.forEach(function(c) { document.body.appendChild(c); });
            window.scrollTo(0, scrollY);
          }
        });
      } catch (e) { console.warn('[S2H] undo push failed:', e); }
    }

    return wrapper;
  }

  // ─── Multi-viewport full-page pipeline ──────────────────────────────

  var MAX_VIEWPORTS = 8;

  function captureViewport() {
    return new Promise(function(resolve) {
      chrome.runtime.sendMessage(
        { action: 'captureScreenshot', format: 'png', returnData: true },
        function(response) { resolve(response && response.dataUrl ? response.dataUrl : null); }
      );
    });
  }

  function scrollToAndWait(y) {
    return new Promise(function(resolve) {
      window.scrollTo(0, y);
      setTimeout(resolve, 300);
    });
  }

  async function runFullPage(onProgress) {
    var log = onProgress || function() {};
    var viewportH = window.innerHeight;
    var pageH = document.documentElement.scrollHeight;
    var totalViewports = Math.min(Math.ceil(pageH / viewportH), MAX_VIEWPORTS);
    var originalScroll = window.scrollY;

    log({ step: 'capture', message: 'Capturing ' + totalViewports + ' viewports...', current: 0, total: totalViewports * 3 });

    // Hide editor UI during capture
    var editorEls = document.querySelectorAll('[id^="rb-editor"], [id^="rb-ed-"]');
    editorEls.forEach(function(el) { el.style.setProperty('display', 'none', 'important'); });

    // Capture all viewports
    var screenshots = [];
    for (var i = 0; i < totalViewports; i++) {
      var y = i * viewportH;
      await scrollToAndWait(y);
      var dataUrl = await captureViewport();
      if (dataUrl) {
        screenshots.push({ index: i, y: y, dataUrl: dataUrl });
        log({ step: 'capture', message: 'Captured viewport ' + (i + 1) + '/' + totalViewports, current: i + 1, total: totalViewports * 3 });
      }
    }

    // Restore scroll and editor UI
    window.scrollTo(0, originalScroll);
    editorEls.forEach(function(el) { el.style.removeProperty('display'); });

    if (screenshots.length === 0) {
      log({ step: 'error', message: 'No screenshots captured' });
      return null;
    }

    // Process each viewport: Pass 1 (analysis) + Pass 2 (reconstruction)
    var htmlChunks = [];
    var analysisPrompt = buildAnalysisPrompt();

    for (var v = 0; v < screenshots.length; v++) {
      var shot = screenshots[v];
      var vpLabel = 'Viewport ' + (v + 1) + '/' + screenshots.length;

      // Pass 1: Analysis
      log({ step: 'analysis', message: vpLabel + ' — Pass 1: Analyzing...', current: totalViewports + v * 2 + 1, total: totalViewports * 3 });
      var brief;
      try {
        var rawBrief = await callVision(shot.dataUrl, analysisPrompt);
        brief = cleanMarkdown(rawBrief);
        var briefCheck = validateBrief(brief);
        if (!briefCheck.valid && briefCheck.severity === 'fatal') {
          console.warn('[S2H] Brief validation failed for viewport ' + (v+1) + ': ' + briefCheck.reason);
          brief = rawBrief; // Use unvalidated
        }
      } catch (e) {
        log({ step: 'error', message: vpLabel + ' — Analysis failed: ' + e.message });
        continue; // Skip this viewport
      }

      // Pass 2: Reconstruction
      log({ step: 'reconstruct', message: vpLabel + ' — Pass 2: Reconstructing...', current: totalViewports + v * 2 + 2, total: totalViewports * 3 });
      var sectionPrompt = buildReconstructionPrompt(brief);
      // Add viewport context
      sectionPrompt += '\n\nCONTEXT: This is viewport ' + (v + 1) + ' of ' + screenshots.length + ' (scrolling top to bottom). ';
      if (v === 0) sectionPrompt += 'This is the TOP of the page — it likely contains the navigation bar and hero section.';
      else if (v === screenshots.length - 1) sectionPrompt += 'This is the BOTTOM of the page — it likely contains footer content.';
      else sectionPrompt += 'This is a MIDDLE section of the page.';

      try {
        var rawHTML = await callVision(shot.dataUrl, sectionPrompt);
        var html = cleanHTML(rawHTML);
        if (html.length > 50) {
          htmlChunks.push({ index: v, html: html });
        }
      } catch (e) {
        log({ step: 'error', message: vpLabel + ' — Reconstruction failed: ' + e.message });
        continue;
      }
    }

    if (htmlChunks.length === 0) {
      log({ step: 'error', message: 'All viewports failed' });
      return null;
    }

    // Stitch: extract styles + merge body content
    var allStyles = [];
    var allBody = [];
    htmlChunks.forEach(function(chunk) {
      // Extract <style> blocks
      var styleMatch;
      var styleRe = /<style[^>]*>([\s\S]*?)<\/style>/gi;
      while ((styleMatch = styleRe.exec(chunk.html)) !== null) {
        allStyles.push(styleMatch[1]);
      }
      // Extract body content (everything after last </style>)
      var bodyContent = chunk.html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '').trim();
      // Remove duplicate Google Fonts links (keep only first occurrence)
      if (chunk.index > 0) {
        bodyContent = bodyContent.replace(/<link[^>]*fonts\.googleapis[^>]*>/gi, '');
      }
      if (bodyContent) allBody.push('<!-- viewport ' + (chunk.index + 1) + ' -->\n' + bodyContent);
    });

    // Extract Google Fonts links from first chunk
    var fontsLinks = '';
    var fontMatch = htmlChunks[0].html.match(/<link[^>]*fonts\.googleapis[^>]*>/gi);
    if (fontMatch) fontsLinks = fontMatch.join('\n') + '\n';

    var stitchedHTML = fontsLinks + '<style>\n' + allStyles.join('\n\n') + '\n</style>\n\n' + allBody.join('\n\n');

    log({ step: 'done', message: 'Full page reconstructed (' + htmlChunks.length + '/' + screenshots.length + ' viewports)', current: totalViewports * 3, total: totalViewports * 3 });

    return {
      brief: null,
      html: stitchedHTML,
      viewportCount: screenshots.length,
      successCount: htmlChunks.length
    };
  }

  // ─── Expose ─────────────────────────────────────────────────────────

  window.__rbS2H = {
    run: runS2H,
    runFullPage: runFullPage,
    replacePage: replacePageWithS2H,
    _buildAnalysisPrompt: buildAnalysisPrompt,
    _buildReconstructionPrompt: buildReconstructionPrompt
  };

})();
