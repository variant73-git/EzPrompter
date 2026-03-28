/**
 * Repix Rebuild Engine v2
 * Clones the entire page DOM, freezes computed styles inline,
 * and renders in an iframe for the editor to manipulate.
 *
 * Approach: cloneNode(true) preserves 100% structure fidelity.
 * Then we walk the clone and bake computed styles inline,
 * removing class/stylesheet dependencies.
 */
(function () {
  "use strict";

  var nodeCounter = 0;
  var nodeMap = {};
  var iframeEl = null;
  var overlayEl = null;
  var hiddenEls = [];

  var SKIP_TAGS = {
    SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, META: 1, LINK: 1, IFRAME: 1, TEMPLATE: 1
  };

  // Styles to bake inline (all visual properties)
  var STYLE_PROPS = [
    "display", "position", "top", "right", "bottom", "left",
    "width", "height", "minWidth", "minHeight", "maxWidth", "maxHeight",
    "margin", "marginTop", "marginRight", "marginBottom", "marginLeft",
    "padding", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
    "border", "borderTop", "borderRight", "borderBottom", "borderLeft",
    "borderRadius", "borderTopLeftRadius", "borderTopRightRadius",
    "borderBottomLeftRadius", "borderBottomRightRadius",
    "backgroundColor", "color", "opacity",
    "fontSize", "fontFamily", "fontWeight", "fontStyle", "fontVariant",
    "lineHeight", "letterSpacing", "textAlign", "textDecoration", "textTransform",
    "whiteSpace", "wordBreak", "wordSpacing", "overflowWrap",
    "overflow", "overflowX", "overflowY",
    "flexDirection", "flexWrap", "justifyContent", "alignItems", "alignContent",
    "alignSelf", "flex", "flexGrow", "flexShrink", "flexBasis", "order", "gap",
    "gridTemplateColumns", "gridTemplateRows", "gridColumn", "gridRow", "gridGap",
    "boxShadow", "textShadow",
    "backgroundImage", "backgroundSize", "backgroundPosition", "backgroundRepeat",
    "objectFit", "objectPosition",
    "transform", "transformOrigin",
    "zIndex", "cursor", "pointerEvents",
    "verticalAlign", "float", "clear",
    "listStyleType", "listStylePosition",
    "tableLayout", "borderCollapse", "borderSpacing",
    "outline", "outlineOffset",
    "clipPath", "filter", "backdropFilter", "mixBlendMode",
    "aspectRatio", "contain"
  ];

  // ── Overlay ────────────────────────────────────────────────────────

  function showOverlay() {
    overlayEl = document.createElement("div");
    overlayEl.id = "rb-rebuild-overlay";
    overlayEl.style.cssText = [
      "position:fixed", "top:0", "left:0", "width:100vw", "height:100vh",
      "background:#000", "display:flex", "align-items:center",
      "justify-content:center", "z-index:2147483647",
      "font-family:'Instrument Sans',system-ui,sans-serif", "color:#EFEEEB"
    ].join(";");
    overlayEl.innerHTML =
      '<div style="text-align:center">' +
      '<span id="rb-rebuild-pct" style="font-size:48px;font-weight:700;display:block;margin-bottom:12px">0%</span>' +
      '<p style="font-size:14px;opacity:0.6;margin:0">Freezing page\u2026</p>' +
      '</div>';
    document.documentElement.appendChild(overlayEl);
  }

  function updateProgress(pct) {
    if (!overlayEl) return;
    var span = overlayEl.querySelector("#rb-rebuild-pct");
    if (span) span.textContent = Math.round(pct) + "%";
  }

  function removeOverlay() {
    if (overlayEl && overlayEl.parentNode) overlayEl.parentNode.removeChild(overlayEl);
    overlayEl = null;
  }

  // ── Bake styles onto a cloned element tree ─────────────────────────

  function bakeStyles(original, clone, depth) {
    if (depth > 30) return;
    if (original.nodeType !== 1 || clone.nodeType !== 1) return;

    var tag = original.tagName.toUpperCase();
    if (SKIP_TAGS[tag]) return;

    // SVG elements: don't try to bake styles, just preserve as-is
    if (tag === "SVG" || original instanceof SVGElement) {
      nodeCounter++;
      clone.setAttribute("data-rb-node", nodeCounter);
      return;
    }

    // Skip invisible elements
    var cs;
    try { cs = window.getComputedStyle(original); } catch (e) { return; }
    if (cs.display === "none") { clone.style.display = "none"; return; }

    // Assign node ID
    nodeCounter++;
    var nid = nodeCounter;
    clone.setAttribute("data-rb-node", nid);

    // Store metadata
    var rect = original.getBoundingClientRect();
    nodeMap[nid] = {
      originalTag: tag.toLowerCase(),
      classes: original.className || "",
      id: original.id || "",
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
    };

    // Bake computed styles inline
    for (var i = 0; i < STYLE_PROPS.length; i++) {
      var prop = STYLE_PROPS[i];
      try {
        var val = cs[prop];
        if (val !== undefined && val !== "") {
          clone.style[prop] = val;
        }
      } catch (e) { /* some props may throw */ }
    }

    // Use bounding rect for width/height when computed is "auto"
    if (cs.width === "auto" || cs.width === "") {
      clone.style.width = rect.width + "px";
    }
    if (cs.height === "auto" || cs.height === "") {
      clone.style.height = rect.height + "px";
    }

    // Strip classes and IDs (decouple from stylesheets)
    clone.removeAttribute("class");
    clone.removeAttribute("id");

    // Recurse children — walk both trees in sync
    // Use element children (not childNodes) to stay aligned
    var origChildren = original.children;
    var cloneChildren = clone.children;
    var len = Math.min(origChildren.length, cloneChildren.length);
    for (var c = 0; c < len; c++) {
      bakeStyles(origChildren[c], cloneChildren[c], depth + 1);
    }
  }

  // ── Main rebuild ───────────────────────────────────────────────────

  function rebuild(callback) {
    nodeCounter = 0;
    nodeMap = {};

    showOverlay();
    updateProgress(5);

    // Step 1: Clone the entire body
    requestAnimationFrame(function () {
      var bodyClone = document.body.cloneNode(true);
      updateProgress(20);

      updateProgress(30);

      // Step 2: Bake computed styles FIRST (before removing anything from clone)
      // This keeps original.children and clone.children aligned
      requestAnimationFrame(function () {
        bakeStyles(document.body, bodyClone, 0);

        // Step 3: NOW remove scripts/styles from clone (after baking)
        var toRemove = bodyClone.querySelectorAll("script,style,noscript,template,link[rel=stylesheet]");
        for (var i = toRemove.length - 1; i >= 0; i--) {
          toRemove[i].parentNode.removeChild(toRemove[i]);
        }
        updateProgress(70);

        requestAnimationFrame(function () {
          // Step 4: Collect font families from computed styles
          var fontSet = {};
          var allOriginal = document.body.querySelectorAll("*");
          for (var f = 0; f < allOriginal.length; f++) {
            try {
              var ff = window.getComputedStyle(allOriginal[f]).fontFamily;
              if (ff) {
                var parts = ff.split(",");
                for (var p = 0; p < parts.length; p++) {
                  var fname = parts[p].trim().replace(/^["']|["']$/g, "");
                  if (fname && !fontSet[fname]) fontSet[fname] = true;
                }
              }
            } catch (e) {}
          }
          var generics = { serif:1, "sans-serif":1, monospace:1, cursive:1, fantasy:1, "system-ui":1, inherit:1, initial:1 };
          var fontImports = [];
          for (var fn in fontSet) {
            if (!generics[fn.toLowerCase()]) {
              fontImports.push(fn.replace(/ /g, "+") + ":wght@100;200;300;400;500;600;700;800;900");
            }
          }
          var fontCSS = fontImports.length > 0
            ? '@import url("https://fonts.googleapis.com/css2?family=' + fontImports.join("&family=") + '&display=swap");'
            : "";

          updateProgress(80);

          // Step 5: Get body background
          var bodyCs = window.getComputedStyle(document.body);
          var bodyBg = bodyCs.backgroundColor || "#ffffff";
          var bodyFont = bodyCs.fontFamily || "system-ui, sans-serif";
          var bodyColor = bodyCs.color || "#000000";

          // Step 6: Serialize the clone
          var cloneHTML = bodyClone.innerHTML;

          // Step 7: Build iframe
          var fullHTML = '<!DOCTYPE html><html><head><meta charset="UTF-8"><style>' +
            fontCSS +
            '\n*{box-sizing:border-box;}' +
            '\nbody{overflow:auto;background:' + bodyBg + ';color:' + bodyColor + ';font-family:' + bodyFont + ';}' +
            '\n[data-rb-node]{transition:outline 80ms;}' +
            '\n[data-rb-node]:hover{outline:1px solid rgba(147,197,253,0.3);}' +
            '\nimg{max-width:100%;}' +
            '</style></head><body>' + cloneHTML + '</body></html>';

          updateProgress(90);

          // Step 8: Create iframe
          iframeEl = document.createElement("iframe");
          iframeEl.id = "rb-rebuild-frame";
          iframeEl.style.cssText = [
            "position:fixed", "top:0", "left:0", "width:100vw", "height:100vh",
            "z-index:2147483630", "border:none", "background:" + bodyBg
          ].join(";");

          // Hide original page content (but NOT editor overlays)
          hiddenEls = [];
          var bodyChildren = document.body.children;
          for (var h = 0; h < bodyChildren.length; h++) {
            var child = bodyChildren[h];
            if (child.id === "rb-editor-root" || child.id === "repixbridge-panel") continue;
            if (child === iframeEl) continue;
            hiddenEls.push({ el: child, opacity: child.style.opacity, pe: child.style.pointerEvents, vis: child.style.visibility });
            child.style.visibility = "hidden";
            child.style.pointerEvents = "none";
          }

          document.documentElement.appendChild(iframeEl);

          var iframeDoc = iframeEl.contentDocument || iframeEl.contentWindow.document;
          iframeDoc.open();
          iframeDoc.write(fullHTML);
          iframeDoc.close();

          updateProgress(100);

          // Wait for iframe to render
          setTimeout(function () {
            removeOverlay();
            if (typeof callback === "function") {
              callback(iframeDoc);
            }
          }, 200);
        });
      });
    });
  }

  // ── API ────────────────────────────────────────────────────────────

  function getNodeMap() { return nodeMap; }
  function getIframe() { return iframeEl; }

  function destroy() {
    removeOverlay();
    if (iframeEl && iframeEl.parentNode) {
      iframeEl.parentNode.removeChild(iframeEl);
    }
    iframeEl = null;

    // Restore original page
    for (var i = 0; i < hiddenEls.length; i++) {
      var item = hiddenEls[i];
      item.el.style.visibility = item.vis || "";
      item.el.style.pointerEvents = item.pe || "";
    }
    hiddenEls = [];
    nodeMap = {};
    nodeCounter = 0;
  }

  window.__rbRebuild = {
    rebuild: rebuild,
    getNodeMap: getNodeMap,
    getIframe: getIframe,
    destroy: destroy
  };
})();
