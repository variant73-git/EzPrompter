/**
 * Repix Rebuild Engine v4
 * No iframe. Edits the live TARGET DOM directly. Disables interactivity
 * (links, JS handlers) and enables editing mode.
 *
 * All side effects target the SITE document. The public hook
 * `window.__rbRebuild` lives on the script's window (host) so editor.js
 * can invoke it directly.
 */
(function () {
  "use strict";

  function _target() {
    return (window.__rbTarget && window.__rbTarget.doc) || document;
  }

  var nodeCounter = 0;
  var nodeMap = {};
  var overlayEl = null;
  var disabledLinks = [];
  var originalPointerEvents = [];

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

  function disableInteractivity() {
    var doc = _target();
    // Disable all links
    var links = doc.querySelectorAll("a[href]");
    for (var i = 0; i < links.length; i++) {
      disabledLinks.push({ el: links[i], href: links[i].getAttribute("href") });
      links[i].addEventListener("click", preventDefault, true);
    }

    // Disable form submissions
    var forms = doc.querySelectorAll("form");
    for (var f = 0; f < forms.length; f++) {
      forms[f].addEventListener("submit", preventDefault, true);
    }

    // Disable buttons (non-editor)
    var buttons = doc.querySelectorAll("button:not([data-rb-editor])");
    for (var b = 0; b < buttons.length; b++) {
      buttons[b].addEventListener("click", preventDefault, true);
    }
  }

  function preventDefault(e) {
    e.preventDefault();
    e.stopPropagation();
  }

  function restoreInteractivity() {
    var doc = _target();
    var links = doc.querySelectorAll("a[href]");
    for (var i = 0; i < links.length; i++) {
      links[i].removeEventListener("click", preventDefault, true);
    }
    var forms = doc.querySelectorAll("form");
    for (var f = 0; f < forms.length; f++) {
      forms[f].removeEventListener("submit", preventDefault, true);
    }
    var buttons = doc.querySelectorAll("button:not([data-rb-editor])");
    for (var b = 0; b < buttons.length; b++) {
      buttons[b].removeEventListener("click", preventDefault, true);
    }
    disabledLinks = [];
  }

  // ── Main rebuild (now just "prepare for editing") ──────────────────

  function rebuild(callback) {
    nodeCounter = 0;
    nodeMap = {};

    var doc = _target();
    // Tag all elements in TARGET
    tagElements(doc.body);

    // Disable page interactivity
    disableInteractivity();

    // Pass the actual target document to the editor
    if (typeof callback === "function") {
      callback(doc);
    }
  }

  // ── API ────────────────────────────────────────────────────────────

  function getNodeMap() { return nodeMap; }
  function getIframe() { return null; } // No iframe in v4

  function destroy() {
    // Restore interactivity
    restoreInteractivity();

    // Remove data-rb-node tags from TARGET
    var doc = _target();
    var tagged = doc.querySelectorAll("[data-rb-node]");
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
