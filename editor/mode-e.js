// RepixBridge — Mode E: Papel Vegetal
// Screenshot → Gemini Vision → Clean HTML/CSS rebuild
// The user edits a representation of the site, not the site itself.

(function() {
  'use strict';

  var REBUILD_PROMPT = [
    'You are a senior front-end developer. I will give you a screenshot of a website section.',
    'Your job is to recreate this section as clean, semantic HTML and CSS.',
    '',
    'RULES:',
    '- Output ONLY valid HTML inside a single <div class="rb-section"> wrapper.',
    '- Use inline styles for all styling (no external CSS, no <style> tags).',
    '- Use semantic HTML: header, nav, section, h1-h6, p, a, button, img, ul, li.',
    '- Give each element a descriptive class name (e.g. "hero-title", "cta-button", "nav-logo").',
    '- For complex backgrounds (gradients, images), use a solid color approximation or a CSS gradient.',
    '- For images/photos/3D renders, use a placeholder <img> with src="data:image/svg+xml,..." showing a gray rectangle with the text "[image]" centered. Set width and height to approximate the original.',
    '- For icons/logos, use simple inline SVGs or placeholder images.',
    '- Match fonts as closely as possible using system fonts or Google Fonts (specify via inline style font-family).',
    '- Match colors exactly (use the hex values you see).',
    '- Match spacing, padding, margins as closely as possible.',
    '- Use flexbox for layout.',
    '- Make it responsive (use %, max-width, not fixed px widths for containers).',
    '- Do NOT include any JavaScript.',
    '- Do NOT include <html>, <head>, <body> — just the <div class="rb-section"> and its contents.',
    '',
    'OUTPUT FORMAT:',
    'Return ONLY the HTML code. No explanation, no markdown, no code fences. Just raw HTML starting with <div class="rb-section">.'
  ].join('\n');

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
  function screenshotToHTML(screenshotDataUrl) {
    return new Promise(function(resolve, reject) {
      chrome.runtime.sendMessage(
        {
          action: 'modeERebuild',
          imageDataUrl: screenshotDataUrl,
          prompt: REBUILD_PROMPT
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
    // Save original page in memory for undo
    window.__rbOriginalPage = {
      html: document.body.innerHTML,
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
      // Unwrap if the AI returned exactly one root element
      if (section.children.length === 1) {
        wrapper.appendChild(section.children[0]);
      } else {
        var wrap = document.createElement('div');
        wrap.className = 'rb-section';
        wrap.innerHTML = html;
        wrapper.appendChild(wrap);
      }
    });

    // Clear body and insert rebuilt page
    document.body.innerHTML = '';
    document.body.appendChild(wrapper);
    document.body.style.margin = '0';
    document.body.style.padding = '0';

    // Re-inject editor root
    var root = document.createElement('div');
    root.id = 'rb-editor-root';
    document.body.appendChild(root);

    return wrapper;
  }

  // Restore original page
  function restoreOriginalPage() {
    if (window.__rbOriginalPage) {
      document.body.innerHTML = window.__rbOriginalPage.html;
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

    // Step 3: Wait a moment for freeze to take effect, then capture
    await new Promise(function(r) { setTimeout(r, 500); });
    log({step: 'capture', message: 'Capturing page...', current: 2, total: 5});
    var screenshots = await captureFullPage();
    log({step: 'capture', message: 'Captured ' + screenshots.length + ' viewports', current: 2, total: 5});

    // Step 4: Send each screenshot to Gemini Vision
    log({step: 'rebuild', message: 'Rebuilding with AI (0/' + screenshots.length + ')...', current: 3, total: 5});
    var sectionsHTML = [];
    for (var i = 0; i < screenshots.length; i++) {
      try {
        var html = await screenshotToHTML(screenshots[i].dataUrl);
        var cleaned = cleanHTML(html);
        if (cleaned.length > 10) {
          sectionsHTML.push(cleaned);
        }
        log({
          step: 'rebuild',
          message: 'Rebuilding with AI (' + (i + 1) + '/' + screenshots.length + ')...',
          current: 3,
          total: 5
        });
      } catch(err) {
        console.error('[Mode E] Rebuild failed for viewport ' + i + ':', err);
        log({step: 'error', message: 'Failed viewport ' + i + ': ' + err.message, current: 3, total: 5});
      }
    }

    if (sectionsHTML.length === 0) {
      log({step: 'error', message: 'No sections rebuilt. Check API key.', current: 5, total: 5});
      return null;
    }

    // Step 5: Replace page content
    log({step: 'replace', message: 'Replacing page content...', current: 4, total: 5});
    var rebuilt = replacePageContent(sectionsHTML);
    log({step: 'done', message: 'Rebuild complete! ' + sectionsHTML.length + ' sections.', current: 5, total: 5});

    return rebuilt;
  }

  // Expose to global scope
  window.__rbModeE = {
    run: runModeE,
    restore: restoreOriginalPage,
    captureFullPage: captureFullPage
  };
})();
