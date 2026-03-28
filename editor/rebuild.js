/**
 * Repix Rebuild Engine
 * Captures the current page DOM and recreates it as clean HTML/CSS in an iframe.
 * The editor manipulates the iframe content instead of the original page.
 */
(function () {
  "use strict";

  var nodeCounter = 0;
  var nodeMap = {};
  var iframeEl = null;
  var overlayEl = null;
  var totalNodes = 0;
  var processedNodes = 0;
  var originalBodyDisplay = "";
  var MAX_DEPTH = 20;
  var CHUNK_SIZE = 50;

  var SKIP_TAGS = {
    SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, META: 1, LINK: 1, HEAD: 1
  };

  var CAPTURED_STYLES = [
    "width", "height",
    "marginTop", "marginRight", "marginBottom", "marginLeft",
    "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
    "display", "flexDirection", "flexWrap", "justifyContent",
    "alignItems", "alignContent", "gap",
    "position",
    "backgroundColor", "color",
    "fontSize", "fontFamily", "fontWeight", "fontStyle",
    "lineHeight", "letterSpacing", "textAlign", "textDecoration", "textTransform",
    "borderRadius",
    "border", "borderTop", "borderRight", "borderBottom", "borderLeft",
    "boxShadow", "opacity", "overflow", "zIndex",
    "backgroundImage", "backgroundSize", "backgroundPosition",
    "maxWidth", "minHeight", "whiteSpace", "wordBreak"
  ];

  var collectedFonts = {};

  // ── Overlay ──────────────────────────────────────────────────────────

  function showOverlay() {
    overlayEl = document.createElement("div");
    overlayEl.id = "rb-rebuild-overlay";
    overlayEl.style.cssText = [
      "position:fixed", "top:0", "left:0", "width:100vw", "height:100vh",
      "background:rgba(0,0,0,0.92)", "display:flex", "align-items:center",
      "justify-content:center", "z-index:2147483647", "font-family:'Instrument Sans',system-ui,sans-serif",
      "color:#EFEEEB"
    ].join(";");

    overlayEl.innerHTML = [
      '<div class="rb-rebuild-progress" style="text-align:center">',
      '  <span class="rb-rebuild-pct" style="font-size:48px;font-weight:700;display:block;margin-bottom:12px">0%</span>',
      '  <p style="font-size:14px;opacity:0.6;margin:0">Rebuilding page\u2026</p>',
      "</div>"
    ].join("");

    document.documentElement.appendChild(overlayEl);
  }

  function updateProgress(pct) {
    if (!overlayEl) return;
    var span = overlayEl.querySelector(".rb-rebuild-pct");
    if (span) span.textContent = Math.round(pct) + "%";
  }

  function removeOverlay() {
    if (overlayEl && overlayEl.parentNode) {
      overlayEl.parentNode.removeChild(overlayEl);
    }
    overlayEl = null;
  }

  // ── Utilities ────────────────────────────────────────────────────────

  function countNodes(el) {
    var count = 0;
    if (el.nodeType === 1) count = 1;
    var child = el.firstChild;
    while (child) {
      count += countNodes(child);
      child = child.nextSibling;
    }
    return count;
  }

  function isVisible(el) {
    var cs = window.getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") return false;
    var rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;
    return true;
  }

  function isGradient(val) {
    return val && (
      val.indexOf("linear-gradient") !== -1 ||
      val.indexOf("radial-gradient") !== -1 ||
      val.indexOf("conic-gradient") !== -1 ||
      val.indexOf("repeating-") !== -1
    );
  }

  function hasBackgroundUrl(val) {
    return val && val.indexOf("url(") !== -1 && !isGradient(val);
  }

  function collectFont(family) {
    if (!family) return;
    var parts = family.split(",");
    for (var i = 0; i < parts.length; i++) {
      var f = parts[i].trim().replace(/^["']|["']$/g, "");
      if (f && !collectedFonts[f] && f !== "inherit" && f !== "initial") {
        collectedFonts[f] = true;
      }
    }
  }

  function buildFontImports() {
    var generics = {
      "serif": 1, "sans-serif": 1, "monospace": 1, "cursive": 1, "fantasy": 1,
      "system-ui": 1, "ui-serif": 1, "ui-sans-serif": 1, "ui-monospace": 1,
      "ui-rounded": 1, "emoji": 1, "math": 1, "fangsong": 1
    };
    var families = [];
    for (var f in collectedFonts) {
      if (!generics[f.toLowerCase()]) {
        families.push(f.replace(/ /g, "+") + ":wght@100;200;300;400;500;600;700;800;900");
      }
    }
    if (families.length === 0) return "";
    return '@import url("https://fonts.googleapis.com/css2?family=' +
      families.join("&family=") + '&display=swap");';
  }

  // ── Capture pseudo-elements ──────────────────────────────────────────

  function capturePseudo(el, pseudo) {
    var cs;
    try {
      cs = window.getComputedStyle(el, pseudo);
    } catch (e) {
      return null;
    }
    var content = cs.getPropertyValue("content");
    if (!content || content === "none" || content === "normal" || content === '""') return null;

    var styles = "";
    styles += "content:" + content + ";";
    styles += "display:" + cs.display + ";";
    if (cs.position && cs.position !== "static") {
      styles += "position:" + cs.position + ";";
    }
    styles += "color:" + cs.color + ";";
    styles += "font-size:" + cs.fontSize + ";";
    styles += "font-family:" + cs.fontFamily + ";";
    styles += "font-weight:" + cs.fontWeight + ";";

    var text = content.replace(/^["']|["']$/g, "");

    var span = {
      tag: "span",
      attrs: 'data-rb-pseudo="' + pseudo + '"',
      style: styles,
      text: text,
      children: []
    };
    return span;
  }

  // ── Text collapsing (for Framer/Webflow fragmented text) ────────────

  function isTextOnlyContainer(el) {
    // Returns true if this element contains only inline text children
    // (spans, strongs, ems, a, etc. with only text inside)
    var dominated = true;
    var hasText = false;
    var child = el.firstChild;
    while (child) {
      if (child.nodeType === 3) {
        if (child.textContent.trim()) hasText = true;
      } else if (child.nodeType === 1) {
        var tag = child.tagName.toUpperCase();
        var INLINE = { SPAN: 1, A: 1, STRONG: 1, EM: 1, B: 1, I: 1, U: 1, SMALL: 1, SUB: 1, SUP: 1, MARK: 1, CODE: 1, LABEL: 1 };
        if (!INLINE[tag]) { dominated = false; break; }
        // Check the inline child only has text
        var grandChild = child.firstChild;
        while (grandChild) {
          if (grandChild.nodeType === 1 && !INLINE[grandChild.tagName.toUpperCase()]) {
            dominated = false; break;
          }
          if (grandChild.nodeType === 3 && grandChild.textContent.trim()) hasText = true;
          grandChild = grandChild.nextSibling;
        }
        if (!dominated) break;
        if (child.textContent.trim()) hasText = true;
      }
      child = child.nextSibling;
    }
    return dominated && hasText;
  }

  function collapseText(el) {
    // Extract all text from inline children into a single string
    var text = '';
    var child = el.firstChild;
    while (child) {
      if (child.nodeType === 3) {
        text += child.textContent;
      } else if (child.nodeType === 1) {
        text += child.textContent;
      }
      child = child.nextSibling;
    }
    return text;
  }

  // Check if element's children are all absolutely positioned small text fragments
  // (Framer pattern: each word/letter in its own absolute-positioned span)
  function isFramerFragmented(el) {
    var children = el.children;
    if (!children || children.length < 3) return false;
    var absCount = 0;
    var textCount = 0;
    for (var i = 0; i < children.length; i++) {
      var childCs = window.getComputedStyle(children[i]);
      if (childCs.position === 'absolute') absCount++;
      if (children[i].textContent.trim().length > 0 && children[i].children.length === 0) textCount++;
    }
    // If most children are absolute-positioned text fragments
    return absCount > children.length * 0.6 && textCount > children.length * 0.5;
  }

  // ── Core capture ─────────────────────────────────────────────────────

  function captureNode(el, depth) {
    if (depth > MAX_DEPTH) return null;

    // Handle text nodes
    if (el.nodeType === 3) {
      var text = el.textContent;
      if (!text || !text.trim()) return null;
      return { tag: "#text", text: text, children: [] };
    }

    if (el.nodeType !== 1) return null;

    var tag = el.tagName.toUpperCase();

    // BR special case
    if (tag === "BR") {
      processedNodes++;
      return { tag: "br", attrs: "", style: "", text: "", children: [] };
    }

    if (SKIP_TAGS[tag]) {
      processedNodes++;
      return null;
    }

    if (!isVisible(el)) {
      processedNodes++;
      return null;
    }

    processedNodes++;

    var cs = window.getComputedStyle(el);
    var rect = el.getBoundingClientRect();

    // SVG: clone directly
    if (tag === "SVG" || el instanceof SVGElement) {
      nodeCounter++;
      var id = nodeCounter;
      nodeMap[id] = {
        originalTag: tag.toLowerCase(),
        classes: el.className ? (el.className.baseVal || el.className) : "",
        id: el.id || "",
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        computedStyles: {}
      };
      return {
        tag: "svg-raw",
        attrs: 'data-rb-node="' + id + '"',
        style: "width:" + rect.width + "px;height:" + rect.height + "px;",
        rawHTML: el.outerHTML,
        children: []
      };
    }

    // Build inline styles
    var inlineStyle = "";
    var storedStyles = {};

    for (var i = 0; i < CAPTURED_STYLES.length; i++) {
      var prop = CAPTURED_STYLES[i];
      var val = cs[prop];
      if (val === undefined || val === "") continue;

      // Special handling
      if (prop === "position") {
        if (val === "fixed") {
          val = "relative";
        } else if (val === "absolute") {
          var parentCs = el.parentElement ? window.getComputedStyle(el.parentElement) : null;
          // Keep absolute only if parent is position:relative (intentional layout)
          // AND parent is NOT flex/grid (where absolute breaks the flow)
          if (parentCs && parentCs.position === "relative" &&
              parentCs.display.indexOf("flex") === -1 && parentCs.display.indexOf("grid") === -1) {
            // keep absolute
          } else {
            val = "relative";
          }
        }
      }

      if (prop === "backgroundImage") {
        if (hasBackgroundUrl(val)) {
          // handled separately below
          storedStyles[prop] = val;
          continue;
        }
        if (!isGradient(val) && val !== "none") continue;
      }

      if (prop === "fontFamily") {
        collectFont(val);
      }

      storedStyles[prop] = val;

      // Convert camelCase to kebab-case
      var kebab = prop.replace(/([A-Z])/g, "-$1").toLowerCase();
      inlineStyle += kebab + ":" + val + ";";
    }

    // Use bounding rect for width/height instead of computed 'auto'
    inlineStyle = inlineStyle.replace(
      /width:[^;]+;/,
      "width:" + rect.width + "px;"
    );
    inlineStyle = inlineStyle.replace(
      /height:[^;]+;/,
      "height:" + rect.height + "px;"
    );
    storedStyles.width = rect.width + "px";
    storedStyles.height = rect.height + "px";

    nodeCounter++;
    var nodeId = nodeCounter;

    nodeMap[nodeId] = {
      originalTag: tag.toLowerCase(),
      classes: el.className || "",
      id: el.id || "",
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      computedStyles: storedStyles
    };

    var result = {
      tag: tag.toLowerCase(),
      attrs: 'data-rb-node="' + nodeId + '"',
      style: inlineStyle,
      text: "",
      children: []
    };

    // IMG element
    if (tag === "IMG") {
      result.attrs += ' src="' + (el.src || "") + '"';
      result.style += "object-fit:" + cs.objectFit + ";";
      result.children = [];
      return result;
    }

    // Background-image url() → preserve it
    if (storedStyles.backgroundImage && hasBackgroundUrl(storedStyles.backgroundImage)) {
      result.style += "background-image:" + storedStyles.backgroundImage + ";";
      result.style += "background-size:" + (cs.backgroundSize || "cover") + ";";
      result.style += "background-position:" + (cs.backgroundPosition || "center") + ";";
    }

    // Pseudo-elements
    var beforePseudo = capturePseudo(el, "::before");
    if (beforePseudo) {
      nodeCounter++;
      beforePseudo.attrs = 'data-rb-node="' + nodeCounter + '" ' + (beforePseudo.attrs || "");
      result.children.push(beforePseudo);
    }

    // ── FIX: Collapse fragmented text (Framer/Webflow pattern) ──
    // If children are all absolutely-positioned text fragments, collapse into one text block
    if (isFramerFragmented(el)) {
      var collapsedText = collapseText(el);
      if (collapsedText.trim()) {
        result.collapsed = true;
        result.style = result.style.replace(/position:[^;]+;/g, '');
        result.style += 'position:relative;';
        result.children.push({ tag: "#text", text: collapsedText, children: [] });
        // Skip normal children processing
        var afterP = capturePseudo(el, "::after");
        if (afterP) {
          nodeCounter++;
          afterP.attrs = 'data-rb-node="' + nodeCounter + '" ' + (afterP.attrs || "");
          result.children.push(afterP);
        }
        return result;
      }
    }

    // ── FIX: Collapse inline text containers ──
    // If element only has inline text children (spans, strongs, etc.), collapse text
    if (isTextOnlyContainer(el)) {
      var inlineText = collapseText(el);
      if (inlineText.trim()) {
        result.collapsed = true;
        result.children.push({ tag: "#text", text: inlineText, children: [] });
        var afterP2 = capturePseudo(el, "::after");
        if (afterP2) {
          nodeCounter++;
          afterP2.attrs = 'data-rb-node="' + nodeCounter + '" ' + (afterP2.attrs || "");
          result.children.push(afterP2);
        }
        return result;
      }
    }

    // Children (normal path)
    var child = el.firstChild;
    while (child) {
      var captured = captureNode(child, depth + 1);
      if (captured) {
        result.children.push(captured);
      }
      child = child.nextSibling;
    }

    // After pseudo
    var afterPseudo = capturePseudo(el, "::after");
    if (afterPseudo) {
      nodeCounter++;
      afterPseudo.attrs = 'data-rb-node="' + nodeCounter + '" ' + (afterPseudo.attrs || "");
      result.children.push(afterPseudo);
    }

    return result;
  }

  // ── Serialize captured tree to HTML ──────────────────────────────────

  function serializeNode(node, insideTextBlock) {
    if (!node) return "";

    if (node.tag === "#text") {
      // If inside a collapsed text container, output raw text (no wrapping span)
      if (insideTextBlock) return escapeHTML(node.text);
      return '<span contenteditable="false">' + escapeHTML(node.text) + "</span>";
    }

    if (node.tag === "br") {
      return "<br>";
    }

    if (node.tag === "svg-raw") {
      return '<div ' + node.attrs + ' style="' + (node.style || "") + '">' +
        node.rawHTML + "</div>";
    }

    var html = "<" + node.tag;
    if (node.attrs) html += " " + node.attrs;
    if (node.style) html += ' style="' + node.style + '"';
    html += ">";

    if (node.text) {
      html += escapeHTML(node.text);
    }

    // Check if this node was a collapsed text container
    var isTextParent = node.collapsed || false;
    for (var i = 0; i < node.children.length; i++) {
      html += serializeNode(node.children[i], isTextParent);
    }

    // Void elements
    var voidTags = { img: 1, br: 1, hr: 1, input: 1 };
    if (!voidTags[node.tag]) {
      html += "</" + node.tag + ">";
    }

    return html;
  }

  function escapeHTML(str) {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // ── Chunked processing ──────────────────────────────────────────────

  function flattenElements(root) {
    var list = [];
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, null, false);
    var node;
    while ((node = walker.nextNode())) {
      list.push(node);
    }
    return list;
  }

  function processInChunks(elements, idx, onProgress, onDone) {
    var end = Math.min(idx + CHUNK_SIZE, elements.length);
    for (var i = idx; i < end; i++) {
      // Touch element to batch reads before the capture phase
      try {
        window.getComputedStyle(elements[i]).display;
      } catch (e) { /* skip */ }
    }
    var pct = (end / elements.length) * 50; // First 50% is the pre-read
    onProgress(pct);

    if (end < elements.length) {
      requestAnimationFrame(function () {
        processInChunks(elements, end, onProgress, onDone);
      });
    } else {
      onDone();
    }
  }

  // ── Rebuild ──────────────────────────────────────────────────────────

  function rebuild(callback) {
    // Reset state
    nodeCounter = 0;
    nodeMap = {};
    collectedFonts = {};
    processedNodes = 0;

    showOverlay();

    var bodyCs = window.getComputedStyle(document.body);
    var bodyBg = bodyCs.backgroundColor || "#ffffff";
    var viewportWidth = document.documentElement.clientWidth || window.innerWidth;

    // Pre-read: batch style reads in chunks
    var allElements = flattenElements(document.body);
    totalNodes = allElements.length || 1;

    processInChunks(allElements, 0, function (pct) {
      updateProgress(pct);
    }, function () {
      // Now do the actual capture (second 50%)
      requestAnimationFrame(function () {
        var tree = captureNode(document.body, 0);
        updateProgress(80);

        requestAnimationFrame(function () {
          var bodyHTML = tree ? serializeNode(tree) : "";
          var fontImports = buildFontImports();
          updateProgress(90);

          var fullHTML = [
            "<!DOCTYPE html>",
            "<html>",
            "<head>",
            '  <meta charset="UTF-8">',
            '  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
            "  <style>",
            "    " + fontImports,
            "    * { margin: 0; padding: 0; box-sizing: border-box; }",
            "    body { overflow: auto; background: " + bodyBg + "; width: " + viewportWidth + "px; }",
            "    [data-rb-node] { transition: outline 100ms; }",
            "    [data-rb-node]:hover { outline: 1px solid rgba(147,197,253,0.3); }",
            "  </style>",
            "</head>",
            "<body>",
            bodyHTML,
            "</body>",
            "</html>"
          ].join("\n");

          // Create iframe
          iframeEl = document.createElement("iframe");
          iframeEl.id = "rb-rebuild-frame";
          iframeEl.style.cssText = [
            "position:fixed", "top:0", "left:0",
            "width:100vw", "height:100vh",
            "z-index:2147483630",
            "border:none",
            "background:" + bodyBg
          ].join(";");

          // Hide original page content (but NOT editor overlays)
          originalBodyDisplay = [];
          Array.from(document.body.children).forEach(function (child) {
            if (child.id === 'rb-editor-root' || child.id === 'repixbridge-panel') return;
            if (child === iframeEl) return;
            originalBodyDisplay.push({ el: child, opacity: child.style.opacity, pe: child.style.pointerEvents });
            child.style.opacity = '0';
            child.style.pointerEvents = 'none';
          });

          document.documentElement.appendChild(iframeEl);

          var iframeDoc = iframeEl.contentDocument || iframeEl.contentWindow.document;
          iframeDoc.open();
          iframeDoc.write(fullHTML);
          iframeDoc.close();

          updateProgress(100);

          // Wait for iframe to finish rendering
          setTimeout(function () {
            removeOverlay();
            if (typeof callback === "function") {
              callback(iframeDoc);
            }
          }, 150);
        });
      });
    });
  }

  // ── Public API ───────────────────────────────────────────────────────

  function getNodeMap() {
    return nodeMap;
  }

  function getIframe() {
    return iframeEl;
  }

  function destroy() {
    removeOverlay();
    if (iframeEl && iframeEl.parentNode) {
      iframeEl.parentNode.removeChild(iframeEl);
    }
    iframeEl = null;

    // Restore original page content
    if (Array.isArray(originalBodyDisplay)) {
      originalBodyDisplay.forEach(function (item) {
        item.el.style.opacity = item.opacity || '';
        item.el.style.pointerEvents = item.pe || '';
      });
    }
    originalBodyDisplay = [];

    nodeMap = {};
    nodeCounter = 0;
    collectedFonts = {};
  }

  // Expose API
  window.__rbRebuild = {
    rebuild: rebuild,
    getNodeMap: getNodeMap,
    getIframe: getIframe,
    destroy: destroy
  };
})();
