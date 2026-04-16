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
      '',
      '## Colors',
      'List every distinct color visible in the screenshot:',
      '- Sample hex values from the actual pixels. Do NOT round to convenient values.',
      '- Format: `#hexval` — role (where it appears)',
      '- Group by: backgrounds, text colors, accent/brand colors, borders/subtle',
      '- Identify the DOMINANT background color (the one covering the most area)',
      '',
      '## Typography',
      'Describe the typographic system:',
      '- Do NOT guess font family names unless you are highly confident. Instead describe characteristics: "geometric sans-serif", "humanist sans", "condensed grotesque", "transitional serif", etc.',
      '- If you can confidently identify a font (e.g., Inter, Helvetica, Georgia), name it.',
      '- List each distinct text style you see:',
      '  - Role (main heading, subheading, nav link, body, button label, badge, etc.)',
      '  - Approximate size in px',
      '  - Weight (light/regular/medium/semibold/bold/black)',
      '  - Case (uppercase/lowercase/sentence case)',
      '  - Color (hex)',
      '  - Any notable properties (letter-spacing, italic, underline)',
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
      '',
      '2. COLOR FIDELITY:',
      '   - Use the hex values from the Visual Brief.',
      '   - If the screenshot shows a color not in the brief, sample it yourself from the image.',
      '   - Background colors, text colors, and accent colors must match exactly.',
      '',
      '3. TYPOGRAPHY:',
      '   - Use the font characteristics from the Visual Brief.',
      '   - If a specific font family was identified, use it (import from Google Fonts if available).',
      '   - If only characteristics were given ("geometric sans-serif"), choose the closest Google Font match.',
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

  // ─── Expose ─────────────────────────────────────────────────────────

  window.__rbS2H = {
    run: runS2H,
    replacePage: replacePageWithS2H,
    // Expose prompts for testing/debugging
    _buildAnalysisPrompt: buildAnalysisPrompt,
    _buildReconstructionPrompt: buildReconstructionPrompt
  };

})();
