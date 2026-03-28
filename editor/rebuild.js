/**
 * Repix Rebuild Engine v3
 * Clones the entire page (DOM + stylesheets) into an iframe.
 * 100% visual fidelity — it's the same page, just in an editable context.
 */
(function () {
  "use strict";

  var nodeCounter = 0;
  var nodeMap = {};
  var iframeEl = null;
  var overlayEl = null;
  var hiddenEls = [];

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
      '<p style="font-size:14px;opacity:0.6;margin:0">Preparing canvas\u2026</p>' +
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

  // ── Collect all stylesheets as text ────────────────────────────────

  function collectStyles() {
    var css = "";

    // Inline <style> tags
    var styleTags = document.querySelectorAll("style");
    for (var i = 0; i < styleTags.length; i++) {
      css += styleTags[i].textContent + "\n";
    }

    // External stylesheets (read via CSSOM where possible)
    var sheets = document.styleSheets;
    for (var s = 0; s < sheets.length; s++) {
      try {
        var rules = sheets[s].cssRules || sheets[s].rules;
        if (rules) {
          for (var r = 0; r < rules.length; r++) {
            css += rules[r].cssText + "\n";
          }
        }
      } catch (e) {
        // Cross-origin stylesheet — include as @import
        if (sheets[s].href) {
          css += '@import url("' + sheets[s].href + '");\n';
        }
      }
    }

    return css;
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

  // ── Main rebuild ───────────────────────────────────────────────────

  function rebuild(callback) {
    nodeCounter = 0;
    nodeMap = {};

    showOverlay();
    updateProgress(10);

    requestAnimationFrame(function () {
      // Step 1: Tag all elements in the original DOM with data-rb-node
      tagElements(document.body);
      updateProgress(30);

      requestAnimationFrame(function () {
        // Step 2: Collect all CSS
        var allCSS = collectStyles();
        updateProgress(50);

        // Step 3: Clone body (tags are already on it)
        var bodyClone = document.body.cloneNode(true);

        // Remove scripts and noscripts from clone (keep styles — they reference classes)
        var toRemove = bodyClone.querySelectorAll("script,noscript,template");
        for (var i = toRemove.length - 1; i >= 0; i--) {
          toRemove[i].parentNode.removeChild(toRemove[i]);
        }
        updateProgress(60);

        requestAnimationFrame(function () {
          // Step 4: Get body properties
          var bodyCs = window.getComputedStyle(document.body);
          var htmlCs = window.getComputedStyle(document.documentElement);
          var bodyBg = bodyCs.backgroundColor;
          var htmlBg = htmlCs.backgroundColor;
          // Use whichever is not transparent
          var pageBg = (bodyBg && bodyBg !== "rgba(0, 0, 0, 0)") ? bodyBg : htmlBg;
          if (!pageBg || pageBg === "rgba(0, 0, 0, 0)") pageBg = "#ffffff";

          var cloneHTML = bodyClone.innerHTML;
          updateProgress(75);

          // Step 5: Build the iframe HTML
          var fullHTML = '<!DOCTYPE html>\n<html>\n<head>\n<meta charset="UTF-8">\n' +
            '<meta name="viewport" content="width=device-width,initial-scale=1">\n' +
            '<base href="' + window.location.origin + window.location.pathname + '">\n' +
            '<style>\n' + allCSS + '\n</style>\n' +
            '<style>\n' +
            '[data-rb-node]{transition:outline 80ms;}\n' +
            '[data-rb-node]:hover{outline:1.5px solid rgba(147,197,253,0.4);outline-offset:1px;}\n' +
            'body{overflow:auto !important;height:auto !important;}\n' +
            'a{pointer-events:none;}\n' +
            '</style>\n' +
            '</head>\n<body style="background:' + pageBg + '">' +
            cloneHTML +
            '</body>\n</html>';

          updateProgress(85);

          // Step 6: Create iframe
          iframeEl = document.createElement("iframe");
          iframeEl.id = "rb-rebuild-frame";
          iframeEl.style.cssText = [
            "position:fixed", "top:0", "left:0", "width:100vw", "height:100vh",
            "z-index:2147483630", "border:none", "background:" + pageBg
          ].join(";");

          // Hide original page content (not editor overlays)
          hiddenEls = [];
          var bodyChildren = document.body.children;
          for (var h = 0; h < bodyChildren.length; h++) {
            var child = bodyChildren[h];
            if (child.id === "rb-editor-root" || child.id === "repixbridge-panel") continue;
            if (child === iframeEl) continue;
            hiddenEls.push({
              el: child,
              vis: child.style.visibility,
              pe: child.style.pointerEvents
            });
            child.style.visibility = "hidden";
            child.style.pointerEvents = "none";
          }

          document.documentElement.appendChild(iframeEl);

          var iframeDoc = iframeEl.contentDocument || iframeEl.contentWindow.document;
          iframeDoc.open();
          iframeDoc.write(fullHTML);
          iframeDoc.close();

          updateProgress(95);

          // Wait for iframe to render + external resources to load
          setTimeout(function () {
            updateProgress(100);
            setTimeout(function () {
              removeOverlay();
              if (typeof callback === "function") {
                callback(iframeDoc);
              }
            }, 150);
          }, 300);
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

    // Remove data-rb-node tags from original page
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
    destroy: destroy
  };
})();
