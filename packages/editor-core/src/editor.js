(function() {
  console.log('[uncraft] editor.js BUILD-MARKER 2026-05-30 slice-B drag-drop');
  if (window.__rbEditorActive) { deactivate(); return; }
  window.__rbEditorActive = true;

  // Host = where panels/popups/keyboard listeners live (editor UI).
  // Target = where the edited content lives (the site).
  // mountEditor sets window.__rbHost / window.__rbTarget on the host window
  // before injecting editor.js. When omitted (standalone runs), both fall
  // back to document/window so the extension behaves exactly as before.
  // Resolved up-front because the site-freeze loop below uses targetDoc.
  var hostDoc = (window.__rbHost && window.__rbHost.doc) || document;
  var hostWin = (window.__rbHost && window.__rbHost.win) || window;
  var targetDoc = (window.__rbTarget && window.__rbTarget.doc) || hostDoc;
  var targetWin = (window.__rbTarget && window.__rbTarget.win) || hostWin;

  var ac = new AbortController(), sig = ac.signal;

  // Detect web builder and freeze animations
  var builderInfo = {builder: 'generic', features: {}};
  try {
    if (window.__rbDetectBuilder) builderInfo = window.__rbDetectBuilder();
    if (builderInfo.builder !== 'generic' && window.__rbFreeze) {
      window.__rbFreeze(builderInfo);
    }
  } catch(detectErr) {}

  // Freeze site animations via JS (not CSS, because insertCSS user-origin !important
  // cannot be overridden by inline !important for .rb-fx-active elements)
  (function freezeSiteAnimations() {
    var nodes = targetDoc.querySelectorAll('*');
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      if (node.nodeType !== 1) continue;
      if (node.closest('#rb-editor-root') || node.closest('#rb-editor-inspector') || node.closest('#rb-ed-banner')) continue;
      var cs = targetWin.getComputedStyle(node);
      if (cs.animationName && cs.animationName !== 'none') {
        node.style.setProperty('animation-play-state', 'paused');
        node.setAttribute('data-rb-frozen-anim', '1');
      }
    }
  })();

  var selectedEl = null, lastHoverEl = null, isDragging = false;
  var selectionDepth = 0;
  var selectionAncestor = null;
  var currentMode = 'A';
  var undoStack = [];
  var redoStack = [];
  var UNDO_STACK_MAX = 100;

  // Canonical push for the undo stack. Every site that previously called
  // `undoStack.push(...)` now calls `pushUndo(...)` so we can (a) enforce
  // max size, (b) invalidate redoStack on new operations (standard
  // undo/redo semantics), (c) centralize telemetry if we add any.
  function pushUndo(entry) {
    undoStack.push(entry);
    if (undoStack.length > UNDO_STACK_MAX) {
      // Drop the oldest entry when we overflow. The oldest entry is the
      // furthest-back state the user can recover, so we prefer to keep
      // recent history which is what users actually expect.
      undoStack.shift();
    }
    // Any new user action clears the redo stack. If the user had undone
    // some steps and then made a new edit, the "redo path" no longer
    // applies — classical undo/redo behavior.
    redoStack.length = 0;
  }
  // Exposed globally so mode-e.js can push a __modeERun entry when it
  // replaces the page. Ensures Cmd+Z works after a Mode E run.
  window.__rbPushUndo = pushUndo;

  var isMac = /Mac/.test(navigator.platform);
  var modKey = isMac ? '\u2318' : 'Ctrl';
  var ftueShown = {};
  try { ftueShown = JSON.parse(localStorage.getItem('rb-ftue') || '{}'); } catch(e) {}

  // Smart Grouping state
  var currentDepth = 0;
  var currentParent = null;
  var groupTree = null;

  // Skip tags
  var SKIP = new Set(['HTML','BODY','HEAD','SCRIPT','STYLE','META','LINK','BR','HR','NOSCRIPT','TITLE','BASE']);

  // SVG icons (width=14 height=14)
  var IC = 'width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"';
  var CLOSE = '<svg '+IC+'><path d="M18 6L6 18M6 6l12 12"/></svg>';
  var EXPORT = '<svg '+IC+'><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></svg>';
  var DL = '<svg '+IC+'><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
  var UL = '<svg '+IC+'><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>';

  // Ensure editor CSS is loaded — lives in HOST (panels live there).
  if (!hostDoc.getElementById('rb-editor-styles')) {
    var cssUrl = '';
    try { cssUrl = chrome.runtime.getURL('editor/editor.css'); } catch(e) {}
    // Web-shell case: chrome.runtime is undefined; the host appends the link
    // tag itself before mounting and we no-op here.
    if (cssUrl) {
      var cssLink = hostDoc.createElement('link');
      cssLink.id = 'rb-editor-styles';
      cssLink.rel = 'stylesheet';
      cssLink.href = cssUrl;
      hostDoc.head.appendChild(cssLink);
    }
  }

  // DOM root — panels & overlays live in HOST.
  var root = hostDoc.createElement('div');
  root.id = 'rb-editor-root';
  hostDoc.body.appendChild(root);
  hostDoc.body.classList.add('rb-ed-active');
  // In canvas mode, the host body is the canvas page itself — we don't
  // want the margin/overflow rules that body.rb-ed-active applies (those
  // squeeze the SITE in extension mode where body === target). Mark with
  // rb-ed-canvas so editor.css can scope around it.
  if (hostDoc !== targetDoc) {
    hostDoc.body.classList.add('rb-ed-canvas');
  }
  hostDoc.documentElement.classList.add('rb-ed-docked');
  hostDoc.documentElement.style.setProperty('--rb-insp-width', '260px');
  hostDoc.documentElement.style.setProperty('--rb-layers-width', '240px');

  // Font isolation: inline <style> injected LAST to beat any site CSS
  var rbFontStyle = hostDoc.createElement('style');
  rbFontStyle.textContent = '#rb-editor-root, #rb-editor-root *, #rb-editor-root *::before, #rb-editor-root *::after { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif !important; }';
  root.appendChild(rbFontStyle);

  // Overlay: hover highlight
  var hoverBox = mk('div', 'rb-sel-hover');
  var hoverTag = mk('div', 'rb-sel-hover-tag');
  hoverBox.appendChild(hoverTag);
  hoverBox.style.display = 'none';
  root.appendChild(hoverBox);

  // Overlay: selection box with handles
  var selBox = mk('div', 'rb-sel-box');
  var selLabel = mk('div', 'rb-sel-label');
  selBox.appendChild(selLabel);
  // Feedback tab on the selection — anchored to the box's top-right
  // corner, sticking OUT (translated above the top edge), same shape as
  // the one on spacing guides. Visible while a node element is
  // selected. Markup is hydrated lazily because SPACING_PIN_SVG /
  // spacingFeedbackTabMarkup are declared further down in the IIFE.
  var selFeedbackTab = mk('div', 'rb-sel-fb-tab');
  selBox.appendChild(selFeedbackTab);
  selBox.style.display = 'none';

  var handleDirs = ['nw','n','ne','e','se','s','sw','w'];
  var handles = {};
  var cursorMap = {nw:'nwse',n:'ns',ne:'nesw',e:'ew',se:'nwse',s:'ns',sw:'nesw',w:'ew'};
  var posMap = {
    nw: {top:'-6px',left:'-6px'},
    n:  {top:'-6px',left:'50%',marginLeft:'-6px'},
    ne: {top:'-6px',right:'-6px'},
    e:  {top:'50%',right:'-6px',marginTop:'-6px'},
    se: {bottom:'-6px',right:'-6px'},
    s:  {bottom:'-6px',left:'50%',marginLeft:'-6px'},
    sw: {bottom:'-6px',left:'-6px'},
    w:  {top:'50%',left:'-6px',marginTop:'-6px'}
  };
  handleDirs.forEach(function(d) {
    var h = mk('div', 'rb-sel-handle');
    h.dataset.dir = d;
    h.style.cursor = cursorMap[d] + '-resize';
    Object.assign(h.style, posMap[d]);
    selBox.appendChild(h);
    handles[d] = h;
  });
  root.appendChild(selBox);

  // Overlay: parent highlight
  var parentBox = mk('div', 'rb-sel-parent');
  parentBox.style.display = 'none';
  root.appendChild(parentBox);

  // Freeze site to idle state — disable all hover/focus/active CSS rules.
  // Reads stylesheets from TARGET (the site) and the kill rule must live in
  // TARGET head so it applies in target's CSS context.
  var hoverKill = targetDoc.createElement('style');
  hoverKill.id = 'rb-hover-kill';
  var killRules = '';
  try {
    Array.from(targetDoc.styleSheets).forEach(function(sheet) {
      try {
        // Skip our own editor stylesheet
        if (sheet.ownerNode && sheet.ownerNode.id === 'rb-editor-styles') return;
        if (sheet.href && sheet.href.indexOf('editor.css') !== -1) return;
        Array.from(sheet.cssRules || []).forEach(function(rule) {
          if (rule.selectorText && (
            rule.selectorText.includes(':hover') ||
            rule.selectorText.includes(':focus') ||
            rule.selectorText.includes(':active')
          )) {
            // Skip rules targeting our editor elements
            if (rule.selectorText.indexOf('rb-') !== -1) return;
            killRules += rule.selectorText + '{';
            for (var i = 0; i < rule.style.length; i++) {
              var prop = rule.style[i];
              killRules += prop + ':revert!important;';
            }
            killRules += '}\n';
          }
        });
      } catch(e) {} // CORS blocked sheets
    });
  } catch(e) {}
  hoverKill.textContent = killRules;
  targetDoc.head.appendChild(hoverKill);

  // In canvas mode the iframe is its own document, so editor.css (loaded
  // into the host) doesn't reach it. Mirror the rb-ed-active class onto
  // the target body and inject the cursor styles there so the custom
  // arrow + text-hint cursor work over the iframe content. Extension mode
  // (host === target) is a no-op since both writes hit the same body.
  targetDoc.body.classList.add('rb-ed-active');
  if (hostDoc !== targetDoc) {
    var cursorStyle = targetDoc.createElement('style');
    cursorStyle.id = 'rb-cursor-style';
    // Class qualifier stacked 3x so specificity beats site CSS that targets
    // text/links via `.section .paragraph p { cursor: text }` patterns
    // (Webflow, Framer, reconstructed pages). Without the bump, sites win
    // the cursor war and the native I-beam leaks over text elements.
    cursorStyle.textContent =
      "body.rb-ed-active.rb-ed-active.rb-ed-active, body.rb-ed-active.rb-ed-active.rb-ed-active *:not(input):not(textarea):not(select) {" +
        "cursor: url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='28' viewBox='-2 -2 42 42'%3E%3Cdefs%3E%3Cfilter id='s'%3E%3CfeDropShadow dx='1' dy='2' stdDeviation='1.5' flood-opacity='0.4'/%3E%3C/filter%3E%3C/defs%3E%3Cpath filter='url(%23s)' d='M34.25,17.94l-13.58,2.72-2.72,13.58c-.22,1.1-1.29,1.81-2.39,1.59-.67-.13-1.23-.6-1.49-1.23L2.15,4.78c-.42-1.04.09-2.22,1.13-2.64.48-.19,1.02-.19,1.51,0l29.82,11.93c1.04.42,1.55,1.6,1.13,2.64-.25.64-.81,1.1-1.48,1.24Z' fill='%23fff' stroke='%23000' stroke-width='1.5'/%3E%3C/svg%3E\") 2 1, default !important;" +
      "}" +
      "body.rb-ed-active.rb-ed-active.rb-ed-active .rb-ed-text-hint {" +
        "cursor: url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='38' viewBox='-2 -2 56 52'%3E%3Cdefs%3E%3Cfilter id='s'%3E%3CfeDropShadow dx='1' dy='2' stdDeviation='1.5' flood-opacity='0.4'/%3E%3C/filter%3E%3C/defs%3E%3Cpath filter='url(%23s)' d='M34.25,17.94l-13.58,2.72-2.72,13.58c-.22,1.1-1.29,1.81-2.39,1.59-.67-.13-1.23-.6-1.49-1.23L2.15,4.78c-.42-1.04.09-2.22,1.13-2.64.48-.19,1.02-.19,1.51,0l29.82,11.93c1.04.42,1.55,1.6,1.13,2.64-.25.64-.81,1.1-1.48,1.24Z' fill='%23fff' stroke='%23000' stroke-width='1.5'/%3E%3Cg transform='translate(32,28) scale(0.7)' fill='%23fff' stroke='%23000' stroke-width='1'%3E%3Cpolygon points='24.5 1 1 1 1 4.99 1.01 4.99 1.01 9 5 9 5 4.99 10.75 4.99 10.75 22.65 7.58 22.65 7.58 26.64 17.91 26.64 17.91 22.65 14.74 22.65 14.74 4.99 20.54 4.99 20.54 9 24.53 9 24.53 1 24.5 1'/%3E%3C/g%3E%3C/svg%3E\") 2 1, text !important;" +
      "}";
    targetDoc.head.appendChild(cursorStyle);
  }

  // Build UI components
  buildBanner();
  buildInspector();

  // Prepare page for editing (tag elements, disable interactivity)
  if (window.__rbRebuild) {
    window.__rbRebuild.rebuild(function() {
      listen();
      initAutoSave();
    });
  } else {
    listen();
    initAutoSave();
  }

  // ============ LOCAL FONTS ============

  var localFonts = null;
  function getLocalFonts(callback) {
    if (localFonts) { callback(localFonts); return; }
    if (!window.queryLocalFonts) { callback([]); return; }
    window.queryLocalFonts().then(function(fonts) {
      var families = new Set();
      fonts.forEach(function(f) { families.add(f.family); });
      localFonts = [...families].sort();
      callback(localFonts);
    }).catch(function() { callback([]); });
  }

  // ============ HELPERS ============

  function mk(tag, cls) {
    // mk() is used exclusively for editor UI (panels, overlays, popups) — host.
    var e = hostDoc.createElement(tag);
    if (cls) e.className = cls;
    return e;
  }

  function isLight() { return hostDoc.body.classList.contains('rb-ed-light'); }

  function getBox(el) {
    var r = el.getBoundingClientRect();
    return {top: r.top, left: r.left, width: r.width, height: r.height, bottom: r.bottom, right: r.right};
  }

  // Map a TARGET element's bounding rect into HOST viewport coords. Used for
  // every overlay (selection box, hover, spacing guides, drop indicator)
  // because the overlay container lives in HOST while the element being
  // outlined lives in TARGET (an iframe in canvas mode). When host === target
  // (extension mode) this is a passthrough.
  function getOverlayBox(el) {
    var r = el.getBoundingClientRect();
    if (hostDoc === targetDoc) {
      return {top: r.top, left: r.left, width: r.width, height: r.height, bottom: r.bottom, right: r.right};
    }
    var ifr = targetWin.frameElement;
    if (!ifr) return {top: r.top, left: r.left, width: r.width, height: r.height, bottom: r.bottom, right: r.right};
    var ir = ifr.getBoundingClientRect();
    var contentW = targetWin.innerWidth || ir.width;
    var scale = ir.width / (contentW || 1);
    return {
      top: ir.top + r.top * scale,
      left: ir.left + r.left * scale,
      width: r.width * scale,
      height: r.height * scale,
      bottom: ir.top + r.bottom * scale,
      right: ir.left + r.right * scale,
      _scale: scale,
      _ifrTop: ir.top,
      _ifrLeft: ir.left
    };
  }
  // For mapping spacing-guide and gap-aware positions where we need to
  // arithmetic-combine target-px values WITH the iframe offset/scale. The
  // overlay code computes things like `r.left - ml` (target px). To draw
  // that correctly in HOST we need ml in scaled px and the iframe origin.
  function targetToHost(tx, ty) {
    if (hostDoc === targetDoc) return {x: tx, y: ty, scale: 1};
    var ifr = targetWin.frameElement;
    if (!ifr) return {x: tx, y: ty, scale: 1};
    var ir = ifr.getBoundingClientRect();
    var contentW = targetWin.innerWidth || ir.width;
    var scale = ir.width / (contentW || 1);
    return {x: ir.left + tx * scale, y: ir.top + ty * scale, scale: scale};
  }

  function isEditorEl(el) {
    if (!el) return true;
    var n = el;
    while (n) {
      if (n.id && (n.id.indexOf('rb-editor') === 0 || n.id === 'repixbridge-panel')) return true;
      // Canvas wrapper is editor UI, but its CHILDREN (the cloned page) are NOT
      if (n.id === 'rb-ed-canvas') return false;
      if (n.id === 'rb-ed-canvas-wrapper') return false;
      n = n.parentElement;
    }
    return false;
  }

  function isValid(el) {
    return el && !SKIP.has(el.tagName) && !isEditorEl(el);
  }

  function isText(el) {
    if (!el) return false;
    var nonText = ['IMG','VIDEO','IFRAME','CANVAS','SVG','INPUT','SELECT','TEXTAREA'];
    if (nonText.indexOf(el.tagName) !== -1) return false;
    // Check innerText (includes text from all descendants)
    var txt = (el.innerText || el.textContent || '').trim();
    return txt.length > 0;
  }

  // Hybrid: known text tags OR any element with direct text nodes
  function isDirectText(el) {
    if (!el) return false;
    var nonText = ['IMG','VIDEO','IFRAME','CANVAS','SVG','INPUT','SELECT','TEXTAREA'];
    if (nonText.indexOf(el.tagName) !== -1) return false;
    // Known text tags — always yes if they have any text content
    var textTags = ['H1','H2','H3','H4','H5','H6','P','SPAN','A','BUTTON','LABEL','LI','BLOCKQUOTE','FIGCAPTION','CODE','PRE','EM','STRONG','B','I','U','SMALL','MARK','TD','TH','DT','DD','CITE'];
    if (textTags.indexOf(el.tagName) !== -1) {
      return (el.innerText || el.textContent || '').trim().length > 0;
    }
    // Other elements — only if they have direct text child nodes
    for (var i = 0; i < el.childNodes.length; i++) {
      if (el.childNodes[i].nodeType === 3 && el.childNodes[i].textContent.trim().length > 0) return true;
    }
    return false;
  }

  function px(v) { return parseFloat(v) || 0; }

  // getComputedStyle that works across iframe boundaries
  function getCS(el) {
    var doc = el.ownerDocument || document;
    return doc.defaultView.getComputedStyle(el);
  }

  function cssProp(jsProp) {
    return jsProp.replace(/([A-Z])/g, '-$1').toLowerCase();
  }

  // ---- Text-wrapper detection & cascade helpers ----
  // Rationale: sites using split-text animations (GSAP SplitText, Framer, etc.)
  // delegate text to nested wrappers with their own inline styles. Selecting the
  // parent and editing shows stale values and needs to cascade writes to leaves.
  function hasDirectText(el) {
    if (!el || !el.childNodes) return false;
    for (var i = 0; i < el.childNodes.length; i++) {
      var n = el.childNodes[i];
      if (n.nodeType === 3 && n.textContent && n.textContent.trim()) return true;
    }
    return false;
  }
  function isEditorEl(el) {
    return !!(el && el.closest && (el.closest('#rb-editor-root') || el.closest('#rb-editor-inspector') || el.closest('#rb-ed-banner') || el.closest('#rb-editor-layers')));
  }
  function getTextLeaves(el) {
    if (!el || el.nodeType !== 1) return [];
    if (hasDirectText(el)) return [el];
    var leaves = [];
    var kids = el.querySelectorAll('*');
    for (var i = 0; i < kids.length; i++) {
      var k = kids[i];
      if (isEditorEl(k)) continue;
      if (hasDirectText(k)) leaves.push(k);
    }
    return leaves;
  }
  function isTextWrapper(el) {
    if (!el || el.nodeType !== 1) return false;
    if (hasDirectText(el)) return false;
    var leaves = getTextLeaves(el);
    return leaves.length > 0;
  }
  // Reads a typography prop consolidating across leaves. Returns either the
  // single value (string) or { mixed: true, first: <value> } when leaves differ.
  function readTextStyle(el, prop) {
    var leaves = getTextLeaves(el);
    if (!leaves.length) return getCS(el)[prop];
    var first = getCS(leaves[0])[prop];
    for (var i = 1; i < leaves.length; i++) {
      if (getCS(leaves[i])[prop] !== first) return { mixed: true, first: first };
    }
    return first;
  }
  // Read element with the authoritative values. For wrappers, returns the first
  // text leaf so code that reads `cs.fontSize` works correctly.
  function getReadEl(el) {
    if (!el) return el;
    if (hasDirectText(el)) return el;
    var leaves = getTextLeaves(el);
    return leaves.length ? leaves[0] : el;
  }
  // Auto-class override pool: used when inline !important loses to a stronger
  // stylesheet rule. Rare — most inline !important wins.
  var _rbOverrideSheet = null;
  var _rbOverrideCounter = 0;
  function getOverrideSheet() {
    if (_rbOverrideSheet) return _rbOverrideSheet;
    // ID-rule override must live in TARGET head — its rules need to apply
    // in the site's CSS context, not the editor host's.
    var s = targetDoc.createElement('style');
    s.id = 'rb-override-sheet';
    targetDoc.head.appendChild(s);
    _rbOverrideSheet = s.sheet;
    return _rbOverrideSheet;
  }
  // Track the last override value per (element, prop) so we don't keep appending
  // duplicate rules on every rAF tick during rapid edits.
  var _rbOverrideLast = new WeakMap();
  function applyOverrideClass(leaf, prop, value) {
    var reg = _rbOverrideLast.get(leaf);
    if (!reg) { reg = {}; _rbOverrideLast.set(leaf, reg); }
    if (reg[prop] === value) return;
    reg[prop] = value;
    // ID selector: React/Framer reassigns className on re-render (stripping our
    // runtime-added classes) but rarely controls id, so an ID rule persists.
    if (!leaf.id) leaf.id = 'rb-ovid-' + (++_rbOverrideCounter);
    try {
      var esc = (window.CSS && CSS.escape) ? CSS.escape(leaf.id) : leaf.id;
      getOverrideSheet().insertRule('#' + esc + '{ ' + cssProp(prop) + ': ' + value + ' !important; }', 0);
    } catch (e) {}
  }

  // ---- Sticky inline writes for framework-driven re-renders ----
  // ID-rule (above) wins over class-level rules, but loses to inline `style="..."`
  // re-written by the framework (Framer/React/Hydrogen). We observe the element's
  // style/class attributes and re-apply our inline !important whenever the framework
  // stomps. After MAX_FAILS rewrites inside WINDOW_MS we disconnect — if the site
  // is actively fighting us, it's cheaper to let the ID rule try alone than to burn
  // CPU in a tug-of-war.
  var _rbSticky = new WeakMap(); // el -> { observer, props: Map<prop, rec>, disabled }
  var _rbStickyWriting = false;
  var STICKY_MAX_FAILS = 5;
  var STICKY_WINDOW_MS = 2000;

  function ensureStickyEntry(el) {
    var entry = _rbSticky.get(el);
    if (entry) return entry;
    entry = { observer: null, props: new Map(), disabled: false };
    var observer = new MutationObserver(function() {
      if (_rbStickyWriting || entry.disabled) return;
      if (!targetDoc.body.contains(el)) {
        try { observer.disconnect(); } catch (_) {}
        entry.disabled = true;
        return;
      }
      var now = Date.now();
      var anyActive = false;
      entry.props.forEach(function(rec, prop) {
        if (rec.fails >= STICKY_MAX_FAILS) return;
        var cur = getCS(el)[prop];
        if (cur === rec.value) { anyActive = true; return; }
        if (now - rec.windowStart > STICKY_WINDOW_MS) {
          rec.fails = 0;
          rec.windowStart = now;
        }
        rec.fails++;
        if (rec.fails >= STICKY_MAX_FAILS) return;
        _rbStickyWriting = true;
        try {
          el.style.setProperty(cssProp(prop), rec.value, 'important');
        } catch (_) {}
        _rbStickyWriting = false;
        anyActive = true;
      });
      if (!anyActive && entry.props.size > 0) {
        try { observer.disconnect(); } catch (_) {}
        entry.disabled = true;
      }
    });
    entry.observer = observer;
    try {
      observer.observe(el, { attributes: true, attributeFilter: ['style', 'class'] });
    } catch (_) {}
    _rbSticky.set(el, entry);
    return entry;
  }

  function startSticky(el, prop, value) {
    var entry = ensureStickyEntry(el);
    if (entry.disabled) {
      entry.disabled = false;
      try {
        entry.observer.observe(el, { attributes: true, attributeFilter: ['style', 'class'] });
      } catch (_) {}
    }
    var rec = entry.props.get(prop);
    if (!rec) {
      entry.props.set(prop, { value: value, fails: 0, windowStart: Date.now() });
    } else {
      rec.value = value;
      rec.fails = 0;
      rec.windowStart = Date.now();
    }
  }

  function stopStickyForEl(el) {
    var entry = _rbSticky.get(el);
    if (!entry) return;
    if (entry.observer) { try { entry.observer.disconnect(); } catch (_) {} }
    _rbSticky.delete(el);
  }

  // ---- Link helpers ----
  // Strict link detection: only report a link when the SELECTED element is
  // unambiguously the link owner — either it's an <a> itself, or its parent
  // is an <a> that wraps this element exclusively (our wrap pattern, or a
  // site's atomic link like an icon/button). Walking further up would mark
  // any descendant of a large clickable hero as "linked" and hide the "+",
  // which surprised the user.
  function getElementLink(el) {
    if (!el || el.nodeType !== 1) return null;
    if (el.tagName === 'A' && el.hasAttribute('href')) return el;
    var p = el.parentElement;
    if (p && p.tagName === 'A' && p.hasAttribute('href') &&
        p.children.length === 1 && p.firstElementChild === el) {
      return p;
    }
    return null;
  }

  // Wrap `el` in a new <a href>. Returns the anchor. Pushes an undo entry of
  // type '__linkWrap' so undo unwraps it cleanly.
  function wrapInLink(el, href) {
    // Anchor wraps a site element — must live in the target document.
    var a = (el.ownerDocument || targetDoc).createElement('a');
    a.setAttribute('href', href);
    a.setAttribute('data-rb-link', '1');
    var parent = el.parentNode;
    if (!parent) return null;
    parent.insertBefore(a, el);
    a.appendChild(el);
    pushUndo({ prop: '__linkWrap', anchor: a, child: el });
    return a;
  }

  function unwrapLink(a) {
    var parent = a.parentNode;
    if (!parent) return;
    var firstChild = a.firstChild;
    while (a.firstChild) parent.insertBefore(a.firstChild, a);
    parent.removeChild(a);
    pushUndo({ prop: '__linkUnwrap', anchor: a, parent: parent, nextSibling: firstChild ? firstChild.nextSibling : null, children: Array.prototype.slice.call(a.childNodes) });
  }

  // Currently-open link editor popup. Tracked so the minidocks can dismiss
  // it when they close — otherwise the popup is orphaned in hostDoc.body and
  // hangs around after the user clicks to a different element (the dock's
  // own outside-click listener fires on the new target, removing the dock,
  // but the link popup never sees a mousedown inside itself).
  var _openLinkPopup = null;
  function removeLinkEditor() {
    var p = _openLinkPopup;
    _openLinkPopup = null;
    if (p && p.parentNode) p.remove();
    // Fallback in case _openLinkPopup got cleared but a stale popup remains.
    var orphan = hostDoc.querySelector('.rb-link-editor');
    if (orphan) orphan.remove();
  }

  // Popup to edit a link (href + target + clear). Anchored near `anchorBtn`.
  // onChange(href | null) — null signals "remove link". Returns popup node.
  function openLinkEditor(anchorBtn, currentHref, onChange) {
    // Popup lives in HOST (panels surface). Clear any prior popup + its
    // outside listeners through the central helper so re-opening doesn't
    // leak listeners.
    removeLinkEditor();
    var pop = hostDoc.createElement('div');
    pop.className = 'rb-link-editor rb-ed-img-menu';
    pop.style.cssText = 'position:fixed;padding:8px;display:flex;flex-direction:column;gap:6px;min-width:280px;z-index:2147483647;';
    var row = hostDoc.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:4px;';
    var inp = hostDoc.createElement('input');
    inp.type = 'url';
    inp.placeholder = 'https://...';
    inp.value = currentHref || '';
    inp.style.cssText = 'flex:1;height:25px;padding:0 8px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:4px;color:inherit;font:inherit;font-size:11px;outline:none;';
    var saveBtn = hostDoc.createElement('button');
    saveBtn.className = 'rb-img-bar-btn';
    saveBtn.textContent = 'Save';
    saveBtn.style.cssText = 'padding:0 10px;height:25px;';
    row.appendChild(inp);
    row.appendChild(saveBtn);
    pop.appendChild(row);
    if (currentHref) {
      var clrBtn = hostDoc.createElement('button');
      clrBtn.className = 'rb-img-bar-btn';
      clrBtn.textContent = 'Remove link';
      clrBtn.style.cssText = 'height:22px;font-size:10px;opacity:0.75;';
      clrBtn.addEventListener('mousedown', function(e) {
        e.stopImmediatePropagation();
        onChange(null);
        if (_openLinkPopup === pop) _openLinkPopup = null;
        pop.remove();
      }, {capture: true});
      pop.appendChild(clrBtn);
    }
    hostDoc.body.appendChild(pop);
    _openLinkPopup = pop;
    var r = anchorBtn.getBoundingClientRect();
    pop.style.left = Math.max(8, Math.min(hostWin.innerWidth - pop.offsetWidth - 8, r.left)) + 'px';
    pop.style.top = Math.min(hostWin.innerHeight - pop.offsetHeight - 8, r.bottom + 6) + 'px';
    setTimeout(function() { inp.focus(); inp.select(); }, 0);
    function closePop() {
      if (_openLinkPopup === pop) _openLinkPopup = null;
      if (pop.parentNode) pop.remove();
      hostDoc.removeEventListener('mousedown', outside, true);
      if (hostDoc !== targetDoc) targetDoc.removeEventListener('mousedown', outsideT, true);
    }
    function commit() {
      var v = inp.value.trim();
      if (!v) { closePop(); return; }
      if (!/^[a-z]+:\/\//i.test(v) && !v.startsWith('mailto:') && !v.startsWith('tel:') && !v.startsWith('#') && !v.startsWith('/')) {
        v = 'https://' + v;
      }
      onChange(v);
      closePop();
    }
    saveBtn.addEventListener('mousedown', function(e) { e.stopImmediatePropagation(); commit(); }, {capture: true});
    inp.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      else if (e.key === 'Escape') { closePop(); }
    });
    function outside(ev) {
      if (!pop.contains(ev.target) && ev.target !== anchorBtn && !anchorBtn.contains(ev.target)) closePop();
    }
    // Canvas mode: mousedown inside the iframe (targetDoc) never bubbles to
    // hostDoc, so listening on host alone leaves the popup open when the
    // user clicks back into the page. Mirror on target so any click outside
    // the popup (in either doc) dismisses it.
    function outsideT(ev) { closePop(); }
    setTimeout(function() {
      hostDoc.addEventListener('mousedown', outside, true);
      if (hostDoc !== targetDoc) targetDoc.addEventListener('mousedown', outsideT, true);
    }, 150);
    return pop;
  }

  // ---- Font picker (popup with search + scroll list; used by inspector & minidock) ----
  var WEB_SAFE_FONTS = ['Arial','Helvetica','Verdana','Georgia','Times New Roman','Courier New','system-ui','Roboto','Inter'];
  // Shared font icon — document with "T" inside. Same one used in the inspector's
  // Font field so the minidock font button matches visually. currentColor so it
  // inherits button text color (handles light/dark mode automatically).
  var FONT_ICON_SVG = '<svg width="12" height="12" viewBox="0 0 36.23 42.5" fill="currentColor"><polygon points="25.58 14.61 10.21 14.61 10.21 17.22 10.22 17.22 10.22 19.84 12.83 19.84 12.83 17.22 16.59 17.22 16.59 28.77 14.52 28.77 14.52 31.38 21.28 31.38 21.28 28.77 19.2 28.77 19.2 17.22 23 17.22 23 19.84 25.61 19.84 25.61 14.61 25.58 14.61"/><path d="M34.31,9.33l-7.41-7.41c-1.24-1.24-2.89-1.93-4.65-1.93H5.72C2.57,0,0,2.57,0,5.72v31.06c0,3.15,2.57,5.72,5.72,5.72h24.79c3.15,0,5.72-2.57,5.72-5.72V13.98c0-1.73-.7-3.42-1.93-4.65ZM33.06,13.98v22.79c0,1.43-1.12,2.54-2.54,2.54H5.72c-1.43,0-2.54-1.12-2.54-2.54V5.72c0-1.43,1.12-2.54,2.54-2.54h16.53c.91,0,1.76.35,2.4,1l7.41,7.41c.64.64,1,1.5,1,2.4Z"/></svg>';
  function openFontPicker(anchorBtn, currentFont, onPick) {
    var existing = hostDoc.querySelector('.rb-font-picker');
    if (existing) existing.remove();
    // Reuse rb-ed-img-menu for frosted-glass + light-mode theming (CSS already
    // provides both). Class rb-font-picker adds sizing and inner layout.
    var pop = hostDoc.createElement('div');
    pop.className = 'rb-font-picker rb-ed-img-menu';
    var srch = hostDoc.createElement('input');
    srch.type = 'text';
    srch.placeholder = 'Search fonts';
    srch.value = currentFont || '';
    srch.className = 'rb-font-picker-search';
    var list = hostDoc.createElement('div');
    list.className = 'rb-font-picker-list';
    pop.appendChild(srch);
    pop.appendChild(list);
    hostDoc.body.appendChild(pop);
    var r = anchorBtn.getBoundingClientRect();
    pop.style.left = Math.max(8, Math.min(hostWin.innerWidth - 228, r.left)) + 'px';
    pop.style.top = Math.min(hostWin.innerHeight - pop.offsetHeight - 8, r.bottom + 6) + 'px';

    // Centralized close: always blur the internal input first (otherwise the
    // global keydown guard sees `document.activeElement` as INPUT and swallows
    // shortcuts like Cmd+Z right after the picker closes), remove the DOM, and
    // detach the outside listener so zombies don't pile up on repeated picks.
    var outsideBound = null;
    function close() {
      try { srch.blur(); } catch (_) {}
      if (pop.parentNode) pop.remove();
      if (outsideBound) {
        hostDoc.removeEventListener('mousedown', outsideBound, true);
        outsideBound = null;
      }
    }

    var fonts = WEB_SAFE_FONTS.slice();
    if (currentFont && fonts.indexOf(currentFont) < 0) fonts.unshift(currentFont);
    function render(filter) {
      list.innerHTML = '';
      var f = (filter || '').toLowerCase().trim();
      var items = f ? fonts.filter(function(n) { return n.toLowerCase().indexOf(f) >= 0; }) : fonts.slice();
      if (!items.length) {
        var e = hostDoc.createElement('div');
        e.textContent = 'No fonts match';
        e.className = 'rb-font-picker-empty';
        list.appendChild(e);
        return;
      }
      items.forEach(function(name) {
        var opt = hostDoc.createElement('div');
        opt.textContent = name;
        opt.className = 'rb-font-picker-opt';
        opt.style.fontFamily = '"' + name + '",sans-serif';
        opt.addEventListener('mousedown', function(e) {
          e.preventDefault(); e.stopImmediatePropagation();
          onPick(name);
          close();
        }, {capture: true});
        list.appendChild(opt);
      });
    }
    render('');
    srch.addEventListener('input', function() { render(srch.value); });
    srch.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') close();
      else if (e.key === 'Enter') {
        var v = srch.value.trim();
        if (v) { onPick(v); close(); }
      }
    });
    setTimeout(function() { srch.focus(); srch.select(); }, 0);
    if (typeof getLocalFonts === 'function') {
      try {
        getLocalFonts(function(locals) {
          if (!locals || !locals.length) return;
          locals.forEach(function(ln) { if (fonts.indexOf(ln) < 0) fonts.push(ln); });
          render(srch.value);
        });
      } catch (_) {}
    }
    outsideBound = function(ev) {
      if (!pop.contains(ev.target) && ev.target !== anchorBtn && !anchorBtn.contains(ev.target)) {
        close();
      }
    };
    setTimeout(function() {
      if (outsideBound) hostDoc.addEventListener('mousedown', outsideBound, true);
    }, 150);
    return pop;
  }

  // ---- Per-range typography (apply style to the current text selection) ----
  // When the user double-clicks text to enter edit mode and selects a word/phrase,
  // typography writes should hit only that slice, not the whole element. We track
  // the last non-collapsed selection inside the editable so applyStyle can route
  // to it. Cleared on exit from text edit.
  var __pendingTextRange = null; // { range: Range, editableRoot: HTMLElement }
  var TEXT_RANGE_PROPS = new Set(['color','fontFamily','fontSize','fontWeight',
    'fontStyle','lineHeight','letterSpacing','textDecoration','textTransform']);

  function applyPropToRange(editableRoot, range, prop, value) {
    if (!editableRoot || !range || !targetDoc.body.contains(editableRoot)) return false;
    try {
      var oldHTML = editableRoot.innerHTML;
      // If the range already exactly wraps a single <span>, modify that span in
      // place instead of nesting a new one. This is the common case after the
      // first apply: the user tweaks the same slice and expects iteration, not
      // accumulating nested spans.
      var target = null;
      var ca = range.commonAncestorContainer;
      if (ca && ca.nodeType === 1 && ca.tagName === 'SPAN' &&
          ca !== editableRoot &&
          range.startContainer === ca && range.endContainer === ca &&
          range.startOffset === 0 && range.endOffset === ca.childNodes.length) {
        target = ca;
      }
      if (target) {
        target.style.setProperty(cssProp(prop), value, 'important');
      } else {
        var span = targetDoc.createElement('span');
        span.style.setProperty(cssProp(prop), value, 'important');
        try {
          range.surroundContents(span);
        } catch (e) {
          var frag = range.extractContents();
          span.appendChild(frag);
          range.insertNode(span);
        }
        target = span;
      }
      pushUndo({ prop: '__textEdit', el: editableRoot, old: oldHTML });
      var newRange = targetDoc.createRange();
      newRange.selectNodeContents(target);
      var sel = targetWin.getSelection();
      if (sel) { sel.removeAllRanges(); sel.addRange(newRange); }
      __pendingTextRange = { range: newRange.cloneRange(), editableRoot: editableRoot };
      return true;
    } catch (e) { return false; }
  }

  function isTransparent(s) {
    if (!s || s === 'transparent' || s === 'rgba(0, 0, 0, 0)') return true;
    var m = s.match(/[\d.]+/g);
    if (m && m.length >= 4 && parseFloat(m[3]) === 0) return true;
    return false;
  }

  function rgbHex(s) {
    if (!s || s === 'transparent') return null;
    if (isTransparent(s)) return null;
    var m = s.match(/\d+/g);
    if (!m || m.length < 3) return null;
    return '#' + m.slice(0, 3).map(function(x) {
      return ('0' + parseInt(x).toString(16)).slice(-2);
    }).join('');
  }

  function throttle(fn, ms) {
    var last = 0;
    return function() {
      var now = Date.now();
      if (now - last >= ms) {
        last = now;
        fn.apply(this, arguments);
      }
    };
  }

  // ============ SMART GROUPING ============

  var SEMANTIC_TAGS = new Set(['HEADER','NAV','MAIN','FOOTER','SECTION','ARTICLE','ASIDE','FIGURE','FORM','TABLE','UL','OL','DL']);
  var LANDMARK_SCORE = {HEADER:10,NAV:9,MAIN:10,FOOTER:10,SECTION:8,ARTICLE:8,ASIDE:6,FORM:7,TABLE:7};

  function buildGroupTree() {
    try { return getGroups(targetDoc.body, 0); } catch(e) { return []; }
  }

  function getGroups(parent, depth) {
    if (depth > 10) return []; // prevent infinite recursion
    var children = Array.from(parent.children).filter(function(el) {
      if (SKIP.has(el.tagName)) return false;
      if (isEditorEl(el)) return false;
      var r = el.getBoundingClientRect();
      if (r.width < 10 || r.height < 10) return false;
      return true;
    });
    if (children.length === 0) return [];
    if (children.length === 1) {
      // Single child — drill deeper to find meaningful structure
      var deeper = getGroups(children[0], depth + 1);
      return deeper.length > 0 ? deeper : [{ el: children[0], score: 5 }];
    }
    var scored = children.map(function(el) {
      var r = el.getBoundingClientRect();
      var area = r.width * r.height;
      var viewportArea = targetWin.innerWidth * targetWin.innerHeight;
      var sizeScore = Math.min(area / viewportArea * 10, 10);
      var semanticScore = LANDMARK_SCORE[el.tagName] || 0;
      var childCount = el.children.length;
      var depthScore = childCount > 2 ? 3 : childCount > 0 ? 1 : 0;
      return { el: el, score: sizeScore + semanticScore + depthScore };
    });
    if (scored.length === 0) return [];
    var maxScore = Math.max.apply(null, scored.map(function(s) { return s.score; }));
    if (maxScore <= 0) return scored;
    var threshold = maxScore * 0.1;
    var groups = scored.filter(function(s) { return s.score >= threshold; });
    if (groups.length > 12) {
      groups.sort(function(a, b) { return b.score - a.score; });
      groups = groups.slice(0, 12).sort(function(a, b) {
        return a.el.compareDocumentPosition(b.el) & 2 ? 1 : -1;
      });
    }
    return groups;
  }

  function getGroupsAtDepth() {
    if (currentDepth === 0 || !currentParent) {
      if (!groupTree) groupTree = buildGroupTree();
      return groupTree;
    }
    return getGroups(currentParent);
  }

  function findGroupFor(el) {
    var groups = getGroupsAtDepth();
    if (!groups || groups.length === 0) return { el: el, score: 0 }; // fallback to raw element
    for (var i = 0; i < groups.length; i++) {
      if (groups[i].el === el || groups[i].el.contains(el)) return groups[i];
    }
    // No group found — return raw element (allows selection of anything)
    return { el: el, score: 0 };
  }

  function drillInto(el) {
    currentParent = el;
    currentDepth++;
    hoverBox.style.display = 'none';
    selBox.style.display = 'none';
    parentBox.style.display = 'none';
    selectedEl = null;
    // Show parent context
    var r = getBox(el);
    Object.assign(parentBox.style, {display:'block',top:r.top+'px',left:r.left+'px',width:r.width+'px',height:r.height+'px'});
    updateDepthIndicator();
  }

  function drillOut() {
    if (currentDepth === 0) return;
    currentDepth--;
    if (currentDepth === 0) { currentParent = null; }
    else {
      currentParent = currentParent ? currentParent.parentElement : null;
      if (currentParent === targetDoc.body) { currentParent = null; currentDepth = 0; }
    }
    deselectEl();
    updateDepthIndicator();
  }

  function updateDepthIndicator() {
    var banner = hostDoc.getElementById('rb-ed-banner');
    if (!banner) return;
    var txt = currentDepth === 0
      ? 'Click any element to edit'
      : 'Depth ' + currentDepth + ' \u2014 double-click to go deeper \u00B7 Esc to go up';
    var first = banner.childNodes[0];
    if (first && first.nodeType === 3) { first.textContent = txt; }
    else { banner.insertBefore(hostDoc.createTextNode(txt), banner.firstChild); }
  }

  // ============ FLASH GROUPS (visual feedback on entry) ============

  function flashGroups() {
    var groups = getGroupsAtDepth();
    if (!groups || groups.length === 0) return;
    var overlays = [];
    groups.forEach(function(g, i) {
      var r = getBox(g.el);
      var ov = mk('div', 'rb-ed-group-flash');
      Object.assign(ov.style, {
        position: 'fixed', top: r.top+'px', left: r.left+'px',
        width: r.width+'px', height: r.height+'px',
        animationDelay: (i * 60) + 'ms'
      });
      // Label showing the tag name
      var lbl = mk('span', 'rb-ed-group-flash-label');
      lbl.textContent = g.el.tagName.toLowerCase();
      ov.appendChild(lbl);
      root.appendChild(ov);
      overlays.push(ov);
    });
    // Remove after animation
    setTimeout(function() {
      overlays.forEach(function(ov) { if (ov.parentNode) ov.remove(); });
    }, 2500);
  }

  // ============ AUTO-SAVE ============

  var autoSaveInterval = null;
  // Autosave key namespaces per SITE URL. In canvas mode the iframe may be
  // cross-origin and reading targetWin.location throws — fall back to host.
  var saveKey;
  try {
    saveKey = 'rb-autosave-' + targetWin.location.hostname + targetWin.location.pathname;
  } catch (e) {
    saveKey = 'rb-autosave-' + hostWin.location.hostname + hostWin.location.pathname;
  }

  function initAutoSave() {
    // Clean up ALL stale editor artifacts from previous sessions
    var staleStyles = hostDoc.getElementById('rb-editor-styles');
    if (staleStyles) staleStyles.remove();

    // Remove stale inline styles from previous editor sessions
    // Our editor uses style.setProperty(prop, val, 'important') — check for that
    targetDoc.querySelectorAll('*').forEach(function(el) {
      if (el.style.length === 0) return;
      if (isEditorEl(el)) return;
      var toRemove = [];
      for (var i = 0; i < el.style.length; i++) {
        var prop = el.style[i];
        if (el.style.getPropertyPriority(prop) === 'important') {
          toRemove.push(prop);
        }
      }
      toRemove.forEach(function(prop) {
        el.style.removeProperty(prop);
      });
    });

    // Clear stale auto-save data
    try { localStorage.removeItem(saveKey); } catch(e) {}

    // Save every 30 seconds
    autoSaveInterval = setInterval(function() {
      saveState();
    }, 30000);
  }

  function saveState() {
    try {
      // Collect all inline style overrides and editor-injected styles
      var edStyles = hostDoc.getElementById('rb-editor-styles');
      var overrides = edStyles ? edStyles.textContent : '';
      // Collect individual inline style changes
      var inlineChanges = [];
      targetDoc.querySelectorAll('[data-rb-node]').forEach(function(el) {
        if (el.style.cssText) {
          inlineChanges.push({
            node: el.getAttribute('data-rb-node'),
            css: el.style.cssText
          });
        }
      });
      var url = '';
      try { url = targetWin.location.href; } catch (e) { try { url = hostWin.location.href; } catch (_) {} }
      var state = {
        url: url,
        timestamp: Date.now(),
        overrides: overrides,
        inlineChanges: inlineChanges
      };
      localStorage.setItem(saveKey, JSON.stringify(state));
      // Show subtle save indicator
      showSaveIndicator();

      // Additionally save a persistent snapshot if there's an active project
      // (i.e., the user came here via Mode E chunking, which creates a project).
      // Auto-snapshots are labeled so the history UI can distinguish them.
      if (window.__rbPersist && window.__rbActiveProjectId) {
        try {
          // Serialize the current edited state as the snapshot "html"
          var rebuiltEl = targetDoc.getElementById('rb-rebuilt-page');
          var snapshotHtml = rebuiltEl ? rebuiltEl.outerHTML : JSON.stringify(state);
          window.__rbPersist.saveSnapshot(
            window.__rbActiveProjectId,
            snapshotHtml,
            {auto: true, label: 'Auto-save'}
          ).then(function() {
            // Occasionally prune old auto-saves to cap storage growth
            if (Math.random() < 0.1) {
              window.__rbPersist.pruneAutoSnapshots(window.__rbActiveProjectId);
            }
          }).catch(function(e) { console.warn('[persist] snapshot failed:', e); });
        } catch(e) { console.warn('[persist] snapshot error:', e); }
      }
    } catch(e) {}
  }

  function showSaveIndicator() {
    var existing = root.querySelector('.rb-ed-save-indicator');
    if (existing) existing.remove();
    var ind = mk('div', 'rb-ed-save-indicator');
    ind.textContent = 'Saved';
    root.appendChild(ind);
    setTimeout(function() { if (ind.parentNode) ind.remove(); }, 1500);
  }

  // Persistent toast notification for long-running operations like Mode E.
  // Unlike showSaveIndicator, this stays visible until explicitly dismissed
  // so the user can walk away and still see the result when they return.
  //
  // status: 'running' | 'success' | 'error'
  // onDismiss: optional callback when user clicks X
  function showToast(message, status, onDismiss) {
    var existing = root.querySelector('.rb-ed-toast');
    if (existing) existing.remove();

    var toast = mk('div', 'rb-ed-toast rb-ed-toast-' + (status || 'running'));
    toast.style.cssText = [
      'position:fixed',
      'top:20px',
      'right:20px',
      'z-index:2147483646',
      'display:flex',
      'align-items:center',
      'gap:10px',
      'padding:12px 16px',
      'min-width:240px',
      'max-width:420px',
      'background:rgba(23,23,23,0.92)',
      'backdrop-filter:blur(20px)',
      '-webkit-backdrop-filter:blur(20px)',
      'border:1px solid rgba(255,255,255,0.12)',
      'border-radius:10px',
      'box-shadow:0 8px 32px rgba(0,0,0,0.5)',
      'font:500 12px "Instrument Sans",sans-serif',
      'color:#EFEEEB'
    ].join(';');

    // Status icon
    var icon = mk('span');
    icon.style.cssText = 'flex-shrink:0;width:16px;height:16px;display:flex;align-items:center;justify-content:center;';
    if (status === 'success') {
      icon.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>';
    } else if (status === 'error') {
      icon.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f87171" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';
    } else if (status === 'warning') {
      icon.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4"/><path d="M10.3 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.41 0z"/><path d="M12 17h.01"/></svg>';
    } else {
      // Running spinner
      icon.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#EFEEEB" stroke-width="2" stroke-linecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>';
      icon.style.animation = 'rb-ed-spin 1s linear infinite';
    }

    var text = mk('span');
    text.style.cssText = 'flex:1;line-height:1.4;word-break:break-word;';
    text.textContent = message;

    // Copy-to-clipboard button. Shown for warning/error so the user can
    // actually capture the reason before dismissing (we wasted an 80-minute
    // session once because the final toast auto-dismissed before the user
    // could read the failure text).
    var copyBtn = mk('button');
    copyBtn.className = 'rb-ed-toast-copy';
    copyBtn.title = 'Copy message';
    copyBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
    copyBtn.style.cssText = 'background:none;border:none;color:rgba(239,238,235,0.5);cursor:pointer;padding:4px;display:none;align-items:center;flex-shrink:0;';
    copyBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      var msg = text.textContent || '';
      try {
        navigator.clipboard.writeText(msg);
        var prev = copyBtn.innerHTML;
        copyBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>';
        setTimeout(function() { copyBtn.innerHTML = prev; }, 1200);
      } catch (_) {}
    });
    if (status === 'warning' || status === 'error') copyBtn.style.display = 'flex';

    var close = mk('button');
    close.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    close.style.cssText = 'background:none;border:none;color:rgba(239,238,235,0.5);cursor:pointer;padding:4px;display:flex;align-items:center;flex-shrink:0;';
    close.addEventListener('click', function() {
      toast.remove();
      if (typeof onDismiss === 'function') onDismiss();
    });

    toast.appendChild(icon);
    toast.appendChild(text);
    toast.appendChild(copyBtn);
    toast.appendChild(close);
    root.appendChild(toast);
    return toast;
  }

  function updateToast(toast, message, status) {
    if (!toast || !toast.parentNode) return;
    var text = toast.querySelector('span:nth-child(2)');
    // Defensive: only overwrite text if we actually have a message. Callers
    // passing empty/undefined used to wipe the toast to blank, leaving a
    // widget with just an icon and no context — actively worse than showing
    // stale text.
    if (text && message != null && message !== '') {
      text.textContent = message;
    }
    // If status changed, rebuild icon
    if (status) {
      toast.className = 'rb-ed-toast rb-ed-toast-' + status;
      var icon = toast.querySelector('span:first-child');
      if (icon) {
        icon.style.animation = '';
        if (status === 'success') {
          icon.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>';
        } else if (status === 'error') {
          icon.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f87171" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';
        } else if (status === 'warning') {
          icon.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4"/><path d="M10.3 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.41 0z"/><path d="M12 17h.01"/></svg>';
        } else {
          icon.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#EFEEEB" stroke-width="2" stroke-linecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>';
          icon.style.animation = 'rb-ed-spin 1s linear infinite';
        }
      }
      // Show/hide copy button when status transitions into a final state.
      var copyBtn = toast.querySelector('.rb-ed-toast-copy');
      if (copyBtn) copyBtn.style.display = (status === 'warning' || status === 'error') ? 'flex' : 'none';
      // Auto-dismiss ONLY success. Warning/error persist so the user can read
      // (and copy) the failure reason — auto-dismissing a fatal message before
      // the user can see it wastes real time and trust.
      if (status === 'success') {
        setTimeout(function() {
          if (toast && toast.parentNode) toast.remove();
        }, 5000);
      }
    }
  }

  // Loader timer — attaches a live elapsed counter ("12s", then "1:24")
  // next to one or more loader targets (inspector progress el, toast, etc.).
  // Updates are written to a dedicated `<span class="rb-loader-timer">` sibling
  // so the caller can keep rewriting the main message text without stomping
  // the timer. Returns a stop() handle to call on success/error.
  function fmtElapsed(ms) {
    var s = Math.floor(ms / 1000);
    if (s < 60) return s + 's';
    var m = Math.floor(s / 60), r = s % 60;
    return m + ':' + (r < 10 ? '0' : '') + r;
  }
  // Wraps each target's content into [msg-span][timer-span] so callers update
  // messages via setMessage() without stomping the live timer. Returns also
  // stop()/remove() for lifecycle control.
  function startLoaderTimer(targets, opts) {
    opts = opts || {};
    var t0 = Date.now();
    var lastUpdateAt = t0;
    var entries = [];
    (targets || []).forEach(function(el) {
      if (!el) return;
      var msgSpan = el.querySelector && el.querySelector('.rb-loader-msg');
      var timerSpan = el.querySelector && el.querySelector('.rb-loader-timer');
      if (!msgSpan) {
        // Migrate the current textContent into an msg span.
        var existing = el.textContent || '';
        el.textContent = '';
        msgSpan = hostDoc.createElement('span');
        msgSpan.className = 'rb-loader-msg';
        msgSpan.textContent = existing;
        el.appendChild(msgSpan);
      }
      if (!timerSpan) {
        timerSpan = hostDoc.createElement('span');
        timerSpan.className = 'rb-loader-timer';
        timerSpan.style.cssText = 'margin-left:6px;opacity:0.6;font-variant-numeric:tabular-nums;';
        timerSpan.textContent = '0s';
        el.appendChild(timerSpan);
      }
      entries.push({ el: el, msg: msgSpan, timer: timerSpan });
    });
    var stuckCb = opts.onStuck || null;
    // Watchdog: if no setMessage within STUCK_TIMEOUT_MS, fire onStuck and
    // mark the message visually so the widget never pretends to be making
    // progress when it isn't. Saves the user from waiting 5 minutes thinking
    // something is happening when the pipeline silently died.
    var STUCK_TIMEOUT_MS = 45000;
    var stuckFired = false;
    function tick() {
      var now = Date.now();
      var t = fmtElapsed(now - t0);
      entries.forEach(function(e) { if (e.timer && e.timer.isConnected) e.timer.textContent = t; });
      if (!stuckFired && (now - lastUpdateAt) > STUCK_TIMEOUT_MS) {
        stuckFired = true;
        entries.forEach(function(e) {
          if (e.msg && e.msg.isConnected && !e.msg.textContent) {
            e.msg.textContent = 'No progress — pipeline may have stalled';
          }
        });
        if (typeof stuckCb === 'function') {
          try { stuckCb(); } catch (_) {}
        }
      }
    }
    tick();
    var iv = setInterval(tick, 1000);
    return {
      setMessage: function(msg) {
        lastUpdateAt = Date.now();
        stuckFired = false;
        // Defensive: never wipe the message with empty/undefined — keeps
        // whatever the last real status was visible instead of going blank.
        if (msg == null || msg === '') return;
        entries.forEach(function(e) { if (e.msg && e.msg.isConnected) e.msg.textContent = msg; });
      },
      stop: function() {
        clearInterval(iv);
        tick();
      },
      remove: function() {
        clearInterval(iv);
        entries.forEach(function(e) {
          if (e.timer && e.timer.parentNode) e.timer.remove();
        });
      }
    };
  }

  function dismissAllToasts() {
    root.querySelectorAll('.rb-ed-toast').forEach(function(t) { t.remove(); });
  }

  function showRestorePrompt(data) {
    var ago = Math.round((Date.now() - data.timestamp) / 60000);
    var label = ago < 60 ? ago + ' min ago' : Math.round(ago/60) + 'h ago';
    var prompt = mk('div', 'rb-ed-restore-prompt');
    prompt.innerHTML = '<span>Previous edits found (' + label + ')</span>' +
      '<button class="rb-ed-restore-yes">Restore</button>' +
      '<button class="rb-ed-restore-no">Dismiss</button>';
    root.appendChild(prompt);

    prompt.querySelector('.rb-ed-restore-yes').addEventListener('click', function() {
      // Apply saved overrides
      if (data.overrides) {
        var s = hostDoc.getElementById('rb-editor-styles') || (function() {
          var s = mk('style'); s.id = 'rb-editor-styles';
          hostDoc.head.appendChild(s); return s;
        })();
        s.textContent = data.overrides;
      }
      // Apply inline changes
      if (data.inlineChanges) {
        data.inlineChanges.forEach(function(change) {
          var el = targetDoc.querySelector('[data-rb-node="' + change.node + '"]');
          if (el) el.style.cssText = change.css;
        });
      }
      prompt.remove();
    });
    prompt.querySelector('.rb-ed-restore-no').addEventListener('click', function() {
      localStorage.removeItem(saveKey);
      prompt.remove();
    });
  }

  // ============ BANNER ============

  function buildBanner() {
    // Mode catalog — central list so adding a new mode requires touching one place.
    // label = what shows in the dropdown, short = compact chip shown on the trigger.
    // Defined INSIDE the function because buildBanner() is called early (line 183)
    // before any top-level `var` initializations below would have executed yet
    // (function hoisting vs var hoisting asymmetry).
    var MODE_LIST = [
      { id: 'A',  label: 'CSS Live',  short: 'A'  },
      { id: 'B',  label: 'Mirror',    short: 'B'  },
      { id: 'C',  label: 'Hybrid',    short: 'C'  },
      { id: 'D',  label: 'Canvas',    short: 'D'  },
      { id: 'E',  label: 'AI Vision', short: 'E'  },
      { id: 'E0', label: 'Vision (033 baseline)', short: 'E0' },
      { id: 'ER', label: 'AI Refined',short: 'E+' },
      { id: 'EL', label: 'AI Lean',   short: 'EL' },
      { id: 'E2', label: 'AI Fast',   short: 'E2' },
      { id: 'S',  label: 'S2H',       short: 'S'  },
      { id: 'F',  label: 'Curated',   short: 'F'  }
    ];

    var b = mk('div');
    b.id = 'rb-ed-banner';

    // Trigger button shows the active mode; clicking toggles the dropdown.
    var trigger = mk('button', 'rb-ed-mode-trigger');
    trigger.id = 'rb-ed-mode-trigger';
    trigger.innerHTML = '<span class="rb-ed-mode-chip">A</span>' +
      '<span class="rb-ed-mode-label">CSS Live</span>' +
      '<svg class="rb-ed-mode-chev" width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M6 9l6 6 6-6"/></svg>';
    b.appendChild(trigger);

    // Dropdown list — hidden by default, appears above the trigger when open.
    var drop = mk('div', 'rb-ed-mode-drop');
    drop.id = 'rb-ed-mode-drop';
    MODE_LIST.forEach(function(m) {
      var item = mk('button', 'rb-ed-mode-item');
      item.dataset.mode = m.id;
      item.innerHTML = '<span class="rb-ed-mode-chip">' + m.short + '</span>' +
        '<span class="rb-ed-mode-label">' + m.label + '</span>';
      if (m.id === 'A') item.classList.add('active');
      drop.appendChild(item);
    });
    b.appendChild(drop);

    var x = mk('button');
    x.id = 'rb-ed-banner-close';
    x.innerHTML = CLOSE;
    x.addEventListener('mousedown', function(e) { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); deactivate(); }, {signal: sig, capture: true});
    b.appendChild(x);
    root.appendChild(b);

    function openDrop() { drop.classList.add('open'); trigger.classList.add('open'); }
    function closeDrop() { drop.classList.remove('open'); trigger.classList.remove('open'); }

    trigger.addEventListener('mousedown', function(e) {
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      if (drop.classList.contains('open')) closeDrop(); else openDrop();
    }, {signal: sig, capture: true});

    drop.querySelectorAll('.rb-ed-mode-item').forEach(function(item) {
      item.addEventListener('mousedown', function(e) {
        e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
        var mode = item.dataset.mode;
        var entry = MODE_LIST.find(function(m) { return m.id === mode; });
        switchMode(mode);
        drop.querySelectorAll('.rb-ed-mode-item').forEach(function(el) { el.classList.remove('active'); });
        item.classList.add('active');
        if (entry) {
          trigger.querySelector('.rb-ed-mode-chip').textContent = entry.short;
          trigger.querySelector('.rb-ed-mode-label').textContent = entry.label;
        }
        closeDrop();
      }, {signal: sig, capture: true});
    });

    // Click-outside closes the dropdown. Uses document capture so we catch
    // the click before any site-level handler stops propagation.
    hostDoc.addEventListener('mousedown', function(e) {
      if (!drop.classList.contains('open')) return;
      if (b.contains(e.target)) return;
      closeDrop();
    }, {signal: sig, capture: true});
  }

  // ============ MODE SWITCHING ============

  function switchMode(mode) {
    deselectEl();
    cleanupMode();
    currentMode = mode;
    if (mode === 'B') activateModeB();
    else if (mode === 'C') activateModeC();
    else if (mode === 'D') activateModeD();
    else if (mode === 'E') activateModeE();
    else if (mode === 'E0') activateModeEClassic();
    else if (mode === 'ER') activateModeERefined();
    else if (mode === 'EL') activateModeELean();
    else if (mode === 'E2') activateModeE2();
    else if (mode === 'S') activateModeS();
    else if (mode === 'F') activateModeF();
  }

  // ============ MODE F: CURATED / NORMALIZED ============

  function activateModeF() {
    inspBody.innerHTML = '';
    var loading = mk('div', 'rb-insp-empty');
    loading.textContent = 'Analyzing site...';
    inspBody.appendChild(loading);

    function doActivate() {
      var result = window.__rbNormalize.normalize();
      if (!result || result.sectionCount === 0) {
        loading.textContent = 'Could not curate this site (0 sections).';
        loading.style.color = '#f87171';
        return;
      }

      loading.textContent = result.sectionCount + ' sections, ' + result.elementCount + ' editable elements';
      loading.style.color = '#22c55e';

      // Flash sections briefly
      result.sections.forEach(function(sec, i) {
        var overlay = mk('div', 'rb-ed-semantic-block');
        overlay.style.cssText = 'position:fixed;pointer-events:none;top:'+sec.bounds.y+'px;left:'+sec.bounds.x+'px;width:'+sec.bounds.width+'px;height:'+sec.bounds.height+'px;';
        var label = mk('span', 'rb-ed-semantic-label');
        label.textContent = sec.type;
        overlay.appendChild(label);
        overlay.style.animationDelay = (i * 60) + 'ms';
        root.appendChild(overlay);
        semanticGroups.push(overlay);
      });
      setTimeout(function() {
        semanticGroups.forEach(function(g) {
          g.style.opacity = '0';
          g.style.transition = 'opacity 600ms';
        });
        setTimeout(function() {
          semanticGroups.forEach(function(g) { g.remove(); });
          semanticGroups = [];
        }, 600);
      }, 2500);
    }

    if (!window.__rbNormalize) {
      chrome.runtime.sendMessage({ action: 'injectNormalize' });
      var waitCount = 0;
      var waitInterval = setInterval(function() {
        waitCount++;
        if (window.__rbNormalize || waitCount > 20) {
          clearInterval(waitInterval);
          if (window.__rbNormalize) doActivate();
          else { loading.textContent = 'Failed to load.'; loading.style.color = '#f87171'; }
        }
      }, 100);
    } else {
      doActivate();
    }
  }

  // ============ MODE E: AI REBUILD (Papel Vegetal) ============

  var semanticGroups = [];

  function activateModeE() {
    if (!window.__rbModeE) {
      inspBody.innerHTML = '';
      var err = mk('div', 'rb-insp-empty');
      err.textContent = 'Mode E not loaded. Reload the page and try again.';
      err.style.color = '#f87171';
      inspBody.appendChild(err);
      return;
    }

    // Show progress in inspector
    inspBody.innerHTML = '';
    var progressEl = mk('div', 'rb-insp-empty');
    progressEl.textContent = 'Starting AI rebuild...';
    inspBody.appendChild(progressEl);

    // Cancel button (shown during rebuild, hidden when done)
    var cancelBtn = mk('button', 'rb-insp-inp');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.cssText = 'cursor:pointer;text-align:center;margin-top:8px;width:100%;color:#f87171;border-color:rgba(248,113,113,0.3);';
    cancelBtn.addEventListener('mousedown', function(e) {
      e.stopImmediatePropagation();
      if (window.__rbModeE && window.__rbModeE.cancel) window.__rbModeE.cancel();
    }, {capture: true, signal: sig});
    inspBody.appendChild(cancelBtn);

    // Restore button (shown after rebuild completes)
    var restoreBtn = mk('button', 'rb-insp-inp');
    restoreBtn.textContent = 'Restore original page';
    restoreBtn.style.cssText = 'cursor:pointer;text-align:center;margin-top:8px;width:100%;display:none;';
    restoreBtn.addEventListener('mousedown', function(e) {
      e.stopImmediatePropagation();
      window.__rbModeE.restore();
      switchMode('A');
    }, {capture: true, signal: sig});
    inspBody.appendChild(restoreBtn);

    // Dev hook: `window.__rbRunModeERefined()` triggers the generation +
    // one refinement pass. Surfaced on window so it's callable from DevTools
    // without shipping UI in M1.
    window.__rbRunModeERefined = function() {
      if (!window.__rbModeE || !window.__rbModeE.runWithRefine) {
        console.error('[Repix] __rbModeE.runWithRefine unavailable');
        return;
      }
      return window.__rbModeE.runWithRefine(function(p) {
        console.log('[Repix refine]', p.step, p.message, p.current + '/' + p.total);
      });
    };

    rebuildInProgress = true;
    // Persistent toast that stays visible even if the user walks away
    // from the inspector panel. Stays until dismissed or updated to
    // success/error.
    var modeEToast = showToast('Mode E: starting…', 'running');
    var modeEToastMsg = modeEToast.querySelector('span:nth-child(2)');
    var loader = startLoaderTimer([progressEl, modeEToastMsg]);

    window.__rbModeE.run(function(progress) {
      if (progress.step === 'error') {
        rebuildInProgress = false;
        loader.stop();
        cancelBtn.style.display = 'none';
        progressEl.style.color = '#f87171';
        loader.setMessage(progress.message);
        updateToast(modeEToast, 'Mode E failed — ' + progress.message, 'error');
      } else if (progress.step === 'done') {
        rebuildInProgress = false;
        loader.stop();
        cancelBtn.style.display = 'none';
        // Honest signaling: pipeline emits "Rebuild PARTIAL — X/Y sections
        // (N failed)" when any viewport bailed (rate limit, timeout, etc).
        // Color amber + flag the toast so the user can't mistake an
        // incomplete rebuild for a clean success.
        var partial = /\bPARTIAL\b|\bfailed\b/i.test(progress.message);
        progressEl.style.color = partial ? '#f59e0b' : '#22c55e';
        loader.setMessage(progress.message);
        restoreBtn.style.display = '';
        updateToast(modeEToast, (partial ? 'Mode E PARTIAL — ' : 'Mode E complete — ') + progress.message, partial ? 'warning' : 'success');
      } else {
        loader.setMessage(progress.message);
      }
    });
  }

  // Mode E+: same generation flow as Mode E, then an extra refinement pass
  // (diff output vs original → regen divergent parts). Uses
  // window.__rbModeE.runWithRefine from editor/mode-e-refine.js.
  function activateModeERefined() {
    if (!window.__rbModeE || !window.__rbModeE.runWithRefine) {
      inspBody.innerHTML = '';
      var err = mk('div', 'rb-insp-empty');
      err.textContent = 'Mode E+ (Refined) not loaded. Reload the page and try again.';
      err.style.color = '#f87171';
      inspBody.appendChild(err);
      return;
    }

    inspBody.innerHTML = '';
    var progressEl = mk('div', 'rb-insp-empty');
    progressEl.textContent = 'Starting AI rebuild + refinement...';
    inspBody.appendChild(progressEl);

    var cancelBtn = mk('button', 'rb-insp-inp');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.cssText = 'cursor:pointer;text-align:center;margin-top:8px;width:100%;color:#f87171;border-color:rgba(248,113,113,0.3);';
    cancelBtn.addEventListener('mousedown', function(e) {
      e.stopImmediatePropagation();
      if (window.__rbModeE && window.__rbModeE.cancel) window.__rbModeE.cancel();
    }, {capture: true, signal: sig});
    inspBody.appendChild(cancelBtn);

    var restoreBtn = mk('button', 'rb-insp-inp');
    restoreBtn.textContent = 'Restore original page';
    restoreBtn.style.cssText = 'cursor:pointer;text-align:center;margin-top:8px;width:100%;display:none;';
    restoreBtn.addEventListener('mousedown', function(e) {
      e.stopImmediatePropagation();
      window.__rbModeE.restore();
      switchMode('A');
    }, {capture: true, signal: sig});
    inspBody.appendChild(restoreBtn);

    rebuildInProgress = true;
    var modeEToast = showToast('Mode E+: starting…', 'running');
    var modeEToastMsg = modeEToast.querySelector('span:nth-child(2)');
    var loader = startLoaderTimer([progressEl, modeEToastMsg]);

    // Track whether the orchestrator has bailed to plain Mode E (no refinement).
    // In fallback mode, the inner runModeE's `done` step is the terminal signal.
    // In normal mode, the terminal signal is one of refine-clean / refine-done /
    // refine-inject / refine-skip (after the rebuild has already swapped the DOM).
    var inFallback = false;
    var finalized = false;
    function finalize(progress) {
      if (finalized) return;
      finalized = true;
      rebuildInProgress = false;
      loader.stop();
      cancelBtn.style.display = 'none';
      // refine-skip = base rebuild OK but refinement didn't land (regen failed,
      // diff failed, empty/identical output). Mark amber so the user sees this
      // wasn't a clean success without conflating it with the Mode E error state.
      var isPartial = progress.step === 'refine-skip';
      progressEl.style.color = isPartial ? '#f59e0b' : '#22c55e';
      loader.setMessage(progress.message);
      restoreBtn.style.display = '';
      var prefix = isPartial ? 'Mode E+ partial — ' : 'Mode E+ complete — ';
      var toastStatus = isPartial ? 'warning' : 'success';
      updateToast(modeEToast, prefix + progress.message, toastStatus);
    }

    window.__rbModeE.runWithRefine(function(progress) {
      if (progress.step === 'error') {
        if (finalized) return;
        finalized = true;
        rebuildInProgress = false;
        loader.stop();
        cancelBtn.style.display = 'none';
        progressEl.style.color = '#f87171';
        loader.setMessage(progress.message);
        updateToast(modeEToast, 'Mode E+ failed — ' + progress.message, 'error');
        return;
      }

      if (progress.step === 'refine-fallback') {
        inFallback = true;
        loader.setMessage(progress.message);
        return;
      }

      // Terminal: any post-rebuild refine step (clean/done/inject/skip), OR
      // the inner runModeE's `done` when we already bailed to fallback.
      var isTerminalRefine = (
        progress.step === 'refine-clean' ||
        progress.step === 'refine-done'  ||
        progress.step === 'refine-inject' ||
        progress.step === 'refine-skip'
      );
      if (isTerminalRefine || (progress.step === 'done' && inFallback)) {
        finalize(progress);
        return;
      }

      // Intermediate (including the non-fallback `done` that precedes refinement).
      loader.setMessage(progress.message);
    });
  }

  // ============ MODE E0: Vision (033 baseline) ============
  // A/B reference. Mirror of the runModeE pipeline as it shipped at
  // checkpoint 033 (commit 2d23d3d). No abort/watchdog/manifest/floater —
  // pure 033 logic. Lets the user compare today's Mode E head-to-head with
  // what was the "best stable version" before the refine loop and the
  // 2026-04-24 additions.
  function activateModeEClassic() {
    if (!window.__rbModeEClassic || !window.__rbModeEClassic.run) {
      inspBody.innerHTML = '';
      var err = mk('div', 'rb-insp-empty');
      err.textContent = 'Mode E Classic (033) not loaded. Reload the page and try again.';
      err.style.color = '#f87171';
      inspBody.appendChild(err);
      return;
    }
    window.__rbPushUndo = pushUndo;

    inspBody.innerHTML = '';
    var progressEl = mk('div', 'rb-insp-empty');
    progressEl.textContent = 'Starting Vision (033 baseline)...';
    inspBody.appendChild(progressEl);

    var restoreBtn = mk('button', 'rb-insp-inp');
    restoreBtn.textContent = 'Restore original page';
    restoreBtn.style.cssText = 'cursor:pointer;text-align:center;margin-top:8px;width:100%;display:none;';
    restoreBtn.addEventListener('mousedown', function(e) {
      e.stopImmediatePropagation();
      window.__rbModeEClassic.restore();
      switchMode('A');
    }, {capture: true, signal: sig});
    inspBody.appendChild(restoreBtn);

    rebuildInProgress = true;
    var modeEToast = showToast('Mode E0 (033): starting…', 'running');
    var modeEToastMsg = modeEToast.querySelector('span:nth-child(2)');
    var loader = startLoaderTimer([progressEl, modeEToastMsg]);

    window.__rbModeEClassic.run(function(progress) {
      if (progress.step === 'error') {
        rebuildInProgress = false;
        loader.stop();
        progressEl.style.color = '#f87171';
        loader.setMessage(progress.message);
        updateToast(modeEToast, 'Mode E0 failed — ' + progress.message, 'error');
      } else if (progress.step === 'done') {
        rebuildInProgress = false;
        loader.stop();
        progressEl.style.color = '#22c55e';
        loader.setMessage(progress.message);
        restoreBtn.style.display = '';
        updateToast(modeEToast, 'Mode E0 (033) complete — ' + progress.message, 'success');
      } else {
        loader.setMessage(progress.message);
      }
    });
  }

  // ============ MODE E LEAN: Flash + floater-as-static-clone + no DESIGN.MD ============
  // Aggressive speed variant of Mode E. Target ~20-40s on a 5-viewport site.
  function activateModeELean() {
    if (!window.__rbModeE || !window.__rbModeE.runLean) {
      inspBody.innerHTML = '';
      var err = mk('div', 'rb-insp-empty');
      err.textContent = 'Mode E Lean not loaded. Reload the page and try again.';
      err.style.color = '#f87171';
      inspBody.appendChild(err);
      return;
    }

    inspBody.innerHTML = '';
    var progressEl = mk('div', 'rb-insp-empty');
    progressEl.textContent = 'Starting Lean AI rebuild (Flash)...';
    inspBody.appendChild(progressEl);

    var cancelBtn = mk('button', 'rb-insp-inp');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.cssText = 'cursor:pointer;text-align:center;margin-top:8px;width:100%;color:#f87171;border-color:rgba(248,113,113,0.3);';
    cancelBtn.addEventListener('mousedown', function(e) {
      e.stopImmediatePropagation();
      if (window.__rbModeE && window.__rbModeE.cancel) window.__rbModeE.cancel();
    }, {capture: true, signal: sig});
    inspBody.appendChild(cancelBtn);

    var restoreBtn = mk('button', 'rb-insp-inp');
    restoreBtn.textContent = 'Restore original page';
    restoreBtn.style.cssText = 'cursor:pointer;text-align:center;margin-top:8px;width:100%;display:none;';
    restoreBtn.addEventListener('mousedown', function(e) {
      e.stopImmediatePropagation();
      window.__rbModeE.restore();
      switchMode('A');
    }, {capture: true, signal: sig});
    inspBody.appendChild(restoreBtn);

    rebuildInProgress = true;
    var modeEToast = showToast('Mode E Lean: starting…', 'running');
    var modeEToastMsg = modeEToast.querySelector('span:nth-child(2)');
    // Diagnostic — tells us if the toast text span was actually found.
    // Without this, a silent querySelector miss would leave the loader
    // writing into nothing, explaining the "spinner + no text" symptom.
    console.log('[Mode EL activator] toast:', !!modeEToast, 'toastMsgSpan:', !!modeEToastMsg, 'progressEl:', !!progressEl);
    if (!modeEToastMsg) {
      console.warn('[Mode EL activator] WARNING: querySelector("span:nth-child(2)") missed the toast text span — loader will have no target to update');
    }
    var loader = startLoaderTimer([progressEl, modeEToastMsg]);

    window.__rbModeE.runLean(function(progress) {
      console.log('[Mode EL activator] received:', progress.step, '-', progress.message);
      if (progress.step === 'error') {
        rebuildInProgress = false;
        loader.stop();
        cancelBtn.style.display = 'none';
        progressEl.style.color = '#f87171';
        loader.setMessage(progress.message);
        updateToast(modeEToast, 'Mode E Lean failed — ' + progress.message, 'error');
      } else if (progress.step === 'done') {
        rebuildInProgress = false;
        loader.stop();
        cancelBtn.style.display = 'none';
        var partial = /\bPARTIAL\b|\bfailed\b/i.test(progress.message);
        progressEl.style.color = partial ? '#f59e0b' : '#22c55e';
        loader.setMessage(progress.message);
        restoreBtn.style.display = '';
        updateToast(modeEToast, (partial ? 'Mode E Lean PARTIAL — ' : 'Mode E Lean complete — ') + progress.message, partial ? 'warning' : 'success');
      } else {
        loader.setMessage(progress.message);
      }
    });
  }

  // ============ MODE E2: Fast HTML-to-Code (same.new-style multi-call) ============

  function activateModeE2() {
    if (!window.__rbModeE2) {
      inspBody.innerHTML = '';
      var err = mk('div', 'rb-insp-empty');
      err.textContent = 'Mode E2 not loaded. Reload the page and try again.';
      err.style.color = '#f87171';
      inspBody.appendChild(err);
      return;
    }
    window.__rbPushUndo = pushUndo;
    inspBody.innerHTML = '';
    var progressEl = mk('div', 'rb-insp-empty');
    progressEl.textContent = 'Starting fast rebuild…';
    inspBody.appendChild(progressEl);

    var toast = showToast('Mode E2: starting…', 'running');
    var toastMsg = toast.querySelector('span:nth-child(2)');
    var loader = startLoaderTimer([progressEl, toastMsg]);

    var t0 = Date.now();
    window.__rbModeE2.run(function(p) {
      var msg = p.message + (p.total ? ' (' + p.current + '/' + p.total + ')' : '');
      loader.setMessage(msg);
    }).then(function(stats) {
      loader.stop();
      var secs = ((Date.now() - t0) / 1000).toFixed(1);
      loader.setMessage('Done: ' + stats.sectionCount + ' sections, ' + stats.sizeKB + 'KB');
      progressEl.style.color = '#22c55e';
      updateToast(toast, 'Mode E2 complete — ' + secs + 's, ' + stats.sectionCount + ' sections', 'success');
    }).catch(function(e) {
      loader.stop();
      loader.setMessage('Failed: ' + (e.message || e));
      progressEl.style.color = '#f87171';
      updateToast(toast, 'Mode E2 failed — ' + (e.message || e), 'error');
    });
  }

  // ============ MODE S: S2H (Screenshot-to-HTML, 2-pass) ============

  function activateModeS() {
    if (!window.__rbS2H) {
      inspBody.innerHTML = '';
      var err = mk('div', 'rb-insp-empty');
      err.textContent = 'S2H not loaded. Reload the page and try again.';
      err.style.color = '#f87171';
      inspBody.appendChild(err);
      return;
    }

    inspBody.innerHTML = '';
    var progressEl = mk('div', 'rb-insp-empty');
    progressEl.textContent = 'Capturing screenshot...';
    inspBody.appendChild(progressEl);

    // Restore button
    var restoreBtn = mk('button', 'rb-insp-inp');
    restoreBtn.textContent = 'Restore original page';
    restoreBtn.style.cssText = 'cursor:pointer;text-align:center;margin-top:8px;width:100%;display:none;';
    restoreBtn.addEventListener('mousedown', function(e) {
      e.stopImmediatePropagation();
      // S2H stores originals in replacePage — reload to restore
      location.reload();
    }, {capture: true, signal: sig});
    inspBody.appendChild(restoreBtn);

    var s2hToast = showToast('S2H: starting full page capture…', 'running');

    rebuildInProgress = true;
    window.__rbS2H.runFullPage(function(progress) {
      if (progress.step === 'error') {
        progressEl.style.color = '#f87171';
        progressEl.textContent = progress.message;
        updateToast(s2hToast, 'S2H failed — ' + progress.message, 'error');
      } else {
        progressEl.textContent = progress.message;
        updateToast(s2hToast, 'S2H: ' + progress.message, 'running');
      }
    }).then(function(result) {
      rebuildInProgress = false;
      if (result && result.html) {
        progressEl.style.color = '#22c55e';
        progressEl.textContent = 'Complete — ' + result.successCount + '/' + result.viewportCount + ' viewports (' + result.html.length + ' chars)';
        restoreBtn.style.display = '';
        updateToast(s2hToast, 'S2H complete — ' + result.successCount + ' viewports', 'success');
        window.__rbS2H.replacePage(result.html);
      }
    }).catch(function(err) {
      rebuildInProgress = false;
      progressEl.style.color = '#f87171';
      progressEl.textContent = 'S2H error: ' + (err.message || err);
      updateToast(s2hToast, 'S2H failed', 'error');
    });
  }

  function cleanupMode() {
    // Dismiss any lingering toasts (e.g. Mode E progress) when switching modes
    dismissAllToasts();
    rebuildInProgress = false;
    // Clean Mode E rebuild
    if (window.__rbModeE) window.__rbModeE.restore();
    // Clean Mode B mirror
    if (window.__rbModeB) { try { window.__rbModeB.restore(); } catch (e) {} }
    semanticGroups.forEach(function(g) { g.remove(); });
    semanticGroups = [];
    // Clean Mode F normalized DOM
    if (window.__rbNormalize) window.__rbNormalize.deactivate();
    // Clean Mode D canvas
    var canvas = hostDoc.getElementById('rb-ed-canvas');
    if (canvas) canvas.remove();
    var wrapper = hostDoc.getElementById('rb-ed-canvas-wrapper');
    if (wrapper) wrapper.remove();
    targetDoc.querySelectorAll('[data-rb-hidden]').forEach(function(el) {
      el.style.display = '';
      el.removeAttribute('data-rb-hidden');
    });
    hostDoc.body.classList.remove('rb-ed-canvas-mode');
    var layoutBtn = hostDoc.querySelector('.rb-ed-layout-btn');
    if (layoutBtn) layoutBtn.remove();
  }

  function activateModeB() {
    inspBody.innerHTML = '';
    var status = mk('div', 'rb-insp-empty');
    status.textContent = 'Mirroring page…';
    inspBody.appendChild(status);

    if (!window.__rbModeB) {
      status.textContent = 'Mode B not loaded. Reload and try again.';
      status.style.color = '#f87171';
      return;
    }

    window.__rbPushUndo = pushUndo;
    deselectEl();

    var loader = startLoaderTimer([status]);

    // Defer to next frame so the inspector status paints before the (brief but
    // blocking) clone + stylesheet extraction runs.
    requestAnimationFrame(function() {
      var result;
      try { result = window.__rbModeB.run(); } catch (e) {
        loader.stop();
        loader.setMessage('Mirror failed: ' + (e && e.message || e));
        status.style.color = '#f87171';
        return;
      }
      loader.stop();
      if (!result) {
        loader.setMessage('Mirror returned no output.');
        status.style.color = '#f87171';
        return;
      }
      loader.setMessage('Mirror ready: ' + result.mirrorNodes + ' nodes, ' +
        result.sheetsCount + ' stylesheets, ' + Math.round(result.cssSize / 1024) + 'KB CSS.');
      status.style.color = '#22c55e';
    });
  }

  function activateModeC() {
    var layoutBtn = mk('button', 'rb-ed-layout-btn');
    layoutBtn.textContent = 'Layout Mode';
    layoutBtn.addEventListener('click', function() {
      if (hostDoc.getElementById('rb-ed-canvas')) {
        cleanupMode();
        layoutBtn.textContent = 'Layout Mode';
        layoutBtn.classList.remove('active');
      } else {
        activateModeD();
        layoutBtn.textContent = 'Exit Layout';
        layoutBtn.classList.add('active');
      }
    }, {signal: sig});
    var header = hostDoc.getElementById('rb-ed-insp-header');
    if (header) header.appendChild(layoutBtn);
  }

  function activateModeD() {
    hostDoc.body.classList.add('rb-ed-canvas-mode');
    // Mode D bakes the SITE into a canvas, so dimensions come from target.
    var vw = targetWin.innerWidth;
    var vh = Math.max(targetDoc.documentElement.scrollHeight, targetWin.innerHeight);

    var wrapper = mk('div');
    wrapper.id = 'rb-ed-canvas-wrapper';
    wrapper.style.cssText = 'position:fixed;top:32px;left:0;right:280px;bottom:0;overflow:auto;background:#2a2a2a;z-index:2147483639;';

    var canvas = mk('div');
    canvas.id = 'rb-ed-canvas';
    canvas.style.cssText = 'position:relative;width:'+vw+'px;min-height:'+vh+'px;background:#fff;transform-origin:0 0;margin:40px auto;box-shadow:0 4px 40px rgba(0,0,0,0.3);';

    Array.from(targetDoc.body.children).forEach(function(child) {
      if (child.id === 'rb-editor-root' || child.id === 'rb-ed-canvas-wrapper') return;
      if (child.tagName === 'SCRIPT' || child.tagName === 'STYLE' || child.tagName === 'LINK') return;
      var clone = child.cloneNode(true);
      bakeStyles(child, clone);
      canvas.appendChild(clone);
      child.style.display = 'none';
      child.setAttribute('data-rb-hidden', '');
    });

    flattenToAbsolute(canvas);
    wrapper.appendChild(canvas);
    // Append to host body, NOT root — so canvas elements pass isEditorEl check.
    hostDoc.body.appendChild(wrapper);

    // Zoom
    var zoomLevel = 1;
    wrapper.addEventListener('wheel', function(e) {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        zoomLevel = Math.max(0.25, Math.min(3, zoomLevel + (e.deltaY > 0 ? -0.1 : 0.1)));
        canvas.style.transform = 'scale(' + zoomLevel + ')';
      }
    }, {signal: sig, passive: false});

    // Pan
    var isPanning = false, panStart = null;
    hostDoc.addEventListener('keydown', function(e) {
      if (e.code === 'Space' && !isPanning && currentMode === 'D') {
        isPanning = true; wrapper.style.cursor = 'grab'; e.preventDefault();
      }
    }, {signal: sig});
    hostDoc.addEventListener('keyup', function(e) {
      if (e.code === 'Space') { isPanning = false; wrapper.style.cursor = ''; }
    }, {signal: sig});
    wrapper.addEventListener('mousedown', function(e) {
      if (isPanning) { panStart = {x:e.clientX, y:e.clientY, sl:wrapper.scrollLeft, st:wrapper.scrollTop}; wrapper.style.cursor = 'grabbing'; }
    }, {signal: sig});
    wrapper.addEventListener('mousemove', function(e) {
      if (isPanning && panStart) { wrapper.scrollLeft = panStart.sl-(e.clientX-panStart.x); wrapper.scrollTop = panStart.st-(e.clientY-panStart.y); }
    }, {signal: sig});
    wrapper.addEventListener('mouseup', function() { panStart = null; if(isPanning) wrapper.style.cursor='grab'; }, {signal: sig});
  }

  function bakeStyles(orig, clone) {
    if (orig.nodeType !== 1 || clone.nodeType !== 1) return;
    var cs = getCS(orig);
    var props = ['display','position','top','right','bottom','left','width','height',
      'margin','padding','border','borderRadius','backgroundColor','color','opacity',
      'fontSize','fontFamily','fontWeight','fontStyle','lineHeight','letterSpacing',
      'textAlign','textDecoration','textTransform','overflow','boxShadow','backgroundImage',
      'backgroundSize','backgroundPosition','backgroundRepeat','flexDirection','flexWrap',
      'justifyContent','alignItems','gap','gridTemplateColumns','gridTemplateRows',
      'objectFit','zIndex','float','clear','whiteSpace','wordBreak'];
    props.forEach(function(p) { try { clone.style[p] = cs[p]; } catch(e) {} });
    for (var i = 0; i < orig.children.length && i < clone.children.length; i++) {
      bakeStyles(orig.children[i], clone.children[i]);
    }
  }

  function flattenToAbsolute(canvas) {
    // Collect ALL visible elements with their positions BEFORE modifying anything
    var elements = [];
    function collect(el) {
      if (el.nodeType !== 1) return;
      if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE' || el.tagName === 'LINK') return;
      var r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return;
      elements.push({ el: el, top: r.top, left: r.left, width: r.width, height: r.height });
      // Don't recurse into children — we'll flatten them all to the canvas level
    }
    // Collect only leaf-ish elements (elements with no block children, or all elements)
    function collectAll(parent) {
      Array.from(parent.children).forEach(function(child) {
        if (child.nodeType !== 1) return;
        if (child.tagName === 'SCRIPT' || child.tagName === 'STYLE' || child.tagName === 'LINK') return;
        var r = child.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) return;
        // Check if this is a "leaf" (has text/img but no major block children)
        var hasBlockChildren = false;
        Array.from(child.children).forEach(function(gc) {
          if (gc.nodeType === 1) {
            var gcR = gc.getBoundingClientRect();
            if (gcR.width > 20 && gcR.height > 20) hasBlockChildren = true;
          }
        });
        if (!hasBlockChildren) {
          // Leaf element — flatten this one
          elements.push({ el: child, top: r.top, left: r.left, width: r.width, height: r.height });
        } else {
          // Container — recurse into children
          collectAll(child);
        }
      });
    }

    var cr = canvas.getBoundingClientRect();
    collectAll(canvas);

    // Now move all collected elements to be direct children of canvas with absolute position
    elements.forEach(function(item) {
      item.el.style.position = 'absolute';
      item.el.style.top = (item.top - cr.top) + 'px';
      item.el.style.left = (item.left - cr.left) + 'px';
      item.el.style.width = item.width + 'px';
      item.el.style.height = item.height + 'px';
      item.el.style.margin = '0';
      item.el.style.padding = getCS(item.el).padding; // preserve padding
      // Move to canvas root
      canvas.appendChild(item.el);
    });
  }

  // ============ BEFOREUNLOAD WARNING ============

  var rebuildInProgress = false;
  function onBeforeUnload(e) {
    e.preventDefault();
    e.returnValue = '';
  }
  hostWin.addEventListener('beforeunload', onBeforeUnload);

  // ============ LAYERS + INSPECTOR ============

  var inspector, inspBody;
  var layersPanel, layersBody;
  var layerHoverLock = false;
  var showInertLayers = false;

  // Visual weight: measures how much meaningful content an element contains
  // Returns a score: 0 = purely structural, higher = more content
  var _weightCache = new WeakMap();
  function visualWeight(el, _depth) {
    if (!el || !el.tagName) return 0;
    if (_weightCache.has(el)) return _weightCache.get(el);
    var depth = _depth || 0;
    if (depth > 8) return 0; // safety limit
    var tag = el.tagName;
    var w = 0;

    // The element itself scores points based on what it IS
    // Interactive elements
    if (tag === 'BUTTON' || tag === 'SELECT' || tag === 'TEXTAREA') w += 2;
    if (tag === 'INPUT') w += 2;
    if (tag === 'A' && (el.textContent || '').trim().length > 0) w += 2;
    // Media
    if (tag === 'IMG' || tag === 'VIDEO' || tag === 'CANVAS' || tag === 'IFRAME') w += 2;
    if (tag === 'SVG') w += 1;
    // Semantic content
    if (/^H[1-6]$/.test(tag)) w += 2;
    if (tag === 'P' || tag === 'LI' || tag === 'BLOCKQUOTE' || tag === 'PRE' || tag === 'CODE') w += 1;
    // Direct text nodes
    for (var i = 0; i < el.childNodes.length; i++) {
      if (el.childNodes[i].nodeType === 3 && el.childNodes[i].textContent.trim().length > 0) { w += 1; break; }
    }

    // Its own visual contribution (background, border, shadow)
    if (tag === 'DIV' || tag === 'SPAN' || tag === 'SECTION' || tag === 'ARTICLE' || tag === 'MAIN' || tag === 'HEADER' || tag === 'FOOTER' || tag === 'NAV' || tag === 'ASIDE') {
      var cs;
      try { cs = getCS(el); } catch(e) {}
      if (cs) {
        if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') {
          _weightCache.set(el, 0);
          return 0;
        }
        var bg = cs.backgroundColor;
        if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') w += 1;
        if (cs.backgroundImage && cs.backgroundImage !== 'none') w += 1;
        var bw = parseFloat(cs.borderWidth) || 0;
        if (bw > 0 && cs.borderStyle !== 'none') w += 1;
        if (cs.boxShadow && cs.boxShadow !== 'none') w += 1;
      }
    }

    // Children contribute with 50% decay per depth level
    var decay = depth === 0 ? 1 : 0.5;
    for (var i = 0; i < el.children.length; i++) {
      var ch = el.children[i];
      if (SKIP.has(ch.tagName) || isEditorEl(ch)) continue;
      w += visualWeight(ch, depth + 1) * decay;
    }

    _weightCache.set(el, w);
    return w;
  }

  // Is this div/span visually inert?
  // true = hiding it changes nothing the designer can see
  // Only VISUAL properties count: background, border, shadow, outline, text, overflow+radius
  // Layout props (padding, gap, max-width, margin, position) do NOT count — they're structural
  function isVisuallyInert(el) {
    if (!el) return true;
    var tag = el.tagName;
    // Only divs and spans can be inert — semantic tags are always visible
    if (tag !== 'DIV' && tag !== 'SPAN') return false;
    var cs;
    try { cs = getCS(el); } catch(e) { return false; }
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return true;
    // Background color
    var bg = cs.backgroundColor;
    if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') return false;
    // Background image/gradient
    if (cs.backgroundImage && cs.backgroundImage !== 'none') return false;
    // Border
    if ((parseFloat(cs.borderWidth) || 0) > 0 && cs.borderStyle !== 'none') return false;
    // Box shadow
    if (cs.boxShadow && cs.boxShadow !== 'none') return false;
    // Outline
    if ((parseFloat(cs.outlineWidth) || 0) > 0 && cs.outlineStyle !== 'none') return false;
    // Overflow clip with border-radius = visible rounded mask
    if ((cs.overflow === 'hidden' || cs.overflow === 'clip') && cs.borderRadius && cs.borderRadius !== '0px') return false;
    // Direct text content
    for (var i = 0; i < el.childNodes.length; i++) {
      if (el.childNodes[i].nodeType === 3 && el.childNodes[i].textContent.trim().length > 0) return false;
    }
    return true;
  }

  // Backward compat alias
  function isUselessWrapper(el) {
    return isVisuallyInert(el);
  }

  // ---- Container resolution (used by selection + guide-drag click pass-through) ----
  // Lifted to IIFE outer scope so the guide-drag handler (defined above
  // listen()) can call resolveContainer without TDZ-ing the function.
  // Pure inline text elements that bubble up to container.
  var INLINE_TAGS = new Set(['SPAN','STRONG','EM','B','I','U','SMALL','CODE','MARK','SUB','SUP','ABBR','CITE','Q','S','DEL','INS','KBD','VAR','SAMP','TIME','DATA','BDI','BDO','RUBY','RT','RP','WBR']);
  // A and LABEL omitted — modern sites style them as buttons/cards/CTAs.
  // Visual elements that should NEVER resolve to parent.
  var VISUAL_TAGS = new Set(['IMG','VIDEO','IFRAME','CANVAS','SVG','BUTTON','INPUT','TEXTAREA','SELECT','A']);

  function drillIntoChild(parentEl, x, y) {
    var stack = targetDoc.elementsFromPoint(x, y);
    var directChild = null;
    for (var i = 0; i < stack.length; i++) {
      var el = stack[i];
      if (el === parentEl || isEditorEl(el)) continue;
      if (!parentEl.contains(el)) continue;
      // Walk up to find the direct child of parentEl
      var walk = el;
      var maxWalk = 20;
      while (walk && walk.parentElement !== parentEl && maxWalk-- > 0) {
        walk = walk.parentElement;
      }
      if (walk && walk.parentElement === parentEl && isValid(walk) && !isEditorEl(walk)) {
        directChild = walk;
        break;
      }
    }
    if (directChild && INLINE_TAGS.has(directChild.tagName)) {
      return null;
    }
    return directChild;
  }

  function resolveContainer(el) {
    // SVG internals → find nearest meaningful visual parent
    var isSvgChild = false;
    try { isSvgChild = el.closest && el.closest('svg'); } catch(e) {}
    var elTag = el.tagName ? el.tagName.toUpperCase() : '';
    var isSvgNs = el.namespaceURI && el.namespaceURI.indexOf('svg') !== -1;
    if (isSvgChild || isSvgNs || elTag === 'SVG' || elTag === 'PATH' || elTag === 'G' || elTag === 'USE' || elTag === 'CIRCLE' || elTag === 'RECT' || elTag === 'LINE' || elTag === 'POLYGON' || elTag === 'POLYLINE' || elTag === 'ELLIPSE') {
      var svgEl = (elTag === 'SVG') ? el : null;
      if (!svgEl) { try { svgEl = el.closest('svg'); } catch(e) {} }
      // Fallback: walk up manually to find the <svg>
      if (!svgEl) {
        var up = el.parentElement;
        var maxSvgUp = 8;
        while (up && maxSvgUp-- > 0) {
          if (up.tagName && up.tagName.toUpperCase() === 'SVG') { svgEl = up; break; }
          up = up.parentElement;
        }
      }
      if (svgEl) {
        // Walk up from SVG to find the first meaningful container
        var parent = svgEl.parentElement;
        var maxUp = 5;
        while (parent && maxUp-- > 0) {
          if (isEditorEl(parent)) break;
          var ptag = parent.tagName.toUpperCase();
          if (ptag === 'A' || ptag === 'BUTTON') return parent;
          if (parent.children.length > 1) return parent;
          if (parent.getAttribute('role') || parent.getAttribute('aria-label')) return parent;
          var cls = (parent.className || '').toString().toLowerCase();
          if (cls.match(/logo|brand|navbar-brand|site-name/)) return parent;
          parent = parent.parentElement;
        }
        return svgEl;
      }
    }

    // Visual elements are always directly selectable
    if (VISUAL_TAGS.has(el.tagName)) return el;

    // Mode E: find semantic block
    if (currentMode === 'E') {
      var sem = el;
      var maxSem = 10;
      while (sem && maxSem-- > 0) {
        if (sem.hasAttribute && sem.hasAttribute('data-rb-semantic')) return sem;
        sem = sem.parentElement;
      }
    }

    // Mode F: only select elements marked as editable
    if (currentMode === 'F') {
      var cur = el;
      var maxF = 10;
      while (cur && maxF-- > 0) {
        if (cur.hasAttribute && cur.hasAttribute('data-rb-editable')) return cur;
        cur = cur.parentElement;
      }
      return null;
    }

    // Inline text tags bubble up to container
    var current = el;
    var maxUp2 = 5;
    while (current && maxUp2-- > 0) {
      if (!INLINE_TAGS.has(current.tagName) && current.tagName !== 'BR') break;
      current = current.parentElement;
    }
    if (!current) return el;

    // Skip useless wrappers
    var maxSkip = 3;
    while (current && maxSkip-- > 0 && isUselessWrapper(current)) {
      current = current.parentElement;
    }

    return current || el;
  }

  // Contextual label for an element — tries to infer its role
  function elLabel(el) {
    var tag = el.tagName.toLowerCase();

    // 1. Semantic tags → human name
    var semanticMap = {
      header: 'Header', footer: 'Footer', main: 'Main', nav: 'Nav',
      aside: 'Sidebar', article: 'Article', section: 'Section',
      form: 'Form', table: 'Table', ul: 'List', ol: 'List',
      li: 'List Item', figure: 'Figure', figcaption: 'Caption',
      dialog: 'Dialog', details: 'Details', summary: 'Summary'
    };
    if (semanticMap[tag]) return semanticMap[tag];

    // 2. Interactive / media
    if (tag === 'a') {
      var txt = (el.textContent || '').trim();
      return txt.length > 0 && txt.length < 20 ? 'Link: ' + txt : 'Link';
    }
    if (tag === 'button') {
      var txt = (el.textContent || '').trim();
      return txt.length > 0 && txt.length < 20 ? 'Button: ' + txt : 'Button';
    }
    if (tag === 'img') return el.alt ? 'Image: ' + el.alt.substring(0, 20) : 'Image';
    if (tag === 'video') return 'Video';
    if (tag === 'svg') return 'Icon';
    if (tag === 'input') return 'Input (' + (el.type || 'text') + ')';
    if (tag === 'textarea') return 'Textarea';
    if (tag === 'select') return 'Select';
    if (tag === 'iframe') return 'Embed';
    if (tag === 'canvas') return 'Canvas';

    // 3. Headings with text preview
    if (/^h[1-6]$/.test(tag)) {
      var txt = (el.textContent || '').trim();
      if (txt.length > 25) txt = txt.substring(0, 25) + '...';
      return tag.toUpperCase() + (txt ? ': ' + txt : '');
    }
    // Paragraphs with text preview
    if (tag === 'p') {
      var txt = (el.textContent || '').trim();
      if (txt.length > 25) txt = txt.substring(0, 25) + '...';
      return txt || 'Paragraph';
    }

    // 4. ARIA roles
    var role = el.getAttribute('role');
    if (role) {
      var roleMap = {
        banner: 'Header', navigation: 'Nav', main: 'Main',
        contentinfo: 'Footer', complementary: 'Sidebar',
        search: 'Search', alert: 'Alert', dialog: 'Dialog',
        tablist: 'Tabs', tab: 'Tab', tabpanel: 'Tab Panel',
        menu: 'Menu', menubar: 'Menu Bar', menuitem: 'Menu Item',
        toolbar: 'Toolbar', progressbar: 'Progress', slider: 'Slider'
      };
      if (roleMap[role]) return roleMap[role];
    }

    // 5. Class-based heuristics for divs/spans
    if (tag === 'div' || tag === 'span') {
      var cls = (el.className && typeof el.className === 'string') ? el.className.toLowerCase() : '';
      // Check for common patterns
      if (/\bhero\b/.test(cls)) return 'Hero';
      if (/\blogo\b/.test(cls)) return 'Logo';
      if (/\bnav(bar|igation)?\b/.test(cls)) return 'Nav';
      if (/\bheader\b/.test(cls)) return 'Header';
      if (/\bfooter\b/.test(cls)) return 'Footer';
      if (/\bsidebar\b/.test(cls)) return 'Sidebar';
      if (/\bcta\b/.test(cls)) return 'CTA';
      if (/\bbanner\b/.test(cls)) return 'Banner';
      if (/\bmodal\b/.test(cls)) return 'Modal';
      if (/\bcard\b/.test(cls)) return 'Card';
      if (/\bgrid\b/.test(cls)) return 'Grid';
      if (/\bcontainer\b/.test(cls)) return 'Container';
      if (/\bwrapper?\b/.test(cls)) return 'Wrapper';
      if (/\bcontent\b/.test(cls)) return 'Content';
      if (/\boverlay\b/.test(cls)) return 'Overlay';
      if (/\bbackdrop\b/.test(cls)) return 'Backdrop';
      if (/\bicon\b/.test(cls)) return 'Icon';
      if (/\bavatar\b/.test(cls)) return 'Avatar';
      if (/\bbadge\b/.test(cls)) return 'Badge';
      if (/\btooltip\b/.test(cls)) return 'Tooltip';
      if (/\bdropdown\b/.test(cls)) return 'Dropdown';
      if (/\btab[s-]?\b/.test(cls)) return 'Tabs';
      if (/\baccordion\b/.test(cls)) return 'Accordion';
      if (/\bcarousel|slider|swiper\b/.test(cls)) return 'Carousel';
      if (/\bform\b/.test(cls)) return 'Form';
      if (/\bsearch\b/.test(cls)) return 'Search';
      if (/\bmenu\b/.test(cls)) return 'Menu';
      if (/\bprice|pricing\b/.test(cls)) return 'Pricing';
      if (/\btestimonial|review\b/.test(cls)) return 'Testimonial';

      // 6. Site wrapper detection — div containing all page sections
      var siteWrapper = findSiteWrapper();
      if (el === siteWrapper && el !== targetDoc.body) return 'Page';

      // 7. Position & role heuristics
      var cs;
      try { cs = getCS(el); } catch(e) {}
      if (cs) {
        var r = el.getBoundingClientRect();
        // Fixed/sticky at top = Sticky Bar
        if ((cs.position === 'fixed' || cs.position === 'sticky') && parseFloat(cs.top) < 10) return 'Sticky Bar';

        // "Background" = purely decorative layer (no text, positioned behind siblings or no meaningful children)
        var hasOwnBg = (cs.backgroundImage && cs.backgroundImage !== 'none') ||
                        (cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent');
        if (hasOwnBg) {
          // Check if this is decorative (no meaningful text, absolute/fixed, or no visible children with text)
          var elText = (el.innerText || '').trim();
          var isDecorative = false;
          // Absolute/fixed positioned with no text = decorative background
          if ((cs.position === 'absolute' || cs.position === 'fixed') && elText.length === 0) isDecorative = true;
          // Has background but zero text and covers a large area = decorative
          if (elText.length === 0 && r.width > 100 && r.height > 100) isDecorative = true;
          // Has z-index lower than siblings = behind content
          if (cs.zIndex && parseInt(cs.zIndex) < 0) isDecorative = true;

          if (isDecorative) return 'Background';
          // Otherwise it's a content container that happens to have a background — don't rename it
        }
      }

      // 7. Fallback: tag.firstClass
      if (el.className && typeof el.className === 'string') {
        var first = el.className.split(' ').filter(function(c) {
          return c.indexOf('rb-') === -1 && c.length < 25;
        })[0];
        if (first) return 'div.' + first;
      }
      return 'div';
    }

    // 8. Everything else: tag name
    return tag;
  }

  function isFloatingWidget(el) {
    var s; try { s = getCS(el); } catch(e) { return false; }
    if (s.position !== 'fixed' && s.position !== 'sticky') return false;
    var r = el.getBoundingClientRect();
    if (r.width < 200 && r.height < 200) return true;
    if (r.bottom > targetWin.innerHeight - 20 && (r.left < 100 || r.right > targetWin.innerWidth - 100) && r.width < 400) return true;
    return false;
  }

  function isHoverMenu(el) {
    var s; try { s = getCS(el); } catch(e) { return false; }
    if (s.opacity === '0' || s.visibility === 'hidden' || s.pointerEvents === 'none') return true;
    if (s.transform && s.transform !== 'none') {
      var r = el.getBoundingClientRect();
      if (r.bottom < 0 || r.top > targetWin.innerHeight || r.right < 0 || r.left > targetWin.innerWidth) return true;
    }
    var cls = (el.className || '').toString().toLowerCase();
    if (cls.match(/dropdown|menu-overlay|submenu|popup|popover|tooltip|flyout|drawer|nav-content|nav-overlay|w-nav-overlay|mobile.?menu|hamburger.?menu|off.?canvas/)) {
      if (s.position === 'absolute' || s.position === 'fixed') return true;
    }
    if (el.classList && (el.classList.contains('w-nav-overlay') || el.classList.contains('w--overlay'))) return true;
    return false;
  }

  // Get visible children of an element (filtered)
  function getVisibleChildren(el) {
    var kids = [];
    for (var i = 0; i < el.children.length; i++) {
      var ch = el.children[i];
      if (SKIP.has(ch.tagName) || isEditorEl(ch)) continue;
      var cr = ch.getBoundingClientRect();
      if (cr.width < 2 && cr.height < 2) continue;
      if (isHoverMenu(ch)) continue;
      kids.push(ch);
    }
    return kids;
  }

  function buildLayerRow(el, depth, _skipBudget) {
    if (!el || !el.tagName || SKIP.has(el.tagName) || isEditorEl(el)) return null;
    if (isHoverMenu(el)) return null;
    if (depth === 0 && isFloatingWidget(el)) return null;
    var r = el.getBoundingClientRect();
    if (r.width < 2 && r.height < 2) return null;
    var skipBudget = (_skipBudget === undefined) ? 8 : _skipBudget;

    var tag = el.tagName.toLowerCase();

    // Filter out invisible iframes (analytics, tracking pixels)
    if (tag === 'iframe') {
      var ics; try { ics = getCS(el); } catch(e) {}
      if (ics && (ics.display === 'none' || ics.visibility === 'hidden' || r.width < 10 || r.height < 10)) return null;
    }

    var isInert = isVisuallyInert(el);

    // Skip inert layers — promote their children to this level
    if (isInert && !showInertLayers && skipBudget > 0) {
      var skipContainer = mk('div');
      skipContainer.setAttribute('data-rb-layer-skip', '');
      var vk = getVisibleChildren(el);
      for (var si = 0; si < vk.length; si++) {
        var childRow = buildLayerRow(vk[si], depth, skipBudget - 1);
        if (childRow) skipContainer.appendChild(childRow);
      }
      return skipContainer.children.length > 0 ? skipContainer : null;
    }

    // Collapse chains of single-child inert wrappers: div.a > div.b > div.c → show as collapsed chain
    var chainLabels = [];
    var chainEnd = el;
    if (isInert) {
      chainLabels.push(elLabel(el));
      var vk = getVisibleChildren(chainEnd);
      while (vk.length === 1 && isUselessWrapper(vk[0])) {
        chainEnd = vk[0];
        chainLabels.push(elLabel(chainEnd));
        vk = getVisibleChildren(chainEnd);
      }
    }
    // If chain collapsed, chainEnd is the last wrapper; its children are what we show
    var effectiveEl = chainLabels.length > 1 ? chainEnd : el;

    var visKids = getVisibleChildren(effectiveEl);
    var hasVisibleChildren = visKids.length > 0;

    var container = mk('div');
    container.setAttribute('data-rb-layer-el', '');

    var row = mk('div', 'rb-layer-row');
    row.style.setProperty('--rb-layer-depth', depth);
    if (isInert) row.classList.add('rb-layer-wrapper');

    if (hasVisibleChildren) {
      var collapseBtn = mk('button', 'rb-layer-collapse rb-collapsed');
      collapseBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 9l6 6 6-6"/></svg>';
      collapseBtn.addEventListener('mousedown', function(e) {
        e.stopPropagation();
        e.stopImmediatePropagation();
        var childContainer = container.querySelector('.rb-layer-children');
        if (!childContainer) return;
        var isOpen = childContainer.classList.contains('rb-layer-expanded');
        if (!isOpen) {
          if (childContainer.children.length === 0) {
            renderLayerChildren(effectiveEl, childContainer, depth + 1);
          }
          childContainer.classList.add('rb-layer-expanded');
          collapseBtn.classList.remove('rb-collapsed');
        } else {
          childContainer.classList.remove('rb-layer-expanded');
          collapseBtn.classList.add('rb-collapsed');
        }
      }, {capture: true});
      row.appendChild(collapseBtn);
    } else {
      var placeholder = mk('div', 'rb-layer-chev-placeholder');
      row.appendChild(placeholder);
    }

    var icon = mk('div', 'rb-layer-icon');
    icon.setAttribute('data-tag', tag);
    row.appendChild(icon);

    var label = mk('span', 'rb-layer-label');
    if (chainLabels.length > 1) {
      // Collapsed chain: show "div.a › div.b › div.c"
      label.textContent = chainLabels.join(' › ');
      label.title = chainLabels.join(' > ');
    } else if (!hasVisibleChildren && isText(el)) {
      var txt = (el.innerText || '').trim();
      if (txt.length > 30) txt = txt.substring(0, 30) + '...';
      label.textContent = txt || elLabel(el);
    } else {
      label.textContent = elLabel(el);
    }
    row.appendChild(label);

    // Eye toggle — show/hide element (appears on hover)
    var eyeBtn = mk('button', 'rb-layer-eye');
    eyeBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M1 8s3-5 7-5 7 5 7 5-3 5-7 5-7-5-7-5z"/><circle cx="8" cy="8" r="2"/></svg>';
    eyeBtn.title = 'Toggle visibility';
    var isHidden = false;
    eyeBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      isHidden = !isHidden;
      if (isHidden) {
        el.style.setProperty('visibility', 'hidden', 'important');
        el.style.setProperty('opacity', '0', 'important');
        row.classList.add('rb-layer-hidden');
        eyeBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M1 8s3-5 7-5 7 5 7 5-3 5-7 5-7-5-7-5z"/><circle cx="8" cy="8" r="2"/><line x1="2" y1="14" x2="14" y2="2"/></svg>';
      } else {
        el.style.removeProperty('visibility');
        el.style.removeProperty('opacity');
        row.classList.remove('rb-layer-hidden');
        eyeBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M1 8s3-5 7-5 7 5 7 5-3 5-7 5-7-5-7-5z"/><circle cx="8" cy="8" r="2"/></svg>';
      }
    });
    row.appendChild(eyeBtn);

    // Hover → highlight element on page with blue fill (lock prevents tMove from clearing it)
    row.addEventListener('mouseenter', function() {
      layerHoverLock = true;
      updateHoverBox(el);
      hoverBox.style.background = 'rgba(0,149,255,0.12)';
      hoverBox.style.borderColor = 'rgba(0,149,255,0.4)';
    });
    row.addEventListener('mouseleave', function() {
      layerHoverLock = false;
      hoverBox.style.display = 'none';
      hoverBox.style.background = '';
      hoverBox.style.borderColor = '';
    });

    // Click → select element
    row.addEventListener('click', function(e) {
      e.stopPropagation();
      selectEl(el);
      selectionDepth = depth;
      selectionAncestor = null;
    });

    // Double-click → rename layer
    row.addEventListener('dblclick', function(e) {
      e.stopPropagation();
      var inp = mk('input', 'rb-layer-rename');
      inp.value = label.textContent;
      inp.style.cssText = 'flex:1;background:' + (isLight() ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.08)') + ';border:1px solid rgba(0,149,255,0.4);border-radius:3px;color:' + (isLight() ? '#333' : '#EFEEEB') + ';font:400 10px/1.3 "Instrument Sans",sans-serif;padding:1px 4px;outline:none;';
      label.style.display = 'none';
      row.insertBefore(inp, label.nextSibling);
      inp.focus();
      inp.select();
      var commit = function() {
        var newName = inp.value.trim();
        if (newName) label.textContent = newName;
        label.style.display = '';
        if (inp.parentElement) inp.parentElement.removeChild(inp);
      };
      inp.addEventListener('blur', commit);
      inp.addEventListener('keydown', function(ke) {
        if (ke.key === 'Enter') { ke.preventDefault(); commit(); }
        if (ke.key === 'Escape') { ke.preventDefault(); label.style.display = ''; if (inp.parentElement) inp.parentElement.removeChild(inp); }
      });
    });

    // Right-click → color picker
    var LAYER_COLORS = [
      {name:'Blue',   hex:'#3B82F6'},
      {name:'Cyan',   hex:'#06B6D4'},
      {name:'Green',  hex:'#22C55E'},
      {name:'Lime',   hex:'#84CC16'},
      {name:'Yellow', hex:'#EAB308'},
      {name:'Orange', hex:'#F97316'},
      {name:'Red',    hex:'#EF4444'},
      {name:'Purple', hex:'#A855F7'},
      {name:'Gray',   hex:'#6B7280'}
    ];
    row.addEventListener('contextmenu', function(e) {
      e.preventDefault();
      e.stopPropagation();
      // Remove any existing color picker
      var old = hostDoc.getElementById('rb-layer-colorpicker');
      if (old) old.remove();
      var picker = mk('div');
      picker.id = 'rb-layer-colorpicker';
      var radius = 40;
      var dotSize = 16;
      var totalSize = (radius + dotSize) * 2 + 4;
      picker.style.cssText = 'position:fixed;z-index:2147483647;width:' + totalSize + 'px;height:' + totalSize + 'px;pointer-events:auto;';
      picker.style.left = (e.clientX - totalSize / 2) + 'px';
      picker.style.top = (e.clientY - totalSize / 2) + 'px';
      // Frosted glass donut
      var donut = mk('div');
      var outerR = radius + dotSize / 2 + 6;
      var innerR = radius - dotSize / 2 - 4;
      donut.style.cssText = 'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:' + (outerR * 2) + 'px;height:' + (outerR * 2) + 'px;border-radius:50%;background:' + (isLight() ? 'rgba(232,232,232,0.88)' : 'rgba(23,23,23,0.85)') + ';backdrop-filter:blur(40px);-webkit-backdrop-filter:blur(40px);border:1px solid ' + (isLight() ? 'rgba(255,255,255,1)' : 'rgba(255,255,255,0.12)') + ';mask:radial-gradient(circle ' + innerR + 'px at center,transparent ' + innerR + 'px,black ' + (innerR + 1) + 'px);-webkit-mask:radial-gradient(circle ' + innerR + 'px at center,transparent ' + innerR + 'px,black ' + (innerR + 1) + 'px);';
      picker.appendChild(donut);
      var allItems = LAYER_COLORS.concat([{name:'None', hex:'none'}]);
      var count = allItems.length;
      allItems.forEach(function(c, i) {
        var angle = (i / count) * Math.PI * 2 - Math.PI / 2;
        var cx = totalSize / 2 + Math.cos(angle) * radius - dotSize / 2;
        var cy = totalSize / 2 + Math.sin(angle) * radius - dotSize / 2;
        var dot = mk('div');
        if (c.hex === 'none') {
          dot.style.cssText = 'position:absolute;width:' + dotSize + 'px;height:' + dotSize + 'px;border-radius:50%;cursor:pointer;border:1px solid rgba(255,255,255,0.25);display:flex;align-items:center;justify-content:center;font-size:9px;color:rgba(255,255,255,0.4);transition:transform 80ms;left:' + cx + 'px;top:' + cy + 'px;';
          dot.textContent = '×';
        } else {
          dot.style.cssText = 'position:absolute;width:' + dotSize + 'px;height:' + dotSize + 'px;border-radius:50%;cursor:pointer;transition:transform 80ms;background:' + c.hex + ';left:' + cx + 'px;top:' + cy + 'px;';
        }
        dot.title = c.name;
        dot.addEventListener('mouseenter', function() { dot.style.transform = 'scale(1.35)'; });
        dot.addEventListener('mouseleave', function() { dot.style.transform = ''; });
        dot.addEventListener('mousedown', function(ce) {
          ce.preventDefault(); ce.stopPropagation();
          if (c.hex === 'none') {
            row.style.borderLeft = ''; icon.style.background = ''; icon.style.borderColor = '';
          } else {
            row.style.borderLeft = '3px solid ' + c.hex; icon.style.background = c.hex; icon.style.borderColor = c.hex;
          }
          picker.remove();
        });
        picker.appendChild(dot);
      });
      root.appendChild(picker);
      // Close on any mousedown outside picker
      var closePicker = function(ev) {
        if (picker.contains(ev.target)) return;
        if (picker.parentElement) picker.remove();
        hostDoc.removeEventListener('mousedown', closePicker, true);
      };
      setTimeout(function() { hostDoc.addEventListener('mousedown', closePicker, true); }, 50);
    });

    row._rbEl = el;
    row._rbEffectiveEl = effectiveEl;
    container.appendChild(row);

    if (hasVisibleChildren) {
      var childContainer = mk('div', 'rb-layer-children');
      container.appendChild(childContainer);
    }

    return container;
  }

  function renderLayerChildren(parentEl, container, depth) {
    var maxChildren = 50;
    var count = 0;
    for (var i = 0; i < parentEl.children.length && count < maxChildren; i++) {
      var child = parentEl.children[i];
      var rowContainer = buildLayerRow(child, depth);
      if (rowContainer) {
        if (rowContainer.hasAttribute('data-rb-layer-skip')) {
          while (rowContainer.firstChild) {
            container.appendChild(rowContainer.firstChild);
            count++;
          }
        } else {
          container.appendChild(rowContainer);
          count++;
        }
      }
    }
  }

  // Highlight a layer row when hovering its element on the page (subtle, different from selected)
  function highlightLayerRow(el) {
    var oldHl = layersBody ? layersBody.querySelectorAll('.rb-layer-hover') : [];
    oldHl.forEach(function(r) { r.classList.remove('rb-layer-hover'); });
    if (!el || !layersBody) return;
    // Build a lookup of all rendered rows
    var allRows = layersBody.querySelectorAll('.rb-layer-row');
    var rowMap = new Map();
    for (var i = 0; i < allRows.length; i++) {
      if (allRows[i]._rbEl) rowMap.set(allRows[i]._rbEl, allRows[i]);
    }
    // Walk up from el to find the nearest ancestor that has a row in the panel
    var walk = el;
    var maxUp = 15;
    while (walk && walk !== targetDoc.body && maxUp-- > 0) {
      if (rowMap.has(walk)) {
        var matchRow = rowMap.get(walk);
        matchRow.classList.add('rb-layer-hover');
        matchRow.scrollIntoView({block: 'nearest', behavior: 'smooth'});
        return;
      }
      walk = walk.parentElement;
    }
  }

  function populateLayers() {
    if (!layersBody) return;
    layersBody.innerHTML = '';
    renderLayerChildren(targetDoc.body, layersBody, 0);
  }

  // ---- SECTIONS TAB ----
  // Find the "site wrapper" — the element whose direct children are the page's stacked sections.
  // Pattern: the deepest single-branch ancestor from body that contains multiple visible full-width children.
  function findSiteWrapper() {
    var el = targetDoc.body;
    var maxDrill = 10;
    while (maxDrill-- > 0) {
      var visKids = [];
      for (var i = 0; i < el.children.length; i++) {
        var ch = el.children[i];
        if (SKIP.has(ch.tagName) || isEditorEl(ch)) continue;
        var r = ch.getBoundingClientRect();
        if (r.width > targetWin.innerWidth * 0.5 && r.height > 15) visKids.push(ch);
      }
      // If this element has 3+ wide children, it's the wrapper
      if (visKids.length >= 3) return el;
      // If it has exactly 1 wide child, drill into it (it's a pass-through wrapper)
      if (visKids.length === 1) { el = visKids[0]; continue; }
      // 0 or 2 wide children — stop here
      return el;
    }
    return el;
  }

  function getSections() {
    var wrapper = findSiteWrapper();
    var sections = [];
    for (var i = 0; i < wrapper.children.length; i++) {
      var ch = wrapper.children[i];
      if (SKIP.has(ch.tagName) || isEditorEl(ch)) continue;
      var r = ch.getBoundingClientRect();
      if (r.width < 50 || r.height < 15) continue;
      if (isFloatingWidget(ch)) continue;
      if (isHoverMenu(ch)) continue;
      sections.push(ch);
    }
    return sections;
  }

  function buildSectionThumb(el) {
    var r = el.getBoundingClientRect();
    var card = mk('div', 'rb-section-card');
    card.setAttribute('draggable', 'true');

    // Thumbnail — scaled-down clone of the element, fills full width
    var thumb = mk('div', 'rb-section-thumb');
    thumb.style.overflow = 'hidden';
    thumb.style.position = 'relative';
    thumb.style.width = '100%';
    // We'll set height after measuring the container width
    var scale = 1;
    var miniWrap = mk('div');
    miniWrap.style.cssText = 'pointer-events:none;overflow:hidden;transform-origin:top left;';
    // Use requestAnimationFrame to measure actual width after append
    var setThumbSize = function() {
      var thumbW = thumb.offsetWidth || 208;
      scale = thumbW / Math.max(r.width, 1);
      var thumbH = Math.max(24, Math.min(120, Math.round(r.height * scale)));
      thumb.style.height = thumbH + 'px';
      miniWrap.style.transform = 'scale(' + scale.toFixed(4) + ')';
      miniWrap.style.width = r.width + 'px';
      miniWrap.style.height = r.height + 'px';
    };
    try {
      var clone = el.cloneNode(true);
      // Remove editor elements from clone
      var edEls = clone.querySelectorAll('[id^="rb-editor"],[id^="rb-ed"],[class^="rb-"]');
      edEls.forEach(function(e) { e.remove(); });
      // Remove scripts
      clone.querySelectorAll('script').forEach(function(s) { s.remove(); });
      clone.style.margin = '0';
      clone.style.position = 'static';
      miniWrap.appendChild(clone);
    } catch(e) {
      // Fallback: colored rectangle
      var cs; try { cs = getCS(el); } catch(e2) {}
      var bgCol = cs && cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)' ? cs.backgroundColor : '#222';
      miniWrap.style.background = bgCol;
    }
    thumb.appendChild(miniWrap);
    card.appendChild(thumb);

    // Label
    var label = mk('div', 'rb-section-label');
    label.textContent = elLabel(el);
    card.appendChild(label);

    // Drag handlers
    card._rbEl = el;
    card.addEventListener('dragstart', function(e) {
      e.dataTransfer.effectAllowed = 'move';
      card.classList.add('rb-section-dragging');
      // Store reference
      window.__rbDragSection = el;
    });
    card.addEventListener('dragend', function() {
      card.classList.remove('rb-section-dragging');
      window.__rbDragSection = null;
      // Remove all drop indicators
      var indicators = hostDoc.querySelectorAll('.rb-section-drop-indicator');
      indicators.forEach(function(ind) { ind.remove(); });
    });
    card.addEventListener('dragover', function(e) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      var rect = card.getBoundingClientRect();
      var midY = rect.top + rect.height / 2;
      // Show indicator above or below
      card.classList.remove('rb-section-drop-above', 'rb-section-drop-below');
      if (e.clientY < midY) {
        card.classList.add('rb-section-drop-above');
      } else {
        card.classList.add('rb-section-drop-below');
      }
    });
    card.addEventListener('dragleave', function() {
      card.classList.remove('rb-section-drop-above', 'rb-section-drop-below');
    });
    card.addEventListener('drop', function(e) {
      e.preventDefault();
      card.classList.remove('rb-section-drop-above', 'rb-section-drop-below');
      var draggedEl = window.__rbDragSection;
      if (!draggedEl || draggedEl === el) return;
      var rect = card.getBoundingClientRect();
      var midY = rect.top + rect.height / 2;
      // Move the actual DOM element
      if (e.clientY < midY) {
        el.parentElement.insertBefore(draggedEl, el);
      } else {
        el.parentElement.insertBefore(draggedEl, el.nextSibling);
      }
      // Rebuild sections panel
      populateSections();
    });

    // Click to select
    card.addEventListener('click', function(e) {
      e.stopPropagation();
      selectEl(el);
    });
    // Hover highlight
    card.addEventListener('mouseenter', function() {
      layerHoverLock = true;
      updateHoverBox(el);
      hoverBox.style.background = 'rgba(0,149,255,0.12)';
      hoverBox.style.borderColor = 'rgba(0,149,255,0.4)';
    });
    card.addEventListener('mouseleave', function() {
      layerHoverLock = false;
      hoverBox.style.display = 'none';
      hoverBox.style.background = '';
      hoverBox.style.borderColor = '';
    });

    // Measure thumb width after DOM insert
    requestAnimationFrame(setThumbSize);
    return card;
  }

  var SMART_EDIT_ICON = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>';

  // Generic placeholder for thumbs whose original src + proxy retry both
  // failed. Mounted as a sibling of the broken <img> with absolute fill.
  var BROKEN_THUMB_SVG = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>';

  // Attaches an error-fallback handler to a thumbnail <img>. On first load
  // failure (CORS / hotlink protection / 404), retries via the canvas-side
  // server proxy at /api/proxy/image which synthesizes a matching Referer
  // header. If the proxy also fails (or we're in extension-mount where the
  // proxy isn't reachable), swaps the <img> for a clean placeholder
  // instead of letting the browser's broken-image glyph leak through.
  function attachThumbFallback(imgEl, originalSrc) {
    if (!imgEl || !originalSrc || /^data:/.test(originalSrc)) return;
    imgEl.addEventListener('error', function onErr() {
      // Skip proxy retry for same-origin URLs — the proxy refuses to fetch
      // its own server (correct SSRF guard) and a 404 on our own origin
      // means the file is genuinely missing. Go straight to placeholder.
      var sameOrigin = false;
      try {
        if (originalSrc.startsWith('/')) sameOrigin = true;
        else sameOrigin = new URL(originalSrc).origin === hostWin.location.origin;
      } catch (e) {}
      if (hostWin.__uncraftZoom && !imgEl.dataset.uncraftProxyTried && !sameOrigin) {
        imgEl.dataset.uncraftProxyTried = '1';
        imgEl.src = '/api/proxy/image?url=' + encodeURIComponent(originalSrc);
        return;
      }
      imgEl.removeEventListener('error', onErr);
      showBrokenThumb(imgEl);
    });
  }
  function showBrokenThumb(imgEl) {
    imgEl.style.opacity = '0';
    var parent = imgEl.parentElement;
    if (!parent || parent.querySelector('.rb-ed-thumb-broken')) return;
    var ph = mk('div', 'rb-ed-thumb-broken');
    ph.innerHTML = BROKEN_THUMB_SVG;
    parent.appendChild(ph);
  }

  // Web-shell origin discovery — mirrors panel.js stcDiscoverOrigin so the
  // editor can fetch persisted assets from inside the content-script
  // context. Cache key matches panel.js so both surfaces share the resolved
  // origin once either side has probed it.
  var WEB_SHELL_ORIGIN_KEY = 'uncraft.webShellOrigin';
  var WEB_SHELL_CANDIDATES = ['https://uncraft.app', 'http://localhost:3030', 'http://127.0.0.1:3030'];
  var webShellOriginCache = null;
  // Proxies a fetch through background.js. Content scripts inherit the
  // page's origin (e.g. https://gistr.so) which the /api/* CORS allowlist
  // rejects; the service worker fetches with the extension origin instead.
  // Returns { ok, status, data, text, error }.
  function bgFetch(url, options) {
    return new Promise(function(resolve) {
      try {
        if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) {
          // Canvas-mount (no extension context) — same-origin direct fetch.
          fetch(url, Object.assign({ credentials: 'include' }, options || {})).then(function(res) {
            var ct = res.headers.get('content-type') || '';
            var parser = ct.indexOf('application/json') >= 0 ? res.json() : res.text();
            parser.then(function(body) {
              resolve({ ok: res.ok, status: res.status, data: ct.indexOf('application/json') >= 0 ? body : null, text: ct.indexOf('application/json') >= 0 ? null : body });
            }).catch(function() { resolve({ ok: res.ok, status: res.status, data: null, text: null }); });
          }).catch(function(err) { resolve({ ok: false, status: 0, error: String((err && err.message) || err) }); });
          return;
        }
        chrome.runtime.sendMessage({ action: 'uncraft.apiFetch', url: url, options: options || {} }, function(resp) {
          if (chrome.runtime.lastError) {
            resolve({ ok: false, status: 0, error: chrome.runtime.lastError.message });
            return;
          }
          resolve(resp || { ok: false, status: 0, error: 'no response' });
        });
      } catch (e) {
        resolve({ ok: false, status: 0, error: String((e && e.message) || e) });
      }
    });
  }

  function getWebShellOrigin() {
    if (webShellOriginCache) return Promise.resolve(webShellOriginCache);
    // Canvas-mount: editor.js is loaded as <script> inside the web-shell
    // itself, so the API lives at our own origin. No discovery needed and
    // chrome.* APIs aren't available outside content-script context.
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
      try {
        webShellOriginCache = hostWin.location.origin;
        return Promise.resolve(webShellOriginCache);
      } catch (e) { return Promise.resolve(null); }
    }
    return new Promise(function(resolve) {
      var done = false;
      function finish(o) { if (!done) { done = true; webShellOriginCache = o; resolve(o); } }
      try {
        chrome.storage.local.get([WEB_SHELL_ORIGIN_KEY], function(cache) {
          var seed = cache && cache[WEB_SHELL_ORIGIN_KEY];
          var order = seed
            ? [seed].concat(WEB_SHELL_CANDIDATES.filter(function(o) { return o !== seed; }))
            : WEB_SHELL_CANDIDATES.slice();
          (function tryNext(i) {
            if (i >= order.length) return finish(null);
            var origin = order[i];
            bgFetch(origin + '/api/boards').then(function(resp) {
              if (resp && (resp.ok || resp.status === 401)) {
                try { chrome.storage.local.set({ 'uncraft.webShellOrigin': origin }); } catch (e) {}
                finish(origin);
              } else tryNext(i + 1);
            });
          })(0);
        });
      } catch (e) { finish(null); }
    });
  }

  // Persisted across rebuilds of populateAssets so the user's scope choice
  // survives a tab toggle. Default = global library (works without a board).
  var assetsScopeState = { kind: 'library' };
  // Generation counter — every populateAssets() bump invalidates any
  // in-flight fetch so stale responses don't paint over a newer render.
  var assetsGen = 0;
  // Smart-edit floating panel — Slice C v2. The panel mounts to the editor
  // root anchored to the right edge of the layers panel and almost fills
  // the site height. It survives Assets tab re-renders because it lives
  // outside the tab body.
  var assetEditPanel = null;
  var assetEditTarget = null;

  // Serializes the asset into dataTransfer for cross-iframe drag onto the
  // canvas surface. Same-origin srcDoc iframes (canvas-mount) share the
  // dataTransfer payload natively — CanvasClient reads it from the drop
  // event and calls api.createNode. The MIME type carries our descriptor
  // separately from any text/url so non-canvas drop targets are unaffected.
  function buildAssetDragData(e, asset) {
    if (!asset || !e || !e.dataTransfer) return;
    try {
      var descriptor = {
        type: asset.type || 'image',
        name: asset.name || '',
        source_url: asset.source_url || null,
        thumb_url: asset.thumb_url || null,
        blob_url: asset.blob_url || null,
        html: asset.html || null,
        meta: asset.meta || {}
      };
      e.dataTransfer.setData('application/x-uncraft-asset', JSON.stringify(descriptor));
      // Fallback for browsers that strip custom MIME types in some flows.
      var url = descriptor.thumb_url || descriptor.blob_url || descriptor.source_url;
      if (url) e.dataTransfer.setData('text/uri-list', url);
      e.dataTransfer.effectAllowed = 'copy';
    } catch (err) { /* swallow — drag still starts, drop will no-op */ }
  }

  // Build an asset-shaped object from a DOM element so the image minidock
  // can hand off into the same smart-edit panel that persisted assets use.
  function assetFromElement(el) {
    if (!el) return null;
    var tag = (el.tagName || '').toLowerCase();
    var src = el.currentSrc || el.src || '';
    var type = tag === 'video' ? 'video' : (tag === 'img' ? 'image' : 'image');
    var name = el.alt || el.title || '';
    if (!name && src) {
      try { name = src.split('/').pop().split('?')[0] || 'Asset'; } catch (e) { name = 'Asset'; }
    }
    return {
      type: type,
      name: name || 'Asset',
      source_url: src || null,
      thumb_url: src || null,
      blob_url: null,
      html: null,
      css: null,
      meta: {},
      _domEl: el
    };
  }

  // Mixed-font detection — Skip the text minidock for wrappers that
  // contain multiple fonts; the dock can't represent that cleanly so we
  // suppress it entirely per user request.
  function isTextMixedFonts(el) {
    try {
      var v = readTextStyle(el, 'fontFamily');
      return !!(v && typeof v === 'object' && v.mixed);
    } catch (e) { return false; }
  }

  // Builds one collapsible card matching the inspector's .rb-insp-sec
  // pattern, but parented to the Assets tab body instead of inspBody.
  // Returns refs the caller can use to inject controls into the header
  // and populate the body.
  function buildAssetsCard(parent, title, slug) {
    var sec = mk('div', 'rb-insp-sec rb-ed-assets-card');
    sec.setAttribute('data-rb-sec', slug);
    var hd = mk('div', 'rb-insp-sec-hd');
    var titleSpan = mk('span', 'rb-insp-sec-title');
    titleSpan.textContent = title;
    hd.appendChild(titleSpan);
    var hdRight = mk('div', 'rb-ed-assets-card-hdright');
    hdRight.style.cssText = 'display:flex;align-items:center;gap:6px;';
    var chev = hostDoc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    chev.setAttribute('class', 'rb-insp-sec-chev');
    chev.setAttribute('viewBox', '0 0 24 24');
    chev.setAttribute('fill', 'none');
    chev.setAttribute('stroke', 'currentColor');
    chev.setAttribute('stroke-width', '1.5');
    chev.innerHTML = '<path d="M6 9l6 6 6-6"/>';
    hdRight.appendChild(chev);
    hd.appendChild(hdRight);
    sec.appendChild(hd);
    var body = mk('div', 'rb-insp-sec-body');
    sec.appendChild(body);
    parent.appendChild(sec);
    hd.addEventListener('click', function(e) {
      // Header controls (scope dropdown) shouldn't collapse the card.
      if (e.target.closest('.rb-ed-assets-scope') || e.target.closest('.rb-ed-assets-scope-menu')) return;
      sec.classList.toggle('collapsed');
    }, { signal: sig });
    return { sec: sec, header: hdRight, body: body };
  }

  function populateAssets() {
    var ab = hostDoc.getElementById('rb-ed-assets-body');
    if (!ab) return;
    ab.innerHTML = '';
    assetsGen++;

    var userCard = buildAssetsCard(ab, 'User Collected Assets', 'user-collected');
    mountScopePicker(userCard.header, userCard.body);
    renderUserCollectedBody(userCard.body, assetsGen);

    var pageCard = buildAssetsCard(ab, 'Page Assets', 'page-assets');
    populatePageAssets(pageCard.body);
  }

  // Smart Edit (Slice D) — analyze → editable JSON → generate → result.
  // Mirrors the widget's Smart Remix flow (panel.js buildGenCard) but
  // collapsed to what the floating panel needs. Background handlers
  // (describeImage, generateImage) are reused as-is.
  var assetEditState = null; // { phase, json, prompt, provider, resultUrl, err, dirty }
  var assetEditMsgListener = null;
  var assetEditRunIdRef = { current: null };
  var assetEditSmartContainer = null;
  // Optional handler bound at enterAssetEdit time. When set, the idle screen
  // shows a "Show in page" button alongside "Smart edit"; clicking it
  // closes the panel and runs the caller's handler (typically: scroll the
  // page, select the element, mount the image minidock).
  var assetEditShowInPage = null;

  function enterAssetEdit(asset, showInPageHandler, autoAnalyze) {
    if (!asset) return;
    if (assetEditPanel) exitAssetEdit();
    assetEditTarget = asset;
    assetEditShowInPage = typeof showInPageHandler === 'function' ? showInPageHandler : null;
    assetEditState = { phase: 'idle', dirty: false };
    assetEditPanel = mk('div', 'rb-ed-asset-edit-panel');
    renderAssetEditView(assetEditPanel, asset);
    // Mount to the editor root so the panel sits above the page but inside
    // the editor's own stacking context — same surface that hosts the
    // banner, inspector, layers panel, etc.
    root.appendChild(assetEditPanel);
    attachAssetEditMessageListener();
    // Callers that mean "edit this now" (image minidock Smart Edit button)
    // can ask the panel to skip the idle gate and run the analyze step
    // immediately. Layers-panel clicks leave this off so the user picks
    // Smart edit / Show in page themselves.
    if (autoAnalyze) {
      setTimeout(triggerAnalyze, 30);
    }
  }

  function exitAssetEdit() {
    detachAssetEditMessageListener();
    if (assetEditPanel) {
      assetEditPanel.remove();
      assetEditPanel = null;
    }
    assetEditTarget = null;
    assetEditState = null;
    assetEditSmartContainer = null;
    assetEditShowInPage = null;
  }

  function attachAssetEditMessageListener() {
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.onMessage) return;
    detachAssetEditMessageListener();
    assetEditMsgListener = function(msg) {
      if (!msg || !assetEditPanel) return;
      if (msg.action === 'promptReady') {
        assetEditState.phase = 'ready';
        assetEditState.json = msg.structuredJson || { style: 'photorealistic', aspectRatio: '1:1' };
        assetEditState.prompt = msg.prompt || '';
        assetEditState.provider = msg.provider || 'gemini';
        renderSmartSection();
      } else if (msg.action === 'promptError') {
        assetEditState.phase = 'error';
        assetEditState.err = msg.error || 'Failed to analyze image.';
        renderSmartSection();
      } else if (msg.action === 'imageGenerated') {
        assetEditState.phase = 'done';
        assetEditState.resultUrl = msg.dataUrl || '';
        renderSmartSection();
      } else if (msg.action === 'imageGenError') {
        assetEditState.phase = 'gen-error';
        assetEditState.err = msg.error || 'Image generation failed.';
        renderSmartSection();
      }
    };
    chrome.runtime.onMessage.addListener(assetEditMsgListener);
  }

  function detachAssetEditMessageListener() {
    if (assetEditMsgListener && typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
      try { chrome.runtime.onMessage.removeListener(assetEditMsgListener); } catch (e) {}
    }
    assetEditMsgListener = null;
  }

  function isCanvasMode() {
    return typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage;
  }

  function submitCanvas(msg, ta) {
    var opt = hostWin && hostWin.__uncraftMountOptions;
    var boardId = (opt && opt.boardId) || null;
    var assetId = assetEditTarget && assetEditTarget.id;
    if (!boardId || !assetId) {
      assetEditState.phase = 'gen-error';
      assetEditState.err = 'Smart Edit needs an asset record (only works on AI-generated images for now).';
      renderSmartSection();
      return;
    }
    assetEditState.phase = 'generating';
    assetEditState.err = null;
    assetEditState.result = null;
    assetEditRunIdRef.current = null;
    renderSmartSection();

    fetch('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        boardId: boardId,
        threadScope: 'asset',
        assetId: assetId,
        message: msg,
        tools: ['createImage', 'getNodeOutput'],
        systemPromptKey: 'EDIT_IMAGE_SYSTEM',
      }),
    }).then(consumeAssetEditSse).catch(function(err) {
      if (!assetEditState) return;
      assetEditState.phase = 'gen-error';
      assetEditState.err = String(err && err.message || err);
      renderSmartSection();
    });
  }

  function consumeAssetEditSse(res) {
    if (!res.ok) {
      return res.text().then(function(t) {
        if (!assetEditState) return;
        assetEditState.phase = 'gen-error';
        assetEditState.err = 'HTTP ' + res.status + ': ' + (t || 'request failed');
        renderSmartSection();
      });
    }
    var reader = res.body.getReader();
    var dec = new TextDecoder();
    var buf = '';
    function pump() {
      return reader.read().then(function(r) {
        if (r.done) return;
        buf += dec.decode(r.value);
        var idx;
        while ((idx = buf.indexOf('\n\n')) !== -1) {
          var block = buf.slice(0, idx); buf = buf.slice(idx + 2);
          var lines = block.split('\n');
          var ev = null, dt = null;
          for (var i = 0; i < lines.length; i++) {
            if (lines[i].indexOf('event:') === 0) ev = lines[i];
            else if (lines[i].indexOf('data:') === 0) dt = lines[i];
          }
          if (!ev || !dt) continue;
          var name = ev.slice(6).trim();
          var payload;
          try { payload = JSON.parse(dt.slice(5).trim()); } catch (e) { continue; }
          handleAssetEditSse(name, payload);
        }
        return pump();
      });
    }
    return pump();
  }

  function handleAssetEditSse(name, payload) {
    if (!assetEditState) return;
    switch (name) {
      case 'run_id':
        assetEditRunIdRef.current = payload.runId;
        break;
      case 'needs_choice':
        // Phase 4 MVP: single-choice auto-confirms. Multi-choice (Claude+auto)
        // auto-picks first as a temporary fallback — Phase 4b adds a proper
        // inline picker in the dock.
        if (Array.isArray(payload.choices) && payload.choices.length > 0) {
          fetch('/api/chat/confirm', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              runId: assetEditRunIdRef.current,
              toolCallId: payload.id,
              action: 'confirm',
              choice: payload.choices[0].id,
            }),
          });
        }
        break;
      case 'tool_status':
        if (payload.status === 'done' && payload.result && payload.result.dataUrl) {
          assetEditState.phase = 'done';
          assetEditState.result = {
            dataUrl: payload.result.dataUrl,
            assetId: payload.result.assetId,
          };
          renderSmartSection();
        } else if (payload.status === 'error') {
          assetEditState.phase = 'gen-error';
          assetEditState.err = payload.error || 'tool error';
          renderSmartSection();
        }
        break;
      case 'run_status':
        if (payload.status === 'failed' || payload.status === 'hard_limited' ||
            payload.status === 'cancelled' || payload.status === 'cancelled_softpause') {
          if (assetEditState.phase !== 'done') {
            assetEditState.phase = 'gen-error';
            assetEditState.err = payload.err || 'agent run ' + payload.status;
            renderSmartSection();
          }
        } else if (payload.status === 'completed' && assetEditState.phase === 'generating') {
          // Run completed but no createImage done event — agent talked without
          // calling the tool. Surface as soft error so user can retry.
          assetEditState.phase = 'gen-error';
          assetEditState.err = 'Agent did not generate an image. Try a more specific instruction.';
          renderSmartSection();
        }
        break;
    }
  }

  function triggerAnalyze() {
    if (!assetEditTarget) return;
    if (isCanvasMode()) {
      // Canvas skips vision pre-analysis (no extension's describeImage handler).
      // Go straight to chat-ready phase — user types instructions directly. The
      // agent has graph context via queryNodes/listAssets if it wants the
      // asset's existing meta.
      assetEditState.phase = 'ready';
      assetEditState.prompt = '';
      assetEditState.json = { canvasAssetId: assetEditTarget.id || null, source: 'canvas' };
      renderSmartSection();
      return;
    }
    var url = assetEditTarget.source_url || assetEditTarget.thumb_url;
    if (!url) {
      assetEditState.phase = 'error';
      assetEditState.err = 'No image URL to analyze.';
      renderSmartSection();
      return;
    }
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) {
      assetEditState.phase = 'error';
      assetEditState.err = 'Smart Edit needs the extension context.';
      renderSmartSection();
      return;
    }
    assetEditState.phase = 'analyzing';
    renderSmartSection();
    try { chrome.runtime.sendMessage({ action: 'describeImage', imageUrl: url }); } catch (e) {}
  }

  function triggerGenerate() {
    if (!assetEditTarget || !assetEditState || !assetEditState.json) return;
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) return;
    var combined = (assetEditState.prompt || '') + '\n\n' + JSON.stringify(assetEditState.json, null, 2);
    assetEditState.phase = 'generating';
    renderSmartSection();
    try {
      chrome.runtime.sendMessage({
        action: 'generateImage',
        prompt: combined,
        // No provider picker in the panel — let background pick the default.
        imageProvider: assetEditState.provider || 'gemini'
      });
    } catch (e) {}
  }

  // Renders the Smart Edit section based on current phase. Replaces the
  // body of assetEditSmartContainer so we can transition idle → analyzing
  // → ready (editor) → generating → done (result) without re-rendering
  // the rest of the panel (header, preview, meta).
  function renderSmartSection() {
    var c = assetEditSmartContainer;
    if (!c || !assetEditState) return;
    c.innerHTML = '';
    var phase = assetEditState.phase;

    if (phase === 'idle') {
      var row = mk('div', 'rb-ed-asset-smart-cta-row');

      var smartBtn = mk('button', 'rb-ed-asset-smart-cta');
      smartBtn.type = 'button';
      smartBtn.innerHTML = '<svg viewBox="0 0 37 40" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M16,29.7c0,.8-.6,1.4-1.3,1.5-1,0-2.7.5-3.2,1.1-.6.6-1,2.3-1.1,3.2,0,.8-.7,1.3-1.5,1.3s-1.4-.6-1.5-1.3c0-1-.5-2.7-1.1-3.2-.6-.6-2.3-1-3.2-1.1-.8,0-1.3-.7-1.3-1.5s.6-1.4,1.3-1.5c1,0,2.7-.5,3.2-1.1.6-.6,1-2.3,1.1-3.2,0-.8.7-1.3,1.5-1.3s1.4.6,1.5,1.3c0,1,.5,2.7,1.1,3.2.6.6,2.3,1,3.2,1.1.8,0,1.3.7,1.3,1.5ZM33.3,16.7c-1.5-.2-5.8-1-7.5-2.7-1.7-1.7-2.5-6-2.7-7.5,0-.8-.7-1.3-1.5-1.3s-1.4.6-1.5,1.3c-.2,1.5-1,5.8-2.7,7.5s-6,2.5-7.5,2.7c-.8,0-1.3.7-1.3,1.5s.6,1.4,1.3,1.5c1.5.2,5.8,1,7.5,2.7s2.5,6,2.7,7.5c0,.8.7,1.3,1.5,1.3s1.4-.6,1.5-1.3c.2-1.5,1-5.8,2.7-7.5,1.7-1.7,6-2.5,7.5-2.7.8,0,1.3-.7,1.3-1.5s-.6-1.4-1.3-1.5Z"/></svg><span>Smart edit</span>';
      smartBtn.addEventListener('mousedown', function(e) {
        e.preventDefault();
        e.stopImmediatePropagation();
        triggerAnalyze();
      }, { capture: true });
      row.appendChild(smartBtn);

      if (assetEditShowInPage) {
        var showBtn = mk('button', 'rb-ed-asset-smart-cta rb-ed-asset-smart-cta-secondary');
        showBtn.type = 'button';
        showBtn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg><span>Show in page</span>';
        showBtn.addEventListener('mousedown', function(e) {
          e.preventDefault();
          e.stopImmediatePropagation();
          var handler = assetEditShowInPage;
          exitAssetEdit();
          if (handler) handler();
        }, { capture: true });
        row.appendChild(showBtn);
      }

      c.appendChild(row);
      return;
    }

    if (phase === 'analyzing') {
      var st = mk('div', 'rb-ed-asset-smart-status');
      st.innerHTML = '<span class="rb-ed-asset-smart-spinner"></span><span>Analyzing image…</span>';
      c.appendChild(st);
      return;
    }

    if (phase === 'error') {
      var er = mk('div', 'rb-ed-asset-smart-error');
      er.textContent = assetEditState.err || 'Something went wrong.';
      c.appendChild(er);
      var retry = mk('button', 'rb-ed-asset-smart-retry');
      retry.type = 'button';
      retry.textContent = 'Try again';
      retry.addEventListener('mousedown', function(e) {
        e.preventDefault();
        e.stopImmediatePropagation();
        assetEditState.phase = 'idle';
        renderSmartSection();
      }, { capture: true });
      c.appendChild(retry);
      return;
    }

    if (phase === 'ready' || phase === 'generating' || phase === 'done' || phase === 'gen-error') {
      // Section title + tooltip
      var title = mk('div', 'rb-ed-asset-smart-title');
      title.textContent = 'Edit Live';
      c.appendChild(title);
      var tip = mk('div', 'rb-ed-asset-smart-tip');
      tip.textContent = 'write over each value';
      c.appendChild(tip);

      // JSON editor — categorized pills
      var editor = mk('div', 'rb-ed-asset-smart-editor');
      renderJsonEditor(editor, assetEditState.json);
      c.appendChild(editor);

      // Actions — Copy prompt (compact, right-aligned) above the
      // full-width Generate pill. Generate gates on assetEditState.dirty
      // so the user has to actually edit at least one pill before firing
      // a generation; on first analyze, no edits = no generation.
      var actions = mk('div', 'rb-ed-asset-smart-actions');
      var copyBtn = mk('button', 'rb-ed-asset-smart-copy');
      copyBtn.type = 'button';
      copyBtn.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg><span>Copy prompt</span>';
      copyBtn.title = 'Copy prompt + JSON';
      copyBtn.addEventListener('mousedown', function(e) {
        e.preventDefault();
        e.stopImmediatePropagation();
        var combined = (assetEditState.prompt || '') + '\n\n' + JSON.stringify(assetEditState.json, null, 2);
        try {
          navigator.clipboard.writeText(combined).then(function() {
            var orig = copyBtn.innerHTML;
            copyBtn.innerHTML = '<span>Copied!</span>';
            setTimeout(function() { copyBtn.innerHTML = orig; }, 1400);
          }).catch(function() {});
        } catch (e2) {}
      }, { capture: true });
      actions.appendChild(copyBtn);

      var genBtn = mk('button', 'rb-ed-asset-smart-gen rb-ed-asset-smart-gen-block');
      genBtn.type = 'button';
      var isGenerating = phase === 'generating';
      var canGenerate = !!assetEditState.dirty;
      if (isGenerating) {
        genBtn.innerHTML = '<span class="rb-ed-asset-smart-spinner rb-ed-asset-smart-spinner-light"></span><span>Generating…</span>';
        genBtn.disabled = true;
      } else if (!canGenerate) {
        genBtn.innerHTML = '<span>Generate</span>';
        genBtn.disabled = true;
        genBtn.title = 'Edit at least one variable to enable generation';
      } else {
        genBtn.innerHTML = '<span>Generate</span><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>';
        genBtn.addEventListener('mousedown', function(e) {
          e.preventDefault();
          e.stopImmediatePropagation();
          triggerGenerate();
        }, { capture: true });
      }
      actions.appendChild(genBtn);
      c.appendChild(actions);

      // Generation result / error
      if (phase === 'done' && assetEditState.resultUrl) {
        var result = mk('div', 'rb-ed-asset-smart-result');
        var img = mk('img');
        img.src = assetEditState.resultUrl;
        img.alt = 'Generated';
        result.appendChild(img);
        c.appendChild(result);

        var resActions = mk('div', 'rb-ed-asset-smart-result-actions');
        var dlBtn = mk('button', 'rb-ed-asset-smart-pill');
        dlBtn.type = 'button';
        dlBtn.textContent = 'Download';
        dlBtn.addEventListener('mousedown', function(e) {
          e.preventDefault();
          e.stopImmediatePropagation();
          var a = hostDoc.createElement('a');
          a.href = assetEditState.resultUrl;
          a.download = 'uncraft-generated.png';
          a.click();
        }, { capture: true });
        resActions.appendChild(dlBtn);

        var againBtn = mk('button', 'rb-ed-asset-smart-pill');
        againBtn.type = 'button';
        againBtn.textContent = 'Generate again';
        againBtn.addEventListener('mousedown', function(e) {
          e.preventDefault();
          e.stopImmediatePropagation();
          triggerGenerate();
        }, { capture: true });
        resActions.appendChild(againBtn);
        c.appendChild(resActions);
      }

      if (phase === 'done' && assetEditState.result && assetEditState.result.dataUrl) {
        var imgWrap = mk('div', 'rb-ed-asset-smart-result');
        var imgCanvas = mk('img', 'rb-ed-asset-smart-result-img');
        imgCanvas.src = assetEditState.result.dataUrl;
        imgWrap.appendChild(imgCanvas);

        var canvasActions = mk('div', 'rb-ed-asset-smart-result-canvas-actions');
        var againBtnCanvas = mk('button', 'rb-ed-asset-smart-result-btn');
        againBtnCanvas.type = 'button';
        againBtnCanvas.textContent = 'Generate another';
        againBtnCanvas.addEventListener('mousedown', function(e) {
          e.preventDefault();
          e.stopImmediatePropagation();
          assetEditState.phase = 'ready';
          assetEditState.result = null;
          renderSmartSection();
        }, { capture: true });
        canvasActions.appendChild(againBtnCanvas);
        imgWrap.appendChild(canvasActions);

        c.appendChild(imgWrap);
      }

      if (phase === 'gen-error') {
        var ge = mk('div', 'rb-ed-asset-smart-error');
        ge.textContent = assetEditState.err || 'Generation failed.';
        c.appendChild(ge);
      }
    }
  }

  // Model picker — mirrors the canvas PromptDock options + storage key so
  // the selection follows the user across surfaces. Persistence falls back
  // gracefully when localStorage isn't writable (private browsing).
  var ASSET_EDIT_MODELS = [
    { id: 'gemini-3.1-pro',  name: 'Gemini 3.1 Pro',  provider: 'google' },
    { id: 'gpt-5.5',         name: 'GPT-5.5',         provider: 'openai' },
    { id: 'claude-4.6-opus', name: 'Claude 4.6 Opus', provider: 'anthropic' },
    { id: 'kimi-k2.6',       name: 'Kimi K2.6',       provider: 'kimi' }
  ];
  var ASSET_EDIT_MODEL_KEY = 'uncraft-model';
  var ASSET_EDIT_DEFAULT_MODEL = 'gpt-5.5';
  function getAssetEditModelId() {
    try {
      var saved = localStorage.getItem(ASSET_EDIT_MODEL_KEY);
      if (saved && ASSET_EDIT_MODELS.some(function(m) { return m.id === saved; })) return saved;
    } catch (e) {}
    return ASSET_EDIT_DEFAULT_MODEL;
  }
  function setAssetEditModelId(id) {
    try { localStorage.setItem(ASSET_EDIT_MODEL_KEY, id); } catch (e) {}
  }
  function findAssetEditModel(id) {
    return ASSET_EDIT_MODELS.find(function(m) { return m.id === id; }) || ASSET_EDIT_MODELS[0];
  }

  // Pinned chat dock at the bottom of the floating panel. Textarea + model
  // picker + send. Pressing Enter (without shift) or clicking send merges
  // the user's instruction with the current JSON state and dispatches a
  // generate call, same path as the inline Generate button.
  function buildAssetChatDock() {
    var dock = mk('div', 'rb-ed-asset-edit-chat');

    var ta = mk('textarea', 'rb-ed-asset-chat-ta');
    ta.placeholder = 'Tell the AI how to change this image…';
    ta.rows = 1;
    ta.addEventListener('input', function() {
      ta.style.height = 'auto';
      ta.style.height = Math.min(ta.scrollHeight, 200) + 'px';
    });

    var actions = mk('div', 'rb-ed-asset-chat-actions');

    // Model picker
    var modelBtn = mk('button', 'rb-ed-asset-chat-model');
    modelBtn.type = 'button';
    var modelIcon = mk('span', 'rb-ed-asset-chat-model-icon');
    var modelName = mk('span', 'rb-ed-asset-chat-model-name');
    var modelChev = hostDoc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    modelChev.setAttribute('class', 'rb-ed-asset-chat-model-chev');
    modelChev.setAttribute('viewBox', '0 0 24 24');
    modelChev.setAttribute('width', '10');
    modelChev.setAttribute('height', '10');
    modelChev.setAttribute('fill', 'none');
    modelChev.setAttribute('stroke', 'currentColor');
    modelChev.setAttribute('stroke-width', '2');
    modelChev.innerHTML = '<path d="M6 9l6 6 6-6"/>';
    modelBtn.appendChild(modelIcon);
    modelBtn.appendChild(modelName);
    modelBtn.appendChild(modelChev);
    function refreshModelLabel() {
      var m = findAssetEditModel(getAssetEditModelId());
      modelName.textContent = m.name;
      modelIcon.textContent = m.provider === 'google' ? 'G'
        : m.provider === 'openai' ? 'O'
        : m.provider === 'anthropic' ? 'A'
        : m.provider === 'kimi' ? 'K' : '·';
    }
    refreshModelLabel();
    modelBtn.addEventListener('mousedown', function(e) {
      e.preventDefault();
      e.stopImmediatePropagation();
      openAssetEditModelMenu(modelBtn, function(id) {
        setAssetEditModelId(id);
        refreshModelLabel();
      });
    }, { capture: true });
    actions.appendChild(modelBtn);

    // Mic button (speech-to-text) — sits LEFT of the send arrow. Records
    // via MediaRecorder, transcribes through POST /api/transcribe (OpenAI
    // Whisper, server-side key). Canvas mode fetches same-origin; extension
    // mode rides bgFetch → background.js → web-shell with the cookie jar,
    // so no per-user key is needed (same posture as the assets save flow).
    var MIC_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><path d="M12 19v3"/></svg>';
    var MIC_STOP_SVG = '<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="1.5"/></svg>';
    var MIC_SPIN_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="12" cy="12" r="9" opacity="0.25"/><path d="M21 12a9 9 0 0 1-9 9"/></svg>';
    var micBtn = mk('button', 'rb-ed-asset-chat-mic');
    micBtn.type = 'button';
    var micPhase = 'idle'; // idle | rec | busy | error
    var micRec = null, micStream = null, micChunks = [], micErrTimer = null, micStopTimer = null;
    function micSetPhase(p, errMsg) {
      micPhase = p;
      micBtn.classList.toggle('rec', p === 'rec');
      micBtn.classList.toggle('busy', p === 'busy');
      micBtn.classList.toggle('err', p === 'error');
      micBtn.innerHTML = p === 'busy' ? MIC_SPIN_SVG : (p === 'rec' ? MIC_STOP_SVG : MIC_SVG);
      micBtn.title = p === 'rec' ? 'Stop recording'
        : p === 'busy' ? 'Transcribing…'
        : p === 'error' ? (errMsg || 'Dictation failed')
        : 'Dictate (speech to text)';
    }
    micSetPhase('idle');
    function micStopTracks() {
      if (micStream) { try { micStream.getTracks().forEach(function(t) { t.stop(); }); } catch (e) {} micStream = null; }
      if (micStopTimer) { clearTimeout(micStopTimer); micStopTimer = null; }
    }
    function micFail(msg) {
      micStopTracks();
      micRec = null;
      micSetPhase('error', msg);
      if (micErrTimer) clearTimeout(micErrTimer);
      micErrTimer = setTimeout(function() { micSetPhase('idle'); }, 2500);
    }
    function micTranscribe(dataUrl) {
      getWebShellOrigin().then(function(origin) {
        if (!origin) { micFail('Open the Uncraft canvas once to enable dictation'); return; }
        bgFetch(origin + '/api/transcribe', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ audioDataUrl: dataUrl })
        }).then(function(resp) {
          if (!resp || !resp.ok) {
            var msg = (resp && resp.data && resp.data.error)
              || (resp && resp.status === 401 ? 'Sign in to Uncraft to use dictation' : 'Transcription failed');
            micFail(msg);
            return;
          }
          var spoken = resp.data && resp.data.text;
          if (spoken) {
            ta.value = ta.value ? (ta.value.replace(/\s+$/, '') + ' ' + spoken) : spoken;
            try { ta.dispatchEvent(new Event('input')); } catch (e) {} // re-run autosize
            try { ta.focus(); } catch (e) {}
          }
          micSetPhase('idle');
        });
      });
    }
    function micToggle() {
      if (micPhase === 'busy') return;
      if (micRec) { try { micRec.stop(); } catch (e) { micFail('Recorder error'); } return; }
      var nav = (hostWin && hostWin.navigator) || navigator;
      var MR = (hostWin && hostWin.MediaRecorder) || (typeof MediaRecorder !== 'undefined' ? MediaRecorder : null);
      if (!MR || !nav.mediaDevices || !nav.mediaDevices.getUserMedia) { micFail('Microphone not available here'); return; }
      nav.mediaDevices.getUserMedia({ audio: true }).then(function(stream) {
        micStream = stream;
        var mime = '';
        try {
          mime = MR.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus'
            : (MR.isTypeSupported('audio/webm') ? 'audio/webm' : '');
        } catch (e) {}
        var rec;
        try { rec = mime ? new MR(stream, { mimeType: mime }) : new MR(stream); }
        catch (e) { micFail('Recorder error'); return; }
        micChunks = [];
        rec.ondataavailable = function(ev) { if (ev.data && ev.data.size) micChunks.push(ev.data); };
        rec.onerror = function() { micFail('Recorder error'); };
        rec.onstop = function() {
          micStopTracks();
          micRec = null;
          var blob = new Blob(micChunks, { type: rec.mimeType || 'audio/webm' });
          micChunks = [];
          if (!blob.size) { micSetPhase('idle'); return; }
          micSetPhase('busy');
          var reader = new FileReader();
          reader.onload = function() { micTranscribe(reader.result); };
          reader.onerror = function() { micFail('Could not read recording'); };
          reader.readAsDataURL(blob);
        };
        try { rec.start(); } catch (e) { micFail('Recorder error'); return; }
        micRec = rec;
        micSetPhase('rec');
        // Auto-stop guard — keeps payloads well under the API body cap.
        micStopTimer = setTimeout(function() {
          try { if (rec.state === 'recording') rec.stop(); } catch (e) {}
        }, 120000);
      }).catch(function() {
        micFail('Microphone permission denied');
      });
    }
    micBtn.addEventListener('mousedown', function(e) {
      e.preventDefault();
      e.stopImmediatePropagation();
      micToggle();
    }, { capture: true });
    actions.appendChild(micBtn);

    // Send button (arrow-up)
    var sendBtn = mk('button', 'rb-ed-asset-chat-send');
    sendBtn.type = 'button';
    sendBtn.title = 'Send';
    sendBtn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></svg>';

    function submit() {
      var msg = ta.value.trim();
      if (!msg) return;
      if (!assetEditState) return;
      ta.value = '';
      ta.style.height = 'auto';

      if (isCanvasMode()) {
        submitCanvas(msg, ta);
        return;
      }

      // Extension path (unchanged)
      if (!assetEditState.json) return;
      var combined = (assetEditState.prompt || '') + '\n\n' +
                     JSON.stringify(assetEditState.json, null, 2) +
                     '\n\nUser instruction: ' + msg;
      assetEditState.phase = 'generating';
      renderSmartSection();
      try {
        chrome.runtime.sendMessage({
          action: 'generateImage',
          prompt: combined,
          imageProvider: assetEditState.provider || 'gemini'
        });
      } catch (e) {}
    }

    ta.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        submit();
      }
    });
    sendBtn.addEventListener('mousedown', function(e) {
      e.preventDefault();
      e.stopImmediatePropagation();
      submit();
    }, { capture: true });

    actions.appendChild(sendBtn);
    dock.appendChild(ta);
    dock.appendChild(actions);
    return dock;
  }

  function openAssetEditModelMenu(anchor, onPick) {
    var existing = hostDoc.querySelector('.rb-ed-asset-chat-model-menu');
    if (existing) { existing.remove(); return; }
    var menu = mk('div', 'rb-ed-asset-chat-model-menu');
    var current = getAssetEditModelId();
    ASSET_EDIT_MODELS.forEach(function(m) {
      var opt = mk('button', 'rb-ed-asset-chat-model-opt');
      opt.type = 'button';
      var sel = m.id === current;
      var lbl = mk('span'); lbl.textContent = m.name; opt.appendChild(lbl);
      if (sel) {
        var tick = mk('span', 'rb-ed-asset-chat-model-tick');
        tick.textContent = '✓';
        opt.appendChild(tick);
      }
      opt.addEventListener('mousedown', function(e) {
        e.preventDefault();
        e.stopImmediatePropagation();
        menu.remove();
        onPick(m.id);
      }, { capture: true });
      menu.appendChild(opt);
    });
    hostDoc.body.appendChild(menu);
    var r = anchor.getBoundingClientRect();
    var mw = menu.offsetWidth || 200;
    var mh = menu.offsetHeight || 160;
    menu.style.left = Math.max(8, Math.min(window.innerWidth - 8 - mw, r.left)) + 'px';
    menu.style.top = Math.max(8, r.top - mh - 6) + 'px';
    setTimeout(function() {
      function close(e) {
        if (!menu.contains(e.target) && e.target !== anchor && !anchor.contains(e.target)) {
          menu.remove();
          hostDoc.removeEventListener('mousedown', close, true);
        }
      }
      hostDoc.addEventListener('mousedown', close, true);
    }, 50);
  }

  // Renders a categorized pill editor for an object structured as
  // { category: { field: value|array }, ... }. Editing a pill writes
  // back to the source object so subsequent generate() picks up edits.
  function renderJsonEditor(parent, jsonData) {
    var CATEGORY_LABELS = {
      subject: 'Subject', environment: 'Environment', style: 'Style',
      color: 'Color', mood: 'Mood', camera: 'Camera',
      lighting: 'Lighting', technical: 'Technical'
    };
    function humanize(k) {
      return String(k || '').replace(/([A-Z])/g, ' $1').replace(/^./, function(s) { return s.toUpperCase(); });
    }
    function makePill(catKey, fieldKey, idx, value) {
      // wrap holds both the pill and (when editing) the black editor that
      // 'embraces' it with a text input above.
      var wrap = mk('span', 'rb-ed-asset-json-pill-wrap');
      var pill = mk('span', 'rb-ed-asset-json-pill');
      pill.textContent = String(value);
      var isColor = /^#[0-9a-fA-F]{3,8}$/.test(String(value));
      if (isColor) {
        pill.classList.add('rb-ed-asset-color-pill');
        pill.style.setProperty('--rb-swatch-color', String(value));
      }
      pill.addEventListener('mousedown', function(e) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (wrap.classList.contains('rb-ed-pill-editing')) return;
        openPillEditor(wrap, pill, catKey, fieldKey, idx, jsonData);
      }, { capture: true });
      wrap.appendChild(pill);
      return wrap;
    }
    function appendField(parentEl, catKey, fieldKey, fieldVal) {
      var row = mk('div', 'rb-ed-asset-json-field');
      var k = mk('div', 'rb-ed-asset-json-key');
      k.textContent = humanize(fieldKey);
      row.appendChild(k);
      var vals = mk('div', 'rb-ed-asset-json-values');
      if (Array.isArray(fieldVal)) {
        fieldVal.forEach(function(item, i) {
          vals.appendChild(makePill(catKey, fieldKey, i, item));
        });
      } else {
        vals.appendChild(makePill(catKey, fieldKey, null, fieldVal));
      }
      row.appendChild(vals);
      parentEl.appendChild(row);
    }
    Object.keys(jsonData).forEach(function(catKey) {
      var catVal = jsonData[catKey];
      if (catVal !== null && typeof catVal === 'object' && !Array.isArray(catVal)) {
        var cat = mk('div', 'rb-ed-asset-json-category');
        var ct = mk('div', 'rb-ed-asset-json-cat-title');
        ct.textContent = CATEGORY_LABELS[catKey] || humanize(catKey);
        cat.appendChild(ct);
        var fields = mk('div', 'rb-ed-asset-json-cat-fields');
        Object.keys(catVal).forEach(function(fk) {
          appendField(fields, catKey, fk, catVal[fk]);
        });
        cat.appendChild(fields);
        parent.appendChild(cat);
      } else {
        // Flat field
        appendField(parent, null, catKey, catVal);
      }
    });
  }

  // Opens the inline pill editor: a black container that envelops the pill
  // and renders a text input above it with a white checkmark confirm
  // button. Enter / checkmark commit; ESC / outside-click cancel and the
  // original value stays.
  function openPillEditor(wrap, pill, catKey, fieldKey, idx, jsonData) {
    closeOpenPillEditor();
    wrap.classList.add('rb-ed-pill-editing');

    var originalValue = pill.textContent;

    var editor = mk('div', 'rb-ed-pill-editor');
    var row = mk('div', 'rb-ed-pill-editor-row');
    var input = mk('input', 'rb-ed-pill-editor-input');
    input.type = 'text';
    input.value = originalValue;

    var confirmBtn = mk('button', 'rb-ed-pill-editor-confirm');
    confirmBtn.type = 'button';
    confirmBtn.title = 'Confirm';
    confirmBtn.innerHTML = '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';

    var closed = false;
    function teardown() {
      if (closed) return;
      closed = true;
      wrap.classList.remove('rb-ed-pill-editing');
      if (editor.parentNode) editor.parentNode.removeChild(editor);
      if (outsideHandler) {
        try { hostDoc.removeEventListener('mousedown', outsideHandler, true); } catch (e) {}
        outsideHandler = null;
      }
    }
    function commit() {
      var newVal = input.value.trim();
      var changed = newVal !== originalValue;
      var target = catKey && jsonData[catKey] ? jsonData[catKey] : jsonData;
      if (idx !== null && idx !== undefined) {
        if (Array.isArray(target[fieldKey])) target[fieldKey][idx] = newVal;
      } else {
        target[fieldKey] = newVal;
      }
      pill.textContent = newVal;
      if (pill.classList.contains('rb-ed-asset-color-pill') && /^#[0-9a-fA-F]{3,8}$/.test(newVal)) {
        pill.style.setProperty('--rb-swatch-color', newVal);
      }
      teardown();
      // Mark dirty + re-render so the Generate button unlocks. Re-render
      // also rebuilds the categorized editor from the (now mutated)
      // assetEditState.json — the new pill carries the new value.
      if (changed && assetEditState) {
        assetEditState.dirty = true;
        renderSmartSection();
      }
    }
    function cancel() { teardown(); }

    confirmBtn.addEventListener('mousedown', function(e) {
      e.preventDefault();
      e.stopImmediatePropagation();
      commit();
    }, { capture: true });
    input.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    });
    input.addEventListener('mousedown', function(e) {
      // Block selection / drag handlers above while the input is focused.
      e.stopImmediatePropagation();
    }, { capture: true });

    row.appendChild(input);
    row.appendChild(confirmBtn);
    editor.appendChild(row);
    // Editor sits BEFORE the pill so the input renders above it inside the
    // shared black wrapper (CSS handles the visual envelope).
    wrap.insertBefore(editor, pill);

    setTimeout(function() {
      input.focus();
      input.select();
    }, 0);

    // Cancel on outside click (anywhere not inside this wrap).
    var outsideHandler = function(e) {
      if (!wrap.contains(e.target)) cancel();
    };
    setTimeout(function() {
      if (!closed) hostDoc.addEventListener('mousedown', outsideHandler, true);
    }, 80);

    // Park a reference so a sibling open will close this one first.
    _openPillEditor = { teardown: teardown };
  }
  var _openPillEditor = null;
  function closeOpenPillEditor() {
    if (_openPillEditor && _openPillEditor.teardown) {
      _openPillEditor.teardown();
      _openPillEditor = null;
    }
  }

  // Right-click context menu for asset thumbs. Exposes "Edit" (opens the
  // smart-edit floating panel) and optionally "Show in page" (selects the
  // matching DOM element + image minidock). Show-in-page is omitted when
  // no page handler is given (e.g. for persisted assets whose source URL
  // isn't this page).
  function showAssetContextMenu(ev, asset, onShowInPage) {
    closeAssetContextMenu();
    var menu = mk('div', 'rb-ed-assets-ctx');
    function addOpt(label, handler) {
      var btn = mk('button', 'rb-ed-assets-ctx-opt');
      btn.type = 'button';
      btn.textContent = label;
      btn.addEventListener('mousedown', function(e) {
        e.preventDefault();
        e.stopImmediatePropagation();
        closeAssetContextMenu();
        handler();
      }, { capture: true });
      menu.appendChild(btn);
    }
    addOpt('Edit', function() { enterAssetEdit(asset, onShowInPage); });
    if (typeof onShowInPage === 'function') {
      addOpt('Show in page', onShowInPage);
    }
    hostDoc.body.appendChild(menu);
    var mw = menu.offsetWidth || 160;
    var mh = menu.offsetHeight || 64;
    var x = Math.max(8, Math.min(window.innerWidth - 8 - mw, ev.clientX));
    var y = Math.max(8, Math.min(window.innerHeight - 8 - mh, ev.clientY));
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    setTimeout(function() {
      function close(e) {
        if (!menu.contains(e.target)) {
          closeAssetContextMenu();
          hostDoc.removeEventListener('mousedown', close, true);
        }
      }
      hostDoc.addEventListener('mousedown', close, true);
    }, 50);
  }
  function closeAssetContextMenu() {
    var existing = hostDoc.querySelectorAll('.rb-ed-assets-ctx');
    existing.forEach(function(n) { n.remove(); });
  }

  function mountScopePicker(header, body) {
    var scopeBtn = mk('button', 'rb-ed-assets-scope');
    scopeBtn.type = 'button';
    var label = mk('span', 'rb-ed-assets-scope-label');
    label.textContent = scopeLabel();
    var chev = hostDoc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    chev.setAttribute('viewBox', '0 0 24 24');
    chev.setAttribute('width', '9');
    chev.setAttribute('height', '9');
    chev.setAttribute('fill', 'none');
    chev.setAttribute('stroke', 'currentColor');
    chev.setAttribute('stroke-width', '2');
    chev.innerHTML = '<path d="M6 9l6 6 6-6"/>';
    scopeBtn.appendChild(label);
    scopeBtn.appendChild(chev);
    header.insertBefore(scopeBtn, header.firstChild);
    scopeBtn.addEventListener('mousedown', function(e) {
      e.stopImmediatePropagation();
      openScopePicker(scopeBtn, function(newScope) {
        if (newScope === assetsScopeState.kind) return;
        assetsScopeState.kind = newScope;
        label.textContent = scopeLabel();
        assetsGen++;
        renderUserCollectedBody(body, assetsGen);
      });
    }, { capture: true, signal: sig });
  }

  function scopeLabel() {
    return assetsScopeState.kind === 'project' ? 'Project' : 'Global';
  }

  function openScopePicker(anchorBtn, onPick) {
    var existing = hostDoc.querySelector('.rb-ed-assets-scope-menu');
    if (existing) { existing.remove(); return; }
    var menu = mk('div', 'rb-ed-assets-scope-menu');
    function makeOpt(labelText, value) {
      var btn = mk('button', 'rb-ed-assets-scope-opt');
      btn.type = 'button';
      var sel = assetsScopeState.kind === value;
      var lbl = mk('span'); lbl.textContent = labelText; btn.appendChild(lbl);
      if (sel) {
        var tick = mk('span', 'rb-ed-assets-scope-tick');
        tick.textContent = '✓';
        btn.appendChild(tick);
      }
      btn.addEventListener('mousedown', function(e) {
        e.stopImmediatePropagation();
        menu.remove();
        onPick(value);
      }, { capture: true });
      return btn;
    }
    menu.appendChild(makeOpt('Global collection', 'library'));
    menu.appendChild(makeOpt('Project collection', 'project'));
    hostDoc.body.appendChild(menu);
    var r = anchorBtn.getBoundingClientRect();
    var mw = menu.offsetWidth || 180;
    menu.style.top = (r.bottom + 4) + 'px';
    menu.style.left = Math.max(8, Math.min(window.innerWidth - 8 - mw, r.right - mw)) + 'px';
    setTimeout(function() {
      function close(e) {
        if (!menu.contains(e.target) && e.target !== anchorBtn && !anchorBtn.contains(e.target)) {
          menu.remove();
          hostDoc.removeEventListener('mousedown', close, true);
        }
      }
      hostDoc.addEventListener('mousedown', close, true);
    }, 50);
  }

  function renderUserCollectedBody(body, gen) {
    body.innerHTML = '';
    var loading = mk('div', 'rb-ed-assets-status');
    loading.textContent = 'Loading…';
    body.appendChild(loading);
    fetchUserAssets(assetsScopeState.kind).then(function(result) {
      // Bail if the user has rebuilt the assets tab (scope change, tab
      // re-open) while our fetch was in flight.
      if (gen !== assetsGen) return;
      if (!body.isConnected) return;
      body.innerHTML = '';
      if (result.error === 'no-origin') {
        body.appendChild(statusMsg("Couldn't reach Uncraft."));
        return;
      }
      if (result.error === 'unauthorized') {
        body.appendChild(signInPrompt());
        return;
      }
      if (result.error === 'no-board') {
        body.appendChild(statusMsg('Open this editor from a project node to see project assets.'));
        return;
      }
      if (result.error) {
        body.appendChild(statusMsg("Couldn't load assets."));
        return;
      }
      var assets = (result.assets || []).filter(function(a) { return a && a.type; });
      if (assets.length === 0) {
        body.appendChild(statusMsg(assetsScopeState.kind === 'project'
          ? 'No assets in this project yet.'
          : 'No assets collected yet. Use the Uncraft widget to collect.'));
        return;
      }
      renderPersistedAssetGrid(body, assets);
    });
  }

  function statusMsg(text) {
    var d = mk('div', 'rb-ed-assets-status');
    d.textContent = text;
    return d;
  }

  function signInPrompt() {
    var wrap = mk('div', 'rb-ed-assets-status');
    wrap.style.lineHeight = '1.5';
    wrap.appendChild(hostDoc.createTextNode('Sign in to see your collected assets.'));
    wrap.appendChild(mk('br'));
    wrap.appendChild(mk('br'));
    var link = mk('button', 'rb-ed-assets-signin');
    link.type = 'button';
    link.textContent = 'Open Uncraft';
    link.addEventListener('mousedown', function(e) {
      e.stopImmediatePropagation();
      getWebShellOrigin().then(function(o) {
        try { window.open((o || 'https://uncraft.app') + '/login', '_blank', 'noopener,noreferrer'); } catch (err) {}
      });
    }, { capture: true, signal: sig });
    wrap.appendChild(link);
    return wrap;
  }

  function fetchUserAssets(kind) {
    return getWebShellOrigin().then(function(origin) {
      if (!origin) return { error: 'no-origin' };
      var url;
      if (kind === 'project') {
        var opt = hostWin.__uncraftMountOptions;
        var boardId = (opt && opt.boardId) || null;
        if (!boardId) return { error: 'no-board' };
        url = origin + '/api/assets?scope=project&id=' + encodeURIComponent(boardId);
      } else {
        url = origin + '/api/assets?scope=library';
      }
      return bgFetch(url).then(function(resp) {
        if (!resp) return { error: 'fetch' };
        if (resp.status === 401) return { error: 'unauthorized' };
        if (!resp.ok) return { error: 'http-' + resp.status };
        return resp.data || { assets: [] };
      });
    });
  }

  function renderPersistedAssetGrid(body, assets) {
    var grid = mk('div', 'rb-ed-assets-pgrid');
    assets.slice(0, 60).forEach(function(asset) {
      var item = mk('div', 'rb-ed-assets-pitem');
      var thumb = (asset.thumb_url || asset.blob_url || asset.source_url || '').trim();
      var t = asset.type;
      if ((t === 'image' || t === 'background-image' || t === 'video') && thumb) {
        var imgEl = mk('img');
        imgEl.alt = asset.name || '';
        imgEl.loading = 'lazy';
        imgEl.style.cssText = 'width:100%;height:100%;object-fit:cover;';
        item.appendChild(imgEl);
        attachThumbFallback(imgEl, thumb);
        imgEl.src = thumb;
      } else if ((t === 'svg' || t === 'icon') && (asset.html || thumb)) {
        if (asset.html) {
          var svgWrap = mk('div', 'rb-ed-assets-pitem-svg');
          svgWrap.innerHTML = asset.html;
          var svgEl = svgWrap.querySelector('svg');
          if (svgEl) {
            svgEl.removeAttribute('width');
            svgEl.removeAttribute('height');
            svgEl.style.width = '100%';
            svgEl.style.height = '100%';
          }
          item.appendChild(svgWrap);
        } else {
          var im = mk('img');
          im.style.cssText = 'width:60%;height:60%;object-fit:contain;';
          item.appendChild(im);
          attachThumbFallback(im, thumb);
          im.src = thumb;
        }
      } else if (t === 'font') {
        var family = (asset.meta && asset.meta.family) || asset.name || 'sans-serif';
        var fontPreview = mk('div', 'rb-ed-assets-pitem-font');
        fontPreview.style.fontFamily = '"' + family.replace(/"/g, '') + '", sans-serif';
        fontPreview.textContent = 'Aa';
        item.appendChild(fontPreview);
      } else if (t === 'group' || t === 'component' || t === 'section') {
        var lbl = mk('div', 'rb-ed-assets-pitem-label');
        var cnt = (asset.meta && asset.meta.itemCount) ? ' · ' + asset.meta.itemCount : '';
        lbl.textContent = t.charAt(0).toUpperCase() + t.slice(1) + cnt;
        item.appendChild(lbl);
      } else {
        var fallback = mk('div', 'rb-ed-assets-pitem-label');
        fallback.textContent = t || '?';
        item.appendChild(fallback);
      }
      // Empty hover overlay — darkens the thumb on hover, no clickable
      // icon (left/right click is delegated to the item itself).
      var overlay = mk('div', 'rb-asset-overlay');
      item.appendChild(overlay);
      if (asset.name) item.title = asset.name;

      // Drag-to-canvas (Slice B) — only enabled in canvas-mount where the
      // host doc IS the canvas. Extension-mount has no canvas to drop on.
      if (hostWin.__uncraftZoom) {
        item.setAttribute('draggable', 'true');
        item.addEventListener('dragstart', function(e) {
          buildAssetDragData(e, asset);
        });
      }

      // Right-click context menu — Edit always; Show in page when the
      // persisted asset's source URL has a matching <img>/<video> on the
      // current page (rare but useful when collecting from a page you're
      // editing right now).
      item.addEventListener('contextmenu', function(e) {
        e.preventDefault();
        e.stopImmediatePropagation();
        var showFn = null;
        if (asset.source_url) {
          try {
            var match = targetDoc.querySelector(
              'img[src="' + asset.source_url.replace(/"/g, '\\"') + '"], ' +
              'video[src="' + asset.source_url.replace(/"/g, '\\"') + '"]'
            );
            if (match) {
              showFn = function() {
                if (isValid(match)) {
                  try { match.scrollIntoView({ behavior: 'auto', block: 'center' }); } catch (e) {}
                  selectEl(match);
                  if (match.tagName === 'IMG' || match.tagName === 'VIDEO') showImgMenu(match);
                }
              };
            }
          } catch (e2) {}
        }
        showAssetContextMenu(e, asset, showFn);
      }, { capture: true });
      grid.appendChild(item);
    });
    body.appendChild(grid);
  }

  // Renders one asset in a takeover "edit" view that occupies the whole
  // Assets tab body. Header has a back button + asset title; main area
  // shows a large preview; meta area shows type / source / added; actions
  // area is a placeholder for Slice D (Smart Remix migration).
  function renderAssetEditView(ab, asset) {
    // Header: back + title — flex-shrink:0, stays at top.
    var hd = mk('div', 'rb-ed-asset-edit-hd');
    var backBtn = mk('button', 'rb-ed-asset-edit-back');
    backBtn.type = 'button';
    backBtn.title = 'Back to Assets';
    backBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>';
    backBtn.addEventListener('mousedown', function(e) {
      e.preventDefault();
      e.stopImmediatePropagation();
      exitAssetEdit();
    }, { capture: true });
    hd.appendChild(backBtn);
    var titleEl = mk('span', 'rb-ed-asset-edit-title');
    titleEl.textContent = asset.name || 'Untitled';
    hd.appendChild(titleEl);
    ab.appendChild(hd);

    // Source hero — edge-to-edge image at the top, mirroring the widget's
    // Smart Remix layout. For non-image asset types we still use the same
    // hero box but with a centered glyph/label.
    var hero = mk('div', 'rb-ed-asset-edit-hero');
    var thumb = (asset.thumb_url || asset.blob_url || asset.source_url || '').trim();
    var t = asset.type;
    if ((t === 'image' || t === 'background-image' || t === 'video') && thumb) {
      var imgEl = mk('img');
      imgEl.alt = asset.name || '';
      imgEl.loading = 'lazy';
      hero.appendChild(imgEl);
      attachThumbFallback(imgEl, thumb);
      imgEl.src = thumb;
    } else if ((t === 'svg' || t === 'icon') && (asset.html || thumb)) {
      if (asset.html) {
        var svgWrap = mk('div', 'rb-ed-asset-edit-svg');
        svgWrap.innerHTML = asset.html;
        var svgEl = svgWrap.querySelector('svg');
        if (svgEl) {
          svgEl.removeAttribute('width');
          svgEl.removeAttribute('height');
          svgEl.style.width = '100%';
          svgEl.style.height = '100%';
        }
        hero.appendChild(svgWrap);
      } else {
        var im = mk('img');
        hero.appendChild(im);
        attachThumbFallback(im, thumb);
        im.src = thumb;
      }
    } else if (t === 'font') {
      var family = (asset.meta && asset.meta.family) || asset.name || 'sans-serif';
      var fp = mk('div', 'rb-ed-asset-edit-font');
      fp.style.fontFamily = '"' + family.replace(/"/g, '') + '", sans-serif';
      fp.textContent = 'Aa Bb Cc';
      hero.appendChild(fp);
    } else if (t === 'group' || t === 'component' || t === 'section') {
      var pl = mk('div', 'rb-ed-asset-edit-label');
      pl.textContent = t.charAt(0).toUpperCase() + t.slice(1);
      hero.appendChild(pl);
    } else {
      var pl2 = mk('div', 'rb-ed-asset-edit-label');
      pl2.textContent = t || '?';
      hero.appendChild(pl2);
    }
    ab.appendChild(hero);

    // Scrollable middle — wraps the smart-edit section so the hero above
    // and the chat dock below stay visible at all times while the editor
    // pills/result region scrolls independently.
    var scroll = mk('div', 'rb-ed-asset-edit-scroll');
    var smart = mk('div', 'rb-ed-asset-edit-actions');
    assetEditSmartContainer = smart;
    scroll.appendChild(smart);
    ab.appendChild(scroll);
    renderSmartSection();

    // Chat dock — textarea + model picker + send.
    var chat = buildAssetChatDock();
    ab.appendChild(chat);
  }

  function populatePageAssets(body) {
    // Collect <img> elements
    var imgElements = [];
    targetDoc.querySelectorAll('img').forEach(function(img) {
      if (isEditorEl(img)) return;
      var w = img.naturalWidth || img.width || 0;
      var h = img.naturalHeight || img.height || 0;
      var src = img.currentSrc || img.src || '';
      if (!src) return;
      if (imgElements.some(function(c) { return c.src === src; })) return;
      imgElements.push({src: src, w: w, h: h, alt: img.alt || '', type: 'image'});
    });

    // Collect inline SVGs (separate section)
    var svgIcons = [];
    targetDoc.querySelectorAll('svg').forEach(function(svg) {
      if (isEditorEl(svg)) return;
      var r = svg.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return;
      try {
        var clone = svg.cloneNode(true);
        if (!clone.getAttribute('xmlns')) clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        var serialized = new XMLSerializer().serializeToString(clone);
        var dataUrl = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(serialized)));
        if (svgIcons.some(function(c) { return c.src === dataUrl; })) return;
        svgIcons.push({src: dataUrl, w: r.width, h: r.height, alt: '', type: 'image', el: svg});
      } catch(e) {}
    });

    // Collect background images
    var bgImages = [];
    targetDoc.querySelectorAll('section,div,article,header,footer').forEach(function(el) {
      if (isEditorEl(el)) return;
      var bg = getCS(el).backgroundImage;
      if (bg && bg !== 'none') {
        var match = bg.match(/url\(["']?(https?:\/\/[^"')]+)["']?\)/);
        if (match && !bgImages.some(function(c) { return c.src === match[1]; }) && !imgElements.some(function(c) { return c.src === match[1]; })) {
          bgImages.push({src: match[1], w: 200, h: 200, alt: '', type: 'background', el: el});
        }
      }
    });

    imgElements.sort(function(a, b) { return (b.w * b.h) - (a.w * a.h); });

    var mutedColor = isLight() ? 'rgba(51,51,51,0.5)' : 'rgba(239,238,235,0.5)';
    var dimColor = isLight() ? 'rgba(51,51,51,0.3)' : 'rgba(239,238,235,0.3)';

    function buildAssetGrid(items, label) {
      var secLabel = mk('div');
      secLabel.style.cssText = 'padding:8px 14px 4px;font:500 11px "Instrument Sans",sans-serif;color:' + mutedColor + ';';
      secLabel.textContent = label + ' (' + items.length + ')';
      body.appendChild(secLabel);

      if (items.length === 0) {
        var empty = mk('div');
        empty.style.cssText = 'padding:2px 14px 8px;font:400 11px "Instrument Sans",sans-serif;color:' + dimColor + ';';
        empty.textContent = 'None found';
        body.appendChild(empty);
        return;
      }

      var grid = mk('div');
      grid.style.cssText = 'display:grid;grid-template-columns:repeat(3,1fr);gap:3px;padding:0 8px 8px;';
      items.slice(0, 18).forEach(function(img) {
        var item = mk('div');
        item.style.cssText = 'aspect-ratio:1;overflow:hidden;border-radius:4px;cursor:pointer;position:relative;';
        var imgEl = mk('img');
        imgEl.alt = img.alt;
        imgEl.style.cssText = 'width:100%;height:100%;object-fit:cover;';
        imgEl.loading = 'lazy';
        item.appendChild(imgEl);
        attachThumbFallback(imgEl, img.src);
        imgEl.src = img.src;

        var overlay = mk('div', 'rb-asset-overlay');
        item.appendChild(overlay);

        function showInPage() {
          if (img.type === 'image') {
            var pageImg = targetDoc.querySelector('img[src="' + img.src.replace(/"/g, '\\"') + '"]');
            if (pageImg && isValid(pageImg)) {
              // Instant scroll so showImgMenu's inView check passes and the
              // dock mounts immediately at the right coords (the default
              // smooth scroll bakes in a 400ms settle delay).
              try { pageImg.scrollIntoView({ behavior: 'auto', block: 'center' }); } catch (e) {}
              selectEl(pageImg);
              showImgMenu(pageImg);
            }
          } else if (img.el) {
            try { img.el.scrollIntoView({ behavior: 'auto', block: 'center' }); } catch (e) {}
            selectEl(img.el);
          }
        }

        // Left click → open the Smart Edit floating panel for this image.
        // Using `click` (not `mousedown`) so dragging the thumb to spawn a
        // canvas node doesn't also open the panel — browsers fire click
        // only when there was no drag.
        function resolveAssetFromThumb() {
          var pageEl = null;
          if (img.type === 'image') {
            try { pageEl = targetDoc.querySelector('img[src="' + img.src.replace(/"/g, '\\"') + '"]'); } catch (e2) {}
          } else {
            pageEl = img.el || null;
          }
          return pageEl ? assetFromElement(pageEl) : {
            type: 'image',
            name: img.alt || 'Asset', source_url: img.src, thumb_url: img.src,
            blob_url: null, html: null, css: null, meta: {}
          };
        }
        item.addEventListener('click', function(e) {
          e.stopImmediatePropagation();
          enterAssetEdit(resolveAssetFromThumb(), showInPage);
        });

        // Drag-to-canvas (Slice B) — only enabled in canvas-mount.
        if (hostWin.__uncraftZoom) {
          item.setAttribute('draggable', 'true');
          item.addEventListener('dragstart', function(e) {
            buildAssetDragData(e, resolveAssetFromThumb());
          });
        }

        // Right click → context menu (Edit / Show in page). Both options
        // route through the floating panel — Edit opens it with the
        // image hero; Show in page bypasses it.
        item.addEventListener('contextmenu', function(e) {
          e.preventDefault();
          e.stopImmediatePropagation();
          var pageEl = null;
          if (img.type === 'image') {
            try { pageEl = targetDoc.querySelector('img[src="' + img.src.replace(/"/g, '\\"') + '"]'); } catch (e2) {}
          } else {
            pageEl = img.el || null;
          }
          var asset = pageEl ? assetFromElement(pageEl) : {
            type: 'image',
            name: img.alt || 'Asset', source_url: img.src, thumb_url: img.src,
            blob_url: null, html: null, css: null, meta: {}
          };
          showAssetContextMenu(e, asset, showInPage);
        }, {capture: true});

        grid.appendChild(item);
      });
      body.appendChild(grid);
    }

    buildAssetGrid(imgElements, 'Images');

    if (svgIcons.length > 0) {
      var divider1 = mk('div');
      divider1.style.cssText = 'height:1px;background:' + (isLight() ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.06)') + ';margin:4px 14px;';
      body.appendChild(divider1);
      buildAssetGrid(svgIcons, 'Icons');
    }

    if (bgImages.length > 0) {
      var divider2 = mk('div');
      divider2.style.cssText = 'height:1px;background:' + (isLight() ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.06)') + ';margin:4px 14px;';
      body.appendChild(divider2);
      buildAssetGrid(bgImages, 'Backgrounds');
    }
  }

  function populateSections() {
    var sb = hostDoc.getElementById('rb-ed-sections-body');
    if (!sb) return;
    sb.innerHTML = '';
    var sections = getSections();
    sections.forEach(function(el) {
      var card = buildSectionThumb(el);
      if (card) sb.appendChild(card);
    });
  }

  function syncLayersSelection(el) {
    if (!layersBody) return;

    // Remove old selection highlight
    var oldSel = layersBody.querySelectorAll('.rb-layer-selected');
    oldSel.forEach(function(r) { r.classList.remove('rb-layer-selected'); });

    if (!el) return;

    // Build ancestor chain from body to el
    var chain = [];
    var walk = el;
    while (walk && walk !== targetDoc.body) {
      chain.unshift(walk);
      walk = walk.parentElement;
    }

    // Walk the layers tree, expanding each ancestor level. Inert ancestors
    // are skip-promoted in the tree (no row), so we tolerate misses and keep
    // descending — descendants may still appear at the same currentContainer.
    var currentContainer = layersBody;
    for (var i = 0; i < chain.length; i++) {
      var target = chain[i];
      var rowContainers = currentContainer.children;
      var foundRC = null;
      var foundRow = null;

      for (var j = 0; j < rowContainers.length; j++) {
        var rc = rowContainers[j];
        var row = rc.querySelector(':scope > .rb-layer-row');
        if (!row) continue;
        if (row._rbEl === target || row._rbEffectiveEl === target) {
          foundRC = rc;
          foundRow = row;
          break;
        }
      }

      if (!foundRow) continue;  // skipped/inert ancestor; keep walking

      if (i === chain.length - 1) {
        foundRow.classList.add('rb-layer-selected');
        foundRow.scrollIntoView({block: 'nearest', behavior: 'smooth'});
        return;
      }

      var childContainer = foundRC.querySelector(':scope > .rb-layer-children');
      if (!childContainer) continue;
      if (childContainer.children.length === 0) {
        // Render from the row's effectiveEl so chain-collapsed wrappers emit
        // the correct children (matching the collapse-button behaviour).
        var src = foundRow._rbEffectiveEl || target;
        renderLayerChildren(src, childContainer, i + 1);
      }
      childContainer.classList.add('rb-layer-expanded');
      var collapseBtn = foundRow.querySelector(':scope > .rb-layer-collapse');
      if (collapseBtn) collapseBtn.classList.remove('rb-collapsed');
      currentContainer = childContainer;
    }

    // Final pass: row for `el` may have been rendered during expansion above
    // but missed by the strict chain walk (e.g. chain ends at an inert
    // wrapper whose children were promoted). Look up by _rbEl directly.
    var allRows = layersBody.querySelectorAll('.rb-layer-row');
    var matchRow = null;
    for (var k = 0; k < allRows.length; k++) {
      if (allRows[k]._rbEl === el || allRows[k]._rbEffectiveEl === el) {
        matchRow = allRows[k];
        break;
      }
    }
    // Fallback: if `el` itself is filtered (inert/skipped) and has no row,
    // highlight the nearest ancestor that does.
    if (!matchRow) {
      var w = el.parentElement;
      while (w && w !== targetDoc.body && !matchRow) {
        for (var m = 0; m < allRows.length; m++) {
          if (allRows[m]._rbEl === w || allRows[m]._rbEffectiveEl === w) {
            matchRow = allRows[m];
            break;
          }
        }
        w = w.parentElement;
      }
    }
    if (matchRow) {
      matchRow.classList.add('rb-layer-selected');
      matchRow.scrollIntoView({block: 'nearest', behavior: 'smooth'});
    }
  }

  function buildInspector() {
    inspector = mk('div');
    inspector.id = 'rb-editor-inspector';

    // Header — user avatar + export
    var hd = mk('div');
    hd.id = 'rb-ed-insp-header';

    // User avatar
    var userWrap = mk('div');
    userWrap.style.cssText = 'display:flex;align-items:center;gap:6px;';
    var userAvatar = mk('div');
    userAvatar.style.cssText = 'width:26px;height:26px;border-radius:50%;background:#7E828A;display:flex;align-items:center;justify-content:center;font:600 11px "Instrument Sans",sans-serif;color:#fff;box-shadow:0 0 0 2px ' + (isLight() ? '#E8E8E8' : '#1A1A1A') + ',0 0 0 4px rgba(' + (isLight() ? '0,0,0,0.15' : '255,255,255,0.5') + ');flex-shrink:0;cursor:pointer;';
    userAvatar.textContent = 'A';
    var userChev = mk('button', 'rb-ed-project-chev');
    userChev.style.cssText = 'border:none;background:none;';
    userChev.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>';
    userChev.addEventListener('mousedown', function(e) {
      e.stopImmediatePropagation();
      var existing = hostDoc.querySelector('.rb-ed-dropdown.rb-user-dd');
      if (existing) { existing.remove(); return; }
      var dd = mk('div', 'rb-ed-dropdown rb-user-dd');
      var rect = userAvatar.getBoundingClientRect();
      dd.style.cssText = 'position:fixed;top:' + (rect.bottom + 8) + 'px;right:' + (hostWin.innerWidth - rect.right) + 'px;min-width:220px;';

      // Name + Free tag + Upgrade button row
      var nameRow = mk('div');
      nameRow.style.cssText = 'display:flex;align-items:center;gap:6px;padding:10px 14px 8px;';
      var nameEl = mk('span');
      nameEl.textContent = 'Adilson Porto';
      nameEl.style.cssText = 'font:500 12px "Instrument Sans",sans-serif;color:' + (isLight() ? '#333' : '#EFEEEB') + ';flex:1;';
      var freeTag = mk('span');
      freeTag.textContent = 'Free';
      freeTag.style.cssText = 'font:500 9px "Instrument Sans",sans-serif;color:' + (isLight() ? 'rgba(51,51,51,0.5)' : 'rgba(239,238,235,0.5)') + ';background:' + (isLight() ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)') + ';padding:2px 6px;border-radius:3px;text-transform:uppercase;letter-spacing:0.5px;';
      var upgradeBtn = mk('button');
      upgradeBtn.textContent = 'Upgrade to PRO';
      upgradeBtn.style.cssText = 'font:600 9px "Instrument Sans",sans-serif;color:#fff;background:#0095FF;border:none;padding:4px 8px;border-radius:4px;cursor:pointer;text-transform:uppercase;letter-spacing:0.3px;-webkit-appearance:none;';
      nameRow.appendChild(nameEl);
      nameRow.appendChild(freeTag);
      nameRow.appendChild(upgradeBtn);
      dd.appendChild(nameRow);

      dd.appendChild(mk('div', 'rb-ed-dropdown-divider'));
      var settingsBtn = mk('button', 'rb-ed-dropdown-item'); settingsBtn.textContent = 'User account settings';
      dd.appendChild(settingsBtn);
      var billingBtn = mk('button', 'rb-ed-dropdown-item'); billingBtn.textContent = 'Billing';
      dd.appendChild(billingBtn);

      root.appendChild(dd);
      var close = function(ev) { if (!dd.contains(ev.target) && !userChev.contains(ev.target) && !userAvatar.contains(ev.target)) { dd.remove(); hostDoc.removeEventListener('mousedown', close, true); }};
      setTimeout(function() { hostDoc.addEventListener('mousedown', close, true); }, 50);
    }, {capture: true, signal: sig});
    userAvatar.addEventListener('mousedown', function(e) { userChev.dispatchEvent(new MouseEvent('mousedown', {bubbles: true, cancelable: true})); }, {capture: true, signal: sig});
    userWrap.appendChild(userAvatar);
    userWrap.appendChild(userChev);
    hd.appendChild(userWrap);

    // Canvas zoom pill — only meaningful when running inside the canvas
    // shell (host page exposes window.__uncraftZoom). In the extension
    // context this is hidden via the missing API check.
    if (hostWin.__uncraftZoom) {
      var zoomWrap = mk('div', 'rb-ed-zoom-wrap');

      // Frame-back button — sits to the LEFT of the zoom pill, attached
      // as part of the same widget. Restores the canvas to the framing
      // captured the moment the user entered edit mode (CanvasClient
      // stamps __uncraftZoom._editFrame after zoomToNode). Disabled when
      // the canvas is already at that frame, so the button signals
      // "you've drifted from the edit-mode view".
      var frameBackBtn = mk('button', 'rb-ed-frame-back');
      frameBackBtn.type = 'button';
      frameBackBtn.title = 'Frame back to edit-mode view';
      frameBackBtn.setAttribute('aria-label', 'Frame back to edit-mode view');
      frameBackBtn.innerHTML =
        '<svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
          '<path d="M2 5V3a1 1 0 0 1 1-1h2"/>' +
          '<path d="M14 5V3a1 1 0 0 0-1-1h-2"/>' +
          '<path d="M2 11v2a1 1 0 0 0 1 1h2"/>' +
          '<path d="M14 11v2a1 1 0 0 1-1 1h-2"/>' +
          '<circle cx="8" cy="8" r="1.4" fill="currentColor" stroke="none"/>' +
        '</svg>';
      // Look up the editing node's id via __uncraftMountOptions — set by
      // CanvasEditorCore on every mount. With the id we can ask the
      // canvas API for the node's edit frame on demand instead of
      // relying on a pre-stamped _editFrame (which is racy and gets
      // wiped when __uncraftZoom is re-created on canvas-scale ticks).
      function currentNodeId() {
        var opt = hostWin.__uncraftMountOptions;
        return (opt && opt.nodeId) || null;
      }
      function isAtEditFrame() {
        var z = hostWin.__uncraftZoom;
        if (!z || !z.getNodeFrame || !z.getState) return true;
        var nid = currentNodeId();
        if (!nid) return true;
        var ef = z.getNodeFrame(nid);
        var cur = z.getState();
        if (!ef || !cur) return true;
        // Tolerance generous on purpose — sub-pixel drift from animation
        // easing or trackpad microscrolls shouldn't keep the button
        // "active" forever once the user is visually back at the frame.
        return Math.abs(cur.positionX - ef.positionX) < 6 &&
               Math.abs(cur.positionY - ef.positionY) < 6 &&
               Math.abs(cur.scale - ef.scale) < 0.01;
      }
      function refreshFrameBackBtn() {
        var z = hostWin.__uncraftZoom;
        var hasApi = !!(z && z.frameNode && z.getNodeFrame);
        var nid = currentNodeId();
        var at = isAtEditFrame();
        frameBackBtn.disabled = !hasApi || !nid || at;
        frameBackBtn.classList.toggle('rb-ed-frame-back-active', hasApi && nid && !at);
      }
      function activateFrameBack() {
        if (frameBackBtn.disabled) return;
        var z = hostWin.__uncraftZoom;
        var nid = currentNodeId();
        if (!z || !z.frameNode || !nid) return;
        z.frameNode(nid, 280);
      }
      frameBackBtn.addEventListener('mousedown', function(e) {
        e.stopImmediatePropagation();
        e.preventDefault();
        activateFrameBack();
      }, {capture: true, signal: sig});
      // Belt-and-suspenders: a `click` listener catches the case where a
      // higher-priority capture-phase handler swallowed the mousedown.
      frameBackBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        activateFrameBack();
      }, {signal: sig});
      zoomWrap.appendChild(frameBackBtn);

      var zoomPill = mk('button', 'rb-ed-zoom-pill');
      zoomPill.type = 'button';
      var zoomPct = mk('span', 'rb-ed-zoom-pct');
      zoomPct.textContent = Math.round((hostWin.__uncraftZoom.getScale() || 1) * 100) + '%';
      var zoomChev = mk('span', 'rb-ed-zoom-chev');
      zoomChev.innerHTML = '<svg viewBox="0 0 12 12" width="9" height="9" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="m3 4.5 3 3 3-3"/></svg>';
      zoomPill.appendChild(zoomPct);
      zoomPill.appendChild(zoomChev);
      zoomWrap.appendChild(zoomPill);

      // Live-update the displayed % AND the frame-back enabled state. The
      // canvas can change via wheel/pan events that don't fire React
      // updates, so we poll on a short interval. 250ms is fast enough to
      // feel responsive, slow enough to be cheap.
      var zoomTickerId = setInterval(function() {
        if (!hostWin.__uncraftZoom) return;
        zoomPct.textContent = Math.round(hostWin.__uncraftZoom.getScale() * 100) + '%';
        refreshFrameBackBtn();
      }, 250);
      // Initial pass so the button starts in the right state without
      // waiting a tick.
      refreshFrameBackBtn();
      sig.addEventListener('abort', function() { clearInterval(zoomTickerId); });

      var zoomMenu = null;
      function closeZoomMenu() {
        if (zoomMenu) { zoomMenu.remove(); zoomMenu = null; hostDoc.removeEventListener('mousedown', onZoomOutside, true); }
      }
      function onZoomOutside(ev) {
        if (zoomMenu && !zoomMenu.contains(ev.target) && !zoomPill.contains(ev.target)) closeZoomMenu();
      }
      function buildZoomItem(label, kbd, onClick) {
        var it = mk('button', 'rb-ed-zoom-item');
        it.type = 'button';
        it.innerHTML = '<span>' + label + '</span>' + (kbd ? '<span class="rb-ed-zoom-kbd">' + kbd + '</span>' : '');
        it.addEventListener('mousedown', function(e) {
          e.stopImmediatePropagation();
          onClick();
          closeZoomMenu();
        }, {capture: true});
        return it;
      }
      zoomPill.addEventListener('mousedown', function(e) {
        e.stopImmediatePropagation();
        if (zoomMenu) { closeZoomMenu(); return; }
        zoomMenu = mk('div', 'rb-ed-zoom-menu');
        [0.5, 0.75, 1, 1.25, 1.5].forEach(function(p) {
          zoomMenu.appendChild(buildZoomItem(Math.round(p * 100) + '%', '', function() { hostWin.__uncraftZoom.setScale(p); }));
        });
        var sep = mk('div', 'rb-ed-zoom-sep');
        zoomMenu.appendChild(sep);
        zoomMenu.appendChild(buildZoomItem('Zoom in', '⌘+', function() { hostWin.__uncraftZoom.zoomIn(); }));
        zoomMenu.appendChild(buildZoomItem('Zoom out', '⌘−', function() { hostWin.__uncraftZoom.zoomOut(); }));
        zoomMenu.appendChild(buildZoomItem('Fit to View', '⌘0', function() { hostWin.__uncraftZoom.fit(); }));
        var rect = zoomPill.getBoundingClientRect();
        zoomMenu.style.cssText = 'position:fixed;top:' + (rect.bottom + 6) + 'px;left:' + Math.max(8, rect.left) + 'px;';
        hostDoc.body.appendChild(zoomMenu);
        setTimeout(function() { hostDoc.addEventListener('mousedown', onZoomOutside, true); }, 50);
      }, {capture: true, signal: sig});
      sig.addEventListener('abort', closeZoomMenu);

      hd.appendChild(zoomWrap);
    }

    var exportWrap = mk('div');
    exportWrap.style.position = 'relative';
    var expBtn = mk('button', 'rb-ed-export-btn');
    expBtn.innerHTML = 'Export ' + EXPORT;
    var expDD = mk('div', 'rb-ed-export-dd');
    expDD.hidden = true;

    ['PNG','JPG','SVG','Figma','Pencil','Paper','Sketch'].forEach(function(fmt) {
      var btn = mk('button');
      btn.textContent = fmt;
      btn.addEventListener('click', function() {
        if (fmt === 'PNG' || fmt === 'JPG') {
          chrome.runtime.sendMessage({action: 'captureScreenshot', format: fmt.toLowerCase()});
        } else if (fmt === 'SVG') {
          downloadSVG();
        } else {
          chrome.runtime.sendMessage({action: 'captureCurrentPage', tool: fmt.toLowerCase()});
        }
        expDD.hidden = true;
      }, {signal: sig});
      expDD.appendChild(btn);
    });

    expBtn.addEventListener('mousedown', function(e) {
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      expDD.hidden = !expDD.hidden;
    }, {signal: sig, capture: true});
    hostDoc.addEventListener('click', function() { expDD.hidden = true; }, {signal: sig});

    exportWrap.appendChild(expBtn);
    exportWrap.appendChild(expDD);
    hd.appendChild(exportWrap);

    inspector.appendChild(hd);

    // Resize handle (left edge of sidebar)
    var resizeH = mk('div');
    resizeH.id = 'rb-insp-resize';
    resizeH.addEventListener('mousedown', function(e) {
      // Resize handle is dock-only; floating inspector has its own drag chrome.
      if (inspector.classList.contains('rb-insp-floating')) return;
      e.preventDefault();
      var startX = e.clientX;
      var startW = inspector.offsetWidth;
      var onMove = function(me) {
        var newW = startW + (startX - me.clientX);
        newW = Math.max(240, Math.min(400, newW));
        inspector.style.width = newW + 'px';
        hostDoc.documentElement.style.setProperty('--rb-insp-width', newW + 'px');
      };
      var onUp = function() {
        hostDoc.removeEventListener('mousemove', onMove);
        hostDoc.removeEventListener('mouseup', onUp);
      };
      hostDoc.addEventListener('mousemove', onMove);
      hostDoc.addEventListener('mouseup', onUp);
    });
    inspector.appendChild(resizeH);

    // Body
    inspBody = mk('div');
    inspBody.id = 'rb-ed-insp-body';
    inspector.appendChild(inspBody);
    root.appendChild(inspector);
    // Defer showGlobalCSS to next frame so DOM is fully mounted
    requestAnimationFrame(function() { showGlobalCSS(); });

    // ---- LAYERS PANEL (left side, docked) ----
    layersPanel = mk('div');
    layersPanel.id = 'rb-editor-layers';

    // Header: Logo + actions
    var layersHd = mk('div');
    layersHd.id = 'rb-ed-layers-header';

    // Top row: Logo + chevron + minimize + undock
    var logoRow = mk('div');
    logoRow.id = 'rb-ed-layers-logo';
    var logoLeft = mk('div');
    logoLeft.style.cssText = 'display:flex;align-items:center;gap:4px;';
    var logoEl = mk('span', 'rb-ed-logo');
    logoEl.innerHTML = '<i>Uncraft</i>';
    var logoChev = mk('button', 'rb-ed-project-chev');
    logoChev.style.cssText = 'border:none;background:none;';
    logoChev.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>';
    logoChev.addEventListener('mousedown', function(e) {
      e.stopImmediatePropagation();
      var existing = hostDoc.querySelector('.rb-ed-dropdown.rb-logo-dd');
      if (existing) { existing.remove(); return; }
      var dd = mk('div', 'rb-ed-dropdown rb-logo-dd');
      var rect = logoChev.getBoundingClientRect();
      dd.style.cssText = 'position:fixed;top:' + (rect.bottom + 4) + 'px;left:' + rect.left + 'px;min-width:220px;';

      // Dropdown structure:
      // - Placeholders stay as requested (Preferences, Save, Edit, View, Text)
      // - Functional items added alongside them and wired to real handlers
      // - Shortcut labels shown on the right for discoverability
      // Each entry: {label, action?, disabled?, divider?, shortcut?}
      var items = [
        {label: 'Preferences', disabled: true},
        {divider: true},
        {label: 'Save', disabled: true},
        {label: 'Saved versions history', action: function() { openSavedVersionsHistory(); }},
        {label: 'Export', action: function() {
          var expBtn = hostDoc.querySelector('.rb-ed-export-btn');
          if (expBtn) expBtn.click();
        }},
        {divider: true},
        {label: 'Edit', disabled: true},
        {label: 'Undo', shortcut: modKey + 'Z', action: function() { undo(); }},
        {label: 'Redo', shortcut: modKey + '\u21e7Z', action: function() { redo(); }},
        {label: 'Cut', shortcut: modKey + 'X', action: function() { clipCut(); }},
        {label: 'Copy', shortcut: modKey + 'C', action: function() { clipCopy(); }},
        {label: 'Paste', shortcut: modKey + 'V', action: function() { clipPaste(); }},
        {label: 'Find', shortcut: modKey + 'F', action: function() { openFind(); }},
        {divider: true},
        {label: 'View', disabled: true},
        {label: 'Text', disabled: true},
        {divider: true},
        {label: 'Help', disabled: true},
        {label: 'Account', disabled: true},
        {divider: true},
        {label: 'Exit Editor', action: function() { deactivate(); }}
      ];

      items.forEach(function(item) {
        if (item.divider) {
          dd.appendChild(mk('div', 'rb-ed-dropdown-divider'));
          return;
        }
        var btn = mk('button', 'rb-ed-dropdown-item');
        btn.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:16px;';
        var lblEl = mk('span');
        lblEl.textContent = item.label;
        btn.appendChild(lblEl);
        if (item.shortcut) {
          var kb = mk('span');
          kb.textContent = item.shortcut;
          kb.style.cssText = 'font:400 10px "Instrument Sans",sans-serif;color:rgba(239,238,235,0.35);margin-left:auto;';
          btn.appendChild(kb);
        }
        if (item.disabled) {
          btn.style.opacity = '0.35';
          btn.style.cursor = 'default';
        } else if (item.action) {
          btn.addEventListener('mousedown', function(ev) {
            ev.stopImmediatePropagation();
            ev.preventDefault();
            dd.remove();
            // Defer the action so the click doesn't interfere with focus
            setTimeout(item.action, 0);
          }, {capture: true});
        }
        dd.appendChild(btn);
      });

      root.appendChild(dd);
      var close = function(ev) { if (!dd.contains(ev.target) && !logoChev.contains(ev.target)) { dd.remove(); hostDoc.removeEventListener('mousedown', close, true); }};
      setTimeout(function() { hostDoc.addEventListener('mousedown', close, true); }, 50);
    }, {capture: true, signal: sig});
    logoLeft.appendChild(logoEl);
    logoLeft.appendChild(logoChev);

    var logoActions = mk('div');
    logoActions.id = 'rb-ed-layers-logo-actions';

    // Minimize → small floating widget
    var panelMinBtn = mk('button', 'rb-ed-minmax-btn');
    panelMinBtn.innerHTML = '<span class="rb-ed-icon-minimize"></span>';
    panelMinBtn.title = 'Minimize panels';
    var panelsMinimized = false;
    var miniWidgetL = null, miniWidgetR = null;
    var DRAG_HANDLE = '<div class="rb-mini-handle"><div class="rb-mini-dots"><span></span><span></span><span></span><span></span></div><div class="rb-mini-dots"><span></span><span></span><span></span><span></span></div></div>';

    function makeDraggable(widget) {
      var handle = widget.querySelector('.rb-mini-handle');
      if (!handle) return;
      handle.addEventListener('mousedown', function(e) {
        e.preventDefault(); e.stopImmediatePropagation();
        var startX = e.clientX, startY = e.clientY;
        var startL = widget.offsetLeft, startT = widget.offsetTop;
        var onMove = function(me) {
          widget.style.left = (startL + me.clientX - startX) + 'px';
          widget.style.top = (startT + me.clientY - startY) + 'px';
          widget.style.right = 'auto';
        };
        var onUp = function() { hostDoc.removeEventListener('mousemove', onMove); hostDoc.removeEventListener('mouseup', onUp); };
        hostDoc.addEventListener('mousemove', onMove);
        hostDoc.addEventListener('mouseup', onUp);
      }, {capture: true});
    }

    function restorePanels() {
      panelsMinimized = false;
      layersPanel.style.display = '';
      inspector.style.display = '';
      // Only remove floating if panels are docked (not floating mode)
      var isFloating = layersPanel.classList.contains('rb-layers-floating');
      if (!isFloating) {
        hostDoc.body.classList.remove('rb-ed-floating');
        hostDoc.documentElement.classList.add('rb-ed-docked');
      }
      if (miniWidgetL) { miniWidgetL.remove(); miniWidgetL = null; }
      if (miniWidgetR) { miniWidgetR.remove(); miniWidgetR = null; }
    }

    panelMinBtn.addEventListener('mousedown', function(e) {
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      panelsMinimized = true;
      layersPanel.style.display = 'none';
      inspector.style.display = 'none';
      hostDoc.body.classList.add('rb-ed-floating');
      hostDoc.documentElement.classList.remove('rb-ed-docked');

      // Left widget: handle + logo + minimize/undock icons
      if (miniWidgetL) miniWidgetL.remove();
      miniWidgetL = mk('div');
      miniWidgetL.className = 'rb-mini-widget';
      miniWidgetL.style.cssText = 'left:12px;top:12px;';
      miniWidgetL.innerHTML = DRAG_HANDLE + '<span class="rb-ed-logo" style="font-size:12px"><i>Uncraft</i></span>';
      var restoreBtnL = mk('button', 'rb-ed-minmax-btn');
      restoreBtnL.innerHTML = '<span class="rb-ed-icon-maximize"></span>';
      restoreBtnL.addEventListener('mousedown', function(we) { we.stopImmediatePropagation(); restorePanels(); }, {capture: true});
      miniWidgetL.appendChild(restoreBtnL);
      root.appendChild(miniWidgetL);
      makeDraggable(miniWidgetL);

      // Right widget: handle + avatar + export
      if (miniWidgetR) miniWidgetR.remove();
      miniWidgetR = mk('div');
      miniWidgetR.className = 'rb-mini-widget';
      miniWidgetR.style.cssText = 'right:12px;top:12px;';
      miniWidgetR.innerHTML = DRAG_HANDLE;
      var miniAvatar = mk('div');
      miniAvatar.style.cssText = 'width:22px;height:22px;border-radius:50%;background:#7E828A;display:flex;align-items:center;justify-content:center;font:600 9px "Instrument Sans",sans-serif;color:#fff;box-shadow:0 0 0 2px ' + (isLight() ? '#E8E8E8' : '#1A1A1A') + ',0 0 0 3px rgba(' + (isLight() ? '0,0,0,0.15' : '255,255,255,0.5') + ');';
      miniAvatar.textContent = 'A';
      miniWidgetR.appendChild(miniAvatar);
      var miniExp = mk('button', 'rb-ed-export-btn');
      miniExp.innerHTML = 'Export';
      miniExp.style.cssText += 'color:#fff;font-size:10px;padding:4px 8px;';
      miniWidgetR.appendChild(miniExp);
      var restoreBtnR = mk('button', 'rb-ed-minmax-btn');
      restoreBtnR.innerHTML = '<span class="rb-ed-icon-maximize"></span>';
      restoreBtnR.addEventListener('mousedown', function(we) { we.stopImmediatePropagation(); restorePanels(); }, {capture: true});
      miniWidgetR.appendChild(restoreBtnR);
      root.appendChild(miniWidgetR);
      makeDraggable(miniWidgetR);
    }, {signal: sig, capture: true});

    // Undock
    var panelUndockBtn = mk('button', 'rb-ed-minmax-btn');
    panelUndockBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="2" width="12" height="12" rx="2"/><line x1="6" y1="2" x2="6" y2="14"/></svg>';
    panelUndockBtn.title = 'Undock panels';
    panelUndockBtn.addEventListener('mousedown', function(e) {
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      var floating = layersPanel.classList.contains('rb-layers-floating');
      layersPanel.classList.toggle('rb-layers-floating', !floating);
      inspector.classList.toggle('rb-insp-floating', !floating);
      hostDoc.body.classList.toggle('rb-ed-floating', !floating);
      hostDoc.documentElement.classList.toggle('rb-ed-docked', floating);
      // Force reflow so site elements recalculate width after margin change.
      void targetDoc.body.offsetHeight;
      panelUndockBtn.title = floating ? 'Undock panels' : 'Dock panels';
    }, {signal: sig, capture: true});

    // Theme toggle (sun/moon)
    var SUN_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>';
    var MOON_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
    var themeBtn = mk('button', 'rb-ed-theme-btn');
    themeBtn.title = 'Toggle light/dark mode';

    function applyTheme(light) {
      hostDoc.body.classList.toggle('rb-ed-light', light);
      themeBtn.innerHTML = light ? MOON_SVG : SUN_SVG;
      themeBtn.title = light ? 'Switch to dark mode' : 'Switch to light mode';
      // Update inline styles that depend on theme
      var bg = light ? '#E8E8E8' : '#1A1A1A';
      var fg = light ? '#333' : '#EFEEEB';
      var ring = light ? '0 0 0 2px #E8E8E8,0 0 0 4px rgba(0,0,0,0.15)' : '0 0 0 2px #1A1A1A,0 0 0 4px rgba(255,255,255,0.5)';
      if (userAvatar) userAvatar.style.boxShadow = ring;
      try { localStorage.setItem('rb-ed-theme', light ? 'light' : 'dark'); } catch(e) {}
    }

    var savedTheme = null;
    try { savedTheme = localStorage.getItem('rb-ed-theme'); } catch(e) {}
    applyTheme(savedTheme === 'light');

    themeBtn.addEventListener('mousedown', function(e) {
      e.preventDefault(); e.stopImmediatePropagation();
      applyTheme(!isLight());
    }, {capture: true, signal: sig});

    // Minimize / theme buttons are no longer surfaced in the layers panel
    // header — minimize was removed at user request and theme moved to the
    // canvas toolbar (web-shell). Their elements + handlers stay declared
    // above so the rest of the code (mini-widget restore, applyTheme on
    // boot) keeps working without churn.
    //
    // Undock IS surfaced — but only in the extension. On the canvas, panels
    // are sized to the editing node and undocking them would put them out
    // of the user's viewport context. `__uncraftZoom` is the canvas-only
    // API stamped by CanvasClient, so its absence = extension context.
    if (!hostWin.__uncraftZoom) {
      logoActions.appendChild(panelUndockBtn);
    }
    logoRow.appendChild(logoLeft);
    logoRow.appendChild(logoActions);
    layersHd.appendChild(logoRow);

    // Project name field (below logo)
    var projectField = mk('div', 'rb-ed-project-field');
    var projectName = mk('input', 'rb-ed-project-name');
    projectName.value = (targetDoc.title || 'Untitled').slice(0, 40);
    projectName.readOnly = true;
    projectName.style.cursor = 'default';
    projectName.addEventListener('click', function() {
      projectName.readOnly = false;
      projectName.style.cursor = 'text';
      projectName.select();
    });
    projectName.addEventListener('blur', function() {
      // Restore 'Untitled' when the user cleared the field — the panel
      // header should never render with an empty name.
      var clean = (projectName.value || '').trim();
      if (!clean) projectName.value = 'Untitled';
      projectName.readOnly = true;
      projectName.style.cursor = 'default';
    });
    projectField.appendChild(projectName);
    layersHd.appendChild(projectField);

    layersPanel.appendChild(layersHd);

    // Tab bar: Layers | Sections | Assets | 🔍
    var tabBar = mk('div');
    tabBar.style.cssText = 'display:flex;border-bottom:1px solid rgba(255,255,255,0.06);flex-shrink:0;';
    var tabLayers = mk('button', 'rb-layer-tab rb-layer-tab-active');
    tabLayers.textContent = 'Layers';
    var tabSections = mk('button', 'rb-layer-tab');
    tabSections.textContent = 'Sections';
    var tabAssets = mk('button', 'rb-layer-tab');
    tabAssets.textContent = 'Assets';
    var tabFind = mk('button', 'rb-layer-tab');
    tabFind.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
    tabFind.title = 'Find';
    tabFind.style.cssText = 'flex:0 0 auto;width:36px;display:flex;align-items:center;justify-content:center;';
    tabBar.appendChild(tabLayers);
    tabBar.appendChild(tabSections);
    tabBar.appendChild(tabAssets);
    tabBar.appendChild(tabFind);
    layersPanel.appendChild(tabBar);

    // Search bar (hidden by default)
    var searchWrap = mk('div');
    searchWrap.id = 'rb-ed-search-wrap';
    var searchInp = mk('input');
    searchInp.id = 'rb-ed-search-inp';
    searchInp.placeholder = 'Search layers or images...';
    searchWrap.appendChild(searchInp);
    layersPanel.appendChild(searchWrap);

    // Tab bodies
    layersBody = mk('div');
    layersBody.id = 'rb-ed-layers-body';
    layersPanel.appendChild(layersBody);

    var sectionsBody = mk('div');
    sectionsBody.id = 'rb-ed-sections-body';
    sectionsBody.style.display = 'none';
    layersPanel.appendChild(sectionsBody);

    var assetsBody = mk('div');
    assetsBody.id = 'rb-ed-assets-body';
    assetsBody.style.display = 'none';
    layersPanel.appendChild(assetsBody);

    // Footer with Exit button — saves and restores normal browsing
    var exitFooter = mk('div');
    exitFooter.id = 'rb-ed-layers-footer';
    var exitBtn = mk('button', 'rb-ed-layers-exit');
    exitBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg><span>Exit Editor</span>';
    exitBtn.title = 'Save and exit — return to normal browsing';
    exitBtn.addEventListener('mousedown', function(e) {
      e.preventDefault();
      e.stopImmediatePropagation();
      deactivate();
    }, {capture: true, signal: sig});
    exitFooter.appendChild(exitBtn);
    layersPanel.appendChild(exitFooter);

    function switchLeftTab(active) {
      layersBody.style.display = active === 'layers' ? '' : 'none';
      sectionsBody.style.display = active === 'sections' ? '' : 'none';
      assetsBody.style.display = active === 'assets' ? '' : 'none';
      tabLayers.classList.toggle('rb-layer-tab-active', active === 'layers');
      tabSections.classList.toggle('rb-layer-tab-active', active === 'sections');
      tabAssets.classList.toggle('rb-layer-tab-active', active === 'assets');
      if (active === 'sections') populateSections();
      if (active === 'assets') populateAssets();
    }

    tabLayers.addEventListener('mousedown', function(e) { e.stopImmediatePropagation(); switchLeftTab('layers'); }, {capture: true, signal: sig});
    tabSections.addEventListener('mousedown', function(e) { e.stopImmediatePropagation(); switchLeftTab('sections'); }, {capture: true, signal: sig});
    tabAssets.addEventListener('mousedown', function(e) { e.stopImmediatePropagation(); switchLeftTab('assets'); }, {capture: true, signal: sig});
    tabFind.addEventListener('mousedown', function(e) {
      e.stopImmediatePropagation();
      searchWrap.classList.toggle('rb-ed-search-open');
      if (searchWrap.classList.contains('rb-ed-search-open')) searchInp.focus();
    }, {capture: true, signal: sig});

    // Resize handle
    var resizeHandle = mk('div');
    resizeHandle.id = 'rb-layers-resize';
    layersPanel.appendChild(resizeHandle);
    resizeHandle.addEventListener('mousedown', function(e) {
      e.preventDefault();
      var startY = e.clientY;
      var startH = layersPanel.offsetHeight;
      var onMove = function(me) {
        var newH = startH + (me.clientY - startY);
        // Layers panel lives in HOST so it clamps against host viewport.
        newH = Math.max(120, Math.min(hostWin.innerHeight - 60, newH));
        layersPanel.style.height = newH + 'px';
      };
      var onUp = function() {
        hostDoc.removeEventListener('mousemove', onMove);
        hostDoc.removeEventListener('mouseup', onUp);
      };
      hostDoc.addEventListener('mousemove', onMove);
      hostDoc.addEventListener('mouseup', onUp);
    });

    root.appendChild(layersPanel);

    populateLayers();

    // Canvas mode default: undocked / floating panels. The host body in
    // canvas isn't the edited site, so the docked layout (which carves
    // 240px+260px out of body width) just compresses canvas chrome. The
    // user prefers floating panels here. Toggle button stays interactive.
    if (hostDoc !== targetDoc) {
      layersPanel.classList.add('rb-layers-floating');
      inspector.classList.add('rb-insp-floating');
      hostDoc.body.classList.add('rb-ed-floating');
      hostDoc.documentElement.classList.remove('rb-ed-docked');
    }
  }

  function showGlobalCSS() {
    updateInspector(targetDoc.body);
    inspector.classList.add('rb-insp-ghost');

    // Override font to show all site fonts
    var fontsUsed = new Set();
    targetDoc.querySelectorAll('h1,h2,h3,p,a,span,div,li,button').forEach(function(scanEl) {
      if (fontsUsed.size > 8) return;
      try { var f = getCS(scanEl).fontFamily.split(',')[0].replace(/['"]/g, '').trim(); if (f) fontsUsed.add(f); } catch(e) {}
    });
    var allFonts = [...fontsUsed].join(', ');
    // Font combobox was a <select> pre-f6d7f42; now it's an <input> with a
    // dropdown, so there's no `.options` array — write into `.value` directly.
    var fontSel = inspBody.querySelector('.rb-insp-font-sel');
    if (fontSel) {
      fontSel.value = allFonts;
      fontSel.defaultValue = allFonts;
      fontSel.title = allFonts;
    }

    // Ghost image placeholder removed — unified into updateInspector single Image row
  }

  // ============ SECTIONS & ROWS ============

  var MORE_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><circle cx="8" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="16" cy="12" r="1" fill="currentColor" stroke="none"/></svg>';

  // Reusable settings popup (anchored to panel left edge, 3px gap)
  function openSettingsPopup(title, anchorBtn, buildContent) {
    var existing = hostDoc.querySelector('.rb-insp-adv-popup');
    if (existing) { existing.remove(); return null; }
    var popup = mk('div', 'rb-insp-adv-popup');
    var inspRect = inspector.getBoundingClientRect();
    var btnRect = anchorBtn.getBoundingClientRect();
    popup.style.cssText = 'position:fixed;top:' + btnRect.top + 'px;right:' + (hostWin.innerWidth - inspRect.left + 3) + 'px;';
    // Header: title + close button
    var popHd = mk('div');
    popHd.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding-bottom:8px;margin-bottom:8px;border-bottom:1px solid rgba(255,255,255,0.06);';
    var popTitle = mk('span', 'rb-insp-sec-title');
    popTitle.textContent = title + ' settings';
    popTitle.style.cssText = 'text-transform:none;letter-spacing:0;';
    var closeBtn = mk('button', 'rb-ed-minmax-btn');
    closeBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    closeBtn.addEventListener('mousedown', function(e) { e.stopImmediatePropagation(); popup.remove(); }, {capture: true, signal: sig});
    popHd.appendChild(popTitle);
    popHd.appendChild(closeBtn);
    popup.appendChild(popHd);
    // Content
    buildContent(popup);
    root.appendChild(popup);
    var closeOutside = function(ev) {
      if (popup && !popup.contains(ev.target) && !anchorBtn.contains(ev.target)) {
        if (popup.parentElement) popup.remove();
        hostDoc.removeEventListener('mousedown', closeOutside, true);
      }
    };
    setTimeout(function() { hostDoc.addEventListener('mousedown', closeOutside, true); }, 50);
    return popup;
  }

  function addSection(title, collapsed, onMore) {
    var sec = mk('div', 'rb-insp-sec');
    sec.setAttribute('data-rb-sec', title.toLowerCase());
    if (collapsed) sec.classList.add('collapsed');
    var hd = mk('div', 'rb-insp-sec-hd');
    var titleSpan = mk('span', 'rb-insp-sec-title');
    titleSpan.textContent = title;
    hd.appendChild(titleSpan);
    var hdRight = mk('div');
    hdRight.style.cssText = 'display:flex;align-items:center;gap:4px;';
    if (onMore) {
      var moreBtn = mk('button', 'rb-insp-adv-btn');
      moreBtn.innerHTML = MORE_ICON;
      moreBtn.title = 'More options';
      moreBtn.addEventListener('mousedown', function(e) {
        e.stopImmediatePropagation();
        onMore(moreBtn, sec);
      }, {capture: true, signal: sig});
      hdRight.appendChild(moreBtn);
    }
    var chev = hostDoc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    chev.setAttribute('class', 'rb-insp-sec-chev');
    chev.setAttribute('viewBox', '0 0 24 24');
    chev.setAttribute('fill', 'none');
    chev.setAttribute('stroke', 'currentColor');
    chev.setAttribute('stroke-width', '1.5');
    chev.innerHTML = '<path d="M6 9l6 6 6-6"/>';
    hdRight.appendChild(chev);
    hd.appendChild(hdRight);
    hd.addEventListener('click', function(e) {
      if (e.target.closest('.rb-insp-adv-btn')) return;
      if (sec.classList.contains('rb-insp-sec-empty')) return;
      sec.classList.toggle('collapsed');
    }, {signal: sig});
    var body = mk('div', 'rb-insp-sec-body');
    sec.appendChild(hd);
    sec.appendChild(body);
    inspBody.appendChild(sec);
    return body;
  }

  function addRow(parent, label, content) {
    var row = mk('div', 'rb-insp-row');
    if (label) {
      var lbl = mk('span', 'rb-insp-lbl');
      lbl.textContent = label;
      row.appendChild(lbl);
    }
    if (typeof content === 'string') {
      var val = mk('span', 'rb-insp-val');
      val.textContent = content;
      row.appendChild(val);
    } else {
      row.appendChild(content);
    }
    parent.appendChild(row);
    return row;
  }

  // Font size presets (Adobe standard)
  var FONT_SIZES = [6,7,8,9,10,11,12,13,14,16,18,21,24,28,32,36,42,48,56,64,72,80,96];

  // Icons for numeric fields (custom SVGs, white, opacity via CSS)
  var FIELD_ICONS = {
    opacity: '<svg width="12" height="12" viewBox="0 0 41.96 41.96" fill="#fff"><path d="M41.46,22.32c-1.38-5.4-5.34-9.58-10.62-11.21-.75-2.43-2.1-4.68-3.92-6.49C23.95,1.64,19.99,0,15.77,0S7.6,1.64,4.62,4.62C.66,8.59-.89,14.2.5,19.64c1.38,5.4,5.33,9.58,10.61,11.21,1.63,5.28,5.8,9.24,11.21,10.62,1.31.33,2.64.5,3.94.5,4.11,0,8.07-1.61,11.07-4.62,3.97-3.97,5.51-9.58,4.12-15.02ZM10.48,27.6c-3.79-1.69-6.53-5.1-7.38-9.21-.89-4.28.43-8.69,3.52-11.78,2.46-2.46,5.74-3.79,9.13-3.79.88,0,1.77.09,2.65.27,4.11.85,7.52,3.59,9.21,7.38-4.68-.43-9.23,1.22-12.57,4.56-3.34,3.34-4.98,7.89-4.56,12.57ZM23.89,25.88c-.94.76-1.98,1.38-3.1,1.85l-6.56-6.56c.47-1.12,1.09-2.16,1.85-3.1l7.81,7.81ZM27.73,20.79c-.47,1.11-1.09,2.15-1.85,3.1l-7.81-7.81c.94-.76,1.98-1.38,3.1-1.85l6.56,6.56ZM28.59,17.68l-4.31-4.31c1.41-.21,2.83-.18,4.24.07.26,1.41.28,2.83.07,4.24ZM17.68,28.59c-1.41.21-2.83.19-4.24-.07-.26-1.41-.28-2.83-.07-4.24l4.31,4.31ZM31.49,14.36c3.79,1.69,6.53,5.1,7.38,9.21.89,4.28-.42,8.69-3.52,11.78-3.09,3.09-7.51,4.41-11.78,3.52-4.11-.85-7.51-3.59-9.21-7.38,4.68.42,9.23-1.22,12.57-4.56,3.34-3.34,4.98-7.89,4.56-12.57Z"/></svg>',
    borderRadius: '<svg width="12" height="12" viewBox="0 0 42.38 42.38" fill="#fff"><path d="M32.86,2.9c3.65,0,6.61,2.97,6.61,6.61v6.3h2.9v-6.3c0-5.25-4.27-9.52-9.52-9.52h-6.3v2.9h6.3Z"/><path d="M2.9,9.52c0-3.65,2.97-6.61,6.61-6.61h6.3V0h-6.3C4.27,0,0,4.27,0,9.52v6.3h2.9v-6.3Z"/><path d="M9.52,39.48c-3.65,0-6.61-2.97-6.61-6.61v-6.3H0v6.3c0,5.25,4.27,9.52,9.52,9.52h6.3v-2.9h-6.3Z"/><path d="M39.48,32.86c0,3.65-2.97,6.61-6.61,6.61h-6.3v2.9h6.3c5.25,0,9.52-4.27,9.52-9.52v-6.3h-2.9v6.3Z"/></svg>',
    borderWidth: '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="#fff" stroke-width="2"><rect x="2" y="2" width="12" height="12" rx="2"/></svg>',
    transform: '<svg width="14" height="14" viewBox="0 0 43.62 43.33" fill="#fff"><path d="M42.12,35.36H11.12c-1.97,0-3.57-1.6-3.57-3.57V1.5c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5,1.5v30.29c0,3.62,2.95,6.57,6.57,6.57h31c.83,0,1.5-.67,1.5-1.5s-.67-1.5-1.5-1.5Z"/><path d="M29.21,39.33c-.83,0-1.5.67-1.5,1.5v1c0,.83.67,1.5,1.5,1.5s1.5-.67,1.5-1.5v-1c0-.83-.67-1.5-1.5-1.5Z"/><path d="M21.96,22.82c.29.31.69.47,1.09.47.37,0,.74-.14,1.03-.41.6-.57.63-1.52.06-2.12-.46-.48-.94-.95-1.43-1.39-.62-.55-1.57-.5-2.12.12-.55.62-.5,1.57.12,2.12.43.39.86.8,1.25,1.22Z"/><path d="M27.41,28.31c-.78.28-1.19,1.14-.91,1.92.19.54.37,1.1.52,1.67.18.67.78,1.12,1.45,1.12.13,0,.25-.02.38-.05.8-.21,1.28-1.03,1.07-1.83-.17-.65-.37-1.29-.59-1.91-.28-.78-1.14-1.19-1.92-.91Z"/><path d="M11.5,16.79c.57.13,1.13.29,1.68.47.15.05.31.07.46.07.63,0,1.22-.4,1.43-1.04.26-.79-.17-1.63-.96-1.89-.63-.21-1.28-.39-1.93-.54-.81-.19-1.61.31-1.8,1.12-.19.81.31,1.61,1.12,1.8Z"/><path d="M2.5,13.24h-1c-.83,0-1.5.67-1.5,1.5s.67,1.5,1.5,1.5h1c.83,0,1.5-.67,1.5-1.5s-.67-1.5-1.5-1.5Z"/><circle cx="29.35" cy="14.04" r="5.53"/></svg>'
  };

  function addInput(parent, label, value, el, prop) {
    var numVal = parseFloat(value);
    var hasUnit = /px|em|rem|%|pt|vw|vh/.test(String(value));
    var unit = hasUnit ? String(value).replace(/[\d.-]/g, '').trim() || 'px' : '';
    var isNumeric = !isNaN(numVal) && String(value).trim() !== '';

    // Font size gets a dropdown with presets
    if (prop === 'fontSize') {
      var wrap = mk('div', 'rb-insp-field-bg');
      wrap.style.cssText = 'display:flex;align-items:center;gap:0;position:relative;border-radius:4px;overflow:hidden;';
      var currentPx = Math.round(numVal);
      // Editable text input
      var fsInp = mk('input', 'rb-insp-inp');
      fsInp.type = 'text';
      fsInp.value = currentPx + 'px';
      fsInp.style.cssText = 'flex:1;background:none;border:none;border-radius:0;';
      fsInp.addEventListener('change', function() {
        var v = fsInp.value.trim();
        if (/^\d+$/.test(v)) v = v + 'px';
        applyStyle(el, prop, v);
      }, {signal: sig});
      // Hidden select triggered by arrow button. The class gives it the same
      // font-size as the other inspector inputs, so the browser renders the
      // <option>s at 12px to match the weight dropdown (native <select> uses
      // the element's own font for its popup).
      var sel = mk('select', 'rb-insp-inp');
      sel.style.cssText = 'position:absolute;right:0;top:0;width:22px;height:100%;opacity:0;cursor:pointer;padding:0;background:none;';
      FONT_SIZES.forEach(function(s) {
        var o = mk('option'); o.value = s + 'px'; o.textContent = s;
        if (s === currentPx) o.selected = true;
        sel.appendChild(o);
      });
      sel.addEventListener('change', function() {
        fsInp.value = sel.value;
        applyStyle(el, prop, sel.value);
      }, {signal: sig});
      // Arrow button that opens the select
      var arrowBtn = mk('div');
      arrowBtn.className = 'rb-insp-fs-arrow';
      arrowBtn.style.cssText = 'width:22px;height:100%;display:flex;align-items:center;justify-content:center;border-radius:0 4px 4px 0;cursor:pointer;flex-shrink:0;';
      arrowBtn.innerHTML = '<svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 9l6 6 6-6"/></svg>';
      wrap.appendChild(fsInp);
      wrap.appendChild(arrowBtn);
      wrap.appendChild(sel);
      addRow(parent, label, wrap);
      return fsInp;
    }

    // Convert value for applying to CSS (opacity % → 0-1)
    var applyVal = function(raw) {
      if (prop === 'opacity') {
        var pct = parseFloat(raw) || 0;
        return String(Math.min(1, Math.max(0, pct / 100)));
      }
      return raw;
    };

    // Numeric values: field-wrap with optional icon + input + steppers
    if (isNumeric) {
      var wrap = mk('div', 'rb-insp-field-wrap');
      var inp = mk('input', 'rb-insp-inp');
      inp.type = 'text';
      inp.value = value;
      inp.defaultValue = String(value);
      inp.addEventListener('change', function() {
        // Reject empty/NaN — inspector values are never blank. Restore last good.
        var v = inp.value.trim();
        if (v === '' || isNaN(parseFloat(v))) { inp.value = inp.defaultValue; return; }
        inp.defaultValue = v;
        applyStyle(el, prop, applyVal(inp.value));
      }, {signal: sig});

      // Icon (set via data-icon attribute by caller, or default)
      var iconSvg = FIELD_ICONS[prop] || '';
      if (iconSvg) {
        var iconEl = mk('span', 'rb-insp-field-icon');
        iconEl.innerHTML = iconSvg;
        wrap.appendChild(iconEl);
      }

      wrap.appendChild(inp);

      // Stepper arrows inside field
      var steppers = mk('div', 'rb-insp-field-steppers');
      var upBtn = mk('button', 'rb-insp-step');
      upBtn.innerHTML = '<svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M18 15l-6-6-6 6"/></svg>';
      upBtn.addEventListener('click', function() {
        var n = parseFloat(inp.value) || 0;
        var nv = (n + 1) + unit;
        if (prop === 'opacity') nv = Math.min(100, n + 1) + unit;
        inp.value = nv;
        applyStyle(el, prop, applyVal(inp.value));
      }, {signal: sig});
      var dnBtn = mk('button', 'rb-insp-step');
      dnBtn.innerHTML = '<svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M6 9l6 6 6-6"/></svg>';
      dnBtn.addEventListener('click', function() {
        var n = parseFloat(inp.value) || 0;
        inp.value = Math.max(0, n - 1) + unit;
        applyStyle(el, prop, applyVal(inp.value));
      }, {signal: sig});
      steppers.appendChild(upBtn);
      steppers.appendChild(dnBtn);
      wrap.appendChild(steppers);
      addRow(parent, label, wrap);
      return inp;
    }

    // Non-numeric: plain input
    var inp = mk('input', 'rb-insp-inp');
    inp.type = 'text';
    inp.value = value;
    inp.addEventListener('change', function() { applyStyle(el, prop, inp.value); }, {signal: sig});
    addRow(parent, label, inp);
    return inp;
  }

  function addSelect(parent, label, options, current, el, prop) {
    var sel = mk('select', 'rb-insp-inp');
    options.forEach(function(o) {
      var opt = mk('option');
      opt.value = o;
      opt.textContent = o;
      if (o === current) opt.selected = true;
      sel.appendChild(opt);
    });
    sel.addEventListener('change', function() {
      applyStyle(el, prop, sel.value);
    }, {signal: sig});
    addRow(parent, label, sel);
  }

  function addColor(parent, label, value, el, prop) {
    var wrap = mk('div', 'rb-insp-color-row rb-insp-field-bg');
    wrap.style.cssText = 'display:flex;align-items:center;gap:6px;border-radius:4px;padding:4px 6px;';
    var swatch = mk('div', 'rb-insp-swatch');
    var hex = rgbHex(value);
    var displayVal = hex || 'transparent';
    swatch.style.background = isTransparent(value) ? 'linear-gradient(45deg,#ccc 25%,transparent 25%,transparent 75%,#ccc 75%),linear-gradient(45deg,#ccc 25%,transparent 25%,transparent 75%,#ccc 75%)' : value;
    if (isTransparent(value)) { swatch.style.backgroundSize = '8px 8px'; swatch.style.backgroundPosition = '0 0, 4px 4px'; }
    var cinp = mk('input');
    cinp.type = 'color';
    cinp.value = hex || '#ffffff';
    var txt = mk('span', 'rb-insp-val');
    txt.textContent = displayVal;
    cinp.addEventListener('input', function() {
      swatch.style.background = cinp.value;
      swatch.style.backgroundSize = '';
      swatch.style.backgroundPosition = '';
      txt.textContent = cinp.value;
      applyStyle(el, prop, cinp.value);
    }, {signal: sig});
    swatch.appendChild(cinp);
    txt.style.cssText = 'cursor:pointer;flex:1;background:none;padding:0;';
    txt.addEventListener('click', function() {
      txt.contentEditable = 'true';
      txt.focus();
      // txt lives in HOST (inspector swatch label), so the selection is on
      // the host window. In extension mode hostWin === window.
      var range = hostDoc.createRange();
      range.selectNodeContents(txt);
      var sel = hostWin.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    });
    txt.addEventListener('blur', function() {
      txt.contentEditable = 'false';
      var newVal = txt.textContent.trim();
      if (/^#[0-9a-fA-F]{3,8}$/.test(newVal)) {
        swatch.style.background = newVal;
        cinp.value = newVal;
        applyStyle(el, prop, newVal);
      }
    });
    txt.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') { e.preventDefault(); txt.blur(); }
    });
    var alphaMatch = value.match(/rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
    var curAlpha = alphaMatch && alphaMatch[4] !== undefined ? Math.round(parseFloat(alphaMatch[4]) * 100) : 100;
    var divider = mk('div', 'rb-insp-field-divider');
    divider.style.cssText = 'width:1px;align-self:stretch;flex-shrink:0;';
    var alphaInp = mk('input', 'rb-insp-inp');
    alphaInp.value = curAlpha + '%';
    alphaInp.style.cssText = 'width:42px;text-align:right;flex:none;background:none;';
    alphaInp.addEventListener('change', function() {
      var pct = parseInt(alphaInp.value) || 100;
      pct = Math.max(0, Math.min(100, pct));
      alphaInp.value = pct + '%';
      var hv = cinp.value;
      var r = parseInt(hv.slice(1,3),16), g = parseInt(hv.slice(3,5),16), b = parseInt(hv.slice(5,7),16);
      var rgba = 'rgba(' + r + ',' + g + ',' + b + ',' + (pct/100) + ')';
      swatch.style.background = rgba;
      txt.textContent = hv;
      applyStyle(el, prop, rgba);
    }, {signal: sig});
    wrap.appendChild(swatch);
    wrap.appendChild(txt);
    wrap.appendChild(divider);
    wrap.appendChild(alphaInp);
    addRow(parent, label, wrap);
  }

  // ============ UPDATE INSPECTOR ============

  function updateInspector(el) {
    var scrollPos = inspector ? inspector.scrollTop : 0;
    // Font dropdown is appended to <body> (to escape inspector's overflow
    // clip) — rebuild orphans it, so clean up any previous instance first.
    var staleDrop = hostDoc.body.querySelector(':scope > .rb-insp-font-drop');
    if (staleDrop) staleDrop.remove();
    inspBody.innerHTML = '';
    inspector.classList.remove('rb-insp-ghost');
    var cs = getCS(el);
    // Text-wrapper aware style read: for elements that wrap nested text (split-text
    // patterns), typography reads should reflect the actual rendered text on the
    // leaves, not the wrapper's inherited values.
    var csT = getCS(getReadEl(el));
    function isTextMixed(prop) {
      var v = readTextStyle(el, prop);
      return v && typeof v === 'object' && v.mixed;
    }
    var r = getBox(el);

    // Breadcrumb
    var breadcrumb = mk('div', 'rb-ed-breadcrumb');
    var chain = [];
    var bcWalk = el;
    while (bcWalk && bcWalk !== targetDoc.body && chain.length < 6) {
      chain.unshift(bcWalk);
      bcWalk = bcWalk.parentElement;
    }
    chain.forEach(function(ancestor, i) {
      if (i > 0) {
        var sep = mk('span', 'rb-ed-crumb-sep');
        sep.textContent = '\u203A';
        breadcrumb.appendChild(sep);
      }
      var crumb = mk('button', 'rb-ed-crumb');
      var tag = ancestor.tagName.toLowerCase();
      var cls = '';
      if (ancestor.className && typeof ancestor.className === 'string') {
        var first = ancestor.className.split(' ').filter(function(c) {
          return c.indexOf('rb-') === -1 && c.length < 20;
        })[0];
        if (first) cls = '.' + first;
      }
      crumb.textContent = tag + cls;
      if (ancestor === el) crumb.classList.add('rb-ed-crumb-active');
      crumb.addEventListener('click', function() {
        selectEl(ancestor);
      });
      breadcrumb.appendChild(crumb);
    });
    // Insert breadcrumb before inspBody (outside scroll area), remove old one first
    var oldBc = inspector.querySelector('.rb-ed-breadcrumb');
    if (oldBc) oldBc.remove();
    inspector.insertBefore(breadcrumb, inspBody);

    // ---- LINK ----
    // Matches the Fill/Stroke/Effects empty-state pattern: collapsed section with
    // a "+" when no link, expanded section with an editable URL field + "−" when
    // there is one. "+" click expands the section inline (no popup) and focuses
    // an input. DOM changes go through pushUndo so Cmd+Z rolls them back.
    var existingLink = getElementLink(el);
    var hasLink = !!existingLink;
    var linkSec = addSection('Link', !hasLink);
    var linkHd = linkSec.parentElement.querySelector('.rb-insp-sec-hd');
    function normalizeHref(v) {
      v = String(v || '').trim();
      if (!v) return '';
      if (/^[a-z]+:\/\//i.test(v) || v.startsWith('mailto:') || v.startsWith('tel:') ||
          v.startsWith('#') || v.startsWith('/')) return v;
      return 'https://' + v;
    }
    function buildLinkInputRow(initialVal, autoFocus) {
      var row = mk('div');
      row.style.cssText = 'display:flex;align-items:center;gap:4px;';
      var field = mk('div', 'rb-insp-field-wrap');
      var icon = mk('span', 'rb-insp-field-icon');
      icon.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M10 13a5 5 0 007.07 0l3-3a5 5 0 00-7.07-7.07L11 5"/><path d="M14 11a5 5 0 00-7.07 0l-3 3a5 5 0 007.07 7.07L13 19"/></svg>';
      var inp = mk('input', 'rb-insp-inp');
      inp.type = 'url';
      inp.placeholder = 'https://…';
      inp.value = initialVal || '';
      inp.defaultValue = initialVal || '';
      field.appendChild(icon);
      field.appendChild(inp);
      row.appendChild(field);
      var committed = false;
      function commit(revert) {
        if (committed) return; committed = true;
        var v = normalizeHref(inp.value);
        var orig = normalizeHref(initialVal);
        if (revert || v === orig) { updateInspector(el); return; }
        if (!v) {
          // cleared → remove link if existed
          var a = getElementLink(el);
          if (a) unwrapLink(a);
        } else {
          var cur = getElementLink(el);
          if (cur) {
            var old = cur.getAttribute('href');
            if (old !== v) {
              cur.setAttribute('href', v);
              pushUndo({ prop: '__hrefChange', anchor: cur, oldHref: old, newHref: v });
            }
          } else {
            wrapInLink(el, v);
          }
        }
        updateInspector(el);
      }
      inp.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') { e.preventDefault(); commit(false); }
        else if (e.key === 'Escape') { e.preventDefault(); commit(true); }
      });
      inp.addEventListener('blur', function() { commit(false); });
      inp.addEventListener('mousedown', function(e) { e.stopImmediatePropagation(); });
      if (autoFocus) setTimeout(function() { inp.focus(); inp.select(); }, 0);
      return row;
    }
    if (!hasLink) {
      linkSec.parentElement.classList.add('rb-insp-sec-empty');
      var addLinkBtn = mk('button', 'rb-insp-add-btn');
      addLinkBtn.textContent = '+';
      addLinkBtn.title = 'Add link';
      addLinkBtn.addEventListener('mousedown', function(e) {
        e.stopImmediatePropagation();
        // Expand the section in-place and focus an empty input (no popup).
        var sec = linkSec.parentElement;
        sec.classList.remove('rb-insp-sec-empty');
        sec.classList.remove('collapsed');
        addLinkBtn.remove();
        var cancelBtn = mk('button', 'rb-insp-add-btn');
        cancelBtn.innerHTML = '−';
        cancelBtn.title = 'Cancel';
        cancelBtn.addEventListener('mousedown', function(e2) {
          e2.stopImmediatePropagation();
          updateInspector(el);
        }, {capture: true, signal: sig});
        linkHd.querySelector('div').appendChild(cancelBtn);
        linkSec.appendChild(buildLinkInputRow('', true));
      }, {capture: true, signal: sig});
      linkHd.querySelector('div').appendChild(addLinkBtn);
    } else {
      var rmLinkBtn = mk('button', 'rb-insp-add-btn');
      rmLinkBtn.innerHTML = '−';
      rmLinkBtn.title = 'Remove link';
      rmLinkBtn.addEventListener('mousedown', function(e) {
        e.stopImmediatePropagation();
        var a = getElementLink(el);
        if (a) unwrapLink(a);
        updateInspector(el);
      }, {capture: true, signal: sig});
      linkHd.querySelector('div').appendChild(rmLinkBtn);
      linkSec.appendChild(buildLinkInputRow(existingLink.getAttribute('href') || '', false));
    }

    // ---- CONTAINER ----
    var posSec = addSection('Container', false, function(btn) {
      openSettingsPopup('Container', btn, function(popup) {
        addSelect(popup, 'Display', ['block','flex','grid','inline','inline-block','none'], cs.display, el, 'display');
        addSelect(popup, 'Position', ['static','relative','absolute','fixed','sticky'], cs.position, el, 'position');
      });
    });

    // Alignment row (3 horizontal icons — vertical disabled for now)
    var IC14 = 'width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"';
    var alignRow = mk('div', 'rb-insp-align-row');
    // Detect current horizontal alignment state
    var curAlignSelf = cs.alignSelf || 'auto';
    var curMarginL = cs.marginLeft;
    var curMarginR = cs.marginRight;
    var curTextAlign = cs.textAlign;
    var posAlignState = 'left'; // default
    if (curAlignSelf === 'center' || (curMarginL === 'auto' && curMarginR === 'auto') || curTextAlign === 'center' || curTextAlign === '-webkit-center') {
      posAlignState = 'center';
    } else if (curAlignSelf === 'flex-end' || curAlignSelf === 'end' || (curMarginL === 'auto' && curMarginR !== 'auto') || curTextAlign === 'right') {
      posAlignState = 'right';
    }
    var aligns = [
      {svg: '<svg '+IC14+'><line x1="2" y1="2" x2="2" y2="14" stroke-width="2"/><line x1="4" y1="4" x2="13" y2="4"/><line x1="4" y1="8" x2="10" y2="8"/><line x1="4" y1="12" x2="13" y2="12"/></svg>',
       title: 'Align left', state: 'left', fn: function() { el.style.setProperty('text-align', 'left', 'important'); el.style.setProperty('align-self', 'flex-start', 'important'); el.style.setProperty('margin-left', '', ''); el.style.setProperty('margin-right', 'auto', 'important'); }},
      {svg: '<svg '+IC14+'><line x1="3" y1="4" x2="13" y2="4"/><line x1="5" y1="8" x2="11" y2="8"/><line x1="3" y1="12" x2="13" y2="12"/><line x1="8" y1="2" x2="8" y2="14" stroke-width="2"/></svg>',
       title: 'Center H', state: 'center', fn: function() { el.style.setProperty('text-align', 'center', 'important'); el.style.setProperty('align-self', 'center', 'important'); el.style.setProperty('margin-left', 'auto', 'important'); el.style.setProperty('margin-right', 'auto', 'important'); }},
      {svg: '<svg '+IC14+'><line x1="14" y1="2" x2="14" y2="14" stroke-width="2"/><line x1="3" y1="4" x2="12" y2="4"/><line x1="6" y1="8" x2="12" y2="8"/><line x1="3" y1="12" x2="12" y2="12"/></svg>',
       title: 'Align right', state: 'right', fn: function() { el.style.setProperty('text-align', 'right', 'important'); el.style.setProperty('align-self', 'flex-end', 'important'); el.style.setProperty('margin-left', 'auto', 'important'); el.style.setProperty('margin-right', '', ''); }}
    ];
    aligns.forEach(function(a) {
      var btn = mk('button', 'rb-insp-align-btn');
      btn.innerHTML = a.svg;
      btn.title = a.title;
      if (a.state === posAlignState) btn.classList.add('active');
      btn.addEventListener('click', function() {
        a.fn();
        updateSelBox(el);
        updateSpacingGuides(el);
        alignRow.querySelectorAll('.rb-insp-align-btn').forEach(function(b) { b.classList.remove('active'); });
        btn.classList.add('active');
      });
      alignRow.appendChild(btn);
    });
    // Alignment + Rotation side by side
    var alignRotRow = mk('div');
    alignRotRow.style.cssText = 'display:flex;gap:6px;align-items:stretch;';
    var alignWrap = mk('div');
    alignWrap.style.cssText = 'flex:1;display:flex;flex-direction:column;gap:3px;';
    var alignLbl = mk('span', 'rb-insp-lbl'); alignLbl.textContent = 'Alignment';
    alignWrap.appendChild(alignLbl);
    alignRow.style.cssText += ';flex:1;';
    alignWrap.appendChild(alignRow);
    var rotWrap = mk('div');
    rotWrap.style.cssText = 'flex:1;display:flex;flex-direction:column;gap:3px;';
    var rotLbl = mk('span', 'rb-insp-lbl'); rotLbl.textContent = 'Rotation';
    rotWrap.appendChild(rotLbl);
    addInput(rotWrap, '', (!cs.transform || cs.transform === 'none') ? '0\u00B0' : cs.transform, el, 'transform');
    alignRotRow.appendChild(alignWrap);
    alignRotRow.appendChild(rotWrap);
    posSec.appendChild(alignRotRow);

    // X/Y position
    var posRow = mk('div', 'rb-insp-pos-row');
    // Labeled numeric field (letter is a non-selectable sibling span so users
    // can't ever clear it, unlike the pre-refactor inputs that had the letter
    // INSIDE the value string). Empty/invalid inputs revert to the field's
    // original numeric value instead of wiping the CSS property.
    function labeledNumField(letter, numVal, onCommit) {
      var f = mk('div', 'rb-insp-field-bg');
      f.style.cssText = 'display:flex;align-items:center;border-radius:4px;overflow:hidden;flex:1;';
      var lbl = mk('span', 'rb-insp-field-letter');
      lbl.textContent = letter;
      var inp = mk('input', 'rb-insp-inp');
      var initial = String(Math.round(numVal));
      inp.value = initial;
      inp.defaultValue = initial;
      inp.style.cssText = 'flex:1;background:none;border:none;padding:5px 2px;text-align:left;min-width:0;';
      inp.addEventListener('change', function() {
        var v = inp.value.trim();
        var n = parseInt(v.replace(/[^0-9-]/g, ''), 10);
        if (v === '' || isNaN(n)) {
          inp.value = inp.defaultValue;
          return;
        }
        inp.defaultValue = String(n);
        inp.value = String(n);
        onCommit(n);
      });
      f.appendChild(lbl);
      f.appendChild(inp);
      return f;
    }

    // X/Y are in the element's own positioning context, not viewport:
    //  - static  → show 0,0; first write promotes to position:relative so left/top
    //              stop being no-ops (common case: h1 inside a hero section).
    //  - relative→ read cs.left/top (current offset from flow position).
    //  - abs/fix → use offsetLeft/offsetTop (distance from offsetParent).
    function ensurePositionable(e) {
      var p = getCS(e).position;
      if (!p || p === 'static') applyStyle(e, 'position', 'relative');
    }
    function readPosXY(e) {
      var p = getCS(e).position;
      if (p === 'relative') {
        return { x: parseFloat(getCS(e).left) || 0, y: parseFloat(getCS(e).top) || 0 };
      }
      if (p === 'absolute' || p === 'fixed' || p === 'sticky') {
        return { x: e.offsetLeft || 0, y: e.offsetTop || 0 };
      }
      return { x: 0, y: 0 };
    }
    var posXY = readPosXY(el);
    posRow.appendChild(labeledNumField('X', posXY.x, function(v) {
      ensurePositionable(el);
      applyStyle(el, 'left', v + 'px');
    }));
    posRow.appendChild(labeledNumField('Y', posXY.y, function(v) {
      ensurePositionable(el);
      applyStyle(el, 'top',  v + 'px');
    }));
    posRow.style.cssText = 'display:flex;gap:6px;';
    addRow(posSec, 'Position', posRow);

    // Dimensions W x H (part of Container)
    var dimRow = mk('div');
    dimRow.style.cssText = 'display:flex;gap:6px;';
    dimRow.appendChild(labeledNumField('W', r.width,  function(v) { applyStyle(el, 'width',  v + 'px'); }));
    dimRow.appendChild(labeledNumField('H', r.height, function(v) { applyStyle(el, 'height', v + 'px'); }));
    addRow(posSec, 'Dimensions', dimRow);

    // Spacing (T/R/B/L) as visual box
    var spacingRow = mk('div', 'rb-insp-spacing-box');
    var sides = [
      {label: 'T', prop: 'paddingTop'},
      {label: 'R', prop: 'paddingRight'},
      {label: 'B', prop: 'paddingBottom'},
      {label: 'L', prop: 'paddingLeft'}
    ];
    sides.forEach(function(s) {
      var field = mk('div', 'rb-insp-field-bg');
      field.style.cssText = 'display:flex;flex-direction:row;align-items:center;border-radius:4px;overflow:hidden;flex:1;';
      var letter = mk('span', 'rb-insp-field-letter');
      letter.textContent = s.label;
      var inp = mk('input', 'rb-insp-inp');
      var initial = String(parseInt(cs[s.prop]) || 0);
      inp.value = initial;
      inp.defaultValue = initial;
      inp.style.cssText = 'width:32px;text-align:center;background:none;border:none;padding:5px 2px;';
      inp.addEventListener('change', function() {
        var v = inp.value.trim();
        var n = parseInt(v.replace(/[^0-9-]/g, ''), 10);
        if (v === '' || isNaN(n)) { inp.value = inp.defaultValue; return; }
        inp.defaultValue = String(n);
        inp.value = String(n);
        applyStyle(el, s.prop, n + 'px');
      });
      field.appendChild(letter);
      field.appendChild(inp);
      spacingRow.appendChild(field);
    });
    addRow(posSec, 'Spacing', spacingRow);

    // ---- APPEARANCE ----
    var appSec = addSection('Appearance', false);
    var appRow = mk('div');
    appRow.style.cssText = 'display:flex;gap:6px;';
    var appOpWrap = mk('div');
    appOpWrap.style.cssText = 'flex:1;display:flex;flex-direction:column;gap:3px;';
    var appOpLbl = mk('span', 'rb-insp-lbl'); appOpLbl.textContent = 'Opacity';
    appOpWrap.appendChild(appOpLbl);
    var opInp = addInput(appOpWrap, '', Math.round(parseFloat(cs.opacity) * 100) + '%', el, 'opacity');
    var appRdWrap = mk('div');
    appRdWrap.style.cssText = 'flex:1;display:flex;flex-direction:column;gap:3px;';
    var appRdLbl = mk('span', 'rb-insp-lbl'); appRdLbl.textContent = 'Radius';
    appRdWrap.appendChild(appRdLbl);
    var rdInp = addInput(appRdWrap, '', cs.borderRadius, el, 'borderRadius');
    appRow.appendChild(appOpWrap);
    appRow.appendChild(appRdWrap);
    appSec.appendChild(appRow);

    // ---- TYPOGRAPHY ----
    var typSec = addSection('Typography', false, function(btn) {
      openSettingsPopup('Typography', btn, function(popup) {
        // Case (text-transform)
        var IC18t = 'width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"';
        var caseRowP = mk('div', 'rb-insp-align-row');
        var casesP = [
          {svg: '<svg '+IC18t+'><line x1="4" y1="10" x2="16" y2="10" stroke-width="2"/></svg>', val: 'none', title: 'None'},
          {svg: '<svg '+IC18t+'><text x="1" y="15" font-size="13" font-weight="500" fill="currentColor" stroke="none" font-family="sans-serif">AG</text></svg>', val: 'uppercase', title: 'UPPERCASE'},
          {svg: '<svg '+IC18t+'><text x="3" y="15" font-size="14" font-weight="400" fill="currentColor" stroke="none" font-family="sans-serif">ag</text></svg>', val: 'lowercase', title: 'lowercase'},
          {svg: '<svg '+IC18t+'><text x="2" y="15" font-size="14" font-weight="400" fill="currentColor" stroke="none" font-family="sans-serif">Ag</text></svg>', val: 'capitalize', title: 'Sentence Case'}
        ];
        casesP.forEach(function(c) {
          var b = mk('button', 'rb-insp-align-btn'); b.innerHTML = c.svg; b.title = c.title;
          if (csT.textTransform === c.val) b.classList.add('active');
          b.addEventListener('click', function() {
            applyStyle(el, 'textTransform', c.val);
            caseRowP.querySelectorAll('.rb-insp-align-btn').forEach(function(x) { x.classList.remove('active'); });
            b.classList.add('active');
          });
          caseRowP.appendChild(b);
        });
        addRow(popup, 'Case', caseRowP);

        // Decoration (text-decoration)
        var decRowP = mk('div', 'rb-insp-align-row');
        var decsP = [
          {svg: '<svg '+IC18t+'><line x1="4" y1="10" x2="16" y2="10" stroke-width="2"/></svg>', val: 'none', title: 'None'},
          {svg: '<svg '+IC18t+'><text x="4" y="13" font-size="13" font-weight="600" fill="currentColor" stroke="none" font-family="sans-serif">U</text><line x1="4" y1="16" x2="14" y2="16" stroke-width="1.5"/></svg>', val: 'underline', title: 'Underline'},
          {svg: '<svg '+IC18t+'><text x="3" y="15" font-size="15" font-weight="400" fill="currentColor" stroke="none" font-family="sans-serif">S</text><line x1="2" y1="10" x2="16" y2="10" stroke-width="1.5"/></svg>', val: 'line-through', title: 'Strikethrough'}
        ];
        decsP.forEach(function(d) {
          var b = mk('button', 'rb-insp-align-btn'); b.innerHTML = d.svg; b.title = d.title;
          if (csT.textDecorationLine === d.val || csT.textDecoration.indexOf(d.val) !== -1) b.classList.add('active');
          b.addEventListener('click', function() {
            applyStyle(el, 'textDecoration', d.val);
            decRowP.querySelectorAll('.rb-insp-align-btn').forEach(function(x) { x.classList.remove('active'); });
            b.classList.add('active');
          });
          decRowP.appendChild(b);
        });
        addRow(popup, 'Decoration', decRowP);

        // Style (bold / italic toggles)
        var styleRowP = mk('div', 'rb-insp-align-row');
        var curWeight = parseInt(csT.fontWeight) || 400;
        var curStyle = csT.fontStyle || 'normal';
        var boldBtn = mk('button', 'rb-insp-align-btn');
        boldBtn.innerHTML = '<svg '+IC18t+'><text x="3" y="15" font-size="14" font-weight="800" fill="currentColor" stroke="none" font-family="sans-serif">B</text></svg>';
        boldBtn.title = 'Bold';
        if (curWeight >= 700) boldBtn.classList.add('active');
        boldBtn.addEventListener('click', function() {
          var next = boldBtn.classList.contains('active') ? '400' : '700';
          applyStyle(el, 'fontWeight', next);
          boldBtn.classList.toggle('active');
        });
        var italicBtn = mk('button', 'rb-insp-align-btn');
        italicBtn.innerHTML = '<svg '+IC18t+'><text x="4" y="15" font-size="14" font-style="italic" font-family="serif" fill="currentColor" stroke="none">I</text></svg>';
        italicBtn.title = 'Italic';
        if (curStyle === 'italic' || curStyle === 'oblique') italicBtn.classList.add('active');
        italicBtn.addEventListener('click', function() {
          var next = italicBtn.classList.contains('active') ? 'normal' : 'italic';
          applyStyle(el, 'fontStyle', next);
          italicBtn.classList.toggle('active');
        });
        styleRowP.appendChild(boldBtn);
        styleRowP.appendChild(italicBtn);
        addRow(popup, 'Style', styleRowP);
      });
    });
    // Font family — search-as-you-type combobox. Typing filters the list; the
    // chevron toggles the full list. Input can't be cleared (blur restores).
    // For text wrappers with nested leaves, display EVERY distinct font used so
    // designers see what's inside at a glance (e.g., "Clearface, Geist").
    function firstFontToken(raw) {
      return String(raw || '').split(',')[0].replace(/['"]/g, '').trim();
    }
    var curFonts = [];
    if (isTextWrapper(el)) {
      getTextLeaves(el).forEach(function(leaf) {
        var f = firstFontToken(getCS(leaf).fontFamily);
        if (f && curFonts.indexOf(f) < 0) curFonts.push(f);
      });
    }
    if (!curFonts.length) curFonts.push(firstFontToken(csT.fontFamily));
    var curFont = curFonts.join(', ');
    var webSafe = ['Arial','Helvetica','Verdana','Georgia','Times New Roman','Courier New','system-ui','Roboto','Inter'];
    var allFonts = webSafe.slice();
    curFonts.forEach(function(f) { if (f && allFonts.indexOf(f) < 0) allFonts.unshift(f); });

    var fontWrap = mk('div', 'rb-insp-field-wrap');
    fontWrap.style.cssText = 'display:flex;align-items:center;border-radius:4px;position:relative;';
    var fontIcon = mk('span', 'rb-insp-field-icon');
    fontIcon.innerHTML = '<svg width="12" height="12" viewBox="0 0 36.23 42.5" fill="#fff"><polygon points="25.58 14.61 10.21 14.61 10.21 17.22 10.22 17.22 10.22 19.84 12.83 19.84 12.83 17.22 16.59 17.22 16.59 28.77 14.52 28.77 14.52 31.38 21.28 31.38 21.28 28.77 19.2 28.77 19.2 17.22 23 17.22 23 19.84 25.61 19.84 25.61 14.61 25.58 14.61"/><path d="M34.31,9.33l-7.41-7.41c-1.24-1.24-2.89-1.93-4.65-1.93H5.72C2.57,0,0,2.57,0,5.72v31.06c0,3.15,2.57,5.72,5.72,5.72h24.79c3.15,0,5.72-2.57,5.72-5.72V13.98c0-1.73-.7-3.42-1.93-4.65ZM33.06,13.98v22.79c0,1.43-1.12,2.54-2.54,2.54H5.72c-1.43,0-2.54-1.12-2.54-2.54V5.72c0-1.43,1.12-2.54,2.54-2.54h16.53c.91,0,1.76.35,2.4,1l7.41,7.41c.64.64,1,1.5,1,2.4Z"/></svg>';
    fontWrap.appendChild(fontIcon);

    var fontInput = mk('input', 'rb-insp-inp rb-insp-font-sel');
    fontInput.type = 'text';
    fontInput.value = curFont;
    fontInput.defaultValue = curFont;
    fontInput.style.cssText = 'flex:1;background:none;border:none;padding:5px 4px;min-width:0;';
    fontWrap.appendChild(fontInput);

    var fontDivider = mk('div', 'rb-insp-field-divider');
    fontDivider.style.cssText = 'width:1px;align-self:stretch;flex-shrink:0;';
    fontWrap.appendChild(fontDivider);
    var fontChev = mk('div', 'rb-insp-field-chev');
    fontChev.style.cssText = 'display:flex;align-items:center;justify-content:center;width:22px;flex-shrink:0;cursor:pointer;';
    fontChev.innerHTML = '<svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 9l6 6 6-6"/></svg>';
    fontWrap.appendChild(fontChev);

    // Dropdown is position:FIXED and appended to document.body, NOT to fontWrap.
    // The inspector panel (#rb-editor-inspector) has overflow:hidden and its body
    // (#rb-ed-insp-body) has overflow-y:auto — an absolute-positioned dropdown
    // inside was getting clipped, making it appear "not to open". Fixed + body
    // append escapes both clippers; we just re-position on every show.
    var fontDrop = mk('div', 'rb-insp-font-drop');
    fontDrop.style.cssText = 'position:fixed;width:220px;background:#1A1A1A;border:1px solid rgba(255,255,255,0.08);border-radius:4px;max-height:240px;overflow-y:auto;display:none;z-index:2147483647;box-shadow:0 8px 24px rgba(0,0,0,0.4);';
    hostDoc.body.appendChild(fontDrop);
    function positionFontDrop() {
      var r = fontWrap.getBoundingClientRect();
      fontDrop.style.left = r.left + 'px';
      fontDrop.style.top  = (r.bottom + 2) + 'px';
      fontDrop.style.width = r.width + 'px';
    }

    function renderFontDrop(filter) {
      fontDrop.innerHTML = '';
      var f = (filter || '').toLowerCase().trim();
      var items = f ? allFonts.filter(function(n) { return n.toLowerCase().indexOf(f) >= 0; }) : allFonts.slice();
      if (!items.length) {
        var empty = mk('div');
        empty.textContent = 'No fonts match';
        empty.style.cssText = 'padding:6px 10px;color:rgba(239,238,235,0.4);font-size:11px;';
        fontDrop.appendChild(empty);
        return;
      }
      items.forEach(function(name) {
        var opt = mk('div', 'rb-insp-font-opt');
        opt.textContent = name;
        opt.style.cssText = 'padding:6px 10px;font-size:11px;cursor:pointer;color:#EFEEEB;font-family:"' + name + '",sans-serif;';
        opt.addEventListener('mouseenter', function() { opt.style.background = 'rgba(255,255,255,0.06)'; });
        opt.addEventListener('mouseleave', function() { opt.style.background = ''; });
        opt.addEventListener('mousedown', function(e) {
          e.preventDefault(); e.stopImmediatePropagation();
          fontInput.value = name;
          fontInput.defaultValue = name;
          applyStyle(el, 'fontFamily', name);
          hideFontDrop();
          fontInput.blur();
        }, {capture: true});
        fontDrop.appendChild(opt);
      });
    }
    function showFontDrop() { renderFontDrop(fontInput.value); positionFontDrop(); fontDrop.style.display = 'block'; }
    function hideFontDrop() { fontDrop.style.display = 'none'; }

    fontInput.addEventListener('focus', function() { showFontDrop(); });
    fontInput.addEventListener('input', function() {
      if (fontDrop.style.display !== 'block') showFontDrop();
      else renderFontDrop(fontInput.value);
    });
    fontInput.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') { fontInput.value = fontInput.defaultValue; hideFontDrop(); fontInput.blur(); }
      else if (e.key === 'Enter') {
        var v = fontInput.value.trim();
        if (v && v !== fontInput.defaultValue) {
          fontInput.defaultValue = v; applyStyle(el, 'fontFamily', v);
        } else if (!v) {
          fontInput.value = fontInput.defaultValue;
        }
        hideFontDrop();
        fontInput.blur();
      }
    });
    fontInput.addEventListener('blur', function() {
      setTimeout(hideFontDrop, 150);  // allow click on option
      if (!fontInput.value.trim()) fontInput.value = fontInput.defaultValue;
    });
    fontChev.addEventListener('mousedown', function(e) {
      e.preventDefault(); e.stopImmediatePropagation();
      if (fontDrop.style.display === 'block') { hideFontDrop(); fontInput.blur(); }
      else { fontInput.focus(); renderFontDrop(''); }  // chevron shows full list
    }, {capture: true});

    // Async-load local fonts into the list once available
    getLocalFonts(function(locals) {
      if (!locals || !locals.length) return;
      locals.forEach(function(f) { if (allFonts.indexOf(f) < 0) allFonts.push(f); });
      if (fontDrop.style.display === 'block') renderFontDrop(fontInput.value);
    });

    addRow(typSec, 'Font', fontWrap);

    // Weight + Size row
    // Weight + Size side by side with labels
    var wsRow = mk('div');
    wsRow.style.cssText = 'display:flex;gap:6px;';
    var weightWrap = mk('div');
    weightWrap.style.cssText = 'flex:1;display:flex;flex-direction:column;gap:3px;';
    var weightLbl = mk('span', 'rb-insp-lbl'); weightLbl.textContent = 'Weight';
    weightWrap.appendChild(weightLbl);
    var weightSel = mk('select', 'rb-insp-inp');
    ['100','200','300','400','500','600','700','800','900'].forEach(function(w) {
      var o = mk('option'); o.value = w; o.textContent = w;
      if (w === csT.fontWeight) o.selected = true;
      weightSel.appendChild(o);
    });
    weightSel.addEventListener('change', function() { applyStyle(el, 'fontWeight', weightSel.value); });
    weightWrap.appendChild(weightSel);

    var sizeWrap = mk('div');
    sizeWrap.style.cssText = 'flex:1;display:flex;flex-direction:column;gap:3px;';
    var sizeLbl = mk('span', 'rb-insp-lbl'); sizeLbl.textContent = 'Size';
    sizeWrap.appendChild(sizeLbl);
    addInput(sizeWrap, '', csT.fontSize, el, 'fontSize');

    wsRow.appendChild(weightWrap);
    wsRow.appendChild(sizeWrap);
    typSec.appendChild(wsRow);

    // Line height + Letter spacing — side by side, icons inside fields
    var lhLsRow = mk('div');
    lhLsRow.style.cssText = 'display:flex;gap:6px;';

    // Line height field with icon inside
    var lhWrap = mk('div');
    lhWrap.style.cssText = 'flex:1;display:flex;flex-direction:column;gap:2px;';
    var lhLabel = mk('span', 'rb-insp-lbl');
    lhLabel.textContent = 'Line height';
    var lhField = mk('div');
    lhField.className = 'rb-insp-field-bg';
    lhField.style.cssText = 'display:flex;align-items:center;border-radius:4px;padding:0 4px;';
    var lhIcon = mk('span');
    lhIcon.innerHTML = '<svg width="12" height="12" viewBox="0 0 39.24 34.36" fill="#fff"><path d="M37.56,31.36c.93,0,1.68.67,1.68,1.5s-.75,1.5-1.68,1.5H1.68c-.93,0-1.68-.67-1.68-1.5s.75-1.5,1.68-1.5h35.87Z"/><path fill-rule="evenodd" d="M16.38,7.47c1.14-3.02,5.41-3.02,6.55,0l7.12,18.97c.29.78-.1,1.64-.88,1.93-.78.29-1.64-.1-1.93-.88l-1.89-5.03h-11.41l-1.89,5.03c-.29.78-1.15,1.17-1.93.88-.78-.29-1.17-1.15-.88-1.93l7.13-18.97ZM20.12,8.53c-.16-.43-.77-.43-.94,0l-4.11,10.94h9.16l-4.11-10.94Z"/><path d="M37.56,0c.93,0,1.68.67,1.68,1.5s-.75,1.5-1.68,1.5H1.68c-.93,0-1.68-.67-1.68-1.5S.75,0,1.68,0h35.87Z"/></svg>';
    lhIcon.className = 'rb-insp-field-icon';
    var lhInp = mk('input', 'rb-insp-inp');
    lhInp.value = csT.lineHeight === 'normal' ? 'auto' : (Math.round(parseFloat(csT.lineHeight) / parseFloat(csT.fontSize) * 100) + '%');
    lhInp.style.cssText = 'flex:1;background:none;border:none;padding:5px 0;';
    lhInp.addEventListener('change', function() {
      var v = lhInp.value.trim();
      if (v.indexOf('%') !== -1) v = String(parseFloat(v) / 100);
      applyStyle(el, 'lineHeight', v);
    });
    lhIcon.classList.add('rb-insp-drag-icon');
    lhIcon.addEventListener('mousedown', function(e) {
      e.preventDefault(); e.stopImmediatePropagation();
      var startX = e.clientX;
      var startVal = parseFloat(lhInp.value) || 100;
      var onMove = function(me) {
        var delta = Math.round((me.clientX - startX) / 2);
        var nv = Math.max(0, startVal + delta);
        lhInp.value = nv + '%';
        applyStyle(el, 'lineHeight', String(nv / 100));
      };
      var onUp = function() {
        hostDoc.removeEventListener('mousemove', onMove);
        hostDoc.removeEventListener('mouseup', onUp);
      };
      hostDoc.addEventListener('mousemove', onMove);
      hostDoc.addEventListener('mouseup', onUp);
    }, {capture: true, signal: sig});
    lhField.appendChild(lhIcon);
    lhField.appendChild(lhInp);
    lhWrap.appendChild(lhLabel);
    lhWrap.appendChild(lhField);

    // Letter spacing field with icon inside
    var lsWrap = mk('div');
    lsWrap.style.cssText = 'flex:1;display:flex;flex-direction:column;gap:2px;';
    var lsLabel = mk('span', 'rb-insp-lbl');
    lsLabel.textContent = 'Letter spacing';
    var lsField = mk('div');
    lsField.className = 'rb-insp-field-bg';
    lsField.style.cssText = 'display:flex;align-items:center;border-radius:4px;padding:0 4px;';
    var lsIcon = mk('span');
    lsIcon.innerHTML = '<svg width="12" height="12" viewBox="0 0 39 35" fill="#fff"><path d="M3,33.5c0,.83-.67,1.5-1.5,1.5s-1.5-.67-1.5-1.5V1.5C0,.67.67,0,1.5,0s1.5.67,1.5,1.5v32Z"/><path fill-rule="evenodd" d="M16.23,8c1.14-3.02,5.41-3.02,6.55,0l7.12,18.97c.29.78-.1,1.64-.88,1.93-.78.29-1.64-.1-1.93-.88l-1.89-5.03h-11.41l-1.89,5.03c-.29.78-1.15,1.17-1.93.88-.78-.29-1.17-1.15-.88-1.93l7.13-18.97ZM19.97,9.06c-.16-.43-.77-.43-.94,0l-4.11,10.94h9.16l-4.11-10.94Z"/><path d="M39,33.5c0,.83-.67,1.5-1.5,1.5s-1.5-.67-1.5-1.5V1.5c0-.83.67-1.5,1.5-1.5s1.5.67,1.5,1.5v32Z"/></svg>';
    lsIcon.className = 'rb-insp-field-icon';
    var lsInp = mk('input', 'rb-insp-inp');
    var lsRaw = parseFloat(csT.letterSpacing) || 0;
    lsInp.value = (csT.letterSpacing === 'normal') ? '0%' : (Math.round(lsRaw / parseFloat(csT.fontSize) * 100) + '%');
    lsInp.style.cssText = 'flex:1;background:none;border:none;padding:5px 0;';
    lsInp.addEventListener('change', function() {
      var v = lsInp.value.trim();
      if (v.indexOf('%') !== -1) {
        var pct = parseFloat(v) || 0;
        v = (pct / 100 * parseFloat(csT.fontSize)) + 'px';
      }
      applyStyle(el, 'letterSpacing', v);
    });
    lsIcon.classList.add('rb-insp-drag-icon');
    lsIcon.addEventListener('mousedown', function(e) {
      e.preventDefault(); e.stopImmediatePropagation();
      var startX = e.clientX;
      var startVal = parseFloat(lsInp.value) || 0;
      var fSize = parseFloat(csT.fontSize) || 16;
      var onMove = function(me) {
        var delta = Math.round((me.clientX - startX) / 2);
        var nv = startVal + delta;
        lsInp.value = nv + '%';
        applyStyle(el, 'letterSpacing', (nv / 100 * fSize) + 'px');
      };
      var onUp = function() {
        hostDoc.removeEventListener('mousemove', onMove);
        hostDoc.removeEventListener('mouseup', onUp);
      };
      hostDoc.addEventListener('mousemove', onMove);
      hostDoc.addEventListener('mouseup', onUp);
    }, {capture: true, signal: sig});
    lsField.appendChild(lsIcon);
    lsField.appendChild(lsInp);
    lsWrap.appendChild(lsLabel);
    lsWrap.appendChild(lsField);

    lhLsRow.appendChild(lhWrap);
    lhLsRow.appendChild(lsWrap);
    addRow(typSec, '', lhLsRow);

    // Text alignment — horizontal (3) + separator + vertical position (3)
    var taRow = mk('div', 'rb-insp-align-row');
    var textAligns = [
      {svg: '<svg '+IC14+'><line x1="2" y1="4" x2="12" y2="4"/><line x1="2" y1="8" x2="9" y2="8"/><line x1="2" y1="12" x2="12" y2="12"/></svg>', val: 'left'},
      {svg: '<svg '+IC14+'><line x1="3" y1="4" x2="13" y2="4"/><line x1="4" y1="8" x2="12" y2="8"/><line x1="3" y1="12" x2="13" y2="12"/></svg>', val: 'center'},
      {svg: '<svg '+IC14+'><line x1="4" y1="4" x2="14" y2="4"/><line x1="7" y1="8" x2="14" y2="8"/><line x1="4" y1="12" x2="14" y2="12"/></svg>', val: 'right'}
    ];
    textAligns.forEach(function(a) {
      var btn = mk('button', 'rb-insp-align-btn');
      btn.innerHTML = a.svg;
      btn.title = 'Align ' + a.val;
      if (csT.textAlign === a.val) btn.classList.add('active');
      btn.addEventListener('click', function() {
        applyStyle(el, 'textAlign', a.val);
        taRow.querySelectorAll('.rb-insp-align-btn.rb-ta-h').forEach(function(b) { b.classList.remove('active'); });
        btn.classList.add('active');
      });
      btn.classList.add('rb-ta-h');
      taRow.appendChild(btn);
    });

    // Separator
    var taSep = mk('div');
    taSep.style.cssText = 'width:1px;align-self:stretch;background:rgba(255,255,255,0.08);margin:0 2px;';
    taRow.appendChild(taSep);

    // Vertical text position (top/center/bottom) — positions text within its div
    var vertAligns = [
      // Top: arrow pointing up + lines at top
      {svg: '<svg '+IC14+'><line x1="2" y1="2" x2="14" y2="2" stroke-width="2"/><line x1="4" y1="5" x2="12" y2="5"/><line x1="5" y1="8" x2="11" y2="8"/><line x1="4" y1="11" x2="12" y2="11" opacity="0.3"/></svg>',
       title: 'Align top', fn: function() { el.style.display = 'flex'; el.style.flexDirection = 'column'; el.style.justifyContent = 'flex-start'; }},
      // Center: lines centered with middle bar
      {svg: '<svg '+IC14+'><line x1="4" y1="3" x2="12" y2="3" opacity="0.3"/><line x1="5" y1="6" x2="11" y2="6"/><line x1="2" y1="8" x2="14" y2="8" stroke-width="2"/><line x1="5" y1="10" x2="11" y2="10"/><line x1="4" y1="13" x2="12" y2="13" opacity="0.3"/></svg>',
       title: 'Center V', fn: function() { el.style.display = 'flex'; el.style.flexDirection = 'column'; el.style.justifyContent = 'center'; }},
      // Bottom: arrow pointing down + lines at bottom
      {svg: '<svg '+IC14+'><line x1="4" y1="5" x2="12" y2="5" opacity="0.3"/><line x1="5" y1="8" x2="11" y2="8"/><line x1="4" y1="11" x2="12" y2="11"/><line x1="2" y1="14" x2="14" y2="14" stroke-width="2"/></svg>',
       title: 'Align bottom', fn: function() { el.style.display = 'flex'; el.style.flexDirection = 'column'; el.style.justifyContent = 'flex-end'; }}
    ];
    // Detect current vertical alignment state
    var vertState = '';
    if (cs.display === 'flex' && cs.flexDirection === 'column') {
      if (cs.justifyContent === 'center') vertState = 'center';
      else if (cs.justifyContent === 'flex-end' || cs.justifyContent === 'end') vertState = 'bottom';
      else vertState = 'top';
    }
    vertAligns.forEach(function(va) {
      var btn = mk('button', 'rb-insp-align-btn');
      btn.innerHTML = va.svg;
      btn.title = va.title;
      btn.classList.add('rb-ta-v');
      if ((va.title === 'Align top' && vertState === 'top') ||
          (va.title === 'Center V' && vertState === 'center') ||
          (va.title === 'Align bottom' && vertState === 'bottom')) {
        btn.classList.add('active');
      }
      btn.addEventListener('click', function() {
        va.fn();
        taRow.querySelectorAll('.rb-insp-align-btn.rb-ta-v').forEach(function(b) { b.classList.remove('active'); });
        btn.classList.add('active');
      });
      taRow.appendChild(btn);
    });
    addRow(typSec, 'Alignment', taRow);

    // Case and Decoration moved to Typography settings popup (⋯ icon)

    // Text colors detection — moved to Fill section below

    // ---- FILL ----
    var hasBg = cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent';
    var _fillBgImg = cs.backgroundImage;
    var _hasBgImg = _fillBgImg && _fillBgImg !== 'none';
    var _hasAnimation = cs.animationName && cs.animationName !== 'none';
    var _hasFxBefore = el.classList.contains('rb-fx-active');
    var hasBgAny = hasBg || _hasBgImg || _hasAnimation || _hasFxBefore;
    var _fillHasVisualEl = el.tagName === 'IMG' || el.tagName === 'SVG' || (el.tagName && el.tagName.toLowerCase() === 'svg') || el.querySelector(':scope > img') || el.querySelector(':scope > svg');
    // Check if element or children have text (for text color rows)
    var _hasTextColor = !!rgbHex(csT.color);
    var hasFill = hasBgAny || _fillHasVisualEl || _hasTextColor;
    var fillSec = addSection('Fill', !hasFill);
    var fillHd = fillSec.parentElement.querySelector('.rb-insp-sec-hd');
    if (!hasFill) {
      fillSec.parentElement.classList.add('rb-insp-sec-empty');
      var addFillBtn = mk('button', 'rb-insp-add-btn');
      addFillBtn.textContent = '+';
      addFillBtn.title = 'Add background';
      addFillBtn.addEventListener('mousedown', function(e) {
        e.stopImmediatePropagation();
        applyStyle(el, 'backgroundColor', isLight() ? '#E8E8E8' : '#1A1A1A');
        updateInspector(el);
      }, {capture: true, signal: sig});
      fillHd.querySelector('div').appendChild(addFillBtn);
    }
    // ---- BACKGROUND COLOR ROW (with fill popup) ----
    var bgRowOuter = mk('div', 'rb-fill-row-outer');
    var bgWrap = mk('div', 'rb-insp-color-row rb-insp-field-bg');
    bgWrap.style.cssText = 'display:flex;align-items:center;gap:6px;border-radius:4px;padding:0 6px;cursor:pointer;flex:1;min-width:0;';
    var bgSwatch = mk('div', 'rb-insp-swatch');
    // Type indicator icon (background)
    var bgHex = rgbHex(cs.backgroundColor);
    var bgDisplayVal, bgAlphaVal;
    var _hasCssGradient = _hasBgImg && _fillBgImg.indexOf('gradient') !== -1;
    // Detect what kind of background is active
    if (_hasFxBefore || _hasAnimation) {
      // Effect active via ::before — show effect name and opacity
      bgSwatch.style.cssText += 'overflow:hidden;';
      if (_hasBgImg) bgSwatch.style.backgroundImage = _fillBgImg;
      if (hasBg) bgSwatch.style.backgroundColor = cs.backgroundColor;
      bgSwatch.style.backgroundSize = 'cover';
      // Read current opacity from the per-element style tag
      var _fxOpacity = 100;
      var _fxStyleTag = el.id ? targetDoc.getElementById(el.id + '-rb-fx') : null;
      if (_fxStyleTag) {
        var opMatch = _fxStyleTag.textContent.match(/opacity\s*:\s*([\d.]+)/);
        if (opMatch) _fxOpacity = Math.round(parseFloat(opMatch[1]) * 100);
      }
      bgDisplayVal = 'effect';
      bgAlphaVal = _fxOpacity + '%';
    } else if (_hasCssGradient) {
      bgSwatch.style.background = _fillBgImg;
      bgDisplayVal = 'gradient';
      bgAlphaVal = '100%';
    } else if (hasBg) {
      bgSwatch.style.background = cs.backgroundColor;
      bgDisplayVal = bgHex || 'transparent';
      var bgAlphaMatch = cs.backgroundColor.match(/rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
      bgAlphaVal = (bgAlphaMatch && bgAlphaMatch[4] !== undefined ? Math.round(parseFloat(bgAlphaMatch[4]) * 100) : 100) + '%';
    } else {
      bgSwatch.style.background = 'linear-gradient(45deg,#ccc 25%,transparent 25%,transparent 75%,#ccc 75%),linear-gradient(45deg,#ccc 25%,transparent 25%,transparent 75%,#ccc 75%)';
      bgSwatch.style.backgroundSize = '8px 8px'; bgSwatch.style.backgroundPosition = '0 0, 4px 4px';
      bgDisplayVal = 'transparent';
      bgAlphaVal = '';
    }
    var bgTxt = mk('span', 'rb-insp-val');
    bgTxt.textContent = bgDisplayVal;
    bgTxt.style.cssText = 'flex:1;background:none;padding:0;';
    var bgAlphaLabel = mk('input', 'rb-insp-inp');
    bgAlphaLabel.value = bgAlphaVal;
    bgAlphaLabel.style.cssText = 'width:42px;text-align:right;flex:none;background:none;';
    if (!bgAlphaVal) bgAlphaLabel.style.display = 'none';
    function showBgAlpha(val) {
      bgAlphaLabel.value = val;
      bgAlphaLabel.style.display = val ? '' : 'none';
    }
    bgAlphaLabel.addEventListener('change', function() {
      var pct = parseInt(bgAlphaLabel.value) || 100;
      pct = Math.max(0, Math.min(100, pct));
      bgAlphaLabel.value = pct + '%';
      // If effect active (::before), update opacity in the per-element style tag
      if (el.classList.contains('rb-fx-active') && el.id) {
        var fxTag = targetDoc.getElementById(el.id + '-rb-fx');
        if (fxTag) {
          fxTag.textContent = fxTag.textContent.replace(/opacity\s*:\s*[\d.]+/, 'opacity:' + (pct / 100));
        }
      } else {
        // Solid color — adjust rgba alpha
        var curBgColor = getCS(el).backgroundColor;
        var m = curBgColor.match(/rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)/);
        if (m) {
          var rgba = 'rgba(' + m[1] + ',' + m[2] + ',' + m[3] + ',' + (pct / 100) + ')';
          el.style.setProperty('background-color', rgba, 'important');
          bgSwatch.style.background = rgba;
        }
      }
    }, {signal: sig});
    bgAlphaLabel.addEventListener('keydown', function(e) { if (e.key === 'Enter') { e.preventDefault(); bgAlphaLabel.blur(); } });
    bgAlphaLabel.addEventListener('mousedown', function(e) { e.stopPropagation(); });

    // Minus button to remove background
    var bgMinusBtn = mk('button', 'rb-fill-row-icon');
    bgMinusBtn.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>';
    bgMinusBtn.title = 'Remove background';
    bgMinusBtn.style.display = hasBgAny ? '' : 'none';
    bgMinusBtn.addEventListener('mousedown', function(e) {
      e.stopImmediatePropagation();
      applyStyle(el, 'backgroundColor', 'transparent');
      el.style.removeProperty('background');
      el.style.removeProperty('background-image');
      el.style.removeProperty('background-size');
      el.style.removeProperty('background-position');
      el.style.removeProperty('animation');
      el.style.removeProperty('animation-play-state');
      // Clean up ::before effect
      el.classList.remove('rb-fx-active');
      el.removeAttribute('data-rb-fx-css');
      el.removeAttribute('data-rb-fx-name');
      if (el.id) { var fxTag = targetDoc.getElementById(el.id + '-rb-fx'); if (fxTag) fxTag.remove(); }
      updateInspector(el);
    }, {capture: true, signal: sig});

    bgWrap.addEventListener('mousedown', function(e) {
      e.stopImmediatePropagation();
      if (window.__rbFillPopup) {
        window.__rbFillPopup.open(bgSwatch, inspector, root, el, 'backgroundColor', sig, {
          apply: function(targetEl, targetProp, cssVal) {
            applyStyle(targetEl, targetProp, cssVal);
            var newHex = rgbHex(cssVal);
            bgTxt.textContent = newHex || cssVal;
            var am = cssVal.match(/rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
            showBgAlpha((am && am[4] !== undefined ? Math.round(parseFloat(am[4]) * 100) : 100) + '%');
            bgMinusBtn.style.display = '';
            bgEyeBtn.style.display = '';
          },
          applyGradient: function(targetEl, gradCSS) {
            pushUndo({el: targetEl, prop: 'background', old: targetEl.style.background});
            targetEl.style.setProperty('background', gradCSS, 'important');
            bgTxt.textContent = 'gradient';
            showBgAlpha('100%');
            bgMinusBtn.style.display = '';
            bgEyeBtn.style.display = '';
          },
          applyEffect: function(targetEl, fx) {
            pushUndo({el: targetEl, prop: '__rb-fx', old: targetEl.getAttribute('data-rb-fx-css') || ''});
            targetEl.classList.add('rb-fx-active');
            // Ensure element has an ID for the ::before selector
            if (!targetEl.id) targetEl.id = 'rb-fx-el-' + Date.now();
            // Store effect CSS for later reference
            targetEl.setAttribute('data-rb-fx-css', fx.css);
            targetEl.setAttribute('data-rb-fx-name', fx.name);
            // Make element a positioning context for ::before
            var curPos = getCS(targetEl).position;
            if (curPos === 'static') targetEl.style.setProperty('position', 'relative', 'important');
            // Inject per-element <style> for ::before — must live in TARGET
            // head so the rule resolves against the target's element tree.
            var fxTagId = targetEl.id + '-rb-fx';
            var existingTag = targetDoc.getElementById(fxTagId);
            if (existingTag) existingTag.remove();
            var fxTag = targetDoc.createElement('style');
            fxTag.id = fxTagId;
            fxTag.textContent = '#' + targetEl.id + '::before{content:"";position:absolute;inset:0;z-index:-1;pointer-events:none;border-radius:inherit;' + fx.css + 'opacity:1;}';
            targetDoc.head.appendChild(fxTag);
            // Clear any direct background from the element (effect is now on ::before)
            targetEl.style.removeProperty('background');
            targetEl.style.removeProperty('background-image');
            targetEl.style.removeProperty('background-color');
            targetEl.style.removeProperty('animation');
            bgSwatch.style.cssText = fx.css + 'width:16px;height:16px;border-radius:8px;flex-shrink:0;';
            bgTxt.textContent = fx.name.toLowerCase();
            showBgAlpha('100%');
            bgMinusBtn.style.display = '';
            bgEyeBtn.style.display = '';
          },
          applyBgImage: function(targetEl, dataUrl) {
            pushUndo({el: targetEl, prop: 'backgroundImage', old: targetEl.style.backgroundImage});
            targetEl.style.backgroundImage = 'url(' + dataUrl + ')';
            targetEl.style.backgroundSize = 'cover';
            targetEl.style.backgroundPosition = 'center';
            bgSwatch.style.backgroundImage = 'url(' + dataUrl + ')';
            bgSwatch.style.backgroundSize = 'cover';
            bgTxt.textContent = 'image';
            showBgAlpha('100%');
            bgMinusBtn.style.display = '';
            bgEyeBtn.style.display = '';
          }
        });
      }
    }, {capture: true, signal: sig});

    bgWrap.appendChild(bgSwatch);
    bgWrap.appendChild(bgTxt);
    bgWrap.appendChild(bgAlphaLabel);

    // Eye button (hide/show) — outside the field
    var bgEyeBtn = mk('button', 'rb-fill-row-icon');
    bgEyeBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
    bgEyeBtn.title = 'Toggle visibility';
    var bgHidden = false;
    var bgOrigStyles = {};
    var bgFxTagBackup = null;
    bgEyeBtn.addEventListener('mousedown', function(e) {
      e.stopImmediatePropagation();
      bgHidden = !bgHidden;
      if (bgHidden) {
        bgOrigStyles = { bg: el.style.background, bgColor: el.style.backgroundColor, bgImage: el.style.backgroundImage, animation: el.style.animation, hasFxClass: el.classList.contains('rb-fx-active') };
        // Hide ::before effect by removing its style tag (target head).
        if (el.id) {
          var fxTag = targetDoc.getElementById(el.id + '-rb-fx');
          if (fxTag) { bgFxTagBackup = fxTag.textContent; fxTag.remove(); }
        }
        el.style.setProperty('background', 'none', 'important');
        el.style.setProperty('background-color', 'transparent', 'important');
        el.style.setProperty('animation', 'none', 'important');
        bgEyeBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
        bgEyeBtn.classList.add('rb-insp-eye-off');
      } else {
        if (bgOrigStyles.bg) el.style.setProperty('background', bgOrigStyles.bg, 'important');
        else el.style.removeProperty('background');
        if (bgOrigStyles.bgColor) el.style.setProperty('background-color', bgOrigStyles.bgColor, 'important');
        else el.style.removeProperty('background-color');
        if (bgOrigStyles.bgImage) el.style.setProperty('background-image', bgOrigStyles.bgImage, 'important');
        else el.style.removeProperty('background-image');
        if (bgOrigStyles.animation) el.style.setProperty('animation', bgOrigStyles.animation, 'important');
        else el.style.removeProperty('animation');
        // Restore ::before effect (target head, same as fx injection above).
        if (bgOrigStyles.hasFxClass && bgFxTagBackup && el.id) {
          var restoredTag = targetDoc.createElement('style');
          restoredTag.id = el.id + '-rb-fx';
          restoredTag.textContent = bgFxTagBackup;
          targetDoc.head.appendChild(restoredTag);
          bgFxTagBackup = null;
        }
        bgEyeBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
        bgEyeBtn.classList.remove('rb-insp-eye-off');
      }
    }, {capture: true, signal: sig});
    bgEyeBtn.style.display = hasBgAny ? '' : 'none';

    // Minus button — outside the field
    bgMinusBtn.style.display = hasBgAny ? '' : 'none';

    bgRowOuter.appendChild(bgWrap);
    bgRowOuter.appendChild(bgEyeBtn);
    bgRowOuter.appendChild(bgMinusBtn);
    addRow(fillSec, 'Background', bgRowOuter);

    // ---- IMAGE ROW (only actual <img>/<svg> elements, not CSS backgrounds) ----
    var visualEl = null;
    if (el.tagName === 'IMG') visualEl = el;
    else if (el.tagName === 'SVG' || (el.tagName && el.tagName.toLowerCase() === 'svg')) visualEl = el;
    else {
      var childImg = el.querySelector(':scope > img');
      var childSvg = el.querySelector(':scope > svg');
      if (childImg) visualEl = childImg;
      else if (childSvg) visualEl = childSvg;
    }
    var hasImage = !!visualEl;

    var imgRowOuter = mk('div', 'rb-fill-row-outer');
    var imgFieldWrap = mk('div', 'rb-insp-color-row rb-insp-field-bg');
    imgFieldWrap.style.cssText = 'display:flex;align-items:center;gap:6px;border-radius:4px;padding:0 6px;cursor:pointer;flex:1;min-width:0;';

    var imgSwatch = mk('div', 'rb-insp-swatch');
    if (hasImage) {
      imgSwatch.style.cssText += 'overflow:hidden;position:relative;';
      var vTag = visualEl.tagName.toUpperCase();
      if (vTag === 'IMG') {
        imgSwatch.style.backgroundImage = 'url(' + visualEl.src + ')';
        imgSwatch.style.backgroundSize = 'cover';
        imgSwatch.style.backgroundPosition = 'center';
      } else {
        imgSwatch.style.background = '#222';
      }
    } else {
      imgSwatch.style.background = 'linear-gradient(45deg,#ccc 25%,transparent 25%,transparent 75%,#ccc 75%),linear-gradient(45deg,#ccc 25%,transparent 25%,transparent 75%,#ccc 75%)';
      imgSwatch.style.backgroundSize = '8px 8px';
      imgSwatch.style.backgroundPosition = '0 0, 4px 4px';
    }
    imgFieldWrap.appendChild(imgSwatch);

    var imgLabel = mk('span', 'rb-insp-val');
    imgLabel.style.cssText = 'flex:1;background:none;padding:0;';
    if (hasImage) {
      var vTag2 = visualEl.tagName.toUpperCase();
      imgLabel.textContent = vTag2 === 'IMG' ? 'image' : 'SVG';
    } else {
      imgLabel.textContent = 'none';
      imgLabel.style.color = 'rgba(239,238,235,0.3)';
    }
    imgFieldWrap.appendChild(imgLabel);

    // Click to open image popup
    imgFieldWrap.addEventListener('mousedown', function(e) {
      e.stopImmediatePropagation();
      if (window.__rbFillPopup) {
        window.__rbFillPopup.openImage(imgSwatch, inspector, root, el, sig, {
          applyImage: function(targetEl, dataUrl) {
            if (visualEl && visualEl.tagName === 'IMG') {
              // Replace existing img src
              pushUndo({el: visualEl, prop: 'src', old: visualEl.src});
              visualEl.src = dataUrl;
            } else {
              // Insert a new <img> inside the div — site element, target doc.
              var newImg = (targetEl.ownerDocument || targetDoc).createElement('img');
              newImg.src = dataUrl;
              newImg.style.cssText = 'width:100%;height:auto;display:block;';
              pushUndo({el: targetEl, prop: '__insertedImg', old: null});
              targetEl.appendChild(newImg);
              visualEl = newImg;
            }
            imgSwatch.style.backgroundImage = 'url(' + dataUrl + ')';
            imgSwatch.style.backgroundSize = 'cover';
            imgSwatch.style.backgroundPosition = 'center';
            imgLabel.textContent = 'image';
            imgLabel.style.color = '';
            imgMinusBtn.style.display = '';
            imgEyeBtn.style.display = '';
          }
        });
      }
    }, {capture: true, signal: sig});

    // Eye button — outside the field
    var imgEyeBtn = mk('button', 'rb-fill-row-icon');
    imgEyeBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
    imgEyeBtn.title = 'Toggle visibility';
    var imgHidden = false;
    imgEyeBtn.addEventListener('mousedown', function(e) {
      e.stopImmediatePropagation();
      imgHidden = !imgHidden;
      if (imgHidden) {
        if (visualEl) visualEl.style.setProperty('visibility', 'hidden', 'important');
        else el.style.setProperty('background-image', 'none', 'important');
        imgEyeBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
        imgEyeBtn.classList.add('rb-insp-eye-off');
      } else {
        if (visualEl) visualEl.style.removeProperty('visibility');
        else el.style.removeProperty('background-image');
        imgEyeBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
        imgEyeBtn.classList.remove('rb-insp-eye-off');
      }
    }, {capture: true, signal: sig});
    imgEyeBtn.style.display = hasImage ? '' : 'none';

    // Minus button — outside the field
    var imgMinusBtn = mk('button', 'rb-fill-row-icon');
    imgMinusBtn.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>';
    imgMinusBtn.title = 'Remove image';
    imgMinusBtn.style.display = hasImage ? '' : 'none';
    imgMinusBtn.addEventListener('mousedown', function(e) {
      e.stopImmediatePropagation();
      if (visualEl && visualEl.tagName === 'IMG') {
        pushUndo({el: visualEl, prop: 'src', old: visualEl.src});
        // Remove the img element if it was inserted by us, otherwise clear src
        if (visualEl.parentElement === el) {
          visualEl.remove();
        } else {
          visualEl.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
        }
      } else if (visualEl && visualEl.tagName === 'SVG') {
        visualEl.style.setProperty('display', 'none', 'important');
      }
      updateInspector(el);
    }, {capture: true, signal: sig});

    imgRowOuter.appendChild(imgFieldWrap);
    imgRowOuter.appendChild(imgEyeBtn);
    imgRowOuter.appendChild(imgMinusBtn);
    addRow(fillSec, 'Image', imgRowOuter);

    // ---- TEXT COLORS (grouped by CSS class, with link/unlink) ----
    // Helper: find the CSS class that defines `color` on an element
    function findColorClass(node) {
      var classes = node.className && typeof node.className === 'string' ? node.className.split(/\s+/) : [];
      var sheets = targetDoc.styleSheets;
      for (var s = 0; s < sheets.length; s++) {
        try { var rules = sheets[s].cssRules || sheets[s].rules; if (!rules) continue; } catch(e) { continue; }
        for (var r = 0; r < rules.length; r++) {
          var rule = rules[r];
          if (!rule.selectorText || !rule.style || !rule.style.color) continue;
          for (var c = 0; c < classes.length; c++) {
            if (classes[c] && rule.selectorText.indexOf('.' + classes[c]) !== -1) {
              return classes[c];
            }
          }
        }
      }
      // Fallback: first meaningful class
      for (var i = 0; i < classes.length; i++) {
        if (classes[i] && classes[i].length > 1 && classes[i].indexOf('rb-') !== 0) return classes[i];
      }
      return null;
    }

    // Group colors by class name (linked by default)
    var colorEntries = []; // {hex, className, targets, isSelf, isMixed}
    var selfHex = rgbHex(csT.color);
    var selfClass = findColorClass(el);
    var elIsTextWrapper = isTextWrapper(el);

    if (elIsTextWrapper) {
      // Text wrapper: each leaf is its own editable color. Don't include wrapper
      // in targets (applyStyle on wrapper would cascade and clobber other leaves).
      // Each entry targets only leaves that currently share that color.
      var leafMap = {};
      getTextLeaves(el).forEach(function(leaf) {
        var lc = getCS(leaf).color;
        var lh = rgbHex(lc);
        if (!lh) return;
        var cls = findColorClass(leaf);
        var key = cls || lh;
        if (!leafMap[key]) leafMap[key] = { hex: lh, className: cls, targets: [] };
        leafMap[key].targets.push(leaf);
      });
      var leafKeys = Object.keys(leafMap);
      var hasMultiple = leafKeys.length >= 2;
      leafKeys.forEach(function(key, idx) {
        var entry = leafMap[key];
        if (idx === 0) entry.isSelf = true;
        // chain is disabled whenever leaves have varying colors (class-wide rule
        // can't represent the mixed state without unifying them)
        if (hasMultiple) entry.chainDisabled = true;
        colorEntries.push(entry);
      });
    } else {
      if (selfHex) colorEntries.push({hex: selfHex, className: selfClass, targets: [el], isSelf: true});
      if (el.children.length > 0) {
        var colorClassMap = {}; // key = className||hex
        el.querySelectorAll('*').forEach(function(child) {
          if (child.closest('svg')) return;
          var hasText = false;
          for (var cn = 0; cn < child.childNodes.length; cn++) {
            if (child.childNodes[cn].nodeType === 3 && child.childNodes[cn].textContent.trim().length > 0) { hasText = true; break; }
          }
          if (!hasText) return;
          var cr = child.getBoundingClientRect();
          if (cr.width < 1 || cr.height < 1) return;
          var cc = getCS(child).color;
          var hex = rgbHex(cc);
          if (!hex) return;
          if (hex === selfHex) {
            colorEntries[0].targets.push(child);
          } else {
            var cls = findColorClass(child);
            var key = cls || hex;
            if (!colorClassMap[key]) colorClassMap[key] = {hex: hex, className: cls, targets: []};
            colorClassMap[key].targets.push(child);
          }
        });
        Object.keys(colorClassMap).forEach(function(key) {
          colorEntries.push(colorClassMap[key]);
        });
      }
    }

    var LINK_SVG = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>';
    var UNLINK_SVG = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18.84 12.25l1.72-1.71a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M5.16 11.75l-1.72 1.71a5 5 0 007.07 7.07l1.72-1.71"/><line x1="2" y1="2" x2="22" y2="22"/></svg>';

    if (colorEntries.length > 0) {
      var colorsStack = mk('div');
      colorsStack.style.cssText = 'display:flex;flex-direction:column;gap:3px;';

      // Shared popup-opener so compact-row swatches and individual-row clicks
      // route through the same fill popup wiring.
      function openTextFillPopup(ent, swEl, hexTxtEl, alphaEl) {
        if (!window.__rbFillPopup) return;
        window.__rbFillPopup.open(swEl, inspector, root, el, 'color', sig, {
          apply: function(targetEl, targetProp, cssVal) {
            if (__pendingTextRange && isTextEditing) {
              applyStyle(el, 'color', cssVal);
            } else {
              ent.targets.forEach(function(t) {
                t.style.removeProperty('-webkit-background-clip');
                t.style.removeProperty('background-clip');
                t.style.removeProperty('-webkit-text-fill-color');
                t.style.removeProperty('background-image');
                t.style.removeProperty('background');
                t.style.removeProperty('animation');
                applyStyle(t, 'color', cssVal);
              });
            }
            var newHex = rgbHex(cssVal);
            if (swEl) swEl.style.background = cssVal;
            if (hexTxtEl) hexTxtEl.textContent = newHex || cssVal;
            if (alphaEl) {
              var am = cssVal.match(/rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
              alphaEl.textContent = (am && am[4] !== undefined ? Math.round(parseFloat(am[4]) * 100) : 100) + '%';
            }
          },
          applyGradient: function(targetEl, gradCSS) {
            ent.targets.forEach(function(t) {
              pushUndo({el: t, prop: 'background', old: t.style.background});
              t.style.setProperty('background', gradCSS, 'important');
              t.style.setProperty('-webkit-background-clip', 'text', 'important');
              t.style.setProperty('background-clip', 'text', 'important');
              t.style.setProperty('-webkit-text-fill-color', 'transparent', 'important');
              t.style.setProperty('color', 'transparent', 'important');
            });
            if (swEl) swEl.style.background = gradCSS;
            if (hexTxtEl) hexTxtEl.textContent = 'gradient';
            if (alphaEl) alphaEl.textContent = '';
          },
          applyEffect: function(targetEl, fx) {
            ent.targets.forEach(function(t) {
              pushUndo({el: t, prop: 'background', old: t.style.background});
              t.classList.add('rb-fx-active');
              t.removeAttribute('data-rb-frozen-anim');
              var cssProps = fx.css.split(';').filter(function(s) { return s.trim(); });
              cssProps.forEach(function(rule) {
                var parts = rule.split(':');
                if (parts.length >= 2) {
                  var p = parts[0].trim();
                  var v = parts.slice(1).join(':').trim();
                  t.style.setProperty(p, v, 'important');
                }
              });
              t.style.setProperty('animation-play-state', 'running', 'important');
              t.style.setProperty('-webkit-background-clip', 'text', 'important');
              t.style.setProperty('background-clip', 'text', 'important');
              t.style.setProperty('-webkit-text-fill-color', 'transparent', 'important');
              t.style.setProperty('color', 'transparent', 'important');
            });
            if (swEl) swEl.style.cssText = fx.css + 'width:14px;height:14px;border-radius:3px;flex-shrink:0;';
            if (hexTxtEl) hexTxtEl.textContent = fx.name.toLowerCase();
            if (alphaEl) alphaEl.textContent = '';
          },
          applyBgImage: function(targetEl, dataUrl) {
            ent.targets.forEach(function(t) {
              pushUndo({el: t, prop: 'backgroundImage', old: t.style.backgroundImage});
              t.style.setProperty('background-image', 'url(' + dataUrl + ')', 'important');
              t.style.setProperty('background-size', 'cover', 'important');
              t.style.setProperty('background-position', 'center', 'important');
              t.style.setProperty('-webkit-background-clip', 'text', 'important');
              t.style.setProperty('background-clip', 'text', 'important');
              t.style.setProperty('-webkit-text-fill-color', 'transparent', 'important');
              t.style.setProperty('color', 'transparent', 'important');
            });
            if (swEl) {
              swEl.style.backgroundImage = 'url(' + dataUrl + ')';
              swEl.style.backgroundSize = 'cover';
            }
            if (hexTxtEl) hexTxtEl.textContent = 'image';
            if (alphaEl) alphaEl.textContent = '';
          }
        });
      }

      // Compact "Selection colors" pill when more than 4 distinct text colors.
      // Each swatch opens the picker for its entry; "+N" pill toggles showing
      // the rest of the swatches wrapped below.
      if (colorEntries.length > 4) {
        // Compact row matches the font field height (25px). Expand spills extra
        // swatches into a separate row below so the compact row height stays fixed.
        var compact = mk('div', 'rb-insp-field-bg rb-insp-color-compact');
        compact.style.cssText = 'display:flex;align-items:center;gap:8px;padding:0 8px;border-radius:4px;height:25px;cursor:pointer;';
        var compactLbl = mk('span', 'rb-insp-selection-lbl');
        compactLbl.textContent = 'Selection colors';
        compactLbl.style.cssText = 'flex:1;font:500 12px/1.3 "Instrument Sans",sans-serif;min-width:100px;white-space:nowrap;';
        compact.appendChild(compactLbl);
        var swatchGroup = mk('div');
        swatchGroup.style.cssText = 'display:flex;gap:4px;align-items:center;flex-shrink:0;';
        function makeCompactSwatch(entry) {
          var sw = mk('div', 'rb-insp-swatch rb-insp-color-compact-swatch');
          sw.style.cssText = 'width:14px;height:14px;border-radius:3px;background:' + entry.hex + ';cursor:pointer;flex-shrink:0;border:1px solid rgba(255,255,255,0.1);';
          sw.title = entry.hex;
          sw.addEventListener('mousedown', function(ev) {
            ev.stopImmediatePropagation();
            openTextFillPopup(entry, sw, null, null);
          }, {capture: true, signal: sig});
          return sw;
        }
        var compactShown = 4;
        for (var ci = 0; ci < compactShown && ci < colorEntries.length; ci++) {
          swatchGroup.appendChild(makeCompactSwatch(colorEntries[ci]));
        }
        compact.appendChild(swatchGroup);
        var morePill = mk('button', 'rb-insp-more-pill');
        morePill.textContent = '+' + (colorEntries.length - compactShown);
        morePill.title = 'Show all colors';
        morePill.style.cssText = 'border:none;font:500 11px/1 "Instrument Sans",sans-serif;padding:3px 7px;border-radius:3px;cursor:pointer;-webkit-appearance:none;flex-shrink:0;';
        // Extra swatches live in a second row so the compact row keeps 25px height
        var extraRow = mk('div');
        extraRow.style.cssText = 'display:none;gap:4px;flex-wrap:wrap;padding:4px 8px 0;';
        var expandedCompact = false;
        function toggleCompactColors() {
          expandedCompact = !expandedCompact;
          if (expandedCompact) {
            extraRow.innerHTML = '';
            for (var ei = compactShown; ei < colorEntries.length; ei++) {
              extraRow.appendChild(makeCompactSwatch(colorEntries[ei]));
            }
            extraRow.style.display = 'flex';
            morePill.textContent = 'less';
          } else {
            extraRow.style.display = 'none';
            extraRow.innerHTML = '';
            morePill.textContent = '+' + (colorEntries.length - compactShown);
          }
        }
        morePill.addEventListener('mousedown', function(ev) {
          ev.stopImmediatePropagation();
          toggleCompactColors();
        }, {capture: true, signal: sig});
        // Clicking anywhere on the compact row (label / empty space) also
        // toggles. Swatches + morePill stopImmediatePropagation in their own
        // capture-phase handlers so this only fires on row chrome.
        compact.addEventListener('mousedown', function(ev) {
          ev.stopImmediatePropagation();
          toggleCompactColors();
        }, {signal: sig});
        compact.appendChild(morePill);
        colorsStack.appendChild(compact);
        colorsStack.appendChild(extraRow);
        addRow(fillSec, 'Text color', colorsStack);
      } else {

      var maxVisibleColors = 4;
      var hiddenColors = [];
      colorEntries.forEach(function(entry, idx) {
        var colorOuter = mk('div', 'rb-fill-row-outer');
        if (idx >= maxVisibleColors) { colorOuter.style.display = 'none'; hiddenColors.push(colorOuter); }
        var colorRow = mk('div', 'rb-insp-color-row rb-insp-field-bg');
        colorRow.style.cssText = 'display:flex;align-items:center;gap:6px;padding:0 6px;cursor:pointer;flex:1;min-width:0;border-radius:4px;overflow:hidden;';
        var sw = mk('div', 'rb-insp-swatch');
        sw.style.background = entry.hex;
        sw.title = entry.hex;
        var hexTxt = mk('span', 'rb-insp-val');
        hexTxt.textContent = entry.hex;
        hexTxt.style.cssText = 'flex:1;background:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';

        // Link/unlink chain icon — default unlinked (changes apply to this element only)
        // chainDisabled: the text wrapper has multiple distinct colors across its
        // leaves; linking would unify them via class-wide write which breaks the
        // per-line color variance the designer set.
        var allClassTargets = entry.targets.slice();
        // Text-wrapper entries: keep ALL the leaves with this color so applying
        // reaches every line sharing the color. Normal entries: first target only
        // (chain expands to all when the user clicks Link).
        entry.targets = elIsTextWrapper ? allClassTargets : [entry.targets[0]];
        var linked = false;
        var linkBtn = mk('button', 'rb-fill-link-btn');
        linkBtn.innerHTML = UNLINK_SVG;
        linkBtn.classList.add('rb-fill-link-off');
        linkBtn.title = 'Apply to global class';
        if (entry.chainDisabled) {
          linkBtn.classList.add('rb-fill-link-disabled');
          linkBtn.title = "Can't set global with mixed colors";
        }
        if (!entry.chainDisabled && !entry.className && allClassTargets.length <= 1) { linkBtn.style.display = 'none'; }

        var cDiv = mk('div', 'rb-insp-field-divider');
        cDiv.style.cssText = 'width:1px;align-self:stretch;flex-shrink:0;';
        var cAlpha = mk('span', 'rb-insp-val');
        cAlpha.textContent = '100%';
        cAlpha.style.cssText = 'width:36px;text-align:right;flex:none;background:none;';

        // Link/unlink handler
        (function(ent, linkBtn2, hexTxt2) {
          linkBtn2.addEventListener('mousedown', function(e) {
            e.stopImmediatePropagation();
            if (ent.chainDisabled) return;  // disabled when leaves have varying colors
            linked = !linked;
            if (linked) {
              linkBtn2.innerHTML = LINK_SVG;
              linkBtn2.title = 'Linked to .' + ent.className;
              linkBtn2.classList.remove('rb-fill-link-off');
              linkBtn2.classList.add('rb-fill-link-on');
              hexTxt2.title = '.' + ent.className;
              if (ent.className) {
                ent.targets = [];
                el.querySelectorAll('.' + ent.className).forEach(function(t) { ent.targets.push(t); });
                if (el.classList.contains(ent.className)) ent.targets.unshift(el);
              } else {
                ent.targets = allClassTargets.slice();
              }
            } else {
              linkBtn2.innerHTML = UNLINK_SVG;
              linkBtn2.title = 'Apply to global class';
              linkBtn2.classList.add('rb-fill-link-off');
              linkBtn2.classList.remove('rb-fill-link-on');
              hexTxt2.title = '';
              ent.targets = [allClassTargets[0]];
            }
          }, {capture: true, signal: sig});
        })(entry, linkBtn, hexTxt);

        // Click → open full 4-tab popup
        (function(ent, sw2, hexTxt2, cAlpha2) {
          colorRow.addEventListener('mousedown', function(e) {
            if (e.target.closest('.rb-fill-link-btn')) return;
            e.stopImmediatePropagation();
            if (window.__rbFillPopup) {
              window.__rbFillPopup.open(sw2, inspector, root, el, 'color', sig, {
                apply: function(targetEl, targetProp, cssVal) {
                  // applyStyle routes through __pendingTextRange automatically
                  // when a word is selected in edit mode.
                  if (__pendingTextRange && isTextEditing) {
                    applyStyle(el, 'color', cssVal);
                  } else {
                    ent.targets.forEach(function(t) {
                      t.style.removeProperty('-webkit-background-clip');
                      t.style.removeProperty('background-clip');
                      t.style.removeProperty('-webkit-text-fill-color');
                      t.style.removeProperty('background-image');
                      t.style.removeProperty('background');
                      t.style.removeProperty('animation');
                      applyStyle(t, 'color', cssVal);
                    });
                  }
                  var newHex = rgbHex(cssVal);
                  sw2.style.background = cssVal;
                  hexTxt2.textContent = newHex || cssVal;
                  var am = cssVal.match(/rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
                  cAlpha2.textContent = (am && am[4] !== undefined ? Math.round(parseFloat(am[4]) * 100) : 100) + '%';
                },
                applyGradient: function(targetEl, gradCSS) {
                  ent.targets.forEach(function(t) {
                    pushUndo({el: t, prop: 'background', old: t.style.background});
                    t.style.setProperty('background', gradCSS, 'important');
                    t.style.setProperty('-webkit-background-clip', 'text', 'important');
                    t.style.setProperty('background-clip', 'text', 'important');
                    t.style.setProperty('-webkit-text-fill-color', 'transparent', 'important');
                    t.style.setProperty('color', 'transparent', 'important');
                  });
                  sw2.style.background = gradCSS;
                  hexTxt2.textContent = 'gradient';
                  cAlpha2.textContent = '';
                },
                applyEffect: function(targetEl, fx) {
                  ent.targets.forEach(function(t) {
                    pushUndo({el: t, prop: 'background', old: t.style.background});
                    t.classList.add('rb-fx-active');
                    t.removeAttribute('data-rb-frozen-anim');
                    var cssProps = fx.css.split(';').filter(function(s) { return s.trim(); });
                    cssProps.forEach(function(rule) {
                      var parts = rule.split(':');
                      if (parts.length >= 2) {
                        var p = parts[0].trim();
                        var v = parts.slice(1).join(':').trim();
                        t.style.setProperty(p, v, 'important');
                      }
                    });
                    t.style.setProperty('animation-play-state', 'running', 'important');
                    t.style.setProperty('-webkit-background-clip', 'text', 'important');
                    t.style.setProperty('background-clip', 'text', 'important');
                    t.style.setProperty('-webkit-text-fill-color', 'transparent', 'important');
                    t.style.setProperty('color', 'transparent', 'important');
                  });
                  sw2.style.cssText = fx.css + 'width:16px;height:16px;border-radius:8px;flex-shrink:0;';
                  hexTxt2.textContent = fx.name.toLowerCase();
                  cAlpha2.textContent = '';
                },
                applyBgImage: function(targetEl, dataUrl) {
                  ent.targets.forEach(function(t) {
                    pushUndo({el: t, prop: 'backgroundImage', old: t.style.backgroundImage});
                    t.style.setProperty('background-image', 'url(' + dataUrl + ')', 'important');
                    t.style.setProperty('background-size', 'cover', 'important');
                    t.style.setProperty('background-position', 'center', 'important');
                    t.style.setProperty('-webkit-background-clip', 'text', 'important');
                    t.style.setProperty('background-clip', 'text', 'important');
                    t.style.setProperty('-webkit-text-fill-color', 'transparent', 'important');
                    t.style.setProperty('color', 'transparent', 'important');
                  });
                  sw2.style.backgroundImage = 'url(' + dataUrl + ')';
                  sw2.style.backgroundSize = 'cover';
                  hexTxt2.textContent = 'image';
                  cAlpha2.textContent = '';
                }
              });
            }
          }, {capture: true, signal: sig});
        })(entry, sw, hexTxt, cAlpha);
        colorRow.appendChild(sw);
        colorRow.appendChild(hexTxt);
        colorRow.appendChild(linkBtn);
        colorRow.appendChild(cDiv);
        colorRow.appendChild(cAlpha);
        // Eye button
        var cEye = mk('button', 'rb-fill-row-icon');
        cEye.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
        cEye.title = 'Toggle visibility';
        (function(ent2, eye2) {
          var cHidden = false;
          eye2.addEventListener('mousedown', function(e) {
            e.stopImmediatePropagation();
            cHidden = !cHidden;
            ent2.targets.forEach(function(t) {
              t.style.setProperty('color', cHidden ? 'transparent' : ent2.hex, 'important');
            });
            eye2.innerHTML = cHidden
              ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>'
              : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
            eye2.classList.toggle('rb-insp-eye-off', cHidden);
          }, {capture: true, signal: sig});
        })(entry, cEye);
        // Minus button
        var cMinus = mk('button', 'rb-fill-row-icon');
        cMinus.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>';
        cMinus.title = 'Remove color';
        (function(ent3) {
          cMinus.addEventListener('mousedown', function(e) {
            e.stopImmediatePropagation();
            ent3.targets.forEach(function(t) {
              t.style.removeProperty('color');
              t.style.removeProperty('-webkit-background-clip');
              t.style.removeProperty('background-clip');
              t.style.removeProperty('-webkit-text-fill-color');
              t.style.removeProperty('background-image');
              t.style.removeProperty('background');
              t.style.removeProperty('animation');
            });
            updateInspector(el);
          }, {capture: true, signal: sig});
        })(entry);
        colorOuter.appendChild(colorRow);
        colorOuter.appendChild(cEye);
        colorOuter.appendChild(cMinus);
        colorsStack.appendChild(colorOuter);
      });
      if (hiddenColors.length > 0) {
        var morePill = mk('button');
        morePill.style.cssText = 'display:flex;align-items:center;justify-content:center;gap:3px;width:100%;padding:4px 0;background:rgba(255,255,255,0.04);border:none;border-radius:12px;cursor:pointer;-webkit-appearance:none;';
        morePill.innerHTML = '<span style="width:4px;height:4px;border-radius:50%;background:rgba(239,238,235,0.3);"></span><span style="width:4px;height:4px;border-radius:50%;background:rgba(239,238,235,0.3);"></span><span style="width:4px;height:4px;border-radius:50%;background:rgba(239,238,235,0.3);"></span>';
        morePill.title = hiddenColors.length + ' more colors';
        var colorsExpanded = false;
        morePill.addEventListener('mousedown', function(e) {
          e.stopImmediatePropagation();
          colorsExpanded = !colorsExpanded;
          hiddenColors.forEach(function(r) { r.style.display = colorsExpanded ? '' : 'none'; });
          morePill.innerHTML = colorsExpanded
            ? '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="rgba(239,238,235,0.4)" stroke-width="2" stroke-linecap="round"><path d="M18 15l-6-6-6 6"/></svg>'
            : '<span style="width:4px;height:4px;border-radius:50%;background:rgba(239,238,235,0.3);"></span><span style="width:4px;height:4px;border-radius:50%;background:rgba(239,238,235,0.3);"></span><span style="width:4px;height:4px;border-radius:50%;background:rgba(239,238,235,0.3);"></span>';
          morePill.title = colorsExpanded ? 'Show less' : hiddenColors.length + ' more colors';
        }, {capture: true});
        colorsStack.appendChild(morePill);
      }
      addRow(fillSec, 'Text color', colorsStack);
      }  // close else branch (colorEntries.length <= 4)
    }

    // ---- STROKE ----
    var hasStroke = cs.borderStyle !== 'none' && (parseFloat(cs.borderWidth) || 0) > 0;
    var strkSec = addSection('Stroke', !hasStroke);
    var strkHd = strkSec.parentElement.querySelector('.rb-insp-sec-hd');
    if (!hasStroke) {
      strkSec.parentElement.classList.add('rb-insp-sec-empty');
      var addStrokeBtn = mk('button', 'rb-insp-add-btn');
      addStrokeBtn.textContent = '+';
      addStrokeBtn.title = 'Add stroke';
      addStrokeBtn.addEventListener('mousedown', function(e) {
        e.stopImmediatePropagation();
        applyStyle(el, 'borderWidth', '1px');
        applyStyle(el, 'borderStyle', 'solid');
        applyStyle(el, 'borderColor', isLight() ? '#333' : '#EFEEEB');
        updateInspector(el);
      }, {capture: true, signal: sig});
      strkHd.querySelector('div').appendChild(addStrokeBtn);
    } else {
      var rmStrokeBtn = mk('button', 'rb-insp-add-btn');
      rmStrokeBtn.innerHTML = '−';
      rmStrokeBtn.title = 'Remove stroke';
      rmStrokeBtn.addEventListener('mousedown', function(e) {
        e.stopImmediatePropagation();
        applyStyle(el, 'borderWidth', '0');
        applyStyle(el, 'borderStyle', 'none');
        updateInspector(el);
      }, {capture: true, signal: sig});
      var eyeStroke = mk('button', 'rb-insp-eye-btn');
      eyeStroke.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
      eyeStroke.title = 'Toggle visibility';
      var strkHidden = false;
      var strkOriginal = {w: cs.borderWidth, s: cs.borderStyle, c: cs.borderColor};
      eyeStroke.addEventListener('mousedown', function(e) {
        e.stopImmediatePropagation();
        strkHidden = !strkHidden;
        if (strkHidden) {
          el.style.setProperty('border', 'none', 'important');
          eyeStroke.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
          eyeStroke.classList.add('rb-insp-eye-off');
        } else {
          el.style.removeProperty('border');
          eyeStroke.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
          eyeStroke.classList.remove('rb-insp-eye-off');
        }
      }, {capture: true, signal: sig});
      strkHd.querySelector('div').appendChild(eyeStroke);
      strkHd.querySelector('div').appendChild(rmStrokeBtn);
    }
    // Width + Radius side by side
    var strkRow = mk('div');
    strkRow.style.cssText = 'display:flex;gap:6px;';
    var strkWWrap = mk('div');
    strkWWrap.style.cssText = 'flex:1;display:flex;flex-direction:column;gap:3px;';
    var strkWLbl = mk('span', 'rb-insp-lbl'); strkWLbl.textContent = 'Width';
    strkWWrap.appendChild(strkWLbl);
    addInput(strkWWrap, '', cs.borderWidth, el, 'borderWidth');
    var strkRWrap = mk('div');
    strkRWrap.style.cssText = 'flex:1;display:flex;flex-direction:column;gap:3px;';
    var strkRLbl = mk('span', 'rb-insp-lbl'); strkRLbl.textContent = 'Radius';
    strkRWrap.appendChild(strkRLbl);
    addInput(strkRWrap, '', cs.borderRadius, el, 'borderRadius');
    strkRow.appendChild(strkWWrap);
    strkRow.appendChild(strkRWrap);
    strkSec.appendChild(strkRow);
    addSelect(strkSec, 'Style', ['none','solid','dashed','dotted'], cs.borderStyle, el, 'borderStyle');
    addColor(strkSec, 'Color', cs.borderColor, el, 'borderColor');

    // ---- EFFECTS ----
    var hasShadow = cs.boxShadow && cs.boxShadow !== 'none';
    var fxSec = addSection('Effects', !hasShadow);
    var fxHd = fxSec.parentElement.querySelector('.rb-insp-sec-hd');
    if (!hasShadow) {
      fxSec.parentElement.classList.add('rb-insp-sec-empty');
      var addFxBtn = mk('button', 'rb-insp-add-btn');
      addFxBtn.textContent = '+';
      addFxBtn.title = 'Add shadow';
      addFxBtn.addEventListener('mousedown', function(e) {
        e.stopImmediatePropagation();
        applyStyle(el, 'boxShadow', '0 4px 12px rgba(0,0,0,0.15)');
        updateInspector(el);
      }, {capture: true, signal: sig});
      fxHd.querySelector('div').appendChild(addFxBtn);
    } else {
      var rmFxBtn = mk('button', 'rb-insp-add-btn');
      rmFxBtn.innerHTML = '−';
      rmFxBtn.title = 'Remove shadow';
      rmFxBtn.addEventListener('mousedown', function(e) {
        e.stopImmediatePropagation();
        applyStyle(el, 'boxShadow', 'none');
        updateInspector(el);
      }, {capture: true, signal: sig});
      var eyeFx = mk('button', 'rb-insp-eye-btn');
      eyeFx.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
      eyeFx.title = 'Toggle visibility';
      var fxHidden = false;
      var fxOriginal = cs.boxShadow;
      eyeFx.addEventListener('mousedown', function(e) {
        e.stopImmediatePropagation();
        fxHidden = !fxHidden;
        if (fxHidden) {
          el.style.setProperty('box-shadow', 'none', 'important');
          eyeFx.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
          eyeFx.classList.add('rb-insp-eye-off');
        } else {
          el.style.setProperty('box-shadow', fxOriginal, 'important');
          eyeFx.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
          eyeFx.classList.remove('rb-insp-eye-off');
        }
      }, {capture: true, signal: sig});
      fxHd.querySelector('div').appendChild(eyeFx);
      fxHd.querySelector('div').appendChild(rmFxBtn);
    }
    addInput(fxSec, 'Shadow', cs.boxShadow === 'none' ? '' : cs.boxShadow, el, 'boxShadow');

    // Restore scroll position
    requestAnimationFrame(function() { if (inspector) inspector.scrollTop = scrollPos; });
  }

  // ============ APPLY STYLE ============

  // Properties that should cascade to descendants when applied to a non-text-wrapper.
  // For elements detected as text-wrappers (split-text), these plus padding/background
  // cascade to leaves so edits always reach the actual rendered text.
  var CASCADE_PROPS = new Set(['color','fontFamily','fontSize','fontWeight','fontStyle',
    'lineHeight','letterSpacing','textAlign','textTransform','textDecoration']);
  // Layout props we never cascade to text leaves — each leaf inherits flow size
  // from the wrapper; forcing width/position per leaf would break the line layout.
  var NEVER_CASCADE_TO_LEAVES = new Set(['width','height','minWidth','minHeight','maxWidth',
    'maxHeight','display','position','top','left','right','bottom','zIndex','flex',
    'flexDirection','flexWrap','justifyContent','alignItems','gap','gridTemplateColumns',
    'gridTemplateRows','float','clear']);

  function applyStyle(el, prop, value) {
    // Range-scoped typography: if the user selected a word/phrase while in text
    // edit mode, route typography writes to that range only (wrap in a <span>).
    // Falls through to the element-level apply if the range is stale or invalid.
    if (TEXT_RANGE_PROPS.has(prop) && __pendingTextRange && isTextEditing) {
      var er = __pendingTextRange.editableRoot;
      if (er && targetDoc.body.contains(er) && (er === selectedEl || er.contains(selectedEl))) {
        if (applyPropToRange(er, __pendingTextRange.range, prop, value)) {
          requestAnimationFrame(function() {
            if (selectedEl) updateSelBox(selectedEl);
          });
          return;
        }
      }
    }
    var cssName = cssProp(prop);
    var wrapped = isTextWrapper(el);

    // Collect every element we'll mutate so we can snapshot cssText (for undo)
    // BEFORE applying changes. A single __cascade undo entry restores all at once.
    var mutateList = [el];
    if (wrapped && !NEVER_CASCADE_TO_LEAVES.has(prop)) {
      getTextLeaves(el).forEach(function(leaf) {
        if (leaf !== el && mutateList.indexOf(leaf) < 0) mutateList.push(leaf);
      });
    } else if (CASCADE_PROPS.has(prop) && el.children.length > 0) {
      el.querySelectorAll('*').forEach(function(child) {
        if (child.nodeType === 1 && !isEditorEl(child)) mutateList.push(child);
      });
    }
    var affected = mutateList.map(function(m) {
      return { el: m, oldCss: m.getAttribute('style') || '' };
    });

    // Apply — order matters: camelCase assignment first, then setProperty with
    // !important. Reversing these loses the !important priority because the
    // camelCase assignment internally calls setProperty(...,'') with empty priority.
    el.style[prop] = value;
    el.style.setProperty(cssName, value, 'important');
    if (wrapped && !NEVER_CASCADE_TO_LEAVES.has(prop)) {
      var leaves = getTextLeaves(el);
      leaves.forEach(function(leaf) {
        if (leaf === el) return;
        leaf.style.setProperty(cssName, value, 'important');
      });
      requestAnimationFrame(function() {
        leaves.forEach(function(leaf) {
          if (leaf === el) return;
          var cur = getCS(leaf)[prop];
          if (cur !== value && cur !== el.style[prop]) applyOverrideClass(leaf, prop, value);
        });
      });
    } else if (CASCADE_PROPS.has(prop) && el.children.length > 0) {
      el.querySelectorAll('*').forEach(function(child) {
        if (child.nodeType === 1 && !isEditorEl(child)) {
          child.style.setProperty(cssName, value, 'important');
        }
      });
    }

    pushUndo({ prop: '__cascade', affected: affected });

    // Auto-resize for typography changes
    var typoProps = ['fontSize','fontFamily','fontWeight','lineHeight','letterSpacing'];
    if (typoProps.indexOf(prop) !== -1) {
      el.style.width = '';
      el.style.height = '';
    }
    // Post-write verification: when the site's framework (Framer/React, Webflow IX,
    // GSAP) re-applies inline styles on the next tick, our !important inline loses.
    // We check at multiple ticks because a single rAF may run BEFORE React's next
    // render. On any mismatch, inject an ID-selector override rule that wins by
    // specificity and persists across className rewrites.
    function _verifyApply() {
      if (!targetDoc.body.contains(el)) return;
      var cur = getCS(el)[prop];
      // If computed value doesn't match what we wrote, something (React re-render,
      // CSS !important with higher specificity, etc.) is overriding us. Fall back
      // to an ID-selector rule in our stylesheet with !important — wins over
      // className-level rules regardless of inline mutations. Also arm a sticky
      // MutationObserver so inline rewrites by the framework get re-applied.
      if (cur !== value) {
        applyOverrideClass(el, prop, value);
        startSticky(el, prop, value);
      }
    }
    requestAnimationFrame(function() {
      _verifyApply();
      if (selectedEl === el) updateSelBox(el);
      requestAnimationFrame(_verifyApply);
    });
    setTimeout(_verifyApply, 150);
    setTimeout(_verifyApply, 600);
  }

  // ============ UNDO / REDO ============
  //
  // Design: undoStack holds operation entries. Each entry has `prop` which
  // identifies the type. When undo() runs, it pops the top, captures the
  // *current* state as the "redo target" for that operation, applies the
  // reverse, and pushes the redo entry to redoStack. When redo() runs, it
  // pops redoStack and re-applies the forward operation.
  //
  // Important: pushUndo() clears redoStack (new operation invalidates redo
  // path). undo() / redo() do NOT clear each other's stacks — they move
  // entries between them.

  function pushRedo(entry) {
    redoStack.push(entry);
    if (redoStack.length > UNDO_STACK_MAX) redoStack.shift();
  }

  // Reverse a single undo entry. Returns a redo entry describing how to
  // re-apply the operation. Shared between undo() and redo() so the logic
  // stays symmetric. Every branch MUST capture the current state into
  // u.newX fields when reverting (forward=false), so redo (forward=true)
  // has something to re-apply.
  function applyUndoEntry(u, forward) {
    // forward=false means undoing (restore old state)
    // forward=true means redoing (re-apply new state)
    if (u.prop === '__removed') {
      if (forward) {
        // Redo of a remove: delete again. Re-capture parent/next for the
        // next round of undo in case the DOM shifted.
        u.parent = u.el.parentElement;
        u.next = u.el.nextElementSibling;
        u.el.remove();
      } else {
        u.parent.insertBefore(u.el, u.next);
      }
    } else if (u.prop === '__move') {
      if (forward) {
        if (u.newNext) u.newParent.insertBefore(u.el, u.newNext);
        else u.newParent.appendChild(u.el);
      } else {
        // Capture current (post-move) position before reverting so redo
        // can re-apply the move.
        u.newParent = u.el.parentElement;
        u.newNext = u.el.nextElementSibling;
        if (u.next) u.parent.insertBefore(u.el, u.next);
        else u.parent.appendChild(u.el);
      }
    } else if (u.prop === '__linkWrap') {
      if (forward) {
        var p = u.child.parentElement;
        if (p) { p.insertBefore(u.anchor, u.child); u.anchor.appendChild(u.child); }
      } else {
        var ap = u.anchor.parentElement;
        if (ap) { ap.insertBefore(u.child, u.anchor); u.anchor.remove(); }
      }
    } else if (u.prop === '__linkUnwrap') {
      if (forward) {
        var ap2 = u.anchor.parentElement;
        if (ap2) {
          u.children.forEach(function(c) { ap2.insertBefore(c, u.anchor); });
          u.anchor.remove();
        }
      } else {
        if (u.parent) {
          if (u.nextSibling && u.nextSibling.parentNode === u.parent) u.parent.insertBefore(u.anchor, u.nextSibling);
          else u.parent.appendChild(u.anchor);
          u.children.forEach(function(c) { u.anchor.appendChild(c); });
        }
      }
    } else if (u.prop === '__hrefChange') {
      var target = forward ? u.newHref : u.oldHref;
      if (target == null) u.anchor.removeAttribute('href');
      else u.anchor.setAttribute('href', target);
    } else if (u.prop === '__coordswap') {
      if (forward) {
        if (u.newElPos !== undefined) u.el.style.position = u.newElPos;
        u.el.style.top = u.newElTop || '';
        u.el.style.left = u.newElLeft || '';
        if (u.newTPos !== undefined) u.target.style.position = u.newTPos;
        u.target.style.top = u.newTTop || '';
        u.target.style.left = u.newTLeft || '';
      } else {
        u.newElPos = u.el.style.position;
        u.newElTop = u.el.style.top;
        u.newElLeft = u.el.style.left;
        u.newTPos = u.target.style.position;
        u.newTTop = u.target.style.top;
        u.newTLeft = u.target.style.left;
        u.el.style.position = u.elPos || '';
        u.el.style.top = u.elTop;
        u.el.style.left = u.elLeft;
        u.target.style.position = u.tPos || '';
        u.target.style.top = u.tTop;
        u.target.style.left = u.tLeft;
      }
    } else if (u.prop === '__freemove') {
      if (forward) {
        u.el.style.top = u.newTop || '';
        u.el.style.left = u.newLeft || '';
      } else {
        u.newTop = u.el.style.top;
        u.newLeft = u.el.style.left;
        u.el.style.top = u.oldTop;
        u.el.style.left = u.oldLeft;
      }
    } else if (u.prop === '__resize') {
      if (forward) {
        u.el.style.width = u.newW || '';
        u.el.style.height = u.newH || '';
        if (u.newML !== undefined) u.el.style.marginLeft = u.newML;
        if (u.newMT !== undefined) u.el.style.marginTop = u.newMT;
        if (u.newLeft !== undefined) u.el.style.left = u.newLeft;
        if (u.newTop !== undefined) u.el.style.top = u.newTop;
        if (u.unlockedNew) {
          u.unlockedNew.forEach(function(item) {
            if (item.prop === '__parentOverflow') item.el.style.overflow = item.val || '';
            else u.el.style[item.prop] = item.val || '';
          });
        }
      } else {
        u.newW = u.el.style.width;
        u.newH = u.el.style.height;
        u.newML = u.el.style.marginLeft;
        u.newMT = u.el.style.marginTop;
        u.newLeft = u.el.style.left;
        u.newTop = u.el.style.top;
        if (u.unlocked) {
          u.unlockedNew = u.unlocked.map(function(item) {
            if (item.prop === '__parentOverflow') {
              return {prop: '__parentOverflow', el: item.el, val: item.el.style.overflow};
            }
            return {prop: item.prop, val: u.el.style[item.prop]};
          });
        }
        u.el.style.width = u.oldW;
        u.el.style.height = u.oldH;
        u.el.style.marginLeft = u.oldML;
        u.el.style.marginTop = u.oldMT || '';
        if (u.usesCoords) {
          u.el.style.left = u.oldLeft || '';
          u.el.style.top  = u.oldTop  || '';
        }
        u.el.style.transform = '';
        if (u.unlocked) {
          u.unlocked.forEach(function(item) {
            if (item.prop === '__parentOverflow') item.el.style.overflow = item.old || '';
            else u.el.style[item.prop] = item.old || '';
          });
        }
      }
    } else if (u.prop === '__src') {
      var now = u.el.src;
      u.el.src = forward ? u.newSrc : u.old;
      if (!forward) u.newSrc = now;
    } else if (u.prop === '__textEdit') {
      var currentHTML = u.el.innerHTML;
      u.el.innerHTML = forward ? u.newHTML : u.old;
      if (!forward) u.newHTML = currentHTML;
    } else if (u.prop === '__cascade') {
      // Style cascade: restore (or re-apply) cssText on every affected element.
      // Captures current cssText on each pass so forward/reverse are symmetric.
      // Stop sticky observers first — otherwise they'd stomp the restored cssText
      // back to the sticky value, defeating the undo.
      u.affected.forEach(function(a) {
        stopStickyForEl(a.el);
        var cur = a.el.getAttribute('style') || '';
        var target = forward ? (a.newCss || '') : (a.oldCss || '');
        if (target) a.el.setAttribute('style', target);
        else a.el.removeAttribute('style');
        if (!forward) a.newCss = cur;
      });
    } else if (u.prop === '__modeBRun') {
      // Mirror of __modeERun but without the Tailwind CDN bit — Mode B uses
      // the original stylesheets extracted inline, no CDN dependency.
      if (forward) {
        var ebEls = getEditorElsInBody();
        var beforeB = ebEls[0] || null;
        u.originalChildren.forEach(function(child) {
          if (child.parentElement === targetDoc.body) child.remove();
        });
        if (beforeB) targetDoc.body.insertBefore(u.wrapper, beforeB);
        else targetDoc.body.appendChild(u.wrapper);
        targetWin.scrollTo(0, u.newScrollY || 0);
      } else {
        u.newScrollY = targetWin.scrollY;
        if (u.wrapper && u.wrapper.parentElement) u.wrapper.remove();
        var ebEls2 = getEditorElsInBody();
        var beforeB2 = ebEls2[0] || null;
        u.originalChildren.forEach(function(child) {
          if (beforeB2) targetDoc.body.insertBefore(child, beforeB2);
          else targetDoc.body.appendChild(child);
        });
        targetWin.scrollTo(0, u.scrollY || 0);
      }
    } else if (u.prop === '__modeERun') {
      if (forward) {
        // Redo of Mode E: put the rebuilt wrapper back
        var editorEls = getEditorElsInBody();
        var before = editorEls[0] || null;
        // Remove current (the originals we restored on undo)
        u.originalChildren.forEach(function(child) {
          if (child.parentElement === targetDoc.body) child.remove();
        });
        if (before) targetDoc.body.insertBefore(u.rebuiltWrapper, before);
        else targetDoc.body.appendChild(u.rebuiltWrapper);
        targetWin.scrollTo(0, u.newScrollY || 0);
      } else {
        // Undo of Mode E: remove rebuilt wrapper + Tailwind CDN, re-insert originals
        u.newScrollY = targetWin.scrollY;
        if (u.rebuiltWrapper && u.rebuiltWrapper.parentElement) u.rebuiltWrapper.remove();
        var twCdn = targetDoc.getElementById('rb-tailwind-cdn');
        if (twCdn) twCdn.remove();
        var editorEls2 = getEditorElsInBody();
        var before2 = editorEls2[0] || null;
        u.originalChildren.forEach(function(child) {
          if (before2) targetDoc.body.insertBefore(child, before2);
          else targetDoc.body.appendChild(child);
        });
        targetWin.scrollTo(0, u.scrollY || 0);
      }
    } else {
      // Generic style prop change. Defensive: an undo entry can land here
      // with a stale or null `el` (e.g., element was removed between
      // pushUndo and apply, or the entry was pushed mid-bug from a stuck
      // drag handler). Skip with a warning instead of crashing the editor.
      if (!u.el || !u.el.style) {
        // eslint-disable-next-line no-console
        console.warn('[uncraft] skipping undo entry with missing el', u);
        return;
      }
      var currentVal = u.el.style[u.prop];
      u.el.style[u.prop] = forward ? (u.newVal || '') : (u.old || '');
      if (!forward) u.newVal = currentVal;
    }
  }

  function getEditorElsInBody() {
    // Looks at TARGET body — Mode E rebuilds target. In extension mode
    // (host === target) this also catches editor scaffold so undo
    // preserves panels; in canvas mode the target body has no scaffold
    // so the list is naturally empty (no false positives).
    var out = [];
    Array.from(targetDoc.body.children).forEach(function(child) {
      if (child.id && (child.id.indexOf('rb-editor') === 0 || child.id.indexOf('rb-ed-') === 0)) {
        out.push(child);
      }
    });
    return out;
  }

  function undo() {
    if (!undoStack.length) return;
    var u = undoStack.pop();
    // A single bad entry (e.g., el referencing a node that was removed
    // from the DOM, or an entry pushed mid-bug) shouldn't kill the
    // editor — log + continue so the user can keep working.
    try {
      applyUndoEntry(u, false);
      pushRedo(u);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[uncraft] undo entry failed, dropping it:', err, u);
    }
    if (selectedEl) {
      updateSelBox(selectedEl);
      updateInspector(selectedEl);
    }
  }

  function redo() {
    if (!redoStack.length) return;
    var u = redoStack.pop();
    try {
      applyUndoEntry(u, true);
      undoStack.push(u);
      if (undoStack.length > UNDO_STACK_MAX) undoStack.shift();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[uncraft] redo entry failed, dropping it:', err, u);
    }
    if (selectedEl) {
      updateSelBox(selectedEl);
      updateInspector(selectedEl);
    }
  }

  // ============ CLIPBOARD (Cut / Copy / Paste) ============
  //
  // Clipboard operations work on the currently selected element. We store
  // the element's outerHTML as text, which means cross-tab / cross-app
  // paste also works (you can Copy here and Paste into a text editor).
  //
  // Paste inserts the content as a sibling AFTER the selected element
  // (closest to how word processors and design tools behave). If nothing
  // is selected, paste is a no-op.

  var clipboardHTML = null; // internal fallback when navigator.clipboard is unavailable

  function clipCopy() {
    if (!selectedEl) return false;
    var html = selectedEl.outerHTML;
    clipboardHTML = html;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(html).catch(function() {});
    }
    return true;
  }

  function clipCut() {
    if (!selectedEl) return false;
    clipCopy();
    var parent = selectedEl.parentElement;
    var next = selectedEl.nextElementSibling;
    var el = selectedEl;
    pushUndo({el: el, prop: '__removed', parent: parent, next: next});
    deselectEl();
    el.remove();
    return true;
  }

  async function clipPaste() {
    var html = clipboardHTML;
    if (navigator.clipboard && navigator.clipboard.readText) {
      try {
        var fromSystem = await navigator.clipboard.readText();
        if (fromSystem && /^\s*</.test(fromSystem)) html = fromSystem;
      } catch(e) { /* permission denied, use internal fallback */ }
    }
    if (!html) return false;
    var target = selectedEl || targetDoc.body.firstElementChild;
    if (!target || isEditorEl(target)) return false;

    // Parse into a DOM fragment in TARGET so adopted nodes inherit target context.
    var tmp = targetDoc.createElement('div');
    tmp.innerHTML = html;
    var newEl = tmp.firstElementChild;
    if (!newEl) return false;

    // Insert as sibling after the selected element
    var parent = target.parentElement;
    if (!parent) return false;
    parent.insertBefore(newEl, target.nextSibling);

    // Push an undo entry so Cmd+Z removes the pasted element
    pushUndo({el: newEl, prop: '__removed', parent: parent, next: newEl.nextSibling});
    return true;
  }

  // ============ FIND ============
  //
  // Simple find-in-page for the editor: user types a query, we find the
  // first element containing that text (case-insensitive), scroll it into
  // view, select it. Enter cycles to next match. Escape closes the overlay.

  var findOverlay = null;
  var findMatches = [];
  var findIndex = 0;

  function openFind() {
    if (findOverlay) { findOverlay.querySelector('input').focus(); return; }
    findOverlay = mk('div', 'rb-ed-find');
    findOverlay.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483646;background:rgba(23,23,23,0.92);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border:1px solid rgba(255,255,255,0.12);border-radius:8px;padding:6px 8px;display:flex;align-items:center;gap:6px;box-shadow:0 8px 24px rgba(0,0,0,0.4);font-family:"Instrument Sans",sans-serif;';
    var input = mk('input');
    input.type = 'text';
    input.placeholder = 'Find text on page…';
    input.style.cssText = 'background:none;border:none;color:#EFEEEB;font:400 13px "Instrument Sans",sans-serif;outline:none;width:260px;padding:4px 6px;';
    var counter = mk('span');
    counter.style.cssText = 'color:rgba(239,238,235,0.4);font:400 11px "Instrument Sans",sans-serif;min-width:48px;text-align:right;';
    counter.textContent = '';
    var close = mk('button');
    close.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    close.style.cssText = 'background:none;border:none;color:rgba(239,238,235,0.5);cursor:pointer;padding:4px;display:flex;align-items:center;';
    close.addEventListener('click', closeFind, {signal: sig});
    findOverlay.appendChild(input);
    findOverlay.appendChild(counter);
    findOverlay.appendChild(close);
    root.appendChild(findOverlay);

    function runSearch() {
      var q = input.value.trim().toLowerCase();
      findMatches = [];
      findIndex = 0;
      if (q.length < 2) { counter.textContent = ''; return; }
      // Walk visible text-containing elements
      var all = targetDoc.querySelectorAll('h1,h2,h3,h4,h5,h6,p,span,a,button,li,td,th,label,div');
      all.forEach(function(el) {
        if (isEditorEl(el)) return;
        var r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) return;
        // Match direct text only (not descendants' text) to avoid selecting huge containers
        var direct = '';
        for (var i = 0; i < el.childNodes.length; i++) {
          var n = el.childNodes[i];
          if (n.nodeType === 3) direct += n.nodeValue;
        }
        if (direct.toLowerCase().indexOf(q) !== -1) findMatches.push(el);
      });
      counter.textContent = findMatches.length ? (findIndex + 1) + '/' + findMatches.length : '0';
      if (findMatches.length) focusFindMatch();
    }

    function focusFindMatch() {
      var el = findMatches[findIndex];
      if (!el) return;
      el.scrollIntoView({behavior: 'smooth', block: 'center'});
      try { selectEl(el); } catch(e) {}
      counter.textContent = (findIndex + 1) + '/' + findMatches.length;
    }

    input.addEventListener('input', runSearch, {signal: sig});
    input.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (findMatches.length === 0) return;
        findIndex = (findIndex + (e.shiftKey ? -1 : 1) + findMatches.length) % findMatches.length;
        focusFindMatch();
      }
      if (e.key === 'Escape') { e.preventDefault(); closeFind(); }
    }, {signal: sig});

    setTimeout(function() { input.focus(); }, 10);
  }

  function closeFind() {
    if (findOverlay) { findOverlay.remove(); findOverlay = null; }
    findMatches = [];
    findIndex = 0;
  }

  // ============ SAVED VERSIONS HISTORY ============
  //
  // Surfaces the persistent snapshot history (in IndexedDB via persist.js)
  // as a floating panel with a timestamped list and Restore buttons. This
  // is the UI for Priority 1 — catastrophic recovery. Users can return to
  // any previously auto-saved state even after the session has ended.

  var savedVersionsPanel = null;

  function formatTimestamp(ts) {
    if (!ts) return '—';
    var d = new Date(ts);
    var now = Date.now();
    var diff = now - ts;
    // Relative label for recent entries
    var rel;
    if (diff < 60000) rel = 'just now';
    else if (diff < 3600000) rel = Math.floor(diff / 60000) + ' min ago';
    else if (diff < 86400000) rel = Math.floor(diff / 3600000) + 'h ago';
    else rel = Math.floor(diff / 86400000) + 'd ago';
    // Absolute label (always shown for precision)
    var pad = function(n) { return n < 10 ? '0' + n : String(n); };
    var abs = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
              ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    return {rel: rel, abs: abs};
  }

  async function openSavedVersionsHistory() {
    if (savedVersionsPanel) { savedVersionsPanel.remove(); savedVersionsPanel = null; return; }
    if (!window.__rbPersist) {
      console.warn('[history] persist.js not loaded');
      return;
    }

    var projectId = window.__rbActiveProjectId;
    var snapshots = [];
    try {
      if (projectId) {
        snapshots = await window.__rbPersist.getSnapshots(projectId, 100);
      } else {
        // No active project yet — still let the user see any projects they have
        var projects = await window.__rbPersist.listProjects(20);
        if (projects.length > 0) {
          // Default to showing the most recent project's history
          projectId = projects[0].id;
          snapshots = await window.__rbPersist.getSnapshots(projectId, 100);
        }
      }
    } catch(e) {
      console.error('[history] failed to load snapshots:', e);
      return;
    }

    savedVersionsPanel = mk('div', 'rb-ed-history');
    savedVersionsPanel.style.cssText = 'position:fixed;top:60px;left:50%;transform:translateX(-50%);z-index:2147483646;background:rgba(23,23,23,0.92);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border:1px solid rgba(255,255,255,0.12);border-radius:12px;padding:0;min-width:420px;max-width:520px;max-height:70vh;box-shadow:0 16px 48px rgba(0,0,0,0.5);font-family:"Instrument Sans",sans-serif;display:flex;flex-direction:column;overflow:hidden;';

    // Header
    var header = mk('div');
    header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid rgba(255,255,255,0.06);';
    var title = mk('span');
    title.textContent = 'Saved versions history';
    title.style.cssText = 'font:600 13px "Instrument Sans",sans-serif;color:#EFEEEB;letter-spacing:0.2px;';
    var closeBtn = mk('button');
    closeBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    closeBtn.style.cssText = 'background:none;border:none;color:rgba(239,238,235,0.5);cursor:pointer;padding:4px;display:flex;align-items:center;';
    closeBtn.addEventListener('click', function() { savedVersionsPanel.remove(); savedVersionsPanel = null; });
    header.appendChild(title);
    header.appendChild(closeBtn);
    savedVersionsPanel.appendChild(header);

    // Body
    var body = mk('div');
    body.style.cssText = 'overflow-y:auto;padding:8px 0;scrollbar-width:thin;';

    if (snapshots.length === 0) {
      var empty = mk('div');
      empty.style.cssText = 'padding:40px 20px;text-align:center;color:rgba(239,238,235,0.4);font:400 12px "Instrument Sans",sans-serif;';
      empty.innerHTML = 'No saved versions yet.<br><span style="font-size:11px;opacity:0.7">Snapshots are auto-created every 30 seconds once you start editing, and before any Mode E run.</span>';
      body.appendChild(empty);
    } else {
      snapshots.forEach(function(snap) {
        var row = mk('div');
        row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:10px 16px;border-bottom:1px solid rgba(255,255,255,0.04);cursor:default;';

        var left = mk('div');
        left.style.cssText = 'flex:1;display:flex;flex-direction:column;gap:2px;min-width:0;';
        var label = mk('div');
        label.textContent = snap.label || 'Snapshot';
        label.style.cssText = 'font:500 12px "Instrument Sans",sans-serif;color:#EFEEEB;' + (snap.isInitial ? 'color:#5ee37f;' : '');
        var ts = formatTimestamp(snap.createdAt);
        var time = mk('div');
        time.innerHTML = '<span style="color:rgba(239,238,235,0.6)">' + ts.abs + '</span><span style="color:rgba(239,238,235,0.35);margin-left:8px">' + ts.rel + '</span>';
        time.style.cssText = 'font:400 11px "Instrument Sans",sans-serif;';
        left.appendChild(label);
        left.appendChild(time);

        var restoreBtn = mk('button');
        restoreBtn.textContent = 'Restore';
        restoreBtn.style.cssText = 'background:rgba(255,255,255,0.08);color:#EFEEEB;border:none;border-radius:999px;padding:5px 14px;font:500 11px "Instrument Sans",sans-serif;cursor:pointer;flex-shrink:0;transition:background 120ms;';
        restoreBtn.addEventListener('mouseenter', function() { restoreBtn.style.background = 'rgba(94,227,127,0.25)'; });
        restoreBtn.addEventListener('mouseleave', function() { restoreBtn.style.background = 'rgba(255,255,255,0.08)'; });
        restoreBtn.addEventListener('click', async function() {
          if (!confirm('Restore this version? Current unsaved changes will be lost.')) return;
          // Apply the snapshot HTML to the current rebuilt page or body.
          // The rebuilt page lives in TARGET; editor scaffolding lives in HOST.
          var container = targetDoc.getElementById('rb-rebuilt-page');
          if (container) {
            container.outerHTML = snap.html;
          } else {
            // No rebuilt page — this is a Mode A edit context. Restore
            // means replacing the body content with the snapshot HTML
            // (user confirmed). When host === target (extension), keep
            // editor scaffolding intact; otherwise just replace target body.
            var editorEls = [];
            if (hostDoc === targetDoc) {
              Array.from(targetDoc.body.children).forEach(function(child) {
                if (child.id && (child.id.indexOf('rb-editor') === 0 || child.id.indexOf('rb-ed-') === 0)) {
                  editorEls.push(child);
                }
              });
            }
            Array.from(targetDoc.body.children).forEach(function(child) {
              if (editorEls.indexOf(child) === -1) child.remove();
            });
            var frag = targetDoc.createElement('div');
            frag.innerHTML = snap.html;
            var insertBefore = editorEls[0] || null;
            Array.from(frag.children).forEach(function(child) {
              if (insertBefore) targetDoc.body.insertBefore(child, insertBefore);
              else targetDoc.body.appendChild(child);
            });
          }
          // Reset in-memory undo/redo since the state we came from no longer exists
          undoStack.length = 0;
          redoStack.length = 0;
          savedVersionsPanel.remove();
          savedVersionsPanel = null;
        });

        row.appendChild(left);
        row.appendChild(restoreBtn);
        body.appendChild(row);
      });
    }

    savedVersionsPanel.appendChild(body);
    root.appendChild(savedVersionsPanel);

    // Close on outside click
    var closeOutside = function(ev) {
      if (savedVersionsPanel && !savedVersionsPanel.contains(ev.target)) {
        savedVersionsPanel.remove();
        savedVersionsPanel = null;
        hostDoc.removeEventListener('mousedown', closeOutside, true);
      }
    };
    setTimeout(function() { hostDoc.addEventListener('mousedown', closeOutside, true); }, 100);
  }

  // ============ LAZY DECOUPLE (bake inline styles on select) ============

  var DECOUPLE_PROPS = [
    'display','position','top','right','bottom','left',
    'width','height','minWidth','minHeight','maxWidth','maxHeight',
    'margin','marginTop','marginRight','marginBottom','marginLeft',
    'padding','paddingTop','paddingRight','paddingBottom','paddingLeft',
    'border','borderTop','borderRight','borderBottom','borderLeft',
    'borderRadius','borderTopLeftRadius','borderTopRightRadius',
    'borderBottomLeftRadius','borderBottomRightRadius',
    'backgroundColor','color','opacity',
    'fontSize','fontFamily','fontWeight','fontStyle','fontVariant',
    'lineHeight','letterSpacing','textAlign','textDecoration','textTransform',
    'whiteSpace','wordBreak','overflowWrap',
    'overflow','overflowX','overflowY',
    'flexDirection','flexWrap','justifyContent','alignItems','alignContent',
    'alignSelf','flex','flexGrow','flexShrink','flexBasis','order','gap',
    'gridTemplateColumns','gridTemplateRows','gridColumn','gridRow',
    'boxShadow','textShadow',
    'backgroundImage','backgroundSize','backgroundPosition','backgroundRepeat',
    'objectFit','objectPosition',
    'transform','transformOrigin',
    'zIndex','verticalAlign','float','clear',
    'listStyleType','listStylePosition',
    'clipPath','filter','backdropFilter','mixBlendMode','aspectRatio'
  ];

  var decoupledSet = new Set();

  function decoupleElement(el) {
    if (!el || !el.getAttribute) return;
    var nid = el.getAttribute('data-rb-node');
    if (!nid || decoupledSet.has(nid)) return;

    // Read all computed styles from the live element
    var cs = getCS(el);
    var rect = el.getBoundingClientRect();

    // Bake inline
    for (var i = 0; i < DECOUPLE_PROPS.length; i++) {
      var prop = DECOUPLE_PROPS[i];
      try {
        var val = cs[prop];
        if (val !== undefined && val !== '') {
          el.style[prop] = val;
        }
      } catch (e) {}
    }

    // Use bounding rect for explicit dimensions
    el.style.width = rect.width + 'px';
    el.style.height = rect.height + 'px';

    // Strip classes (now independent of stylesheets)
    el.removeAttribute('class');

    decoupledSet.add(nid);
  }

  // Also decouple parent so its flex/grid layout is preserved when children move
  function decoupleForMove(el) {
    decoupleElement(el);
    if (el.parentElement && el.parentElement.getAttribute('data-rb-node')) {
      decoupleElement(el.parentElement);
      // Decouple siblings so their positions stay stable
      var siblings = el.parentElement.children;
      for (var s = 0; s < siblings.length; s++) {
        if (siblings[s].getAttribute('data-rb-node')) {
          decoupleElement(siblings[s]);
        }
      }
    }
  }

  // ============ SELECT / DESELECT ============

  var isTextEditing = false;

  function selectEl(el) {
    if (selectedEl && selectedEl !== el) {
      selectedEl.contentEditable = 'false';
      selectedEl.removeAttribute('data-rb-editing');
      selectedEl.classList.remove('rb-ed-movable');
      isTextEditing = false;
    }

    selectedEl = el;
    updateSelBox(el);
    updateParentBox(el);
    updateInspector(el);
    updateSpacingGuides(el);

    // Scroll FREE during selection (1 click) — locked only during text edit (2 clicks)
    el.classList.add('rb-ed-movable');

    var box = getBox(el);
    if (isText(el)) {
      showFtue('dblclick', 'Double-click to edit text', box.left, box.top);
    }
    showFtue('undo', 'Press <kbd>' + modKey + '+Z</kbd> to undo', box.left, box.top - 24);
    syncLayersSelection(el);
  }

  // Snapshot of innerHTML when user enters text edit mode. Used to detect
  // changes and push a single undo entry on exit instead of flooding the
  // undoStack with per-keystroke mutations.
  var textEditOriginalHTML = null;
  var textEditTarget = null;

  function enterTextEdit(el) {
    el.contentEditable = 'true';
    el.setAttribute('data-rb-editing', '');
    el.classList.remove('rb-ed-movable');
    selBox.style.display = 'none';
    isTextEditing = true;
    textEditTarget = el;
    textEditOriginalHTML = el.innerHTML;
    // No scroll lock — causes too many issues on custom scroll sites
    el.focus();
    try {
      var range = targetDoc.createRange();
      range.selectNodeContents(el);
      var sel = targetWin.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    } catch(err) {}
  }

  function exitTextEdit() {
    // If the user actually edited anything, capture it as a single undo
    // entry with the whole innerHTML before/after. Undo handler type is
    // __textEdit.
    if (textEditTarget && textEditOriginalHTML !== null) {
      var newHTML = textEditTarget.innerHTML;
      if (newHTML !== textEditOriginalHTML) {
        pushUndo({
          el: textEditTarget,
          prop: '__textEdit',
          old: textEditOriginalHTML
        });
      }
    }
    textEditTarget = null;
    textEditOriginalHTML = null;
    isTextEditing = false;
    __pendingTextRange = null;
    // Text dock is a text-edit-session affordance — kill it when the session
    // ends so it doesn't hang on after the user clicks elsewhere.
    try { removeTextDock(); } catch (_) {}
  }

  function deselectEl() {
    if (selectedEl) {
      selectedEl.contentEditable = 'false';
      selectedEl.removeAttribute('data-rb-editing');
      selectedEl.classList.remove('rb-ed-movable');
    }
    var sel = targetWin.getSelection();
    if (sel) sel.removeAllRanges();
    selectedEl = null;
    selectionDepth = 0;
    selectionAncestor = null;
    if (isTextEditing) exitTextEdit();
    isTextEditing = false;
    selBox.style.display = 'none';
    parentBox.style.display = 'none';
    var lock = hostDoc.getElementById('rb-ed-lock');
    if (lock) lock.remove();
    hideSpacingGuides();
    showGlobalCSS();
    syncLayersSelection(null);
  }

  // ============ UPDATE OVERLAYS ============

  function updateSelBox(el) {
    if (!el) { selBox.style.display = 'none'; return; }
    var r = getOverlayBox(el);
    Object.assign(selBox.style, {
      display: 'block', top: r.top + 'px', left: r.left + 'px',
      width: r.width + 'px', height: r.height + 'px'
    });
    var tag = el.tagName.toLowerCase();
    var cls = el.classList.length
      ? '.' + Array.from(el.classList).filter(function(c) {
          return c.indexOf('rb-') === -1;
        }).slice(0, 1).join('.')
      : '';
    selLabel.textContent = Math.round(r.width) + ' \u00d7 ' + Math.round(r.height);
  }

  function updateHoverBox(el) {
    if (!el) { hoverBox.style.display = 'none'; return; }
    var r = getOverlayBox(el);
    Object.assign(hoverBox.style, {
      display: 'block', top: r.top + 'px', left: r.left + 'px',
      width: r.width + 'px', height: r.height + 'px'
    });
    var clsStr = '';
    if (el.className && typeof el.className === 'string') {
      var first = el.className.split(' ').filter(function(c) {
        return c.indexOf('rb-') === -1;
      })[0];
      if (first) clsStr = '.' + first;
    }
    hoverTag.textContent = el.tagName.toLowerCase() + clsStr;
  }

  function updateParentBox(el) {
    var p = el.parentElement;
    if (!p || SKIP.has(p.tagName)) { parentBox.style.display = 'none'; return; }
    var r = getOverlayBox(p);
    Object.assign(parentBox.style, {
      display: 'block', top: r.top + 'px', left: r.left + 'px',
      width: r.width + 'px', height: r.height + 'px'
    });
  }

  // ============ SPACING GUIDES ============

  // Cross-doc drag listener helpers. In canvas mode (host !== target)
  // mouse events that originate inside the iframe DON'T bubble out into
  // the host document, so any drag handler that listens on hostDoc only
  // gets stuck the moment the cursor enters iframe content (mouseup
  // never lands → ghost-pressed state). Listening on BOTH docs covers
  // both viewport halves. In extension mode host === target so the
  // second pair is skipped (would otherwise double-fire).
  function bindDragOnBothDocs(move, up) {
    hostDoc.addEventListener('mousemove', move);
    hostDoc.addEventListener('mouseup', up);
    if (hostDoc !== targetDoc) {
      targetDoc.addEventListener('mousemove', move);
      targetDoc.addEventListener('mouseup', up);
    }
  }
  function unbindDragOnBothDocs(move, up) {
    hostDoc.removeEventListener('mousemove', move);
    hostDoc.removeEventListener('mouseup', up);
    if (hostDoc !== targetDoc) {
      targetDoc.removeEventListener('mousemove', move);
      targetDoc.removeEventListener('mouseup', up);
    }
  }
  // Normalise an event's clientX/clientY to HOST viewport coords. Events
  // dispatched by the iframe (targetDoc) carry clientX/Y in IFRAME viewport
  // coords — comparing those against host-captured drag-start coords does
  // garbage math and the drag value jumps around or never matches the
  // mouseup threshold. This converts iframe coords back to host coords
  // using the same scale getOverlayBox uses.
  function eventToHostXY(ev) {
    if (hostDoc === targetDoc) return {x: ev.clientX, y: ev.clientY};
    var ifr = targetWin && targetWin.frameElement;
    if (!ifr) return {x: ev.clientX, y: ev.clientY};
    // ev.view is the window the event was dispatched in.
    if (ev.view === targetWin) {
      var ir = ifr.getBoundingClientRect();
      var contentW = targetWin.innerWidth || ir.width;
      var scale = ir.width / (contentW || 1);
      return {x: ir.left + ev.clientX * scale, y: ir.top + ev.clientY * scale};
    }
    return {x: ev.clientX, y: ev.clientY};
  }

  var spacingGuides = {
    mt: mk('div', 'rb-spacing-guide rb-spacing-margin'),
    mr: mk('div', 'rb-spacing-guide rb-spacing-margin'),
    mb: mk('div', 'rb-spacing-guide rb-spacing-margin'),
    ml: mk('div', 'rb-spacing-guide rb-spacing-margin'),
    pt: mk('div', 'rb-spacing-guide rb-spacing-padding'),
    pr: mk('div', 'rb-spacing-guide rb-spacing-padding'),
    pb: mk('div', 'rb-spacing-guide rb-spacing-padding'),
    pl: mk('div', 'rb-spacing-guide rb-spacing-padding'),
    gap: mk('div', 'rb-spacing-guide rb-spacing-gap')
  };

  // CSS prop mapping for each guide
  var guideProps = {
    mt: 'marginTop', mr: 'marginRight', mb: 'marginBottom', ml: 'marginLeft',
    pt: 'paddingTop', pr: 'paddingRight', pb: 'paddingBottom', pl: 'paddingLeft',
    gap: 'gap'
  };
  // Drag axis: which direction to track mouse movement
  var guideAxis = {
    mt: 'y', mb: 'y', pt: 'y', pb: 'y',
    ml: 'x', mr: 'x', pl: 'x', pr: 'x',
    gap: 'auto'
  };
  // Drag direction: positive means "value increases when mouse moves this way"
  var guideDir = {
    mt: -1, mb: 1, pt: 1, pb: -1,
    ml: -1, mr: 1, pl: 1, pr: -1,
    gap: 1
  };
  // Mirror map for Alt-drag (opposite side)
  var guideMirror = {
    mt: 'mb', mb: 'mt', ml: 'mr', mr: 'ml',
    pt: 'pb', pb: 'pt', pl: 'pr', pr: 'pl'
  };
  var marginSides = ['mt','mr','mb','ml'];
  var paddingSides = ['pt','pr','pb','pl'];
  function guideGroup(key) {
    if (marginSides.indexOf(key) >= 0) return marginSides;
    if (paddingSides.indexOf(key) >= 0) return paddingSides;
    return null;
  }

  // State: which guide the keyboard nudges (set on hover or drag start)
  var activeGuideKey = null;
  // Toggled by 'G' key — hides guides entirely when false
  var guidesVisible = true;

  function setActiveGuide(key) {
    if (activeGuideKey && spacingGuides[activeGuideKey]) {
      spacingGuides[activeGuideKey].classList.remove('rb-spacing-active');
    }
    activeGuideKey = key;
    if (key && spacingGuides[key]) spacingGuides[key].classList.add('rb-spacing-active');
  }

  function guideTargetEl(key) {
    if (!selectedEl) return null;
    return key === 'gap' ? selectedEl.parentElement : selectedEl;
  }

  function renderWidgetLabel(widget, value, startValue) {
    var valSpan = widget.querySelector('.rb-spacing-val');
    if (!valSpan) return;
    if (startValue != null && value !== startValue) {
      var d = value - startValue;
      valSpan.innerHTML = value + ' <span class="rb-spacing-delta">' + (d >= 0 ? '+' : '') + d + '</span>';
    } else {
      valSpan.textContent = String(value);
    }
  }

  // Pin icon — same shape used by the host shell's PromptDock so the
  // feedback affordance reads as "the same thing" inside the editor and
  // out on the canvas.
  var SPACING_PIN_SVG = '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" x2="12" y1="17" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/></svg>';

  function spacingWidgetMarkup(iconChar, valStr) {
    return (
      '<span class="rb-spacing-icon">' + iconChar + '</span>' +
      '<span class="rb-spacing-val">' + valStr + '</span>'
    );
  }

  function spacingFeedbackTabMarkup() {
    return (
      '<span class="rb-spacing-fb-lbl">Add feedback</span>' +
      '<span class="rb-spacing-fb-sep" aria-hidden="true"></span>' +
      '<button type="button" class="rb-spacing-fb-btn" title="Pin feedback to this guide" aria-label="Add feedback">' +
        SPACING_PIN_SVG +
      '</button>'
    );
  }

  // Hydrate the selection-box feedback tab (created earlier, before
  // SPACING_PIN_SVG existed). Wire click + drag-suppression.
  selFeedbackTab.innerHTML = spacingFeedbackTabMarkup();
  selFeedbackTab.addEventListener('mousedown', function(e) {
    e.stopPropagation();
    e.preventDefault();
  }, true);
  selFeedbackTab.addEventListener('click', function(e) {
    e.stopPropagation();
    e.preventDefault();
    try {
      hostWin.dispatchEvent(new CustomEvent('uncraft:feedback', {
        detail: { source: 'selection', selector: selectedEl ? (selectedEl.id || selectedEl.tagName) : null }
      }));
    } catch (err) {}
  });

  Object.keys(spacingGuides).forEach(function(key) {
    var widget = mk('div', 'rb-spacing-widget');
    widget.innerHTML = spacingWidgetMarkup('\u2194', '0');
    widget.setAttribute('data-rb-guide', key);
    spacingGuides[key].appendChild(widget);

    spacingGuides[key].style.display = 'none';
    spacingGuides[key].style.pointerEvents = 'auto';
    spacingGuides[key].style.cursor = (guideAxis[key] === 'x') ? 'ew-resize' : 'ns-resize';
    spacingGuides[key].setAttribute('data-rb-guide', key);
    root.appendChild(spacingGuides[key]);

    // Hover tracking for keyboard nudge
    spacingGuides[key].addEventListener('mouseenter', function() { setActiveGuide(key); });
    spacingGuides[key].addEventListener('mouseleave', function() {
      if (!spacingGuides[key].classList.contains('rb-spacing-dragging')) setActiveGuide(null);
    });

    // Dbl-click on the label → inline numeric input (supports 20, 20px, 1rem, 2em, 50%, +5, -3)
    widget.addEventListener('dblclick', function(e) {
      e.preventDefault();
      e.stopPropagation();
      var prop = guideProps[key];
      var targetEl = guideTargetEl(key);
      if (!targetEl) return;
      var cs = getCS(targetEl);
      var curPx = parseFloat(cs[prop]) || 0;
      var iconSpan = widget.querySelector('.rb-spacing-icon');
      var iconChar = iconSpan ? iconSpan.textContent : '\u2194';

      var input = hostDoc.createElement('input');
      input.type = 'text';
      input.value = String(Math.round(curPx));
      input.className = 'rb-spacing-inline-input';
      widget.innerHTML = '';
      widget.appendChild(input);
      widget.classList.add('rb-spacing-editing');
      setTimeout(function() { input.focus(); input.select(); }, 0);

      var committed = false;
      function restoreLabel(label) {
        widget.classList.remove('rb-spacing-editing');
        widget.innerHTML = spacingWidgetMarkup(iconChar, label);
      }
      function parseInput(v) {
        v = v.trim();
        if (/^[+-]\s*[0-9.]+$/.test(v)) {
          var delta = parseFloat(v);
          return isNaN(delta) ? null : Math.max(0, curPx + delta);
        }
        var m = v.match(/^([0-9.]+)\s*(px|rem|em|%)?$/i);
        if (!m) return null;
        var num = parseFloat(m[1]);
        if (isNaN(num)) return null;
        var unit = (m[2] || 'px').toLowerCase();
        if (unit === 'px') return num;
        if (unit === 'rem') return num * (parseFloat(getCS(targetDoc.documentElement).fontSize) || 16);
        if (unit === 'em')  return num * (parseFloat(cs.fontSize) || 16);
        if (unit === '%') {
          var parent = targetEl.parentElement;
          var pw = parent ? parent.getBoundingClientRect().width : 0;
          return num / 100 * pw;
        }
        return null;
      }
      function commit() {
        if (committed) return;
        committed = true;
        var newVal = parseInput(input.value);
        if (newVal != null) {
          newVal = Math.max(0, Math.round(newVal));
          targetEl.style[prop] = newVal + 'px';
          pushUndo({ el: targetEl, prop: prop, old: curPx + 'px' });
          restoreLabel(String(newVal));
          updateSpacingGuides(selectedEl);
          updateSelBox(selectedEl);
        } else {
          restoreLabel(String(Math.round(curPx)));
        }
      }
      input.addEventListener('keydown', function(ev) {
        ev.stopPropagation();
        if (ev.key === 'Enter') { ev.preventDefault(); commit(); }
        else if (ev.key === 'Escape') { committed = true; restoreLabel(String(Math.round(curPx))); }
      });
      input.addEventListener('blur', commit);
      input.addEventListener('mousedown', function(ev) { ev.stopPropagation(); });
    });

    // Drag to resize spacing (with Alt/Shift/Cmd modifiers). The
    // bindDragOnBothDocs / unbindDragOnBothDocs helpers live at IIFE
    // outer scope (above the spacing/corner registration) so both the
    // edge-band drag and the corner-handle drag can share them.
    var dragStartPos = null;
    var dragStartValue = 0;
    spacingGuides[key].addEventListener('mousedown', function(e) {
      if (!selectedEl) return;
      if (e.target && e.target.classList && e.target.classList.contains('rb-spacing-inline-input')) return;
      // NOTE: do NOT preventDefault/stopPropagation here yet — if the user only
      // clicks (no drag), we pass the click through to the underlying element so
      // they can switch selection even when guides cover the surrounding area.
      e.stopPropagation();

      var prop = guideProps[key];
      var targetEl = guideTargetEl(key);
      if (!targetEl) return;

      var cs = getCS(targetEl);
      dragStartValue = parseFloat(cs[prop]) || 0;
      dragStartPos = eventToHostXY(e);

      var axis = guideAxis[key];
      if (axis === 'auto') {
        var parentCs = getCS(targetEl);
        axis = (parentCs.flexDirection === 'row' || parentCs.flexDirection === 'row-reverse') ? 'x' : 'y';
      }
      var dir = guideDir[key];
      var group = guideGroup(key);
      var mirror = guideMirror[key];

      var initial = {};
      initial[key] = dragStartValue;
      if (group) group.forEach(function(k) { if (initial[k] == null) initial[k] = parseFloat(cs[guideProps[k]]) || 0; });
      if (mirror) initial[mirror] = parseFloat(cs[guideProps[mirror]]) || 0;

      var dragged = false;
      var DRAG_THRESHOLD = 3;  // px before we commit to drag mode

      function onMove(ev) {
        var hp = eventToHostXY(ev);
        if (!dragged) {
          if (Math.abs(hp.x - dragStartPos.x) < DRAG_THRESHOLD &&
              Math.abs(hp.y - dragStartPos.y) < DRAG_THRESHOLD) return;
          dragged = true;
          setActiveGuide(key);
          spacingGuides[key].classList.add('rb-spacing-dragging');
          hostDoc.body.classList.add('rb-ed-dragging-guide');
        }
        var delta = (axis === 'x')
          ? (hp.x - dragStartPos.x) * dir
          : (hp.y - dragStartPos.y) * dir;
        // Convert host-px delta back to target-px so the value matches the
        // CSS units we're writing (margin/padding live in target coords).
        var s = (function() {
          var box = getOverlayBox(targetEl);
          return (box && box._scale) ? box._scale : 1;
        })();
        if (s && s !== 1) delta = delta / s;
        var newVal = Math.max(0, Math.round(dragStartValue + delta));
        if (ev.metaKey || ev.ctrlKey) newVal = Math.round(newVal / 8) * 8;

        if (ev.shiftKey && group) {
          group.forEach(function(k) { targetEl.style[guideProps[k]] = newVal + 'px'; });
        } else if (ev.altKey && mirror) {
          targetEl.style[prop] = newVal + 'px';
          targetEl.style[guideProps[mirror]] = newVal + 'px';
        } else {
          targetEl.style[prop] = newVal + 'px';
        }

        renderWidgetLabel(widget, newVal, dragStartValue);
        updateSpacingGuides(selectedEl);
        updateSelBox(selectedEl);
      }
      function onUp(ev) {
        unbindDragOnBothDocs(onMove, onUp);
        spacingGuides[key].classList.remove('rb-spacing-dragging');
        hostDoc.body.classList.remove('rb-ed-dragging-guide');

        if (!dragged) {
          // Click without drag → pass through: select whatever site element is
          // visually under the cursor. Hide all guides + corners for the hit
          // test so elementFromPoint doesn't return a guide again.
          var allGuides = Object.keys(spacingGuides).map(function(k) { return spacingGuides[k]; });
          var allCorners = Object.keys(cornerGuides).map(function(k) { return cornerGuides[k]; });
          var prev = [];
          allGuides.concat(allCorners).forEach(function(g) {
            prev.push({el: g, val: g.style.pointerEvents});
            g.style.pointerEvents = 'none';
          });
          // elementFromPoint expects viewport coords of THAT doc — use the
          // raw ev.client coords if the event came from targetDoc, else
          // convert host coords back to target. Simpler: just use the
          // event's own coords with its own document.
          var hitDoc = (ev.view === targetWin) ? targetDoc : (hostDoc === targetDoc ? hostDoc : null);
          var below = hitDoc ? hitDoc.elementFromPoint(ev.clientX, ev.clientY) : null;
          prev.forEach(function(p) { p.el.style.pointerEvents = p.val; });
          if (below && !isEditorEl(below) && isValid(below)) {
            var resolved = resolveContainer(below);
            if (resolved && isValid(resolved) && resolved !== selectedEl) {
              if (isTextEditing) exitTextEdit();
              selectEl(resolved);
            }
          }
          return;
        }

        var modShift = ev && ev.shiftKey && group;
        var modAlt = ev && ev.altKey && mirror;
        if (modShift) {
          group.forEach(function(k) { pushUndo({ el: targetEl, prop: guideProps[k], old: initial[k] + 'px' }); });
        } else if (modAlt) {
          pushUndo({ el: targetEl, prop: prop, old: dragStartValue + 'px' });
          pushUndo({ el: targetEl, prop: guideProps[mirror], old: initial[mirror] + 'px' });
        } else {
          pushUndo({ el: targetEl, prop: prop, old: dragStartValue + 'px' });
        }
        updateSpacingGuides(selectedEl);
      }
      bindDragOnBothDocs(onMove, onUp);
    });
  });

  // Corner handles: drag the outer-margin corner to change two sides at once (NW, NE, SE, SW)
  var cornerGuides = {
    nw: mk('div', 'rb-spacing-corner rb-spacing-corner-nw'),
    ne: mk('div', 'rb-spacing-corner rb-spacing-corner-ne'),
    se: mk('div', 'rb-spacing-corner rb-spacing-corner-se'),
    sw: mk('div', 'rb-spacing-corner rb-spacing-corner-sw')
  };
  // Each corner edits two margins; signs convert screen delta → value delta.
  var cornerConfig = {
    nw: { props: ['marginTop', 'marginLeft'],     signY: -1, signX: -1 },
    ne: { props: ['marginTop', 'marginRight'],    signY: -1, signX:  1 },
    se: { props: ['marginBottom', 'marginRight'], signY:  1, signX:  1 },
    sw: { props: ['marginBottom', 'marginLeft'],  signY:  1, signX: -1 }
  };
  Object.keys(cornerGuides).forEach(function(ckey) {
    var handle = cornerGuides[ckey];
    handle.style.display = 'none';
    root.appendChild(handle);
    handle.addEventListener('mousedown', function(e) {
      if (!selectedEl) return;
      e.preventDefault();
      e.stopPropagation();
      var cfg = cornerConfig[ckey];
      var cs = getCS(selectedEl);
      var startY = parseFloat(cs[cfg.props[0]]) || 0;
      var startX = parseFloat(cs[cfg.props[1]]) || 0;
      var startPos = eventToHostXY(e);
      hostDoc.body.classList.add('rb-ed-dragging-guide');
      function onMove(ev) {
        var hp = eventToHostXY(ev);
        // Convert host-px delta to target-px (same reason as spacing-guide).
        var s = (function() {
          var box = getOverlayBox(selectedEl);
          return (box && box._scale) ? box._scale : 1;
        })();
        var dy = (hp.y - startPos.y) * cfg.signY;
        var dx = (hp.x - startPos.x) * cfg.signX;
        if (s && s !== 1) { dy = dy / s; dx = dx / s; }
        var newY = Math.max(0, Math.round(startY + dy));
        var newX = Math.max(0, Math.round(startX + dx));
        if (ev.metaKey || ev.ctrlKey) {
          newY = Math.round(newY / 8) * 8;
          newX = Math.round(newX / 8) * 8;
        }
        selectedEl.style[cfg.props[0]] = newY + 'px';
        selectedEl.style[cfg.props[1]] = newX + 'px';
        updateSpacingGuides(selectedEl);
        updateSelBox(selectedEl);
      }
      function onUp() {
        unbindDragOnBothDocs(onMove, onUp);
        hostDoc.body.classList.remove('rb-ed-dragging-guide');
        if (selectedEl) {
          pushUndo({ el: selectedEl, prop: cfg.props[0], old: startY + 'px' });
          pushUndo({ el: selectedEl, prop: cfg.props[1], old: startX + 'px' });
        }
      }
      bindDragOnBothDocs(onMove, onUp);
    });
  });

  function positionGuide(guide, x, y, w, h, value, icon) {
    if (value <= 0 || w <= 0 || h <= 0) {
      guide.style.display = 'none';
      return;
    }
    Object.assign(guide.style, {
      display: 'block',
      position: 'fixed',
      left: x + 'px',
      top: y + 'px',
      width: w + 'px',
      height: h + 'px'
    });
    if (!guide.classList.contains('rb-spacing-dragging') && !guide.classList.contains('rb-spacing-editing-label')) {
      var valSpan = guide.querySelector('.rb-spacing-val');
      if (valSpan && !guide.querySelector('.rb-spacing-inline-input')) valSpan.textContent = Math.round(value);
    }
    var iconSpan = guide.querySelector('.rb-spacing-icon');
    if (iconSpan && icon) iconSpan.textContent = icon;
  }

  function positionCorner(corner, x, y, show) {
    if (!show) { corner.style.display = 'none'; return; }
    Object.assign(corner.style, {
      display: 'block',
      position: 'fixed',
      left: x + 'px',
      top: y + 'px'
    });
  }

  function updateSpacingGuides(el) {
    if (!el || !guidesVisible) {
      Object.keys(spacingGuides).forEach(function(k) { spacingGuides[k].style.display = 'none'; });
      Object.keys(cornerGuides).forEach(function(k) { cornerGuides[k].style.display = 'none'; });
      return;
    }

    // Use HOST-mapped rect so guides land on the rendered iframe content,
    // not the host viewport. _scale (host px per target px) factors the
    // margin/padding values which getCS returns in target px.
    var r = getOverlayBox(el);
    var s = r._scale != null ? r._scale : 1;
    // Expose scale to CSS so the guide widgets (labels) shrink with canvas
    // zoom. Without this, at zoom < 1 the guide bands are correctly sized
    // but their labels stay at 1:1, swamping the guide visually.
    hostDoc.documentElement.style.setProperty('--rb-guide-scale', s.toFixed(4));
    var cs = getCS(el);
    var lMt = px(cs.marginTop), lMr = px(cs.marginRight), lMb = px(cs.marginBottom), lMl = px(cs.marginLeft);
    var lPt = px(cs.paddingTop), lPr = px(cs.paddingRight), lPb = px(cs.paddingBottom), lPl = px(cs.paddingLeft);
    var mt = lMt * s, mr = lMr * s, mb = lMb * s, ml = lMl * s;
    var pt = lPt * s, pr = lPr * s, pb = lPb * s, pl = lPl * s;

    // Position margin guides (OUTSIDE the element). Labels show target px.
    positionGuide(spacingGuides.mt, r.left - ml, r.top - mt, r.width + ml + mr, mt, lMt);
    positionGuide(spacingGuides.mr, r.right, r.top, mr, r.height, lMr);
    positionGuide(spacingGuides.mb, r.left - ml, r.bottom, r.width + ml + mr, mb, lMb);
    positionGuide(spacingGuides.ml, r.left - ml, r.top, ml, r.height, lMl);

    // Position padding guides (INSIDE the element)
    positionGuide(spacingGuides.pt, r.left, r.top, r.width, pt, lPt);
    positionGuide(spacingGuides.pr, r.right - pr, r.top, pr, r.height, lPr);
    positionGuide(spacingGuides.pb, r.left, r.bottom - pb, r.width, pb, lPb);
    positionGuide(spacingGuides.pl, r.left, r.top, pl, r.height, lPl);

    // Gap guide
    var parentCs = el.parentElement ? getCS(el.parentElement) : null;
    var gapVal = parentCs ? (px(parentCs.gap) || 0) : 0;
    if (gapVal > 0 && el.nextElementSibling) {
      var nextR = getOverlayBox(el.nextElementSibling);
      var isHoriz = parentCs.flexDirection === 'row' || parentCs.flexDirection === 'row-reverse';
      if (isHoriz) {
        positionGuide(spacingGuides.gap, r.right, r.top, nextR.left - r.right, r.height, gapVal, '\u2194');
      } else {
        positionGuide(spacingGuides.gap, r.left, r.bottom, r.width, nextR.top - r.bottom, gapVal, '\u2195');
      }
    } else {
      spacingGuides.gap.style.display = 'none';
    }

    // Corner handles — show all 4 whenever ANY target-px margin is ≥ 2.
    var anyMargin = lMl >= 2 || lMt >= 2 || lMr >= 2 || lMb >= 2;
    positionCorner(cornerGuides.nw, r.left - ml,  r.top - mt,    anyMargin);
    positionCorner(cornerGuides.ne, r.right + mr, r.top - mt,    anyMargin);
    positionCorner(cornerGuides.se, r.right + mr, r.bottom + mb, anyMargin);
    positionCorner(cornerGuides.sw, r.left - ml,  r.bottom + mb, anyMargin);
  }

  function showSpacingGuides(el) {
    updateSpacingGuides(el);
  }

  function hideSpacingGuides() {
    setActiveGuide(null);
    updateSpacingGuides(null);
  }

  // ============ SVG EXPORT ============

  function downloadSVG() {
    // Export the TARGET (the site we're editing), at TARGET's viewport size.
    var w = targetWin.innerWidth, h = targetWin.innerHeight;
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '">' +
      '<foreignObject width="100%" height="100%">' +
      '<html xmlns="http://www.w3.org/1999/xhtml">' +
      targetDoc.documentElement.outerHTML +
      '</html></foreignObject></svg>';
    var blob = new Blob([svg], {type: 'image/svg+xml'});
    var a = hostDoc.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'repix-export.svg';
    a.click();
  }

  // ============ IMAGE MENU ============

  function showImgMenu(img) {
    removeImgMenu();

    // Flash highlight
    img.style.outline = '2px solid #3b82f6';
    img.style.outlineOffset = '2px';
    setTimeout(function() {
      img.style.outline = '';
      img.style.outlineOffset = '';
    }, 800);

    // Check if image is already visible in TARGET viewport.
    var rect = img.getBoundingClientRect();
    var inView = rect.top >= 0 && rect.bottom <= targetWin.innerHeight;

    function positionAndShow() {
      var r = getOverlayBox(img);
      var m = mk('div', 'rb-ed-img-menu');
      m.style.top = Math.max(4, r.top - 40) + 'px';
      m.style.left = (r.left + r.width / 2) + 'px';
      m.style.transform = 'translateX(-50%)';
      buildBarContent(m, img);
      root.appendChild(m);
      // Auto-close on outside click (guarded by generation to prevent stale listeners)
      var gen = _imgMenuGeneration;
      var closeOutside = function(ev) {
        if (gen !== _imgMenuGeneration) { hostDoc.removeEventListener('mousedown', closeOutside, true); return; }
        if (m && !m.contains(ev.target)) {
          removeImgMenu();
          hostDoc.removeEventListener('mousedown', closeOutside, true);
        }
      };
      setTimeout(function() { hostDoc.addEventListener('mousedown', closeOutside, true); }, 150);
    }

    if (!inView) {
      img.scrollIntoView({behavior: 'smooth', block: 'center'});
      // Wait for scroll to settle, then position
      setTimeout(positionAndShow, 400);
    } else {
      positionAndShow();
    }
  }

  function buildBarContent(m, img) {

    // Copy
    var copyBtn = mk('button', 'rb-img-bar-btn');
    copyBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg><span>Copy</span>';
    copyBtn.addEventListener('mousedown', function(e) {
      e.stopImmediatePropagation();
      fetch(img.src).then(function(r) { return r.blob(); }).then(function(blob) {
        if (navigator.clipboard && navigator.clipboard.write) {
          navigator.clipboard.write([new ClipboardItem({'image/png': blob})]);
        }
      }).catch(function() {});
      removeImgMenu();
    }, {capture: true});

    // Replace
    var repBtn = mk('button', 'rb-img-bar-btn');
    repBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg><span>Replace</span>';
    var finp = mk('input');
    finp.type = 'file'; finp.accept = 'image/*'; finp.style.display = 'none';
    finp.addEventListener('change', function(ev) {
      var f = ev.target.files[0]; if (!f) return;
      var reader = new FileReader();
      reader.onload = function() {
        pushUndo({el: img, prop: '__src', old: img.src});
        img.src = reader.result;
        removeImgMenu();
      };
      reader.readAsDataURL(f);
    });
    repBtn.addEventListener('mousedown', function(e) { e.stopImmediatePropagation(); finp.click(); }, {capture: true});

    // Download
    var dlBtn = mk('button', 'rb-img-bar-btn');
    dlBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg><span>Download</span>';
    dlBtn.addEventListener('mousedown', function(e) {
      e.stopImmediatePropagation();
      fetch(img.src).then(function(r) { return r.blob(); }).then(function(blob) {
        var url = URL.createObjectURL(blob);
        var a = mk('a'); a.href = url; a.download = 'image.png';
        hostDoc.body.appendChild(a); a.click(); hostDoc.body.removeChild(a);
        URL.revokeObjectURL(url);
      }).catch(function() { window.open(img.src, '_blank'); });
      removeImgMenu();
    }, {capture: true});

    // Divider
    var divider = mk('div', 'rb-img-bar-divider');

    // Smart Edit (white bg + sparkle icon)
    var smartBtn = mk('button', 'rb-img-bar-btn rb-img-bar-smart');
    smartBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 37 40"><path fill="#2b2b2b" d="M16,29.7c0,.8-.6,1.4-1.3,1.5-1,0-2.7.5-3.2,1.1-.6.6-1,2.3-1.1,3.2,0,.8-.7,1.3-1.5,1.3s-1.4-.6-1.5-1.3c0-1-.5-2.7-1.1-3.2-.6-.6-2.3-1-3.2-1.1-.8,0-1.3-.7-1.3-1.5s.6-1.4,1.3-1.5c1,0,2.7-.5,3.2-1.1.6-.6,1-2.3,1.1-3.2,0-.8.7-1.3,1.5-1.3s1.4.6,1.5,1.3c0,1,.5,2.7,1.1,3.2.6.6,2.3,1,3.2,1.1.8,0,1.3.7,1.3,1.5ZM33.3,16.7c-1.5-.2-5.8-1-7.5-2.7-1.7-1.7-2.5-6-2.7-7.5,0-.8-.7-1.3-1.5-1.3s-1.4.6-1.5,1.3c-.2,1.5-1,5.8-2.7,7.5s-6,2.5-7.5,2.7c-.8,0-1.3.7-1.3,1.5s.6,1.4,1.3,1.5c1.5.2,5.8,1,7.5,2.7s2.5,6,2.7,7.5c0,.8.7,1.3,1.5,1.3s1.4-.6,1.5-1.3c.2-1.5,1-5.8,2.7-7.5,1.7-1.7,6-2.5,7.5-2.7.8,0,1.3-.7,1.3-1.5s-.6-1.4-1.3-1.5Z"/></svg><span>Smart Edit</span>';
    smartBtn.addEventListener('mousedown', function(e) {
      e.stopImmediatePropagation();
      var asset = assetFromElement(img);
      var imgRef = img;
      removeImgMenu();
      if (!asset) return;
      // Auto-analyze: clicking Smart Edit from the minidock signals intent
      // to edit immediately, so skip the idle "Smart edit / Show in page"
      // gate and go straight to analyzing.
      enterAssetEdit(asset, function() {
        if (!imgRef || !isValid(imgRef)) return;
        try { imgRef.scrollIntoView({ behavior: 'auto', block: 'center' }); } catch (e2) {}
        selectEl(imgRef);
        showImgMenu(imgRef);
      }, true);
    }, {capture: true});

    m.appendChild(copyBtn);
    m.appendChild(repBtn);
    m.appendChild(dlBtn);
    m.appendChild(divider);
    m.appendChild(makeDockLinkBtn(img, function() {
      if (selectedEl === img) updateInspector(img);
    }));
    var linkDivider = mk('div', 'rb-img-bar-divider');
    m.appendChild(linkDivider);
    m.appendChild(smartBtn);
    m.appendChild(finp);
    appendDockClose(m);
    prependDockHandle(m);
  }

  var _imgMenuGeneration = 0;
  function removeImgMenu() {
    _imgMenuGeneration++;
    var m = root.querySelector('.rb-ed-img-menu');
    if (m) m.remove();
    // Link popup is opened from the image minidock; close it when the dock dies
    // so it doesn't strand in hostDoc.body after selection changes.
    removeLinkEditor();
  }

  // Shared: prepend drag handle to any minidock
  function prependDockHandle(m) {
    var handle = mk('div', 'rb-dock-handle');
    handle.innerHTML = '<div class="rb-mini-dots"><span></span><span></span><span></span><span></span></div><div class="rb-mini-dots"><span></span><span></span><span></span><span></span></div>';
    m.insertBefore(handle, m.firstChild);
    // Make draggable
    handle.addEventListener('mousedown', function(e) {
      e.preventDefault(); e.stopImmediatePropagation();
      var sx = e.clientX, sy = e.clientY;
      // Use getBoundingClientRect to get the actual rendered position (includes transform)
      var rect = m.getBoundingClientRect();
      var sl = rect.left, st = rect.top;
      // Remove transform immediately so offsetLeft matches visual position
      m.style.left = sl + 'px';
      m.style.top = st + 'px';
      m.style.transform = 'none';
      m.style.right = 'auto';
      function onMove(me) {
        m.style.left = (sl + me.clientX - sx) + 'px';
        m.style.top = (st + me.clientY - sy) + 'px';
      }
      function onUp() { hostDoc.removeEventListener('mousemove', onMove); hostDoc.removeEventListener('mouseup', onUp); }
      hostDoc.addEventListener('mousemove', onMove);
      hostDoc.addEventListener('mouseup', onUp);
    }, {capture: true});
  }

  // Shared: link button for any minidock. Active (filled chain) when element
  // has a link, outline when not. Click opens the same popup editor used by
  // the Link section in the inspector.
  function makeDockLinkBtn(el, onAfterChange) {
    var btn = mk('button', 'rb-img-bar-btn');
    // SVG uses stroke:currentColor so it inherits the button color — blue when
    // `rb-dock-link-active` class is set, theme-default otherwise.
    btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M10 13a5 5 0 007.07 0l3-3a5 5 0 00-7.07-7.07L11 5"/><path d="M14 11a5 5 0 00-7.07 0l-3 3a5 5 0 007.07 7.07L13 19"/></svg>';
    function render() {
      var link = getElementLink(el);
      var hasLink = !!link;
      btn.title = hasLink ? ('Link: ' + (link.getAttribute('href') || '')) : 'Add link';
      btn.classList.toggle('rb-dock-link-active', hasLink);
    }
    render();
    btn.addEventListener('mousedown', function(e) {
      e.stopImmediatePropagation();
      var cur = getElementLink(el);
      var curHref = cur ? (cur.getAttribute('href') || '') : '';
      openLinkEditor(btn, curHref, function(urlOrNull) {
        if (urlOrNull == null) {
          var a = getElementLink(el);
          if (a) unwrapLink(a);
        } else {
          var a2 = getElementLink(el);
          if (a2) {
            var old = a2.getAttribute('href');
            if (old !== urlOrNull) {
              a2.setAttribute('href', urlOrNull);
              pushUndo({ prop: '__hrefChange', anchor: a2, oldHref: old, newHref: urlOrNull });
            }
          } else {
            wrapInLink(el, urlOrNull);
          }
        }
        render();
        if (typeof onAfterChange === 'function') onAfterChange();
      });
    }, {capture: true});
    return btn;
  }

  // Shared: append close divider + X to any minidock
  function appendDockClose(m) {
    var closeDivider = mk('div', 'rb-img-bar-divider');
    var closeBtn = mk('button', 'rb-img-bar-btn');
    closeBtn.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    closeBtn.title = 'Close';
    closeBtn.addEventListener('mousedown', function(e) {
      e.stopImmediatePropagation();
      m.remove();
    }, {capture: true});
    m.appendChild(closeDivider);
    m.appendChild(closeBtn);
  }

  // ============ TEXT MINIDOCK ============

  function showTextDock(el) {
    removeTextDock();
    // For text wrappers (split-text parents with no direct text), read values
    // from the first text leaf so drag starts from the visible size, not the
    // wrapper's inherited value. Writes still go to `el` and cascade via applyStyle.
    var readEl = getReadEl(el);
    var cs = getCS(readEl);
    function isMixed(prop) {
      var v = readTextStyle(el, prop);
      return v && typeof v === 'object' && v.mixed;
    }

    // Snapshot style attribute of wrapper + every leaf so Restore reverts
    // everything the dock session touched (including cascades).
    var origCss = [{ el: el, css: el.getAttribute('style') || '' }];
    getTextLeaves(el).forEach(function(leaf) {
      if (leaf === el) return;
      origCss.push({ el: leaf, css: leaf.getAttribute('style') || '' });
    });

    var rect = getOverlayBox(el);
    var m = mk('div', 'rb-ed-img-menu rb-ed-text-dock');
    m.style.top = Math.max(4, rect.top - 40) + 'px';
    m.style.left = (rect.left + rect.width / 2) + 'px';
    m.style.transform = 'translateX(-50%)';

    // Drag-to-adjust (horizontal = x, vertical = inverted y). If no drag occurs
    // (movement < 3px by mouseup), enter edit mode: replace the span with an
    // <input>, focus+select. Enter/blur commit; Escape reverts. This gives the
    // user both affordances on the same button without a modifier.
    function makeDragValue(btn, initVal, prop, unit, step, min, max, formatFn) {
      btn.classList.add('rb-dock-drag');
      var valSpan = btn.querySelector('span');
      var curVal = initVal;
      btn._editing = false;

      function format(v) { return formatFn ? formatFn(v) : v; }

      function enterEditMode() {
        if (btn._editing) return;
        btn._editing = true;
        var origText = valSpan.textContent;
        var inp = hostDoc.createElement('input');
        inp.type = 'text';
        inp.value = String(curVal);
        inp.style.cssText = 'width:3.5em;background:rgba(255,255,255,0.06);border:none;color:inherit;font:inherit;text-align:center;padding:1px 2px;outline:none;border-radius:2px;';
        valSpan.textContent = '';
        valSpan.appendChild(inp);
        setTimeout(function() { inp.focus(); inp.select(); }, 0);
        var committed = false;
        function commit() {
          if (committed) return; committed = true;
          btn._editing = false;
          var n = parseFloat(inp.value);
          if (!isNaN(n)) {
            curVal = Math.max(min, Math.min(max, n));
            applyStyle(el, prop, curVal + unit);
            valSpan.textContent = format(curVal);
          } else {
            valSpan.textContent = origText;
          }
        }
        inp.addEventListener('blur', commit);
        inp.addEventListener('keydown', function(e) {
          if (e.key === 'Enter') { e.preventDefault(); inp.blur(); }
          else if (e.key === 'Escape') {
            e.preventDefault();
            committed = true;
            btn._editing = false;
            valSpan.textContent = origText;
            inp.blur();
          }
        });
        inp.addEventListener('mousedown', function(e) { e.stopImmediatePropagation(); });
      }

      btn.addEventListener('mousedown', function(e) {
        if (btn._editing) return;
        e.preventDefault(); e.stopImmediatePropagation();
        var sx = e.clientX, sy = e.clientY;
        var startVal = curVal;
        var dragged = false;

        function onMove(ev) {
          var dx = ev.clientX - sx;
          var dy = -(ev.clientY - sy);
          if (!dragged && Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
          dragged = true;
          var delta = (Math.abs(dx) > Math.abs(dy) ? dx : dy) * step;
          curVal = Math.max(min, Math.min(max, Math.round((startVal + delta) * 10) / 10));
          valSpan.textContent = format(curVal);
          applyStyle(el, prop, curVal + unit);
        }
        function onUp() {
          hostDoc.removeEventListener('mousemove', onMove, true);
          hostDoc.removeEventListener('mouseup', onUp, true);
          if (!dragged) enterEditMode();
        }
        hostDoc.addEventListener('mousemove', onMove, true);
        hostDoc.addEventListener('mouseup', onUp, true);
      }, {capture: true});
    }

    // Prop icons — always visible on every minidock button, same pattern as
    // letter-spacing + line-height. Makes the dock instantly scannable and keeps
    // a consistent shape regardless of Mixed/not-mixed state.
    var ICON_SIZE   = '<svg class="rb-dock-mix-svg" width="14" height="12" viewBox="0 0 14 12" fill="currentColor"><text x="0" y="10" font-size="6">A</text><text x="5" y="10" font-size="11">A</text></svg>';
    var ICON_WEIGHT = '<svg class="rb-dock-mix-svg" width="16" height="12" viewBox="0 0 16 12" fill="currentColor"><text x="0" y="10" font-size="10" font-weight="300">B</text><text x="8" y="10" font-size="10" font-weight="900">B</text></svg>';

    // Font family — always shows the shared FONT_ICON_SVG (same as inspector Font field)
    var fontBtn = mk('button', 'rb-img-bar-btn');
    var fontName = (cs.fontFamily || 'sans-serif').split(',')[0].replace(/['"]/g, '').trim();
    if (fontName.length > 14) fontName = fontName.substring(0, 12) + '\u2026';
    var fontMixed = isMixed('fontFamily');
    fontBtn.innerHTML = '<span class="rb-dock-mix-svg">' + FONT_ICON_SVG + '</span><span>' + (fontMixed ? 'Mixed' : fontName) + '</span>';
    if (fontMixed) fontBtn.classList.add('rb-dock-mixed');
    fontBtn.title = fontMixed ? 'Mixed fonts across lines' : cs.fontFamily;
    fontBtn.addEventListener('mousedown', function(e) {
      e.stopImmediatePropagation();
      var currentFont = (cs.fontFamily || '').split(',')[0].replace(/['"]/g, '').trim();
      openFontPicker(fontBtn, currentFont, function(picked) {
        applyStyle(el, 'fontFamily', picked);
        var disp = picked.length > 14 ? picked.substring(0, 12) + '\u2026' : picked;
        // The fontBtn has two spans: [0] wraps the SVG icon, [1] holds the
        // label. querySelector('span') would hit [0] and wipe the icon — use
        // :last-child to target the label specifically.
        var lblSpan = fontBtn.querySelector('span:last-child');
        if (lblSpan) lblSpan.textContent = disp;
        fontBtn.title = picked;
        fontBtn.classList.remove('rb-dock-mixed');
        // Sync ONLY the inspector's font field value (don't rebuild the whole
        // inspector — that's destructive and was breaking post-pick focus on
        // the dropdown + swallowing Cmd+Z). defaultValue also gets updated so
        // the blur-revert logic doesn't reset to the pre-pick font.
        if (selectedEl === el && inspector) {
          var fs = inspector.querySelector('.rb-insp-font-sel');
          if (fs) { fs.value = picked; fs.defaultValue = picked; }
        }
      });
    }, {capture: true});

    // Size (drag to adjust)
    var sizeVal = Math.round(parseFloat(cs.fontSize)) || 16;
    var sizeMixed = isMixed('fontSize');
    var sizeBtn = mk('button', 'rb-img-bar-btn');
    sizeBtn.innerHTML = ICON_SIZE + '<span>' + (sizeMixed ? 'Mixed' : sizeVal) + '</span>';
    if (sizeMixed) sizeBtn.classList.add('rb-dock-mixed');
    sizeBtn.title = sizeMixed ? 'Mixed sizes across lines — drag to homogenize' : 'Font size — drag to adjust';
    makeDragValue(sizeBtn, sizeVal, 'fontSize', 'px', 1, 1, 400);

    // Weight (drag to adjust, steps of 100)
    var weightVal = parseInt(cs.fontWeight) || 400;
    var weightMixed = isMixed('fontWeight');
    var weightBtn = mk('button', 'rb-img-bar-btn');
    weightBtn.innerHTML = ICON_WEIGHT + '<span>' + (weightMixed ? 'Mixed' : weightVal) + '</span>';
    if (weightMixed) weightBtn.classList.add('rb-dock-mixed');
    weightBtn.title = weightMixed ? 'Mixed weights across lines — drag to homogenize' : 'Font weight — drag to adjust';
    makeDragValue(weightBtn, weightVal, 'fontWeight', '', 100, 100, 900, function(v) {
      return Math.round(v / 100) * 100;
    });

    // Letter spacing (drag to adjust, fine step)
    var lsRaw = cs.letterSpacing === 'normal' ? 0 : parseFloat(cs.letterSpacing) || 0;
    var lsMixed = isMixed('letterSpacing');
    var lsBtn = mk('button', 'rb-img-bar-btn');
    lsBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M8 7V17"/><path d="M16 7V17"/><path d="M3 12h18"/></svg><span>' + (lsMixed ? 'Mixed' : (Math.round(lsRaw * 10) / 10)) + '</span>';
    if (lsMixed) lsBtn.classList.add('rb-dock-mixed');
    lsBtn.title = lsMixed ? 'Mixed letter-spacing — drag to homogenize' : 'Letter spacing — drag to adjust';
    makeDragValue(lsBtn, lsRaw, 'letterSpacing', 'px', 0.1, -10, 50);

    // Line height (drag to adjust)
    var lhRaw = cs.lineHeight === 'normal' ? parseFloat(cs.fontSize) * 1.2 : parseFloat(cs.lineHeight) || 20;
    var lhMixed = isMixed('lineHeight');
    var lhBtn = mk('button', 'rb-img-bar-btn');
    lhBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 10H7"/><path d="M21 6H7"/><path d="M21 14H7"/><path d="M21 18H7"/><path d="M3 4v16"/></svg><span>' + (lhMixed ? 'Mixed' : Math.round(lhRaw)) + '</span>';
    if (lhMixed) lhBtn.classList.add('rb-dock-mixed');
    lhBtn.title = lhMixed ? 'Mixed line-height — drag to homogenize' : 'Line height — drag to adjust';
    makeDragValue(lhBtn, lhRaw, 'lineHeight', 'px', 1, 1, 200);

    m.appendChild(fontBtn);
    var d1 = mk('div', 'rb-img-bar-divider');
    m.appendChild(d1);
    m.appendChild(sizeBtn);
    m.appendChild(weightBtn);
    var d2 = mk('div', 'rb-img-bar-divider');
    m.appendChild(d2);
    m.appendChild(lsBtn);
    m.appendChild(lhBtn);

    // Link (shared helper; also used in image minidock)
    var dLink = mk('div', 'rb-img-bar-divider');
    m.appendChild(dLink);
    m.appendChild(makeDockLinkBtn(el, function() { updateInspector(el); }));

    // Restore original — disabled until at least one tracked element's
    // style attribute drifts from the snapshot taken when the dock opened.
    var d3 = mk('div', 'rb-img-bar-divider');
    m.appendChild(d3);
    var restoreBtn = mk('button', 'rb-img-bar-btn');
    restoreBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 105.64-8.36L1 10"/></svg><span>Restore</span>';
    restoreBtn.title = 'Restore original text styles';
    restoreBtn.disabled = true;
    function hasDockChanges() {
      for (var i = 0; i < origCss.length; i++) {
        var o = origCss[i];
        if ((o.el.getAttribute('style') || '') !== o.css) return true;
      }
      return false;
    }
    function refreshRestoreBtn() {
      var dirty = hasDockChanges();
      restoreBtn.disabled = !dirty;
    }
    // Watch every snapshotted leaf for style/class flips. When the user
    // tweaks size/font/color via inspector or minidock the inline style
    // changes — this fires and re-evaluates the disabled state. Cleaned up
    // via the editor's AbortController on deactivate.
    try {
      var dockMo = new MutationObserver(refreshRestoreBtn);
      origCss.forEach(function(o) {
        try { dockMo.observe(o.el, { attributes: true, attributeFilter: ['style','class'] }); } catch(_){}
      });
      sig.addEventListener('abort', function() { try { dockMo.disconnect(); } catch(_){} });
    } catch (e) {}
    restoreBtn.addEventListener('mousedown', function(e) {
      e.stopImmediatePropagation();
      if (restoreBtn.disabled) return;
      // Snapshot current style for undo, then revert each affected element
      // to the cssText captured when the dock first opened.
      var affected = origCss.map(function(o) {
        return { el: o.el, oldCss: o.el.getAttribute('style') || '' };
      });
      origCss.forEach(function(o) {
        if (o.css) o.el.setAttribute('style', o.css);
        else o.el.removeAttribute('style');
      });
      pushUndo({ prop: '__cascade', affected: affected });
      updateInspector(el);
      showTextDock(el);
    }, {capture: true});
    m.appendChild(restoreBtn);

    appendDockClose(m);
    prependDockHandle(m);
    root.appendChild(m);

    // Auto-close
    var gen = _textDockGen;
    var closeOutside = function(ev) {
      if (gen !== _textDockGen) { hostDoc.removeEventListener('mousedown', closeOutside, true); return; }
      if (m && !m.contains(ev.target)) {
        removeTextDock();
        hostDoc.removeEventListener('mousedown', closeOutside, true);
      }
    };
    setTimeout(function() { hostDoc.addEventListener('mousedown', closeOutside, true); }, 150);

    // Canvas-only auto-dismiss on viewport movement. The dock is anchored to
    // the text element's screen position; once the user pans/zooms the canvas
    // more than ~100px, the anchor is wildly off — better to drop the dock
    // than to leave it hovering nowhere. Wheel covers trackpad pan + Cmd-zoom.
    // Skip in extension mode (host === target) since the page scroll there is
    // the page itself, which the dock already follows via repositioning.
    // Cross-doc wheel events don't bubble between iframe and host — listen on
    // both so panning over either the canvas chrome OR the iframe counts.
    if (hostDoc !== targetDoc) {
      var scrollAccum = 0;
      var dockScrollHandler = function(ev) {
        if (gen !== _textDockGen) {
          hostDoc.removeEventListener('wheel', dockScrollHandler, true);
          try { targetDoc.removeEventListener('wheel', dockScrollHandler, true); } catch(_){}
          return;
        }
        scrollAccum += Math.abs(ev.deltaX || 0) + Math.abs(ev.deltaY || 0);
        if (scrollAccum > 100) {
          removeTextDock();
          hostDoc.removeEventListener('wheel', dockScrollHandler, true);
          try { targetDoc.removeEventListener('wheel', dockScrollHandler, true); } catch(_){}
        }
      };
      hostDoc.addEventListener('wheel', dockScrollHandler, true);
      try { targetDoc.addEventListener('wheel', dockScrollHandler, true); } catch(_){}
      sig.addEventListener('abort', function() {
        try { hostDoc.removeEventListener('wheel', dockScrollHandler, true); } catch(_){}
        try { targetDoc.removeEventListener('wheel', dockScrollHandler, true); } catch(_){}
      });
    }
  }

  var _textDockGen = 0;
  function removeTextDock() {
    _textDockGen++;
    var m = root.querySelector('.rb-ed-text-dock');
    if (m) m.remove();
    // Link popup is opened from the text minidock; close it when the dock dies
    // so it doesn't strand in hostDoc.body after selection changes.
    removeLinkEditor();
  }

  // ============ MOVE / SNAP (Figma-style) ============

  var dragGhost = null;
  var dropIndicator = null;
  var lastDropTarget = null;
  var lastDropPos = null; // 'before' or 'after'

  // Convert a target-doc rect to host-doc coords (matches eventToHostXY logic).
  // In extension mode (host === target) returns the rect unchanged. The ghost
  // lives in hostDoc, but el.getBoundingClientRect() reports in the doc el is
  // in (target) — so width/height/left/top need scaling by the iframe's
  // displayed-to-native ratio plus translation by the iframe's host offset.
  function rectToHost(r) {
    if (hostDoc === targetDoc) return {left: r.left, top: r.top, width: r.width, height: r.height};
    var ifr = targetWin && targetWin.frameElement;
    if (!ifr) return {left: r.left, top: r.top, width: r.width, height: r.height};
    var ir = ifr.getBoundingClientRect();
    var contentW = targetWin.innerWidth || ir.width;
    var scale = ir.width / (contentW || 1);
    return {
      left: ir.left + r.left * scale,
      top: ir.top + r.top * scale,
      width: r.width * scale,
      height: r.height * scale
    };
  }

  function createDragGhost(el) {
    if (dragGhost) dragGhost.remove();
    var hr = rectToHost(el.getBoundingClientRect());
    dragGhost = mk('div', 'rb-ed-ghost');
    dragGhost.style.width = hr.width + 'px';
    dragGhost.style.height = Math.min(hr.height, 120) + 'px';
    dragGhost.style.left = hr.left + 'px';
    dragGhost.style.top = hr.top + 'px';
    // Capture visual snapshot
    dragGhost.style.background = getCS(el).backgroundColor || 'rgba(147,197,253,0.1)';
    dragGhost.style.borderRadius = getCS(el).borderRadius || '4px';
    var tagLabel = mk('span', 'rb-ed-ghost-tag');
    tagLabel.textContent = el.tagName.toLowerCase() + (el.className ? '.' + el.className.split(' ')[0] : '');
    dragGhost.appendChild(tagLabel);
    root.appendChild(dragGhost);
    // Dim the original
    el.style.opacity = '0.25';
    el.style.transition = 'opacity 100ms';
  }

  // Center the ghost on the cursor in both axes (was vertical fixed at y-20,
  // which read as "ghost lagging behind the mouse" and — in canvas mode where
  // x/y arrive in host coords — pulled the ghost outside the node entirely).
  function updateDragGhost(x, y) {
    if (!dragGhost) return;
    var w = parseInt(dragGhost.style.width) || 0;
    var h = parseInt(dragGhost.style.height) || 0;
    dragGhost.style.left = (x - w / 2) + 'px';
    dragGhost.style.top = (y - h / 2) + 'px';
  }

  function removeDragGhost(el) {
    if (dragGhost) { dragGhost.remove(); dragGhost = null; }
    if (el) { el.style.opacity = ''; el.style.transition = ''; }
  }

  function showDropIndicator(targetEl, position) {
    if (!dropIndicator) {
      dropIndicator = mk('div', 'rb-ed-drop-indicator');
      root.appendChild(dropIndicator);
    }
    var r = targetEl.getBoundingClientRect();
    var parentStyle = getCS(targetEl.parentElement);
    var isVertical = parentStyle.flexDirection === 'column' ||
                     parentStyle.display === 'block' ||
                     parentStyle.display === '' ||
                     (!parentStyle.display.includes('flex') && !parentStyle.display.includes('grid'));

    if (isVertical) {
      var yPos = position === 'before' ? r.top : r.bottom;
      Object.assign(dropIndicator.style, {
        top: (yPos - 1.5) + 'px', left: r.left + 'px',
        width: r.width + 'px', height: '3px',
        display: 'block'
      });
    } else {
      var xPos = position === 'before' ? r.left : r.right;
      Object.assign(dropIndicator.style, {
        top: r.top + 'px', left: (xPos - 1.5) + 'px',
        width: '3px', height: r.height + 'px',
        display: 'block'
      });
    }
  }

  function hideDropIndicator() {
    if (dropIndicator) dropIndicator.style.display = 'none';
    lastDropTarget = null;
    lastDropPos = null;
  }

  // Detect if children are absolutely positioned
  function isAbsoluteLayout(parent) {
    var children = parent.children;
    if (!children.length) return false;
    for (var i = 0; i < Math.min(children.length, 3); i++) {
      var pos = getCS(children[i]).position;
      if (pos === 'absolute' || pos === 'fixed') return true;
    }
    return false;
  }

  var useCoordSwap = false; // set per drag session

  function handleMove(el, e) {
    var parent = el.parentElement;
    if (!parent) return;

    // Ghost lives in hostDoc; in canvas mode the event's clientX/Y are in
    // target (iframe) coords. Translate before positioning so the ghost
    // tracks the actual cursor across the iframe boundary + canvas scale.
    var hp = eventToHostXY(e);
    updateDragGhost(hp.x, hp.y);

    // Mode D always uses coord swap. Others detect from layout.
    useCoordSwap = (currentMode === 'D') || isAbsoluteLayout(parent);

    var siblings = Array.from(parent.children).filter(function(c) {
      return c !== el && isValid(c);
    });
    if (!siblings.length) { hideDropIndicator(); return; }

    // Find closest sibling by center-point proximity
    var closest = null;
    var closestDist = Infinity;
    var closestPos = 'before';

    siblings.forEach(function(sib) {
      var r = sib.getBoundingClientRect();
      var cx = r.left + r.width / 2;
      var cy = r.top + r.height / 2;
      var dist = Math.sqrt(Math.pow(e.clientX - cx, 2) + Math.pow(e.clientY - cy, 2));

      if (dist < closestDist) {
        closestDist = dist;
        closest = sib;
        var parentStyle = getCS(parent);
        var isHorizontal = parentStyle.flexDirection === 'row' ||
                          parentStyle.flexDirection === 'row-reverse' ||
                          (parentStyle.display.includes('flex') && parentStyle.flexDirection !== 'column');
        if (isHorizontal) {
          closestPos = e.clientX < cx ? 'before' : 'after';
        } else {
          closestPos = e.clientY < cy ? 'before' : 'after';
        }
      }
    });

    if (closest && closestDist < 300) {
      showDropIndicator(closest, closestPos);
      lastDropTarget = closest;
      lastDropPos = closestPos;
    } else {
      hideDropIndicator();
    }
  }

  function commitDrop(el) {
    if (!lastDropTarget || !el.parentElement) {
      hideDropIndicator();
      removeDragGhost(el);
      return;
    }

    if (useCoordSwap) {
      // Absolute/canvas layout: swap visual positions
      var elRect = el.getBoundingClientRect();
      var tRect = lastDropTarget.getBoundingClientRect();

      // Read current inline top/left (or compute from rect)
      var elTop = el.style.top || elRect.top + 'px';
      var elLeft = el.style.left || elRect.left + 'px';
      var tTop = lastDropTarget.style.top || tRect.top + 'px';
      var tLeft = lastDropTarget.style.left || tRect.left + 'px';
      // Capture original inline position so undo can restore relative/static
      // elements that were force-promoted to absolute below.
      var elPos = el.style.position;
      var tPos = lastDropTarget.style.position;

      pushUndo({
        el: el, prop: '__coordswap',
        elPos: elPos, elTop: elTop, elLeft: elLeft,
        target: lastDropTarget, tPos: tPos, tTop: tTop, tLeft: tLeft
      });

      // Ensure both are absolute
      el.style.position = 'absolute';
      lastDropTarget.style.position = 'absolute';
      // Swap
      el.style.top = tTop;
      el.style.left = tLeft;
      lastDropTarget.style.top = elTop;
      lastDropTarget.style.left = elLeft;
    } else {
      // Flow layout: DOM reorder
      var oldNext = el.nextElementSibling;
      var oldParent = el.parentElement;

      pushUndo({ el: el, prop: '__move', parent: oldParent, next: oldNext });

      if (lastDropPos === 'before') {
        lastDropTarget.parentElement.insertBefore(el, lastDropTarget);
      } else {
        var nextSib = lastDropTarget.nextElementSibling;
        if (nextSib) {
          lastDropTarget.parentElement.insertBefore(el, nextSib);
        } else {
          lastDropTarget.parentElement.appendChild(el);
        }
      }
    }

    el.style.transition = 'transform 150ms cubic-bezier(0.2, 0, 0, 1)';
    el.style.transform = 'scale(1.02)';
    requestAnimationFrame(function() {
      requestAnimationFrame(function() {
        el.style.transform = '';
        setTimeout(function() { el.style.transition = ''; }, 150);
      });
    });

    hideDropIndicator();
    removeDragGhost(el);
    updateSelBox(el);
  }

  // ============ FTUE ============

  function showFtue(id, html, x, y) {
    if (ftueShown[id]) return;
    ftueShown[id] = true;
    try { localStorage.setItem('rb-ftue', JSON.stringify(ftueShown)); } catch(e) {}
    var tip = mk('div', 'rb-ed-ftue');
    tip.innerHTML = html;
    tip.style.left = x + 'px';
    tip.style.top = (y - 10) + 'px';
    tip.style.transform = 'translateY(-100%)';
    root.appendChild(tip);
    setTimeout(function() { if (tip.parentNode) tip.remove(); }, 4000);
  }

  // ============ LISTEN ============

  function listen() {
    // Capture non-collapsed selections inside the editable element so subsequent
    // typography writes can target only the selected text (per-word color, size…).
    // Don't clear on collapsed — clicking an inspector field collapses the selection
    // but we want to keep the previous range available for the pending write.
    // selectionchange fires inside the TARGET — that's where contentEditable
    // text edits happen.
    targetDoc.addEventListener('selectionchange', function() {
      if (!isTextEditing || !selectedEl) return;
      var sel = targetWin.getSelection();
      if (!sel || !sel.rangeCount) return;
      var r = sel.getRangeAt(0);
      if (r.collapsed) return;
      if (!selectedEl.contains(r.commonAncestorContainer)) return;
      __pendingTextRange = { range: r.cloneRange(), editableRoot: selectedEl };
    }, {signal: sig});

    // Canvas-only: redraw overlay boxes when the viewport transforms.
    // hover/selection boxes are anchored to live target-doc rects via
    // getOverlayBox, but they only repaint when their update fn runs —
    // without this hook they stay frozen at pre-zoom dimensions until
    // the next mousemove (which doesn't fire while the user wheels).
    // rAF-coalesced so a burst of wheel deltas costs one paint, and
    // listeners are passive + capture:true so we don't fight the canvas
    // pan/zoom handler in CanvasClient.
    if (hostDoc !== targetDoc) {
      var _overlayRefreshScheduled = false;
      var _refreshOverlayBoxes = function() {
        _overlayRefreshScheduled = false;
        if (lastHoverEl && targetDoc.body.contains(lastHoverEl)) updateHoverBox(lastHoverEl);
        if (selectedEl && targetDoc.body.contains(selectedEl)) {
          updateSelBox(selectedEl);
          try { updateSpacingGuides(selectedEl); } catch (_) {}
        }
      };
      var _onViewportWheel = function() {
        if (_overlayRefreshScheduled) return;
        _overlayRefreshScheduled = true;
        requestAnimationFrame(_refreshOverlayBoxes);
      };
      hostDoc.addEventListener('wheel', _onViewportWheel, {passive: true, capture: true, signal: sig});
      targetDoc.addEventListener('wheel', _onViewportWheel, {passive: true, capture: true, signal: sig});
    }

    // INLINE_TAGS / VISUAL_TAGS / drillIntoChild / resolveContainer hoisted
    // to IIFE outer scope (above) — they're called from guide-drag handlers
    // outside listen(), so they can't be closed over here.

    // Hover — selects containers, not inline text. Listens on TARGET so
    // mouse moves inside an iframed site reach us in the canvas case.
    var tMove = throttle(function(e) {
      if (isDragging) return;
      if (layerHoverLock) return;
      var rawEl = targetDoc.elementFromPoint(e.clientX, e.clientY);
      if (!rawEl || !isValid(rawEl)) {
        if (lastHoverEl) { lastHoverEl.classList.remove('rb-ed-text-hint'); lastHoverEl = null; }
        hoverBox.style.display = 'none';
        highlightLayerRow(null);
        return;
      }
      var el = resolveContainer(rawEl);
      if (!isValid(el) || el === selectedEl) { hoverBox.style.display = 'none'; return; }
      if (lastHoverEl && lastHoverEl !== el) lastHoverEl.classList.remove('rb-ed-text-hint');
      lastHoverEl = el;
      if (isText(el)) el.classList.add('rb-ed-text-hint');
      updateHoverBox(el);
      // Highlight matching layer row in panel
      highlightLayerRow(el);
    }, 16);
    targetDoc.addEventListener('mousemove', tMove, {signal: sig, capture: true});

    // Click — 1 click selects, 2nd click on same element enters text edit.
    // Mousedown on TARGET picks up clicks inside the iframed site.
    var lastClickEl = null;
    var lastClickTime = 0;

    targetDoc.addEventListener('mousedown', function(e) {
      // Any mousedown outside the guide's own inline-edit input must commit +
      // close it. Previous attempts scoped this to "different widget" which
      // still left the user stuck when clicking inspector fields, site content,
      // or even the widget chrome outside the input. Simplest rule: if the
      // click is not the input itself, blur. The input's blur handler runs
      // commit() synchronously so the next click's handlers (focus, selection,
      // etc.) see a clean state.
      var activeGuideInput = root.querySelector('.rb-spacing-inline-input');
      if (activeGuideInput && e.target !== activeGuideInput) {
        activeGuideInput.blur();
      }
      if (isEditorEl(e.target)) return;
      var rawEl = targetDoc.elementFromPoint(e.clientX, e.clientY);
      if (!rawEl || !isValid(rawEl)) return;

      var link = e.target.closest('a');
      if (link && !isEditorEl(link)) { e.preventDefault(); }

      // Hover-first target resolution: whatever the user SAW highlighted under
      // their cursor is what they expect to select. If the click falls within
      // the hovered element's bounding rect, prefer it over the raw hit-test
      // result (which can return a deeper nested element in whitespace gaps).
      var hoverTarget = null;
      if (lastHoverEl && targetDoc.body.contains(lastHoverEl)) {
        var hr = lastHoverEl.getBoundingClientRect();
        if (e.clientX >= hr.left && e.clientX <= hr.right &&
            e.clientY >= hr.top  && e.clientY <= hr.bottom) {
          hoverTarget = lastHoverEl;
        }
      }

      var now = Date.now();
      var repeatRef = hoverTarget || rawEl;
      var isRepeatClick = (selectedEl) && (now - lastClickTime < 500) &&
                          (selectedEl === repeatRef || selectedEl.contains(repeatRef));
      lastClickTime = now;
      lastClickEl = rawEl;

      // Already in text edit mode — click outside exits, click inside lets browser handle
      if (selectedEl && selectedEl.contentEditable === 'true') {
        if (!selectedEl.contains(rawEl)) {
          e.preventDefault();
          selectedEl.contentEditable = 'false';
          selectedEl.removeAttribute('data-rb-editing');
          selectedEl.classList.add('rb-ed-movable');
          exitTextEdit();
          isTextEditing = false;
          var s = targetWin.getSelection(); if (s) s.removeAllRanges();
          var newEl = resolveContainer(rawEl);
          if (newEl && isValid(newEl)) { selectEl(newEl); } else { deselectEl(); }
        }
        return;
      }

      e.preventDefault();
      removeImgMenu();
      removeTextDock();

      if (!isRepeatClick) {
        // NEW AREA: prefer the hovered target when available (so hover and
        // click always agree); fall back to container resolution otherwise.
        var el = hoverTarget || resolveContainer(rawEl);
        if (!isValid(el)) return;
        selectionDepth = 0;
        selectionAncestor = el;

        if (el.tagName === 'IMG' || el.tagName === 'VIDEO') showImgMenu(el);
        // Text minidock fires for direct text elements, AND for wrappers
        // (isTextWrapper — divs with multiple text children) ONLY when the
        // wrapper's children share a single font family. The mixed-fonts
        // case was surfacing the dock with a useless "Mixed" font readout
        // when the user just wanted to select the box — guard skips it.
        else if (isDirectText(el)) showTextDock(el);
        else if (isTextWrapper(el) && !isTextMixedFonts(el)) showTextDock(el);
        else if (isDirectText(rawEl)) showTextDock(rawEl);
        selectEl(el);

        if (el.contentEditable !== 'true') {
          dragStart = {x: e.clientX, y: e.clientY};
          dragThreshold = false;
        }
      } else {
        // REPEAT CLICK on same area: drill deeper
        var deeper = drillIntoChild(selectedEl, e.clientX, e.clientY);

        if (deeper) {
          // If the deeper element is a text element (p, h1, span with text, etc.) — enter text edit
          if (isText(deeper) && !deeper.querySelector('img,video,canvas,iframe,svg,button,input,select,textarea')) {
            selectEl(deeper);
            enterTextEdit(deeper);
            dragStart = null;
            dragThreshold = false;
            return;
          }

          selectionDepth++;
          selectEl(deeper);

          if (deeper.tagName === 'IMG' || deeper.tagName === 'VIDEO') showImgMenu(deeper);
          if (deeper.contentEditable !== 'true') {
            dragStart = {x: e.clientX, y: e.clientY};
            dragThreshold = false;
          }
        } else {
          // Can't drill deeper
          if (selectedEl && (selectedEl.tagName === 'IMG' || selectedEl.tagName === 'VIDEO')) {
            showImgMenu(selectedEl);
          } else if (isText(selectedEl) && selectedEl.contentEditable !== 'true') {
            enterTextEdit(selectedEl);
            dragStart = null;
            dragThreshold = false;
          }
        }
      }
    }, {signal: sig, capture: true});

    // Block page clicks — but let overlay modals and editor UI through.
    // Listens on TARGET so site clicks (e.g., navigation links) get blocked.
    targetDoc.addEventListener('click', function(e) {
      if (isEditorEl(e.target)) return;
      // Let legacy overlay modal clicks through (close button, tabs, etc)
      if (e.target.closest('#repix-overlay') || e.target.closest('.ezp-modal')) return;
      e.preventDefault();
      e.stopPropagation();
      return false;
    }, {signal: sig, capture: true});

    // Drag (move elements — Figma-style with ghost + drop indicator)
    // dragStart and dragThreshold are set by the main mousedown handler above
    // This handler only starts drag if element is already selected and not in text edit mode
    var dragStart = null;
    var dragThreshold = false;

    // Store original position for Mode D free move
    var dragOrigTop = 0, dragOrigLeft = 0;

    // Drag tracks the mouse over the TARGET (the site we're moving elements
    // within). dragOrigTop/Left and dragStart use viewport coords from the
    // event's own surface, so they're consistent in both extension and
    // canvas-iframe cases.
    targetDoc.addEventListener('mousemove', function(e) {
      if (!dragStart || !selectedEl) return;
      var dx = e.clientX - dragStart.x;
      var dy = e.clientY - dragStart.y;

      if (!dragThreshold) {
        if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
          dragThreshold = true;
          isDragging = true;
          hostDoc.body.classList.add('rb-ed-dragging');

          if (currentMode === 'D') {
            // Mode D: free move — no ghost, just move the element directly
            dragOrigTop = parseInt(selectedEl.style.top) || 0;
            dragOrigLeft = parseInt(selectedEl.style.left) || 0;
            selBox.style.display = 'none';
          } else {
            // Modes A/B/C: ghost + drop indicator
            targetDoc.documentElement.classList.add('rb-scroll-locked');
            createDragGhost(selectedEl);
            selBox.style.display = 'none';
          }
        }
        return;
      }

      if (currentMode === 'D') {
        // Mode D: move element directly by updating top/left
        selectedEl.style.top = (dragOrigTop + dy) + 'px';
        selectedEl.style.left = (dragOrigLeft + dx) + 'px';
      } else {
        // Modes A/B/C: show drop indicator for swap
        handleMove(selectedEl, e);
      }
    }, {signal: sig});

    function endDragSafe() {
      if (isDragging && selectedEl) {
        if (currentMode === 'D') {
          // Mode D: commit the free move, save undo
          pushUndo({
            el: selectedEl, prop: '__freemove',
            oldTop: dragOrigTop + 'px', oldLeft: dragOrigLeft + 'px'
          });
          updateSelBox(selectedEl);
        } else {
          // Modes A/B/C: commit the swap (or hide indicator if no target)
          commitDrop(selectedEl);
          targetDoc.documentElement.classList.remove('rb-scroll-locked');
        }
        isDragging = false;
        hostDoc.body.classList.remove('rb-ed-dragging');
      } else if (dragStart) {
        // Drag was armed but never crossed threshold (or pointer escaped the
        // target before mousemove fired) — make sure scroll-lock + ghost +
        // selBox visibility are restored even though no drag actually ran.
        targetDoc.documentElement.classList.remove('rb-scroll-locked');
        removeDragGhost(selectedEl);
        if (selectedEl) {
          selBox.style.display = 'block';
          updateSelBox(selectedEl);
        }
        hostDoc.body.classList.remove('rb-ed-dragging');
      }
      dragStart = null;
      dragThreshold = false;
    }
    targetDoc.addEventListener('mouseup', endDragSafe, {signal: sig});
    // In canvas mode the user may release the mouse outside the iframe — the
    // target listener never fires and the editor would be stuck in a half-
    // dragged state (rb-scroll-locked, ghost present, selBox hidden). A host-
    // level fallback catches this. In extension mode host === target so the
    // listener registers twice on the same EventTarget; identity-guard.
    if (hostDoc !== targetDoc) {
      hostDoc.addEventListener('mouseup', endDragSafe, {signal: sig});

      // Mouse-leave the iframe → clear the hover overlay. Without this the
      // hoverBox stays pinned to the last element under the cursor inside
      // the iframe even after the user has moved out into canvas chrome,
      // which reads as a stuck highlight. Re-entering the iframe lets the
      // normal mousemove handler take over again.
      var ifrEl = targetWin.frameElement;
      if (ifrEl) {
        ifrEl.addEventListener('mouseleave', function() {
          if (lastHoverEl) {
            try { lastHoverEl.classList.remove('rb-ed-text-hint'); } catch(_){}
            lastHoverEl = null;
          }
          hoverBox.style.display = 'none';
          try { highlightLayerRow(null); } catch(_){}
        }, {signal: sig});
      }

      // Click outside the node iframe (and outside any editor UI) deselects.
      // In-progress edits commit-as-is: text edit exits leaving the typed
      // value, an armed-but-not-started drag is cancelled, and a running
      // drag is cleaned up via endDragSafe. We listen on mousedown (capture)
      // so we run BEFORE the canvas's pan handler steals the gesture.
      hostDoc.addEventListener('mousedown', function(e) {
        var ifr = targetWin.frameElement;
        var inIframe = ifr && ifr.contains(e.target);
        var inEditorUi = isEditorEl(e.target);
        if (inEditorUi) return;
        if (inIframe) return; // click into iframe — target handler owns it
        if (!selectedEl && !isTextEditing && !dragStart) return;
        if (isTextEditing) {
          if (selectedEl) {
            try { selectedEl.contentEditable = 'false'; selectedEl.removeAttribute('data-rb-editing'); } catch(_){}
          }
          exitTextEdit();
          isTextEditing = false;
        }
        endDragSafe();
        deselectEl();
      }, {signal: sig, capture: true});
    }

    // Block right-click when an element is selected — TARGET fires on the
    // site, but the toast lives in HOST (the editor root).
    targetDoc.addEventListener('contextmenu', function(e) {
      if (selectedEl && !isEditorEl(e.target)) {
        e.preventDefault();
        // Show feedback
        var existing = hostDoc.getElementById('rb-ed-lock');
        if (!existing) {
          var tip = mk('div', 'rb-ed-lock');
          tip.id = 'rb-ed-lock';
          tip.textContent = 'Right-click disabled during edit';
          root.appendChild(tip);
          setTimeout(function() { if (tip.parentNode) tip.remove(); }, 2000);
        }
      }
    }, {signal: sig, capture: true});

    // Keyboard — global shortcuts live on HOST (panels + form fields are there).
    hostDoc.addEventListener('keydown', function(e) {
      if (e.altKey && (e.key === 'l' || e.key === 'L')) {
        e.preventDefault();
        if (layersPanel) {
          layersPanel.style.display = layersPanel.style.display === 'none' ? '' : 'none';
        }
        return;
      }
      // ---- Spacing guides: 'G' toggle + arrow-key nudge on the hovered guide ----
      var _tgt = e.target;
      var _inEditable = _tgt && (_tgt.tagName === 'INPUT' || _tgt.tagName === 'TEXTAREA' || _tgt.isContentEditable);
      if (!_inEditable && !isTextEditing && (e.key === 'g' || e.key === 'G') && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        guidesVisible = !guidesVisible;
        if (selectedEl) updateSpacingGuides(selectedEl);
        return;
      }
      if (!_inEditable && activeGuideKey && selectedEl && guidesVisible &&
          (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        var _targ = guideTargetEl(activeGuideKey);
        if (_targ) {
          var _prop = guideProps[activeGuideKey];
          var _cs = getCS(_targ);
          var _cur = parseFloat(_cs[_prop]) || 0;
          var _axis = guideAxis[activeGuideKey];
          if (_axis === 'auto') {
            _axis = (_cs.flexDirection === 'row' || _cs.flexDirection === 'row-reverse') ? 'x' : 'y';
          }
          var _dir = guideDir[activeGuideKey];
          var _screen = 0;
          if (_axis === 'y') _screen = (e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0);
          else              _screen = (e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0);
          if (_screen !== 0) {
            e.preventDefault();
            var _step = e.shiftKey ? 10 : ((e.metaKey || e.ctrlKey) ? 8 : 1);
            var _new = Math.max(0, _cur + _screen * _dir * _step);
            _targ.style[_prop] = _new + 'px';
            pushUndo({ el: _targ, prop: _prop, old: _cur + 'px' });
            updateSpacingGuides(selectedEl);
            updateSelBox(selectedEl);
            return;
          }
        }
      }
      // ---- Input-field guard ---------------------------------------------
      // When the user is typing into any form control inside the editor UI
      // (inspector, minidock, popup), the global shortcuts below must NOT fire.
      // Without this, pressing Backspace/Delete/Cmd+X/etc. inside an inspector
      // input destroys the selected site element. Escape is still allowed (blur).
      var _keyTgt = e.target;
      var _keyTag = _keyTgt && _keyTgt.tagName;
      var _inInspectorForm = (_keyTag === 'INPUT' || _keyTag === 'TEXTAREA' || _keyTag === 'SELECT');
      if (_inInspectorForm && e.key !== 'Escape') return;

      if (e.key === 'Escape') {
        if (isTextEditing) {
          selectedEl.contentEditable = 'false';
          selectedEl.removeAttribute('data-rb-editing');
          selectedEl.classList.add('rb-ed-movable');
          exitTextEdit();
          isTextEditing = false;
          var s = targetWin.getSelection(); if (s) s.removeAllRanges();
          updateSelBox(selectedEl);
          return;
        }
        if (selectedEl && selectionDepth > 0) {
          var parent = selectedEl.parentElement;
          if (parent && parent !== targetDoc.body && isValid(parent)) {
            selectionDepth--;
            selectEl(parent);
          }
          return;
        }
        if (selectedEl) {
          deselectEl();
          return;
        }
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
        // During text edit, let the browser's native contentEditable undo
        // handle it (character-level granularity). Our own undo only kicks
        // in for non-text-edit operations.
        if (isTextEditing) return;
        e.preventDefault();
        e.stopPropagation();
        if (e.shiftKey) redo();
        else undo();
      }
      // Cmd+Y as alternative redo (Windows convention)
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) {
        if (isTextEditing) return;
        e.preventDefault();
        e.stopPropagation();
        redo();
      }
      // Cut / Copy / Paste — only when an element is selected and we're
      // not in text edit mode (let native clipboard work during text edit)
      if ((e.ctrlKey || e.metaKey) && !isTextEditing) {
        if ((e.key === 'x' || e.key === 'X') && selectedEl) {
          e.preventDefault();
          e.stopPropagation();
          clipCut();
        } else if ((e.key === 'c' || e.key === 'C') && selectedEl) {
          e.preventDefault();
          e.stopPropagation();
          clipCopy();
        } else if (e.key === 'v' || e.key === 'V') {
          e.preventDefault();
          e.stopPropagation();
          clipPaste();
        }
      }
      // Find — Cmd+F
      if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault();
        e.stopPropagation();
        openFind();
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        // Guard: keys typed INTO an inspector/minidock input or any other editor
        // form control must not delete the site element. Only delete when the
        // event target is the body/document (no active form field).
        var _del_t = e.target;
        var _tag = _del_t && _del_t.tagName;
        if (_tag === 'INPUT' || _tag === 'TEXTAREA' || _tag === 'SELECT' || (_del_t && _del_t.isContentEditable)) return;
        if (selectedEl && selectedEl.contentEditable !== 'true') {
          e.preventDefault();
          var parent = selectedEl.parentElement;
          var next = selectedEl.nextElementSibling;
          pushUndo({el: selectedEl, prop: '__removed', parent: parent, next: next});
          selectedEl.remove();
          deselectEl();
        }
      }
    }, {signal: sig});

    // Scroll/resize update overlays
    var tScroll = throttle(function() {
      if (selectedEl) {
        updateSelBox(selectedEl);
        updateParentBox(selectedEl);
        updateSpacingGuides(selectedEl);
      }
    }, 16);
    // Scroll/resize fire on TARGET (site scroll changes element rects) AND
    // on HOST (canvas pan/zoom changes the iframe's host-viewport rect, so
    // overlays drawn relative to host need to re-sync). In extension mode
    // host === target so we'd register the same listener twice — guard with
    // an identity check.
    targetWin.addEventListener('scroll', tScroll, {signal: sig, capture: true});
    targetWin.addEventListener('resize', tScroll, {signal: sig});
    if (hostWin !== targetWin) {
      hostWin.addEventListener('scroll', tScroll, {signal: sig, capture: true});
      hostWin.addEventListener('resize', tScroll, {signal: sig});
      // Canvas pan/zoom mutates a transform on a wrapper element — neither
      // scroll nor resize fires for that. Watch the iframe's bounding rect
      // via ResizeObserver as a fallback.
      try {
        var ifr = targetWin.frameElement;
        if (ifr && typeof hostWin.ResizeObserver === 'function') {
          var ro = new hostWin.ResizeObserver(tScroll);
          ro.observe(ifr);
          sig.addEventListener('abort', function() { try { ro.disconnect(); } catch(_){} });
        }
        // rAF poll covers transform changes that ResizeObserver can't see
        // (translate-only pan keeps width/height unchanged).
        var lastIfRect = ifr ? ifr.getBoundingClientRect() : null;
        var rafId = null;
        function rafTick() {
          rafId = null;
          if (!ifr) return;
          var nr = ifr.getBoundingClientRect();
          if (!lastIfRect || nr.left !== lastIfRect.left || nr.top !== lastIfRect.top || nr.width !== lastIfRect.width || nr.height !== lastIfRect.height) {
            lastIfRect = nr;
            tScroll();
          }
          rafId = hostWin.requestAnimationFrame(rafTick);
        }
        rafId = hostWin.requestAnimationFrame(rafTick);
        sig.addEventListener('abort', function() { if (rafId) hostWin.cancelAnimationFrame(rafId); });
      } catch (e) { /* swallow — best-effort sync */ }
    }

    // Unlock CSS constraints that prevent resize — use !important to beat stylesheets
    function unlockResize(el, dir) {
      var cs = getCS(el);
      var unlocked = [];

      // Remove max-width/max-height constraints (with !important to beat stylesheets)
      if (cs.maxWidth !== 'none' && cs.maxWidth !== '0px') {
        unlocked.push({prop: 'maxWidth', old: el.style.maxWidth});
        el.style.setProperty('max-width', 'none', 'important');
      }
      if (cs.maxHeight !== 'none' && cs.maxHeight !== '0px') {
        unlocked.push({prop: 'maxHeight', old: el.style.maxHeight});
        el.style.setProperty('max-height', 'none', 'important');
      }
      // Remove min-width/min-height that prevent shrinking
      if (dir.indexOf('w') !== -1 || dir.indexOf('e') !== -1) {
        if (cs.minWidth && cs.minWidth !== '0px') {
          unlocked.push({prop: 'minWidth', old: el.style.minWidth});
          el.style.setProperty('min-width', '0', 'important');
        }
      }
      if (dir.indexOf('n') !== -1 || dir.indexOf('s') !== -1) {
        if (cs.minHeight && cs.minHeight !== '0px') {
          unlocked.push({prop: 'minHeight', old: el.style.minHeight});
          el.style.setProperty('min-height', '0', 'important');
        }
      }
      // Convert percentage/auto width to px for precise control
      var rect = el.getBoundingClientRect();
      if (cs.width === 'auto' || cs.width.indexOf('%') !== -1) {
        unlocked.push({prop: 'width', old: el.style.width});
        el.style.setProperty('width', rect.width + 'px', 'important');
      }
      if (cs.height === 'auto' || cs.height.indexOf('%') !== -1) {
        unlocked.push({prop: 'height', old: el.style.height});
        el.style.setProperty('height', rect.height + 'px', 'important');
      }
      // Unlock flex-grow only (if parent is flex and this child would fight our
      // explicit width/height). Full `flex: none` was too aggressive — it also
      // disables the element's auto-basis fallback, which caused containers to
      // collapse to content-width on mousedown alone.
      var parentEl = el.parentElement;
      var parentIsFlex = false;
      if (parentEl) {
        var pcs0 = getCS(parentEl);
        parentIsFlex = pcs0.display === 'flex' || pcs0.display === 'inline-flex';
      }
      if (parentIsFlex && (parseFloat(cs.flexGrow) || 0) > 0) {
        unlocked.push({prop: 'flexGrow', old: el.style.flexGrow});
        el.style.setProperty('flex-grow', '0', 'important');
      }
      // Unlock box-sizing for consistent resize
      if (cs.boxSizing !== 'border-box') {
        unlocked.push({prop: 'boxSizing', old: el.style.boxSizing});
        el.style.setProperty('box-sizing', 'border-box', 'important');
      }
      // Check parent overflow
      var parent = el.parentElement;
      if (parent) {
        var pcs = getCS(parent);
        if (pcs.overflow === 'hidden') {
          unlocked.push({prop: '__parentOverflow', el: parent, old: parent.style.overflow});
          parent.style.overflow = 'visible';
        }
      }
      return unlocked;
    }

    // Resize handles
    handleDirs.forEach(function(d) {
      handles[d].addEventListener('mousedown', function(e) {
        if (!selectedEl) return;
        e.preventDefault();
        e.stopPropagation();
        var dir = d;
        var startR = selectedEl.getBoundingClientRect();
        var sx = e.clientX, sy = e.clientY;
        var origW = startR.width, origH = startR.height;
        var cs0 = getCS(selectedEl);
        var origML = parseFloat(cs0.marginLeft) || 0;
        var origMT = parseFloat(cs0.marginTop) || 0;
        var origLeft = parseFloat(cs0.left) || 0;
        var origTop = parseFloat(cs0.top) || 0;
        var posKind = cs0.position;
        var usesCoords = (posKind === 'absolute' || posKind === 'fixed' || posKind === 'sticky' || posKind === 'relative');
        // Lazy unlock: only runs on first real movement. A pure click without
        // drag MUST be a no-op — unlockResize mutates flex/margin/width and
        // would shift the element on sites like Shopify's .container.
        var unlocked = null;
        var DRAG_THRESHOLD = 2;  // px

        // Stash the live element at drag start. The closure-captured
        // `selectedEl` may be nulled mid-drag (deselect from another path,
        // host click-outside, etc.) — using a stable local ref prevents a
        // null-deref storm on every mousemove (was firing 80+× per gesture
        // and choking everything else).
        var resizeEl = selectedEl;
        function onM(ev) {
          if (!resizeEl) return;
          var hp = eventToHostXY(ev);
          var dx = hp.x - sx, dy = hp.y - sy;
          // Convert host-px delta to target-px so the size we write matches
          // the iframe's natural coordinate system at canvas zooms < 1.
          var rscale = (function() {
            var box = getOverlayBox(resizeEl);
            return (box && box._scale) ? box._scale : 1;
          })();
          if (rscale && rscale !== 1) { dx = dx / rscale; dy = dy / rscale; }
          if (!unlocked) {
            if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
            unlocked = unlockResize(resizeEl, dir);
          }
          var w = origW, h = origH;
          if (dir.indexOf('e') !== -1) w += dx;
          if (dir.indexOf('w') !== -1) w -= dx;
          if (dir.indexOf('s') !== -1) h += dy;
          if (dir.indexOf('n') !== -1) h -= dy;
          var newW = Math.max(20, w);
          var newH = Math.max(20, h);
          var realDw = origW - newW;
          var realDh = origH - newH;

          resizeEl.style.setProperty('width',  newW + 'px', 'important');
          resizeEl.style.setProperty('height', newH + 'px', 'important');

          if (dir.indexOf('w') !== -1) {
            if (usesCoords) {
              resizeEl.style.setProperty('left', (origLeft + realDw) + 'px', 'important');
            } else {
              resizeEl.style.setProperty('margin-left', (origML + realDw) + 'px', 'important');
            }
          }
          if (dir.indexOf('n') !== -1) {
            if (usesCoords) {
              resizeEl.style.setProperty('top', (origTop + realDh) + 'px', 'important');
            } else {
              resizeEl.style.setProperty('margin-top', (origMT + realDh) + 'px', 'important');
            }
          }

          updateSelBox(resizeEl);
          updateSpacingGuides(resizeEl);
        }

        function onU() {
          unbindDragOnBothDocs(onM, onU);
          if (!unlocked || !resizeEl) return;
          pushUndo({
            el: resizeEl, prop: '__resize',
            oldW: origW + 'px', oldH: origH + 'px',
            oldML: origML + 'px', oldMT: origMT + 'px',
            oldLeft: origLeft + 'px', oldTop: origTop + 'px',
            usesCoords: usesCoords,
            unlocked: unlocked
          });
        }

        bindDragOnBothDocs(onM, onU);
      }, {signal: sig});
    });

    // Editor attention (from background.js) — extension only.
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
      chrome.runtime.onMessage.addListener(function(msg, sender, sendResponse) {
        if (msg.action === 'editorAttention') {
          // If editor was deactivated, don't respond — let background inject panel
          if (!window.__rbEditorActive) return;
          inspector.classList.remove('rb-ed-attention');
          void inspector.offsetWidth;
          inspector.classList.add('rb-ed-attention');
          sendResponse({active: true});
          return true;
        }
      });
    }
  }

  // ============ DEACTIVATE ============

  // Expose deactivate() so the host (mountEditor / CanvasEditorCore) can
  // tear the editor down when its component unmounts. Stored on the host
  // window so the canvas's parent doc reaches the right closure.
  hostWin.__rbDeactivate = function() { deactivate(); };

  function deactivate() {
    saveState();
    if (autoSaveInterval) clearInterval(autoSaveInterval);
    hostWin.removeEventListener('beforeunload', onBeforeUnload);
    // Clean up any stale FAB from older builds (defensive — the FAB feature
    // was removed but a leftover DOM node could persist on a page reload)
    var staleFab = hostDoc.getElementById('rb-ed-fab');
    if (staleFab) staleFab.remove();
    var hk = targetDoc.getElementById('rb-hover-kill');
    if (hk) hk.remove();
    // Override sheet lives in target head — clean it up too.
    var ovs = targetDoc.getElementById('rb-override-sheet');
    if (ovs) ovs.remove();
    // Canvas-mode cursor style + rb-ed-active marker on target body.
    var cs = targetDoc.getElementById('rb-cursor-style');
    if (cs) cs.remove();
    if (hostDoc !== targetDoc && targetDoc.body) {
      targetDoc.body.classList.remove('rb-ed-active');
    }
    // Font dropdown / popups are appended to host body (not root) to escape
    // inspector overflow clipping, so they need explicit cleanup on teardown.
    hostDoc.querySelectorAll('body > .rb-insp-font-drop, body > .rb-font-picker, body > .rb-link-editor').forEach(function(el) { el.remove(); });
    hostDoc.documentElement.style.removeProperty('--rb-insp-width');
    hostDoc.documentElement.style.removeProperty('--rb-layers-width');

    if (layersPanel && layersPanel.parentElement) {
      layersPanel.parentElement.removeChild(layersPanel);
    }

    hostWin.__rbEditorActive = false;
    ac.abort();
    root.remove();
    hostDoc.body.classList.remove('rb-ed-active', 'rb-ed-dragging', 'rb-ed-floating', 'rb-ed-canvas');
    hostDoc.documentElement.classList.remove('rb-scroll-locked', 'rb-ed-docked');
    hostDoc.body.style.paddingTop = '';

    // Clean up rebuild engine
    if (window.__rbRebuild) {
      window.__rbRebuild.destroy();
    }

    targetDoc.querySelectorAll('[data-rb-editing]').forEach(function(el) {
      el.contentEditable = 'false';
      el.removeAttribute('data-rb-editing');
    });
    targetDoc.querySelectorAll('.rb-ed-movable,.rb-ed-text-hint').forEach(function(el) {
      el.classList.remove('rb-ed-movable', 'rb-ed-text-hint');
    });

    var edStyles = hostDoc.getElementById('rb-editor-styles');
    if (edStyles) edStyles.remove();

    // Extension-only courtesy: ask background to re-open the popup widget.
    // Web-shell has no chrome.runtime — guard the call.
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({action: 'reopenPanel'}, function() {
          if (chrome.runtime.lastError) { /* ignore */ }
        });
      }
    } catch (e) {}
  }

})();
