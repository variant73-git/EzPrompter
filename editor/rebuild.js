/**
 * Repix Rebuild Engine v5
 * DOM Mirroring approach (inspired by Reforge analysis):
 * - Extracts original stylesheets (not computed styles)
 * - Preserves CSS classes, media queries, keyframes, hover states
 * - Cleans up scripts, event handlers, animation runtime
 * - Disables interactivity for editing
 */
(function () {
  "use strict";

  var nodeCounter = 0;
  var nodeMap = {};
  var disabledLinks = [];
  var originalPageState = null;

  // ── Extract all stylesheets from the document ─────────────────────

  function extractStylesheets() {
    var cssTexts = [];

    // 1. External stylesheets (linked via <link>)
    var sheets = document.styleSheets;
    for (var i = 0; i < sheets.length; i++) {
      try {
        var sheet = sheets[i];
        // Skip our own editor CSS
        if (sheet.href && sheet.href.indexOf('editor.css') !== -1) continue;
        if (sheet.ownerNode && sheet.ownerNode.id && sheet.ownerNode.id.indexOf('rb-') === 0) continue;

        var rules = sheet.cssRules || sheet.rules;
        if (!rules) continue;

        var sheetCSS = '';
        for (var j = 0; j < rules.length; j++) {
          sheetCSS += rules[j].cssText + '\n';
        }
        if (sheetCSS.trim()) {
          cssTexts.push({
            source: sheet.href || 'inline',
            css: sheetCSS
          });
        }
      } catch (e) {
        // Cross-origin stylesheets can't be read — include the <link> reference instead
        if (sheets[i].href) {
          cssTexts.push({
            source: sheets[i].href,
            css: null, // will be included as <link>
            href: sheets[i].href
          });
        }
      }
    }

    // 2. Inline <style> elements (including CSS-in-JS injected styles)
    var inlineStyles = document.querySelectorAll('style:not([id^="rb-"])');
    for (var s = 0; s < inlineStyles.length; s++) {
      var text = inlineStyles[s].textContent || '';
      if (text.trim() && text.indexOf('rb-ed-') === -1 && text.indexOf('rb-editor') === -1) {
        cssTexts.push({
          source: 'inline-style-' + s,
          css: text
        });
      }
    }

    return cssTexts;
  }

  // ── Extract Google Fonts links ────────────────────────────────────

  function extractFontLinks() {
    var fontLinks = [];
    var links = document.querySelectorAll('link[rel*="stylesheet"], link[rel="preconnect"]');
    for (var i = 0; i < links.length; i++) {
      var href = links[i].getAttribute('href') || '';
      if (href.indexOf('fonts.googleapis.com') !== -1 ||
          href.indexOf('fonts.gstatic.com') !== -1 ||
          href.indexOf('use.typekit.net') !== -1) {
        fontLinks.push(href);
      }
    }
    return fontLinks;
  }

  // ── Clean HTML: remove scripts, animation artifacts, editor elements ──

  function cleanDOM(rootEl) {
    // Remove scripts
    var scripts = rootEl.querySelectorAll('script');
    for (var i = scripts.length - 1; i >= 0; i--) scripts[i].remove();

    // Remove noscript
    var noscripts = rootEl.querySelectorAll('noscript');
    for (var i = noscripts.length - 1; i >= 0; i--) noscripts[i].remove();

    // Remove editor elements
    var editorEls = rootEl.querySelectorAll('[id^="rb-editor"], [id^="rb-ed-"], [id="repixbridge-panel"]');
    for (var i = editorEls.length - 1; i >= 0; i--) editorEls[i].remove();

    // Remove event handler attributes
    var allEls = rootEl.querySelectorAll('*');
    for (var i = 0; i < allEls.length; i++) {
      var attrs = allEls[i].attributes;
      var toRemove = [];
      for (var a = 0; a < attrs.length; a++) {
        if (attrs[a].name.indexOf('on') === 0 && attrs[a].name !== 'onload') {
          toRemove.push(attrs[a].name);
        }
      }
      toRemove.forEach(function(name) { allEls[i].removeAttribute(name); });
    }

    // Force animated elements to visible (Webflow IX3 hides them)
    var hiddenByAnim = rootEl.querySelectorAll('[style*="visibility: hidden"], [style*="opacity: 0"]');
    for (var i = 0; i < hiddenByAnim.length; i++) {
      var el = hiddenByAnim[i];
      var s = el.style;
      if (s.visibility === 'hidden') s.visibility = 'visible';
      if (s.opacity === '0') s.opacity = '1';
      // Reset reveal transforms
      var t = s.transform || '';
      if (t.indexOf('translate') !== -1 && (t.indexOf('100%') !== -1 || t.indexOf('50px') !== -1)) {
        s.transform = 'none';
      }
    }
  }

  // ── Tag elements with data-rb-node IDs ─────────────────────────────

  function tagElements(el) {
    if (el.nodeType !== 1) return;
    var tag = el.tagName.toUpperCase();
    if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT" || tag === "META" || tag === "LINK") return;

    nodeCounter++;
    var nid = nodeCounter;
    el.setAttribute("data-rb-node", nid);

    var rect = el.getBoundingClientRect();
    nodeMap[nid] = {
      originalTag: tag.toLowerCase(),
      classes: el.className || "",
      id: el.id || "",
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
    };

    var children = el.children;
    for (var c = 0; c < children.length; c++) {
      tagElements(children[c]);
    }
  }

  // ── Disable page interactivity ─────────────────────────────────────

  function preventDefaultHandler(e) {
    e.preventDefault();
    e.stopPropagation();
  }

  function disableInteractivity() {
    var links = document.querySelectorAll("a[href]");
    for (var i = 0; i < links.length; i++) {
      links[i].addEventListener("click", preventDefaultHandler, true);
    }
    var forms = document.querySelectorAll("form");
    for (var f = 0; f < forms.length; f++) {
      forms[f].addEventListener("submit", preventDefaultHandler, true);
    }
    var buttons = document.querySelectorAll("button:not([data-rb-editor])");
    for (var b = 0; b < buttons.length; b++) {
      buttons[b].addEventListener("click", preventDefaultHandler, true);
    }
  }

  function restoreInteractivity() {
    document.querySelectorAll("a[href]").forEach(function(el) {
      el.removeEventListener("click", preventDefaultHandler, true);
    });
    document.querySelectorAll("form").forEach(function(el) {
      el.removeEventListener("submit", preventDefaultHandler, true);
    });
    document.querySelectorAll("button:not([data-rb-editor])").forEach(function(el) {
      el.removeEventListener("click", preventDefaultHandler, true);
    });
  }

  // ── Kill animation runtimes ────────────────────────────────────────

  function killAnimations() {
    // Inject CSS to kill all animations/transitions
    var killCSS = document.createElement('style');
    killCSS.id = 'rb-kill-animations';
    killCSS.textContent = [
      '*, *::before, *::after {',
      '  animation: none !important;',
      '  animation-play-state: paused !important;',
      '  transition: none !important;',
      '}',
      // Force visibility on Webflow IX3 hidden elements
      'html.w-mod-js:not(.w-mod-ix3) [style*="visibility: hidden"] {',
      '  visibility: visible !important;',
      '}'
    ].join('\n');
    document.head.appendChild(killCSS);

    // Kill GSAP
    if (window.gsap) {
      try {
        gsap.globalTimeline.pause();
        if (window.ScrollTrigger) ScrollTrigger.getAll().forEach(function(st) { st.kill(); });
      } catch(e) {}
    }

    // Kill Lenis
    if (window.__lenis) try { window.__lenis.destroy(); } catch(e) {}
    if (window.lenis) try { window.lenis.destroy(); } catch(e) {}

    // Kill Webflow IX
    if (window.Webflow) {
      try { Webflow.require('ix2').destroy(); } catch(e) {}
    }
  }

  // ── Main rebuild ──────────────────────────────────────────────────

  function rebuild(callback) {
    nodeCounter = 0;
    nodeMap = {};

    // Save original state for undo
    originalPageState = {
      scrollY: window.scrollY
    };

    // Step 1: Kill animations before anything else
    killAnimations();

    // Step 2: Clean DOM (remove scripts, force-reveal hidden elements)
    cleanDOM(document.body);

    // Step 3: Tag all elements for editor
    tagElements(document.body);

    // Step 4: Disable interactivity
    disableInteractivity();

    if (typeof callback === "function") {
      callback(document);
    }
  }

  // ── Get extracted CSS (for Mode E or export) ──────────────────────

  function getExtractedCSS() {
    return {
      stylesheets: extractStylesheets(),
      fontLinks: extractFontLinks()
    };
  }

  // ── API ────────────────────────────────────────────────────────────

  function getNodeMap() { return nodeMap; }
  function getIframe() { return null; }

  function destroy() {
    restoreInteractivity();

    // Remove animation kill CSS
    var killCSS = document.getElementById('rb-kill-animations');
    if (killCSS) killCSS.remove();

    // Remove data-rb-node tags
    var tagged = document.querySelectorAll("[data-rb-node]");
    for (var t = 0; t < tagged.length; t++) {
      tagged[t].removeAttribute("data-rb-node");
    }

    nodeMap = {};
    nodeCounter = 0;
  }

  window.__rbRebuild = {
    rebuild: rebuild,
    getNodeMap: getNodeMap,
    getIframe: getIframe,
    getExtractedCSS: getExtractedCSS,
    destroy: destroy
  };
})();
