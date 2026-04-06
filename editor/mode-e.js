// RepixBridge — Mode E: Papel Vegetal
// Screenshot → Gemini Vision → Clean HTML/CSS rebuild
// The user edits a representation of the site, not the site itself.

(function() {
  'use strict';

  // Build the rebuild prompt dynamically with extracted tokens
  function buildPrompt(tokens) {
    var colorHint = tokens && tokens.colors && tokens.colors.length > 0
      ? '\n\nDESIGN TOKENS from the original site:\nColors: ' + tokens.colors.join(', ') +
        '\nFonts: ' + (tokens.fonts || []).join(', ') +
        '\nBorder radii: ' + (tokens.radii || []).join(', ') +
        '\nUse THESE EXACT colors and fonts in your rebuild.'
      : '';

    return [
      'You are a pixel-perfect front-end developer. I will give you a screenshot of ONE viewport section of a website.',
      'Recreate EXACTLY what you see as clean HTML with inline CSS styles.',
      '',
      'CRITICAL RULES:',
      '- Reproduce the layout, spacing, colors, typography, and proportions EXACTLY as shown.',
      '- Use a single wrapper: <div class="rb-section" style="...">',
      '- ALL styling must be inline (style="..."). No <style> tags, no external CSS.',
      '- Use semantic tags: header, nav, section, h1-h6, p, a, button, img, span, ul, li.',
      '- Give every element a descriptive class: hero-title, cta-button, nav-logo, etc.',
      '- COLORS: Match every color exactly using hex values. Backgrounds, text, borders — all must match.',
      '- FONTS: Use the exact font-family. If unsure, use system-ui or sans-serif.',
      '- FONT SIZES: Match sizes carefully. Use px values that match the screenshot.',
      '- SPACING: Match all padding, margins, and gaps precisely in px.',
      '- LAYOUT: Use flexbox. Match the exact positioning (centered, left-aligned, etc.).',
      '- BACKGROUNDS: If a section has a solid color or gradient background, reproduce it exactly with CSS.',
      '  For photo/image backgrounds, use a solid color that matches the dominant color of the image.',
      '- IMAGES: For photos, product shots, or illustrations, use a placeholder div with the dominant color',
      '  and approximate dimensions: <div style="width:400px;height:300px;background:#3d5a2e;border-radius:16px;"></div>',
      '- TEXT: Reproduce ALL visible text content exactly as shown. Every heading, paragraph, button label, nav item.',
      '- The section should be full-width (width:100%) with content centered via max-width + margin:0 auto.',
      '- Do NOT include <html>, <head>, <body> tags.',
      '- Do NOT include any JavaScript.',
      '- Do NOT add comments or explanations.',
      colorHint,
      '',
      'OUTPUT: Return ONLY the raw HTML. No markdown, no code fences, no explanation.',
      'Start directly with <div class="rb-section"'
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
      setTimeout(resolve, 400); // wait for render + lazy-loaded content
    });
  }

  // Capture the entire page as an array of viewport screenshots
  async function captureFullPage() {
    var viewportH = window.innerHeight;
    var pageH = document.documentElement.scrollHeight;
    var screenshots = [];
    var originalScroll = window.scrollY;

    // Hide editor UI during capture
    var editorRoot = document.getElementById('rb-editor-root');
    if (editorRoot) editorRoot.style.display = 'none';

    for (var y = 0; y < pageH; y += viewportH) {
      await scrollToAndWait(y);
      var dataUrl = await captureViewport();
      if (dataUrl) {
        screenshots.push({
          y: y,
          height: Math.min(viewportH, pageH - y),
          dataUrl: dataUrl
        });
      }
    }

    // Restore scroll and editor UI
    window.scrollTo(0, originalScroll);
    if (editorRoot) editorRoot.style.display = '';

    return screenshots;
  }

  // Send a screenshot to Gemini Vision and get HTML back
  function screenshotToHTML(screenshotDataUrl, tokens) {
    return new Promise(function(resolve, reject) {
      chrome.runtime.sendMessage(
        {
          action: 'modeERebuild',
          imageDataUrl: screenshotDataUrl,
          prompt: buildPrompt(tokens)
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

  // Progress callback type: { step: string, current: number, total: number }
  // Main entry point
  async function runModeE(onProgress) {
    var log = onProgress || function() {};

    // Step 1: Detect builder
    var builderInfo = window.__rbDetectBuilder ? window.__rbDetectBuilder() : {builder: 'generic'};
    log({step: 'detect', message: 'Detected: ' + builderInfo.builder, current: 0, total: 5});

    // Step 2: Freeze animations
    if (builderInfo.builder !== 'generic' && window.__rbFreeze) {
      window.__rbFreeze(builderInfo);
      log({step: 'freeze', message: 'Animations frozen', current: 1, total: 5});
    } else {
      log({step: 'freeze', message: 'No animations to freeze', current: 1, total: 5});
    }

    // Step 3: Extract design tokens BEFORE capture (colors, fonts, spacing from the live site)
    var tokens = null;
    if (window.__rbExtractor) {
      tokens = window.__rbExtractor.extractTokens();
      log({step: 'tokens', message: 'Extracted ' + (tokens.colors || []).length + ' colors, ' + (tokens.fonts || []).length + ' fonts', current: 2, total: 6});
    }

    // Step 4: Wait for freeze, then capture
    await new Promise(function(r) { setTimeout(r, 500); });
    log({step: 'capture', message: 'Capturing page...', current: 3, total: 6});
    var screenshots = await captureFullPage();
    log({step: 'capture', message: 'Captured ' + screenshots.length + ' viewports', current: 3, total: 6});

    // Step 5: Send each screenshot + tokens to Gemini Vision
    log({step: 'rebuild', message: 'Rebuilding with AI (0/' + screenshots.length + ')...', current: 4, total: 6});
    var sectionsHTML = [];
    for (var i = 0; i < screenshots.length; i++) {
      try {
        var html = await screenshotToHTML(screenshots[i].dataUrl, tokens);
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
        log({step: 'error', message: 'Failed viewport ' + i + ': ' + err.message, current: 4, total: 6});
      }
    }

    if (sectionsHTML.length === 0) {
      log({step: 'error', message: 'No sections rebuilt. Check API key.', current: 6, total: 6});
      return null;
    }

    // Step 6: Replace page content
    log({step: 'replace', message: 'Replacing page content...', current: 5, total: 6});
    var rebuilt = replacePageContent(sectionsHTML);
    log({step: 'done', message: 'Rebuild complete! ' + sectionsHTML.length + ' sections.', current: 6, total: 6});

    return rebuilt;
  }

  // Expose to global scope
  window.__rbModeE = {
    run: runModeE,
    restore: restoreOriginalPage,
    captureFullPage: captureFullPage
  };
})();
