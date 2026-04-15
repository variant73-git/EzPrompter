(function() {
  if (window.__rbEditorActive) { deactivate(); return; }
  window.__rbEditorActive = true;

  var ac = new AbortController(), sig = ac.signal;

  // Detect web builder and freeze animations
  var builderInfo = {builder: 'generic', features: {}};
  try {
    if (window.__rbDetectBuilder) builderInfo = window.__rbDetectBuilder();
    if (builderInfo.builder !== 'generic' && window.__rbFreeze) {
      window.__rbFreeze(builderInfo);
    }
  } catch(detectErr) {}

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

  // Target document is always the page document (no iframe in v4)
  var targetDoc = document;

  // Skip tags
  var SKIP = new Set(['HTML','BODY','HEAD','SCRIPT','STYLE','META','LINK','BR','HR','NOSCRIPT','TITLE','BASE']);

  // SVG icons (width=14 height=14)
  var IC = 'width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"';
  var CLOSE = '<svg '+IC+'><path d="M18 6L6 18M6 6l12 12"/></svg>';
  var EXPORT = '<svg '+IC+'><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></svg>';
  var DL = '<svg '+IC+'><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
  var UL = '<svg '+IC+'><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>';

  // Ensure editor CSS is loaded
  if (!document.getElementById('rb-editor-styles')) {
    var cssUrl = '';
    try { cssUrl = chrome.runtime.getURL('editor/editor.css'); } catch(e) {}
    if (cssUrl) {
      var cssLink = document.createElement('link');
      cssLink.id = 'rb-editor-styles';
      cssLink.rel = 'stylesheet';
      cssLink.href = cssUrl;
      document.head.appendChild(cssLink);
    }
  }

  // DOM root
  var root = document.createElement('div');
  root.id = 'rb-editor-root';
  document.body.appendChild(root);
  document.body.classList.add('rb-ed-active');
  document.documentElement.style.setProperty('--rb-insp-width', '260px');
  document.documentElement.style.setProperty('--rb-layers-width', '240px');

  // Font isolation: inline <style> injected LAST to beat any site CSS
  var rbFontStyle = document.createElement('style');
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

  // Freeze site to idle state — disable all hover/focus/active CSS rules
  var hoverKill = document.createElement('style');
  hoverKill.id = 'rb-hover-kill';
  var killRules = '';
  try {
    Array.from(document.styleSheets).forEach(function(sheet) {
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
  document.head.appendChild(hoverKill);

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
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    return e;
  }

  function isLight() { return document.body.classList.contains('rb-ed-light'); }

  function getBox(el) {
    var r = el.getBoundingClientRect();
    return {top: r.top, left: r.left, width: r.width, height: r.height, bottom: r.bottom, right: r.right};
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

  function px(v) { return parseFloat(v) || 0; }

  // getComputedStyle that works across iframe boundaries
  function getCS(el) {
    var doc = el.ownerDocument || document;
    return doc.defaultView.getComputedStyle(el);
  }

  function cssProp(jsProp) {
    return jsProp.replace(/([A-Z])/g, '-$1').toLowerCase();
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
    try { return getGroups(document.body, 0); } catch(e) { return []; }
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
      var viewportArea = window.innerWidth * window.innerHeight;
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
      if (currentParent === document.body) { currentParent = null; currentDepth = 0; }
    }
    deselectEl();
    updateDepthIndicator();
  }

  function updateDepthIndicator() {
    var banner = document.getElementById('rb-ed-banner');
    if (!banner) return;
    var txt = currentDepth === 0
      ? 'Click any element to edit'
      : 'Depth ' + currentDepth + ' \u2014 double-click to go deeper \u00B7 Esc to go up';
    var first = banner.childNodes[0];
    if (first && first.nodeType === 3) { first.textContent = txt; }
    else { banner.insertBefore(document.createTextNode(txt), banner.firstChild); }
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
  var saveKey = 'rb-autosave-' + window.location.hostname + window.location.pathname;

  function initAutoSave() {
    // Clean up ALL stale editor artifacts from previous sessions
    var staleStyles = document.getElementById('rb-editor-styles');
    if (staleStyles) staleStyles.remove();

    // Remove stale inline styles from previous editor sessions
    // Our editor uses style.setProperty(prop, val, 'important') — check for that
    document.querySelectorAll('*').forEach(function(el) {
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
      var edStyles = document.getElementById('rb-editor-styles');
      var overrides = edStyles ? edStyles.textContent : '';
      // Collect individual inline style changes
      var inlineChanges = [];
      document.querySelectorAll('[data-rb-node]').forEach(function(el) {
        if (el.style.cssText) {
          inlineChanges.push({
            node: el.getAttribute('data-rb-node'),
            css: el.style.cssText
          });
        }
      });
      var state = {
        url: window.location.href,
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
          var rebuiltEl = document.getElementById('rb-rebuilt-page');
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
    } else {
      // Running spinner
      icon.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#EFEEEB" stroke-width="2" stroke-linecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>';
      icon.style.animation = 'rb-ed-spin 1s linear infinite';
    }

    var text = mk('span');
    text.style.cssText = 'flex:1;line-height:1.4;word-break:break-word;';
    text.textContent = message;

    var close = mk('button');
    close.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    close.style.cssText = 'background:none;border:none;color:rgba(239,238,235,0.5);cursor:pointer;padding:4px;display:flex;align-items:center;flex-shrink:0;';
    close.addEventListener('click', function() {
      toast.remove();
      if (typeof onDismiss === 'function') onDismiss();
    });

    toast.appendChild(icon);
    toast.appendChild(text);
    toast.appendChild(close);
    root.appendChild(toast);
    return toast;
  }

  function updateToast(toast, message, status) {
    if (!toast || !toast.parentNode) return;
    var text = toast.querySelector('span:nth-child(2)');
    if (text) text.textContent = message;
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
        } else {
          icon.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#EFEEEB" stroke-width="2" stroke-linecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>';
          icon.style.animation = 'rb-ed-spin 1s linear infinite';
        }
      }
    }
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
        var s = document.getElementById('rb-editor-styles') || (function() {
          var s = mk('style'); s.id = 'rb-editor-styles';
          document.head.appendChild(s); return s;
        })();
        s.textContent = data.overrides;
      }
      // Apply inline changes
      if (data.inlineChanges) {
        data.inlineChanges.forEach(function(change) {
          var el = document.querySelector('[data-rb-node="' + change.node + '"]');
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
    var b = mk('div');
    b.id = 'rb-ed-banner';
    b.innerHTML = '<div class="rb-ed-modes">' +
      '<button class="rb-ed-mode active" data-mode="A">A: CSS Live</button>' +
      '<button class="rb-ed-mode" data-mode="B">B: Rebuild</button>' +
      '<button class="rb-ed-mode" data-mode="C">C: Hybrid</button>' +
      '<button class="rb-ed-mode" data-mode="D">D: Canvas</button>' +
      '<button class="rb-ed-mode" data-mode="E">E: AI</button>' +
      '<button class="rb-ed-mode" data-mode="F">F: Curated</button>' +
    '</div>';
    var x = mk('button');
    x.id = 'rb-ed-banner-close';
    x.innerHTML = CLOSE;
    x.addEventListener('mousedown', function(e) { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); deactivate(); }, {signal: sig, capture: true});
    b.appendChild(x);
    root.appendChild(b);
    b.querySelectorAll('.rb-ed-mode').forEach(function(btn) {
      btn.addEventListener('mousedown', function(e) {
        e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
        switchMode(btn.dataset.mode);
        b.querySelectorAll('.rb-ed-mode').forEach(function(m) { m.classList.remove('active'); });
        btn.classList.add('active');
      }, {signal: sig, capture: true});
    });
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

    rebuildInProgress = true;
    // Persistent toast that stays visible even if the user walks away
    // from the inspector panel. Stays until dismissed or updated to
    // success/error.
    var modeEToast = showToast('Mode E: starting…', 'running');
    window.__rbModeE.run(function(progress) {
      if (progress.step === 'error') {
        rebuildInProgress = false;
        progressEl.style.color = '#f87171';
        progressEl.textContent = progress.message;
        updateToast(modeEToast, 'Mode E failed — ' + progress.message, 'error');
      } else if (progress.step === 'done') {
        rebuildInProgress = false;
        progressEl.style.color = '#22c55e';
        progressEl.textContent = progress.message;
        restoreBtn.style.display = '';
        updateToast(modeEToast, 'Mode E complete — ' + progress.message, 'success');
      } else {
        progressEl.textContent = progress.message;
        updateToast(modeEToast, 'Mode E: ' + progress.message, 'running');
      }
    });
  }

  // applySemantic removed — Mode E now uses the full rebuild pipeline (mode-e.js)

  function cleanupMode() {
    // Clean Mode E rebuild
    if (window.__rbModeE) window.__rbModeE.restore();
    semanticGroups.forEach(function(g) { g.remove(); });
    semanticGroups = [];
    // Clean Mode F normalized DOM
    if (window.__rbNormalize) window.__rbNormalize.deactivate();
    // Clean Mode D canvas
    var canvas = document.getElementById('rb-ed-canvas');
    if (canvas) canvas.remove();
    var wrapper = document.getElementById('rb-ed-canvas-wrapper');
    if (wrapper) wrapper.remove();
    document.querySelectorAll('[data-rb-hidden]').forEach(function(el) {
      el.style.display = '';
      el.removeAttribute('data-rb-hidden');
    });
    document.body.classList.remove('rb-ed-canvas-mode');
    var layoutBtn = document.querySelector('.rb-ed-layout-btn');
    if (layoutBtn) layoutBtn.remove();
  }

  function activateModeB() {
    if (window.__rbRebuild) window.__rbRebuild.rebuild();
  }

  function activateModeC() {
    var layoutBtn = mk('button', 'rb-ed-layout-btn');
    layoutBtn.textContent = 'Layout Mode';
    layoutBtn.addEventListener('click', function() {
      if (document.getElementById('rb-ed-canvas')) {
        cleanupMode();
        layoutBtn.textContent = 'Layout Mode';
        layoutBtn.classList.remove('active');
      } else {
        activateModeD();
        layoutBtn.textContent = 'Exit Layout';
        layoutBtn.classList.add('active');
      }
    }, {signal: sig});
    var header = document.getElementById('rb-ed-insp-header');
    if (header) header.appendChild(layoutBtn);
  }

  function activateModeD() {
    document.body.classList.add('rb-ed-canvas-mode');
    var vw = window.innerWidth;
    var vh = Math.max(document.documentElement.scrollHeight, window.innerHeight);

    var wrapper = mk('div');
    wrapper.id = 'rb-ed-canvas-wrapper';
    wrapper.style.cssText = 'position:fixed;top:32px;left:0;right:280px;bottom:0;overflow:auto;background:#2a2a2a;z-index:2147483639;';

    var canvas = mk('div');
    canvas.id = 'rb-ed-canvas';
    canvas.style.cssText = 'position:relative;width:'+vw+'px;min-height:'+vh+'px;background:#fff;transform-origin:0 0;margin:40px auto;box-shadow:0 4px 40px rgba(0,0,0,0.3);';

    Array.from(document.body.children).forEach(function(child) {
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
    // Append to body, NOT root — so canvas elements pass isEditorEl check
    document.body.appendChild(wrapper);

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
    document.addEventListener('keydown', function(e) {
      if (e.code === 'Space' && !isPanning && currentMode === 'D') {
        isPanning = true; wrapper.style.cursor = 'grab'; e.preventDefault();
      }
    }, {signal: sig});
    document.addEventListener('keyup', function(e) {
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
    var cs = getComputedStyle(orig);
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
      item.el.style.padding = getComputedStyle(item.el).padding; // preserve padding
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
  window.addEventListener('beforeunload', onBeforeUnload);

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
      try { cs = getComputedStyle(el); } catch(e) {}
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
    try { cs = getComputedStyle(el); } catch(e) { return false; }
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
      if (el === siteWrapper && el !== document.body) return 'Page';

      // 7. Position & role heuristics
      var cs;
      try { cs = getComputedStyle(el); } catch(e) {}
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
    var s; try { s = getComputedStyle(el); } catch(e) { return false; }
    if (s.position !== 'fixed' && s.position !== 'sticky') return false;
    var r = el.getBoundingClientRect();
    if (r.width < 200 && r.height < 200) return true;
    if (r.bottom > window.innerHeight - 20 && (r.left < 100 || r.right > window.innerWidth - 100) && r.width < 400) return true;
    return false;
  }

  function isHoverMenu(el) {
    var s; try { s = getComputedStyle(el); } catch(e) { return false; }
    if (s.opacity === '0' || s.visibility === 'hidden' || s.pointerEvents === 'none') return true;
    if (s.transform && s.transform !== 'none') {
      var r = el.getBoundingClientRect();
      if (r.bottom < 0 || r.top > window.innerHeight || r.right < 0 || r.left > window.innerWidth) return true;
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
      var ics; try { ics = getComputedStyle(el); } catch(e) {}
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
      var old = document.getElementById('rb-layer-colorpicker');
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
        document.removeEventListener('mousedown', closePicker, true);
      };
      setTimeout(function() { document.addEventListener('mousedown', closePicker, true); }, 50);
    });

    row._rbEl = el;
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
    while (walk && walk !== document.body && maxUp-- > 0) {
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
    renderLayerChildren(document.body, layersBody, 0);
  }

  // ---- SECTIONS TAB ----
  // Find the "site wrapper" — the element whose direct children are the page's stacked sections.
  // Pattern: the deepest single-branch ancestor from body that contains multiple visible full-width children.
  function findSiteWrapper() {
    var el = document.body;
    var maxDrill = 10;
    while (maxDrill-- > 0) {
      var visKids = [];
      for (var i = 0; i < el.children.length; i++) {
        var ch = el.children[i];
        if (SKIP.has(ch.tagName) || isEditorEl(ch)) continue;
        var r = ch.getBoundingClientRect();
        if (r.width > window.innerWidth * 0.5 && r.height > 15) visKids.push(ch);
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
      var cs; try { cs = getComputedStyle(el); } catch(e2) {}
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
      var indicators = document.querySelectorAll('.rb-section-drop-indicator');
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

  function populateAssets() {
    var ab = document.getElementById('rb-ed-assets-body');
    if (!ab) return;
    ab.innerHTML = '';

    // Collect all images > 80x80
    var imgs = [];
    document.querySelectorAll('img').forEach(function(img) {
      var w = img.naturalWidth || img.width || 0;
      var h = img.naturalHeight || img.height || 0;
      var src = img.currentSrc || img.src || '';
      if (!src || src.indexOf('data:image/svg') === 0 || src.indexOf('data:image/gif') === 0) return;
      if (w < 80 || h < 80) return;
      if (imgs.some(function(c) { return c.src === src; })) return;
      imgs.push({src: src, w: w, h: h, alt: img.alt || ''});
    });

    // Also background images
    document.querySelectorAll('section,div,article,header,footer').forEach(function(el) {
      if (isEditorEl(el)) return;
      var bg = getCS(el).backgroundImage;
      if (bg && bg !== 'none') {
        var match = bg.match(/url\(["']?(https?:\/\/[^"')]+)["']?\)/);
        if (match && !imgs.some(function(c) { return c.src === match[1]; })) {
          imgs.push({src: match[1], w: 200, h: 200, alt: ''});
        }
      }
    });

    imgs.sort(function(a, b) { return (b.w * b.h) - (a.w * a.h); });

    var countEl = mk('div');
    countEl.style.cssText = 'padding:8px 14px;font:500 11px "Instrument Sans",sans-serif;color:' + (isLight() ? 'rgba(51,51,51,0.5)' : 'rgba(239,238,235,0.5)') + ';';
    countEl.textContent = imgs.length + ' image' + (imgs.length !== 1 ? 's' : '') + ' found';
    ab.appendChild(countEl);

    var grid = mk('div');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(3,1fr);gap:3px;padding:0 8px 8px;';
    imgs.slice(0, 30).forEach(function(img) {
      var item = mk('div');
      item.style.cssText = 'aspect-ratio:1;overflow:hidden;border-radius:4px;cursor:pointer;position:relative;';
      var imgEl = mk('img');
      imgEl.src = img.src;
      imgEl.alt = img.alt;
      imgEl.style.cssText = 'width:100%;height:100%;object-fit:cover;';
      imgEl.loading = 'lazy';
      item.appendChild(imgEl);

      // Click to select the image on the page
      item.addEventListener('mousedown', function(e) {
        e.stopImmediatePropagation();
        var pageImg = document.querySelector('img[src="' + img.src + '"]');
        if (pageImg && isValid(pageImg)) selectEl(pageImg);
      }, {capture: true});
      grid.appendChild(item);
    });
    ab.appendChild(grid);
  }

  function populateSections() {
    var sb = document.getElementById('rb-ed-sections-body');
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
    while (walk && walk !== document.body) {
      chain.unshift(walk);
      walk = walk.parentElement;
    }

    // Walk the layers tree, expanding each ancestor level
    var currentContainer = layersBody;
    for (var i = 0; i < chain.length; i++) {
      var target = chain[i];
      var found = false;

      // Search rows in currentContainer
      var rowContainers = currentContainer.children;
      for (var j = 0; j < rowContainers.length; j++) {
        var rc = rowContainers[j];
        var row = rc.querySelector('.rb-layer-row');
        if (!row || row._rbEl !== target) continue;

        found = true;

        if (i === chain.length - 1) {
          // Target element — highlight
          row.classList.add('rb-layer-selected');
          row.scrollIntoView({block: 'nearest', behavior: 'smooth'});
        } else {
          // Ancestor — expand it
          var chev = row.querySelector('.rb-layer-chev');
          var childContainer = rc.querySelector('.rb-layer-children');
          if (childContainer) {
            if (childContainer.children.length === 0) {
              renderLayerChildren(target, childContainer, i + 1);
            }
            childContainer.classList.add('rb-layer-expanded');
            if (chev) chev.classList.add('rb-layer-open');
            currentContainer = childContainer;
          }
        }
        break;
      }

      if (!found) {
        // Row not in tree (possibly filtered as inert) — stop searching
        break;
      }
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
      var existing = document.querySelector('.rb-ed-dropdown.rb-user-dd');
      if (existing) { existing.remove(); return; }
      var dd = mk('div', 'rb-ed-dropdown rb-user-dd');
      var rect = userAvatar.getBoundingClientRect();
      dd.style.cssText = 'position:fixed;top:' + (rect.bottom + 8) + 'px;right:' + (window.innerWidth - rect.right) + 'px;min-width:220px;';

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
      var close = function(ev) { if (!dd.contains(ev.target) && !userChev.contains(ev.target) && !userAvatar.contains(ev.target)) { dd.remove(); document.removeEventListener('mousedown', close, true); }};
      setTimeout(function() { document.addEventListener('mousedown', close, true); }, 50);
    }, {capture: true, signal: sig});
    userAvatar.addEventListener('mousedown', function(e) { userChev.dispatchEvent(new MouseEvent('mousedown', {bubbles: true, cancelable: true})); }, {capture: true, signal: sig});
    userWrap.appendChild(userAvatar);
    userWrap.appendChild(userChev);
    hd.appendChild(userWrap);

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
    document.addEventListener('click', function() { expDD.hidden = true; }, {signal: sig});

    exportWrap.appendChild(expBtn);
    exportWrap.appendChild(expDD);
    hd.appendChild(exportWrap);

    inspector.appendChild(hd);

    // Resize handle (left edge of sidebar)
    var resizeH = mk('div');
    resizeH.id = 'rb-insp-resize';
    resizeH.addEventListener('mousedown', function(e) {
      if (isFloating) return;
      e.preventDefault();
      var startX = e.clientX;
      var startW = inspector.offsetWidth;
      var onMove = function(me) {
        var newW = startW + (startX - me.clientX);
        newW = Math.max(240, Math.min(400, newW));
        inspector.style.width = newW + 'px';
        document.documentElement.style.setProperty('--rb-insp-width', newW + 'px');
      };
      var onUp = function() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
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
    logoEl.innerHTML = '<i>Repix</i>';
    var logoChev = mk('button', 'rb-ed-project-chev');
    logoChev.style.cssText = 'border:none;background:none;';
    logoChev.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>';
    logoChev.addEventListener('mousedown', function(e) {
      e.stopImmediatePropagation();
      var existing = document.querySelector('.rb-ed-dropdown.rb-logo-dd');
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
          var expBtn = document.querySelector('.rb-ed-export-btn');
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
        {label: 'Account', disabled: true}
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
      var close = function(ev) { if (!dd.contains(ev.target) && !logoChev.contains(ev.target)) { dd.remove(); document.removeEventListener('mousedown', close, true); }};
      setTimeout(function() { document.addEventListener('mousedown', close, true); }, 50);
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
        var onUp = function() { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      }, {capture: true});
    }

    function restorePanels() {
      panelsMinimized = false;
      layersPanel.style.display = '';
      inspector.style.display = '';
      // Only remove floating if panels are docked (not floating mode)
      var isFloating = layersPanel.classList.contains('rb-layers-floating');
      if (!isFloating) document.body.classList.remove('rb-ed-floating');
      if (miniWidgetL) { miniWidgetL.remove(); miniWidgetL = null; }
      if (miniWidgetR) { miniWidgetR.remove(); miniWidgetR = null; }
    }

    panelMinBtn.addEventListener('mousedown', function(e) {
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      panelsMinimized = true;
      layersPanel.style.display = 'none';
      inspector.style.display = 'none';
      document.body.classList.add('rb-ed-floating');

      // Left widget: handle + logo + minimize/undock icons
      if (miniWidgetL) miniWidgetL.remove();
      miniWidgetL = mk('div');
      miniWidgetL.className = 'rb-mini-widget';
      miniWidgetL.style.cssText = 'left:12px;top:12px;';
      miniWidgetL.innerHTML = DRAG_HANDLE + '<span class="rb-ed-logo" style="font-size:12px"><i>Repix</i></span>';
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
      document.body.classList.toggle('rb-ed-floating', !floating);
      panelUndockBtn.title = floating ? 'Undock panels' : 'Dock panels';
    }, {signal: sig, capture: true});

    // Theme toggle (sun/moon)
    var SUN_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>';
    var MOON_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
    var themeBtn = mk('button', 'rb-ed-theme-btn');
    themeBtn.title = 'Toggle light/dark mode';

    function applyTheme(light) {
      document.body.classList.toggle('rb-ed-light', light);
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

    logoActions.appendChild(themeBtn);
    logoActions.appendChild(panelMinBtn);
    logoActions.appendChild(panelUndockBtn);
    logoRow.appendChild(logoLeft);
    logoRow.appendChild(logoActions);
    layersHd.appendChild(logoRow);

    // Project name field (below logo)
    var projectField = mk('div', 'rb-ed-project-field');
    var projectName = mk('input', 'rb-ed-project-name');
    projectName.value = (document.title || 'Untitled').slice(0, 40);
    projectName.readOnly = true;
    projectName.style.cursor = 'default';
    projectName.addEventListener('click', function() {
      projectName.readOnly = false;
      projectName.style.cursor = 'text';
      projectName.select();
    });
    projectName.addEventListener('blur', function() {
      projectName.readOnly = true;
      projectName.style.cursor = 'default';
    });
    var projectChev = mk('div', 'rb-ed-project-chev');
    projectChev.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>';
    projectChev.addEventListener('mousedown', function(e) {
      e.stopImmediatePropagation();
      var existing = document.querySelector('.rb-ed-dropdown.rb-project-dd');
      if (existing) { existing.remove(); return; }
      var dd = mk('div', 'rb-ed-dropdown rb-project-dd');
      var rect = projectField.getBoundingClientRect();
      dd.style.cssText = 'position:fixed;top:' + (rect.bottom + 4) + 'px;left:' + rect.left + 'px;';
      var histBtn = mk('button', 'rb-ed-dropdown-item'); histBtn.textContent = 'Show version history';
      dd.appendChild(histBtn);
      var expBtn = mk('button', 'rb-ed-dropdown-item'); expBtn.textContent = 'Export';
      dd.appendChild(expBtn);
      dd.appendChild(mk('div', 'rb-ed-dropdown-divider'));
      var renameBtn = mk('button', 'rb-ed-dropdown-item'); renameBtn.textContent = 'Rename';
      renameBtn.addEventListener('click', function() { dd.remove(); projectName.click(); });
      dd.appendChild(renameBtn);
      root.appendChild(dd);
      var close = function(ev) { if (!dd.contains(ev.target) && !projectChev.contains(ev.target)) { dd.remove(); document.removeEventListener('mousedown', close, true); }};
      setTimeout(function() { document.addEventListener('mousedown', close, true); }, 50);
    }, {capture: true, signal: sig});
    projectField.appendChild(projectName);
    projectField.appendChild(projectChev);
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
        newH = Math.max(120, Math.min(window.innerHeight - 60, newH));
        layersPanel.style.height = newH + 'px';
      };
      var onUp = function() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    root.appendChild(layersPanel);

    populateLayers();
  }

  function showGlobalCSS() {
    updateInspector(document.body);
    inspector.classList.add('rb-insp-ghost');

    // Override font to show all site fonts
    var fontsUsed = new Set();
    document.querySelectorAll('h1,h2,h3,p,a,span,div,li,button').forEach(function(scanEl) {
      if (fontsUsed.size > 8) return;
      try { var f = getCS(scanEl).fontFamily.split(',')[0].replace(/['"]/g, '').trim(); if (f) fontsUsed.add(f); } catch(e) {}
    });
    var allFonts = [...fontsUsed].join(', ');
    var fontSel = inspBody.querySelector('.rb-insp-font-sel');
    if (fontSel && fontSel.options.length > 0) {
      fontSel.options[0].textContent = allFonts;
      fontSel.options[0].value = allFonts;
      fontSel.title = allFonts;
    }

    // Ghost image placeholder removed — unified into updateInspector single Image row
  }

  // ============ SECTIONS & ROWS ============

  var MORE_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><circle cx="8" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="16" cy="12" r="1" fill="currentColor" stroke="none"/></svg>';

  // Reusable settings popup (anchored to panel left edge, 3px gap)
  function openSettingsPopup(title, anchorBtn, buildContent) {
    var existing = document.querySelector('.rb-insp-adv-popup');
    if (existing) { existing.remove(); return null; }
    var popup = mk('div', 'rb-insp-adv-popup');
    var inspRect = inspector.getBoundingClientRect();
    var btnRect = anchorBtn.getBoundingClientRect();
    popup.style.cssText = 'position:fixed;top:' + btnRect.top + 'px;right:' + (window.innerWidth - inspRect.left + 3) + 'px;';
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
        document.removeEventListener('mousedown', closeOutside, true);
      }
    };
    setTimeout(function() { document.addEventListener('mousedown', closeOutside, true); }, 50);
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
    var chev = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
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
      // Hidden select triggered by arrow button
      var sel = mk('select');
      sel.style.cssText = 'position:absolute;right:0;top:0;width:22px;height:100%;opacity:0;cursor:pointer;';
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
      inp.addEventListener('change', function() { applyStyle(el, prop, applyVal(inp.value)); }, {signal: sig});

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
    // Hex text — click to select for manual editing
    txt.style.cssText = 'cursor:pointer;flex:1;background:none;padding:0;';
    txt.addEventListener('click', function() {
      txt.contentEditable = 'true';
      txt.focus();
      var range = document.createRange();
      range.selectNodeContents(txt);
      var sel = window.getSelection();
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
    // Opacity/alpha control
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
    inspBody.innerHTML = '';
    inspector.classList.remove('rb-insp-ghost');
    var cs = getCS(el);
    var r = getBox(el);

    // Breadcrumb
    var breadcrumb = mk('div', 'rb-ed-breadcrumb');
    var chain = [];
    var bcWalk = el;
    while (bcWalk && bcWalk !== document.body && chain.length < 6) {
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
    var xInp = mk('input', 'rb-insp-inp');
    xInp.value = 'X  ' + Math.round(r.left);
    xInp.style.width = '48%';
    var yInp = mk('input', 'rb-insp-inp');
    yInp.value = 'Y  ' + Math.round(r.top);
    yInp.style.width = '48%';
    posRow.appendChild(xInp);
    posRow.appendChild(yInp);
    posRow.style.cssText = 'display:flex;gap:6px;';
    addRow(posSec, 'Position', posRow);

    // Dimensions W x H (part of Container)
    var dimRow = mk('div');
    dimRow.style.cssText = 'display:flex;gap:6px;';
    var wInp = mk('input', 'rb-insp-inp');
    wInp.value = 'W  ' + Math.round(r.width);
    wInp.style.width = '48%';
    wInp.addEventListener('change', function() {
      applyStyle(el, 'width', parseInt(wInp.value.replace(/\D/g,'')) + 'px');
    });
    var hInp = mk('input', 'rb-insp-inp');
    hInp.value = 'H  ' + Math.round(r.height);
    hInp.style.width = '48%';
    hInp.addEventListener('change', function() {
      applyStyle(el, 'height', parseInt(hInp.value.replace(/\D/g,'')) + 'px');
    });
    dimRow.appendChild(wInp);
    dimRow.appendChild(hInp);
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
      inp.value = parseInt(cs[s.prop]) || 0;
      inp.style.cssText = 'width:32px;text-align:center;background:none;border:none;padding:5px 2px;';
      inp.addEventListener('change', function() {
        applyStyle(el, s.prop, inp.value + 'px');
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
          if (cs.textTransform === c.val) b.classList.add('active');
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
          if (cs.textDecorationLine === d.val || cs.textDecoration.indexOf(d.val) !== -1) b.classList.add('active');
          b.addEventListener('click', function() {
            applyStyle(el, 'textDecoration', d.val);
            decRowP.querySelectorAll('.rb-insp-align-btn').forEach(function(x) { x.classList.remove('active'); });
            b.classList.add('active');
          });
          decRowP.appendChild(b);
        });
        addRow(popup, 'Decoration', decRowP);
      });
    });
    // Font family — current + web safe + local fonts
    var curFont = cs.fontFamily.split(',')[0].replace(/['"]/g, '').trim();
    var fontSel = mk('select', 'rb-insp-font-sel');
    var curOpt = mk('option'); curOpt.value = curFont; curOpt.textContent = curFont; curOpt.selected = true;
    fontSel.appendChild(curOpt);
    var webSafe = ['Arial','Helvetica','Verdana','Georgia','Times New Roman','Courier New','system-ui','Roboto','Inter'];
    webSafe.forEach(function(f) {
      if (f === curFont) return;
      var o = mk('option'); o.value = f; o.textContent = f;
      fontSel.appendChild(o);
    });
    getLocalFonts(function(locals) {
      if (locals.length === 0) return;
      var group = mk('optgroup');
      group.label = 'Local Fonts (' + locals.length + ')';
      locals.forEach(function(f) {
        if (f === curFont || webSafe.indexOf(f) !== -1) return;
        var o = mk('option'); o.value = f; o.textContent = f;
        group.appendChild(o);
      });
      fontSel.appendChild(group);
    });
    fontSel.addEventListener('change', function() { applyStyle(el, 'fontFamily', fontSel.value); });
    var fontWrap = mk('div', 'rb-insp-field-wrap');
    fontWrap.style.cssText = 'display:flex;align-items:center;border-radius:4px;';
    var fontIcon = mk('span', 'rb-insp-field-icon');
    fontIcon.innerHTML = '<svg width="12" height="12" viewBox="0 0 36.23 42.5" fill="#fff"><polygon points="25.58 14.61 10.21 14.61 10.21 17.22 10.22 17.22 10.22 19.84 12.83 19.84 12.83 17.22 16.59 17.22 16.59 28.77 14.52 28.77 14.52 31.38 21.28 31.38 21.28 28.77 19.2 28.77 19.2 17.22 23 17.22 23 19.84 25.61 19.84 25.61 14.61 25.58 14.61"/><path d="M34.31,9.33l-7.41-7.41c-1.24-1.24-2.89-1.93-4.65-1.93H5.72C2.57,0,0,2.57,0,5.72v31.06c0,3.15,2.57,5.72,5.72,5.72h24.79c3.15,0,5.72-2.57,5.72-5.72V13.98c0-1.73-.7-3.42-1.93-4.65ZM33.06,13.98v22.79c0,1.43-1.12,2.54-2.54,2.54H5.72c-1.43,0-2.54-1.12-2.54-2.54V5.72c0-1.43,1.12-2.54,2.54-2.54h16.53c.91,0,1.76.35,2.4,1l7.41,7.41c.64.64,1,1.5,1,2.4Z"/></svg>';
    fontWrap.appendChild(fontIcon);
    fontSel.style.cssText += 'background:none;border:none;border-radius:0;flex:1;padding-right:4px;';
    fontWrap.appendChild(fontSel);
    var fontDivider = mk('div');
    fontDivider.className = 'rb-insp-field-divider';
    fontDivider.style.cssText = 'width:1px;align-self:stretch;flex-shrink:0;';
    fontWrap.appendChild(fontDivider);
    var fontChev = mk('div');
    fontChev.className = 'rb-insp-field-chev';
    fontChev.style.cssText = 'display:flex;align-items:center;justify-content:center;width:22px;flex-shrink:0;cursor:pointer;';
    fontChev.innerHTML = '<svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 9l6 6 6-6"/></svg>';
    // Click-forwarder: chevron is visual, but we need it to actually open the
    // <select>. HTMLSelectElement.showPicker() is the modern API; fall back to
    // a programmatic click on the select element if showPicker isn't available.
    fontChev.addEventListener('mousedown', function(e) {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (typeof fontSel.showPicker === 'function') {
        try { fontSel.showPicker(); return; } catch(err) {}
      }
      fontSel.focus();
      fontSel.click();
    }, {capture: true, signal: sig});
    fontWrap.appendChild(fontChev);
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
      if (w === cs.fontWeight) o.selected = true;
      weightSel.appendChild(o);
    });
    weightSel.addEventListener('change', function() { applyStyle(el, 'fontWeight', weightSel.value); });
    weightWrap.appendChild(weightSel);

    var sizeWrap = mk('div');
    sizeWrap.style.cssText = 'flex:1;display:flex;flex-direction:column;gap:3px;';
    var sizeLbl = mk('span', 'rb-insp-lbl'); sizeLbl.textContent = 'Size';
    sizeWrap.appendChild(sizeLbl);
    addInput(sizeWrap, '', cs.fontSize, el, 'fontSize');

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
    lhInp.value = cs.lineHeight === 'normal' ? 'auto' : (Math.round(parseFloat(cs.lineHeight) / parseFloat(cs.fontSize) * 100) + '%');
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
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
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
    var lsRaw = parseFloat(cs.letterSpacing) || 0;
    lsInp.value = (cs.letterSpacing === 'normal') ? '0%' : (Math.round(lsRaw / parseFloat(cs.fontSize) * 100) + '%');
    lsInp.style.cssText = 'flex:1;background:none;border:none;padding:5px 0;';
    lsInp.addEventListener('change', function() {
      var v = lsInp.value.trim();
      if (v.indexOf('%') !== -1) {
        var pct = parseFloat(v) || 0;
        v = (pct / 100 * parseFloat(cs.fontSize)) + 'px';
      }
      applyStyle(el, 'letterSpacing', v);
    });
    lsIcon.classList.add('rb-insp-drag-icon');
    lsIcon.addEventListener('mousedown', function(e) {
      e.preventDefault(); e.stopImmediatePropagation();
      var startX = e.clientX;
      var startVal = parseFloat(lsInp.value) || 0;
      var fSize = parseFloat(cs.fontSize) || 16;
      var onMove = function(me) {
        var delta = Math.round((me.clientX - startX) / 2);
        var nv = startVal + delta;
        lsInp.value = nv + '%';
        applyStyle(el, 'letterSpacing', (nv / 100 * fSize) + 'px');
      };
      var onUp = function() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
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
      if (cs.textAlign === a.val) btn.classList.add('active');
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

    // Text colors — unified list: own color + distinct child colors
    var colorEntries = []; // {hex, targets: [elements], isSelf: bool}
    var selfHex = rgbHex(cs.color);
    if (selfHex) colorEntries.push({hex: selfHex, targets: [el], isSelf: true});
    if (el.children.length > 0) {
      var colorMap = {};
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
          if (!colorMap[hex]) colorMap[hex] = [];
          colorMap[hex].push(child);
        }
      });
      Object.keys(colorMap).forEach(function(hex) {
        colorEntries.push({hex: hex, targets: colorMap[hex], isSelf: false});
      });
    }
    if (colorEntries.length > 0) {
      var colorsStack = mk('div');
      colorsStack.style.cssText = 'display:flex;flex-direction:column;gap:3px;';
      var maxVisible = 4;
      var hiddenColors = [];
      colorEntries.forEach(function(entry, idx) {
        var colorRow = mk('div', 'rb-insp-field-wrap');
        colorRow.style.cssText = 'display:flex;align-items:stretch;gap:6px;padding:2px 6px;';
        if (idx >= maxVisible) { colorRow.style.display = 'none'; hiddenColors.push(colorRow); }
        var sw = mk('div', 'rb-insp-swatch');
        sw.style.background = entry.hex;
        sw.title = entry.hex;
        sw.style.position = 'relative';
        var cinp = mk('input');
        cinp.type = 'color';
        cinp.value = entry.hex;
        cinp.addEventListener('input', function() {
          sw.style.background = cinp.value;
          sw.title = cinp.value;
          hexTxt.textContent = cinp.value;
          entry.targets.forEach(function(t) { applyStyle(t, 'color', cinp.value); });
        }, {signal: sig});
        sw.appendChild(cinp);
        var hexTxt = mk('span', 'rb-insp-val');
        hexTxt.textContent = entry.hex;
        hexTxt.style.cssText = 'flex:1;cursor:pointer;background:none;';
        hexTxt.addEventListener('click', function() {
          hexTxt.contentEditable = 'true'; hexTxt.focus();
          var range = document.createRange(); range.selectNodeContents(hexTxt);
          var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
        });
        hexTxt.addEventListener('blur', function() {
          hexTxt.contentEditable = 'false';
          var nv = hexTxt.textContent.trim();
          if (/^#[0-9a-fA-F]{3,8}$/.test(nv)) { sw.style.background = nv; cinp.value = nv; entry.targets.forEach(function(t) { applyStyle(t, 'color', nv); }); }
        });
        hexTxt.addEventListener('keydown', function(e) { if (e.key === 'Enter') { e.preventDefault(); hexTxt.blur(); } });
        var cDiv = mk('div');
        cDiv.style.cssText = 'width:1px;align-self:stretch;background:rgba(255,255,255,0.1);flex-shrink:0;';
        var cAlpha = mk('input', 'rb-insp-inp');
        cAlpha.value = '100%';
        cAlpha.style.cssText = 'width:42px;text-align:right;flex:none;background:none;';
        (function(ent, sw2, cinp2, cAlpha2) {
          cAlpha2.addEventListener('change', function() {
            var pct = parseInt(cAlpha2.value) || 100;
            pct = Math.max(0, Math.min(100, pct));
            cAlpha2.value = pct + '%';
            var hv = cinp2.value;
            var r = parseInt(hv.slice(1,3),16), g = parseInt(hv.slice(3,5),16), b = parseInt(hv.slice(5,7),16);
            var rgba = 'rgba(' + r + ',' + g + ',' + b + ',' + (pct/100) + ')';
            sw2.style.background = rgba;
            ent.targets.forEach(function(t) { applyStyle(t, 'color', rgba); });
          }, {signal: sig});
        })(entry, sw, cinp, cAlpha);
        colorRow.appendChild(sw);
        colorRow.appendChild(hexTxt);
        colorRow.appendChild(cDiv);
        colorRow.appendChild(cAlpha);
        colorsStack.appendChild(colorRow);
      });
      // "Show more" pill button
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
          if (colorsExpanded) {
            morePill.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="rgba(239,238,235,0.4)" stroke-width="2" stroke-linecap="round"><path d="M18 15l-6-6-6 6"/></svg>';
            morePill.title = 'Show less';
          } else {
            morePill.innerHTML = '<span style="width:4px;height:4px;border-radius:50%;background:rgba(239,238,235,0.3);"></span><span style="width:4px;height:4px;border-radius:50%;background:rgba(239,238,235,0.3);"></span><span style="width:4px;height:4px;border-radius:50%;background:rgba(239,238,235,0.3);"></span>';
            morePill.title = hiddenColors.length + ' more colors';
          }
        }, {capture: true});
        colorsStack.appendChild(morePill);
      }
      addRow(typSec, 'Colors', colorsStack);
    }

    // ---- FILL ----
    var hasBg = cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent';
    var _fillBgImg = cs.backgroundImage;
    var _fillHasImg = (_fillBgImg && _fillBgImg !== 'none') || el.tagName === 'IMG' || el.tagName === 'SVG' || (el.tagName && el.tagName.toLowerCase() === 'svg') || el.querySelector(':scope > img') || el.querySelector(':scope > svg');
    var hasFill = hasBg || _fillHasImg;
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
    if (hasBg) {
      var eyeFill = mk('button', 'rb-insp-eye-btn');
      eyeFill.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
      eyeFill.title = 'Toggle visibility';
      var fillHidden = false;
      var fillOrigBg = cs.backgroundColor;
      eyeFill.addEventListener('mousedown', function(e) {
        e.stopImmediatePropagation();
        fillHidden = !fillHidden;
        if (fillHidden) {
          el.style.setProperty('background-color', 'transparent', 'important');
          eyeFill.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
          eyeFill.classList.add('rb-insp-eye-off');
        } else {
          el.style.setProperty('background-color', fillOrigBg, 'important');
          eyeFill.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
          eyeFill.classList.remove('rb-insp-eye-off');
        }
      }, {capture: true, signal: sig});
      fillHd.querySelector('div').appendChild(eyeFill);
    }
    addColor(fillSec, 'Background color', cs.backgroundColor, el, 'backgroundColor');

    // ---- IMAGE (field matching color row structure) ----
    var visualEl = null;
    if (el.tagName === 'IMG') visualEl = el;
    else if (el.tagName === 'SVG' || (el.tagName && el.tagName.toLowerCase() === 'svg')) visualEl = el;
    else {
      var childImg = el.querySelector(':scope > img');
      var childSvg = el.querySelector(':scope > svg');
      if (childImg) visualEl = childImg;
      else if (childSvg) visualEl = childSvg;
    }
    var currentBgImg = cs.backgroundImage;
    var hasBgImg = currentBgImg && currentBgImg !== 'none';
    var hasImage = visualEl || hasBgImg;

    var imgFieldWrap = mk('div', 'rb-insp-color-row rb-insp-field-bg');
    imgFieldWrap.style.cssText = 'display:flex;align-items:center;gap:6px;border-radius:4px;padding:4px 6px;';

    // Swatch-sized thumbnail (16x16 to match color swatch)
    var imgSwatch = mk('div', 'rb-insp-swatch');
    if (hasImage) {
      imgSwatch.style.cssText += 'overflow:hidden;position:relative;';
      if (visualEl) {
        var vTag = visualEl.tagName.toUpperCase();
        if (vTag === 'IMG') {
          imgSwatch.style.backgroundImage = 'url(' + visualEl.src + ')';
          imgSwatch.style.backgroundSize = 'cover';
          imgSwatch.style.backgroundPosition = 'center';
        } else {
          imgSwatch.style.background = '#222';
        }
      } else {
        imgSwatch.style.backgroundImage = currentBgImg;
        imgSwatch.style.backgroundSize = 'cover';
        imgSwatch.style.backgroundPosition = 'center';
      }
    } else {
      // Empty: checkerboard like transparent color
      imgSwatch.style.background = 'linear-gradient(45deg,#ccc 25%,transparent 25%,transparent 75%,#ccc 75%),linear-gradient(45deg,#ccc 25%,transparent 25%,transparent 75%,#ccc 75%)';
      imgSwatch.style.backgroundSize = '8px 8px';
      imgSwatch.style.backgroundPosition = '0 0, 4px 4px';
    }
    imgFieldWrap.appendChild(imgSwatch);

    // Text label
    var imgLabel = mk('span', 'rb-insp-val');
    imgLabel.style.cssText = 'flex:1;background:none;padding:0;';
    if (hasImage) {
      if (visualEl) {
        var vTag2 = visualEl.tagName.toUpperCase();
        imgLabel.textContent = vTag2 === 'IMG' ? 'image' : 'SVG';
      } else {
        imgLabel.textContent = 'background';
      }
      imgLabel.style.cursor = 'pointer';
    } else {
      imgLabel.textContent = 'none';
      imgLabel.style.color = 'rgba(239,238,235,0.3)';
    }
    imgFieldWrap.appendChild(imgLabel);

    // If has image: click field to open image panel
    if (hasImage) {
      var imgPanelBtn = imgFieldWrap;
      imgPanelBtn.style.cursor = 'pointer';
      imgPanelBtn.addEventListener('mousedown', function(e) {
        e.stopImmediatePropagation();
        var existing = document.querySelector('.rb-insp-img-popup');
        if (existing) { existing.remove(); return; }
        var popup = mk('div', 'rb-insp-adv-popup rb-insp-img-popup');
        var inspRect = inspector.getBoundingClientRect();
        var fieldRect = imgFieldWrap.getBoundingClientRect();
        var popupTop = Math.min(fieldRect.top, window.innerHeight - 260);
        popup.style.cssText = 'position:fixed;top:' + popupTop + 'px;right:' + (window.innerWidth - inspRect.left + 3) + 'px;min-width:200px;';

        // Header
        var popHd = mk('div');
        popHd.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding-bottom:8px;margin-bottom:8px;border-bottom:1px solid rgba(255,255,255,0.06);';
        var popTitle = mk('span', 'rb-insp-sec-title');
        popTitle.textContent = 'Image';
        popTitle.style.cssText = 'text-transform:none;letter-spacing:0;';
        var closeBtn = mk('button', 'rb-ed-minmax-btn');
        closeBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
        closeBtn.addEventListener('mousedown', function(ev) { ev.stopImmediatePropagation(); popup.remove(); }, {capture: true, signal: sig});
        popHd.appendChild(popTitle);
        popHd.appendChild(closeBtn);
        popup.appendChild(popHd);

        // Large thumbnail
        var lgThumb = mk('div');
        lgThumb.style.cssText = 'width:100%;height:120px;border-radius:8px;overflow:hidden;border:1px solid rgba(255,255,255,0.1);margin-bottom:10px;display:flex;align-items:center;justify-content:center;background:#222;';
        if (visualEl) {
          var vt = visualEl.tagName.toUpperCase();
          if (vt === 'IMG') {
            var lgImg = mk('img');
            lgImg.src = visualEl.src;
            lgImg.style.cssText = 'width:100%;height:100%;object-fit:cover;';
            lgThumb.appendChild(lgImg);
          } else {
            try {
              var svClone = visualEl.cloneNode(true);
              svClone.setAttribute('width', '60');
              svClone.setAttribute('height', '60');
              svClone.style.cssText = 'width:60px;height:60px;';
              svClone.removeAttribute('class');
              lgThumb.appendChild(svClone);
            } catch(err) {}
          }
        } else {
          lgThumb.style.backgroundImage = currentBgImg;
          lgThumb.style.backgroundSize = 'cover';
          lgThumb.style.backgroundPosition = 'center';
        }
        popup.appendChild(lgThumb);

        // Action buttons row
        var actRow = mk('div');
        actRow.style.cssText = 'display:flex;gap:4px;';

        // Replace
        var replBtn = mk('button', 'rb-insp-align-btn');
        replBtn.style.cssText = 'flex:1;height:28px;gap:4px;';
        replBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg><span style="font:400 10px \'Instrument Sans\',sans-serif">Replace</span>';
        var replInp = mk('input'); replInp.type = 'file'; replInp.accept = 'image/*'; replInp.style.display = 'none';
        replBtn.addEventListener('mousedown', function(ev) { ev.stopImmediatePropagation(); replInp.click(); }, {capture: true});
        replInp.addEventListener('change', function(ev) {
          var f = ev.target.files[0]; if (!f) return;
          var rd = new FileReader();
          rd.onload = function() {
            if (visualEl && visualEl.tagName === 'IMG') {
              pushUndo({el: visualEl, prop: 'src', old: visualEl.src});
              visualEl.src = rd.result;
            } else {
              pushUndo({el: el, prop: 'backgroundImage', old: el.style.backgroundImage});
              el.style.backgroundImage = 'url(' + rd.result + ')';
              el.style.backgroundSize = 'cover';
              el.style.backgroundPosition = 'center';
            }
            popup.remove();
            updateInspector(el);
          };
          rd.readAsDataURL(f);
        });
        actRow.appendChild(replInp);
        actRow.appendChild(replBtn);

        // Download
        var dlBtn = mk('button', 'rb-insp-align-btn');
        dlBtn.style.cssText = 'flex:1;height:28px;gap:4px;';
        dlBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg><span style="font:400 10px \'Instrument Sans\',sans-serif">Download</span>';
        dlBtn.addEventListener('mousedown', function(ev) {
          ev.stopImmediatePropagation();
          var dlUrl = '';
          if (visualEl && visualEl.tagName === 'IMG') dlUrl = visualEl.src;
          else if (hasBgImg) { var m = currentBgImg.match(/url\(["']?([^"')]+)["']?\)/); if (m) dlUrl = m[1]; }
          if (dlUrl) { var a = document.createElement('a'); a.href = dlUrl; a.download = 'image'; a.click(); }
        }, {capture: true});
        actRow.appendChild(dlBtn);

        popup.appendChild(actRow);
        root.appendChild(popup);

        var closeOutside = function(ev) {
          if (popup && !popup.contains(ev.target) && !imgFieldWrap.contains(ev.target)) {
            if (popup.parentElement) popup.remove();
            document.removeEventListener('mousedown', closeOutside, true);
          }
        };
        setTimeout(function() { document.addEventListener('mousedown', closeOutside, true); }, 50);
      }, {capture: true, signal: sig});
    }
    addRow(fillSec, 'Image', imgFieldWrap);

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

  // Properties that should cascade to children when applied to a container
  var CASCADE_PROPS = new Set(['color','fontFamily','fontSize','fontWeight','fontStyle',
    'lineHeight','letterSpacing','textAlign','textTransform','textDecoration']);

  function applyStyle(el, prop, value) {
    var old = el.style[prop] || getCS(el)[prop];
    pushUndo({el: el, prop: prop, old: old});

    // Apply to element
    el.style[prop] = value;
    el.style.setProperty(cssProp(prop), value, 'important');

    // If it's a cascading property and element has children, apply to all descendants
    if (CASCADE_PROPS.has(prop) && el.children.length > 0) {
      el.querySelectorAll('*').forEach(function(child) {
        if (child.nodeType === 1) {
          child.style.setProperty(cssProp(prop), value, 'important');
        }
      });
    }

    // Auto-resize for typography changes
    var typoProps = ['fontSize','fontFamily','fontWeight','lineHeight','letterSpacing'];
    if (typoProps.indexOf(prop) !== -1) {
      el.style.width = '';
      el.style.height = '';
    }
    requestAnimationFrame(function() {
      if (selectedEl === el) updateSelBox(el);
    });
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
    } else if (u.prop === '__coordswap') {
      if (forward) {
        u.el.style.top = u.newElTop || '';
        u.el.style.left = u.newElLeft || '';
        u.target.style.top = u.newTTop || '';
        u.target.style.left = u.newTLeft || '';
      } else {
        u.newElTop = u.el.style.top;
        u.newElLeft = u.el.style.left;
        u.newTTop = u.target.style.top;
        u.newTLeft = u.target.style.left;
        u.el.style.top = u.elTop;
        u.el.style.left = u.elLeft;
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
        // Re-apply unlocked props if we saved their new values too
        if (u.unlockedNew) {
          u.unlockedNew.forEach(function(item) {
            if (item.prop === '__parentOverflow') item.el.style.overflow = item.val || '';
            else u.el.style[item.prop] = item.val || '';
          });
        }
      } else {
        // Capture current (post-resize) dimensions for redo
        u.newW = u.el.style.width;
        u.newH = u.el.style.height;
        u.newML = u.el.style.marginLeft;
        u.newMT = u.el.style.marginTop;
        // Also capture current values of unlocked props
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
    } else if (u.prop === '__modeERun') {
      if (forward) {
        // Redo of Mode E: put the rebuilt wrapper back
        var editorEls = getEditorElsInBody();
        var before = editorEls[0] || null;
        // Remove current (the originals we restored on undo)
        u.originalChildren.forEach(function(child) {
          if (child.parentElement === document.body) child.remove();
        });
        if (before) document.body.insertBefore(u.rebuiltWrapper, before);
        else document.body.appendChild(u.rebuiltWrapper);
        window.scrollTo(0, u.newScrollY || 0);
      } else {
        // Undo of Mode E: remove rebuilt wrapper, re-insert originals
        u.newScrollY = window.scrollY;
        if (u.rebuiltWrapper && u.rebuiltWrapper.parentElement) u.rebuiltWrapper.remove();
        var editorEls2 = getEditorElsInBody();
        var before2 = editorEls2[0] || null;
        u.originalChildren.forEach(function(child) {
          if (before2) document.body.insertBefore(child, before2);
          else document.body.appendChild(child);
        });
        window.scrollTo(0, u.scrollY || 0);
      }
    } else {
      // Generic style prop change
      var currentVal = u.el.style[u.prop];
      u.el.style[u.prop] = forward ? (u.newVal || '') : (u.old || '');
      if (!forward) u.newVal = currentVal;
    }
  }

  function getEditorElsInBody() {
    var out = [];
    Array.from(document.body.children).forEach(function(child) {
      if (child.id && (child.id.indexOf('rb-editor') === 0 || child.id.indexOf('rb-ed-') === 0)) {
        out.push(child);
      }
    });
    return out;
  }

  function undo() {
    if (!undoStack.length) return;
    var u = undoStack.pop();
    // Capture current state into the entry so redo can reverse
    applyUndoEntry(u, false);
    pushRedo(u);
    if (selectedEl) {
      updateSelBox(selectedEl);
      updateInspector(selectedEl);
    }
  }

  function redo() {
    if (!redoStack.length) return;
    var u = redoStack.pop();
    applyUndoEntry(u, true);
    undoStack.push(u);
    if (undoStack.length > UNDO_STACK_MAX) undoStack.shift();
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
    var target = selectedEl || document.body.firstElementChild;
    if (!target || isEditorEl(target)) return false;

    // Parse into a DOM fragment
    var tmp = document.createElement('div');
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
      var all = document.querySelectorAll('h1,h2,h3,h4,h5,h6,p,span,a,button,li,td,th,label,div');
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
          // Apply the snapshot HTML to the current rebuilt page or body
          var container = document.getElementById('rb-rebuilt-page');
          if (container) {
            container.outerHTML = snap.html;
          } else {
            // No rebuilt page — this is a Mode A edit context. Restore
            // means replacing the body content with the snapshot HTML
            // (user confirmed). Keep editor elements intact.
            var editorEls = [];
            Array.from(document.body.children).forEach(function(child) {
              if (child.id && (child.id.indexOf('rb-editor') === 0 || child.id.indexOf('rb-ed-') === 0)) {
                editorEls.push(child);
              }
            });
            Array.from(document.body.children).forEach(function(child) {
              if (editorEls.indexOf(child) === -1) child.remove();
            });
            var frag = document.createElement('div');
            frag.innerHTML = snap.html;
            var insertBefore = editorEls[0] || null;
            Array.from(frag.children).forEach(function(child) {
              if (insertBefore) document.body.insertBefore(child, insertBefore);
              else document.body.appendChild(child);
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
        document.removeEventListener('mousedown', closeOutside, true);
      }
    };
    setTimeout(function() { document.addEventListener('mousedown', closeOutside, true); }, 100);
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
      var range = document.createRange();
      range.selectNodeContents(el);
      var sel = window.getSelection();
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
  }

  function deselectEl() {
    if (selectedEl) {
      selectedEl.contentEditable = 'false';
      selectedEl.removeAttribute('data-rb-editing');
      selectedEl.classList.remove('rb-ed-movable');
    }
    var sel = window.getSelection();
    if (sel) sel.removeAllRanges();
    selectedEl = null;
    selectionDepth = 0;
    selectionAncestor = null;
    if (isTextEditing) exitTextEdit();
    isTextEditing = false;
    selBox.style.display = 'none';
    parentBox.style.display = 'none';
    var lock = document.getElementById('rb-ed-lock');
    if (lock) lock.remove();
    hideSpacingGuides();
    showGlobalCSS();
    syncLayersSelection(null);
  }

  // ============ UPDATE OVERLAYS ============

  function updateSelBox(el) {
    if (!el) { selBox.style.display = 'none'; return; }
    var r = getBox(el);
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
    var r = getBox(el);
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
    var r = getBox(p);
    Object.assign(parentBox.style, {
      display: 'block', top: r.top + 'px', left: r.left + 'px',
      width: r.width + 'px', height: r.height + 'px'
    });
  }

  // ============ SPACING GUIDES ============

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

  Object.keys(spacingGuides).forEach(function(key) {
    var widget = mk('div', 'rb-spacing-widget');
    widget.innerHTML = '<span class="rb-spacing-icon">\u2194</span><span class="rb-spacing-val">0</span>';
    spacingGuides[key].appendChild(widget);
    spacingGuides[key].style.display = 'none';
    spacingGuides[key].style.pointerEvents = 'auto';
    spacingGuides[key].style.cursor = (guideAxis[key] === 'x') ? 'ew-resize' : 'ns-resize';
    root.appendChild(spacingGuides[key]);

    // Drag to resize spacing
    var dragStartPos = null;
    var dragStartValue = 0;

    spacingGuides[key].addEventListener('mousedown', function(e) {
      if (!selectedEl) return;
      e.preventDefault();
      e.stopPropagation();

      var prop = guideProps[key];
      var targetEl = (key === 'gap') ? selectedEl.parentElement : selectedEl;
      if (!targetEl) return;

      var cs = getCS(targetEl);
      dragStartValue = parseFloat(cs[prop]) || 0;
      dragStartPos = { x: e.clientX, y: e.clientY };

      var axis = guideAxis[key];
      if (axis === 'auto') {
        // For gap, detect direction from parent flex
        var parentCs = getCS(targetEl);
        axis = (parentCs.flexDirection === 'row' || parentCs.flexDirection === 'row-reverse') ? 'x' : 'y';
      }
      var dir = guideDir[key];

      function onMove(ev) {
        var delta = (axis === 'x')
          ? (ev.clientX - dragStartPos.x) * dir
          : (ev.clientY - dragStartPos.y) * dir;
        var newVal = Math.max(0, Math.round(dragStartValue + delta));
        // Snap to 1px
        targetEl.style[prop] = newVal + 'px';
        // Update the widget value
        var valSpan = spacingGuides[key].querySelector('.rb-spacing-val');
        if (valSpan) valSpan.textContent = newVal;
        // Update guides positions
        updateSpacingGuides(selectedEl);
        updateSelBox(selectedEl);
      }

      function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        // Push undo
        pushUndo({ el: targetEl, prop: prop, old: dragStartValue + 'px' });
      }

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
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
    var valSpan = guide.querySelector('.rb-spacing-val');
    if (valSpan) valSpan.textContent = Math.round(value);
    var iconSpan = guide.querySelector('.rb-spacing-icon');
    if (iconSpan && icon) iconSpan.textContent = icon;
  }

  function updateSpacingGuides(el) {
    if (!el) {
      Object.keys(spacingGuides).forEach(function(k) { spacingGuides[k].style.display = 'none'; });
      return;
    }

    var r = el.getBoundingClientRect();
    var cs = getCS(el);
    var mt = px(cs.marginTop);
    var mr = px(cs.marginRight);
    var mb = px(cs.marginBottom);
    var ml = px(cs.marginLeft);
    var pt = px(cs.paddingTop);
    var pr = px(cs.paddingRight);
    var pb = px(cs.paddingBottom);
    var pl = px(cs.paddingLeft);

    // Position margin guides (OUTSIDE the element)
    positionGuide(spacingGuides.mt, r.left - ml, r.top - mt, r.width + ml + mr, mt, mt);
    positionGuide(spacingGuides.mr, r.right, r.top, mr, r.height, mr);
    positionGuide(spacingGuides.mb, r.left - ml, r.bottom, r.width + ml + mr, mb, mb);
    positionGuide(spacingGuides.ml, r.left - ml, r.top, ml, r.height, ml);

    // Position padding guides (INSIDE the element)
    positionGuide(spacingGuides.pt, r.left, r.top, r.width, pt, pt);
    positionGuide(spacingGuides.pr, r.right - pr, r.top, pr, r.height, pr);
    positionGuide(spacingGuides.pb, r.left, r.bottom - pb, r.width, pb, pb);
    positionGuide(spacingGuides.pl, r.left, r.top, pl, r.height, pl);

    // Gap guide
    var parentCs = el.parentElement ? getCS(el.parentElement) : null;
    var gapVal = parentCs ? (px(parentCs.gap) || 0) : 0;
    if (gapVal > 0 && el.nextElementSibling) {
      var nextR = el.nextElementSibling.getBoundingClientRect();
      var isHoriz = parentCs.flexDirection === 'row' || parentCs.flexDirection === 'row-reverse';
      if (isHoriz) {
        positionGuide(spacingGuides.gap, r.right, r.top, nextR.left - r.right, r.height, gapVal, '\u2194');
      } else {
        positionGuide(spacingGuides.gap, r.left, r.bottom, r.width, nextR.top - r.bottom, gapVal, '\u2195');
      }
    } else {
      spacingGuides.gap.style.display = 'none';
    }
  }

  function showSpacingGuides(el) {
    updateSpacingGuides(el);
  }

  function hideSpacingGuides() {
    updateSpacingGuides(null);
  }

  // ============ SVG EXPORT ============

  function downloadSVG() {
    var w = window.innerWidth, h = window.innerHeight;
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '">' +
      '<foreignObject width="100%" height="100%">' +
      '<html xmlns="http://www.w3.org/1999/xhtml">' +
      document.documentElement.outerHTML +
      '</html></foreignObject></svg>';
    var blob = new Blob([svg], {type: 'image/svg+xml'});
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'repix-export.svg';
    a.click();
  }

  // ============ IMAGE MENU ============

  function showImgMenu(img, x, y) {
    removeImgMenu();
    var m = mk('div', 'rb-ed-img-menu');
    m.style.left = x + 'px';
    m.style.top = y + 'px';

    var dlBtn = mk('button');
    dlBtn.innerHTML = DL + ' Download';
    dlBtn.addEventListener('click', function() {
      fetch(img.src).then(function(r) { return r.blob(); }).then(function(blob) {
        var url = URL.createObjectURL(blob);
        var a = mk('a');
        a.href = url;
        a.download = 'image.png';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }).catch(function() {
        // Fallback: open in new tab for cross-origin images
        window.open(img.src, '_blank');
      });
      removeImgMenu();
    });

    var repBtn = mk('button');
    repBtn.innerHTML = UL + ' Replace';
    var finp = mk('input');
    finp.type = 'file';
    finp.accept = 'image/*';
    finp.style.display = 'none';
    finp.addEventListener('change', function(e) {
      var f = e.target.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function() {
        pushUndo({el: img, prop: '__src', old: img.src});
        img.src = reader.result;
        removeImgMenu();
      };
      reader.readAsDataURL(f);
    });
    repBtn.addEventListener('click', function() { finp.click(); });

    m.appendChild(dlBtn);
    m.appendChild(repBtn);
    m.appendChild(finp);
    root.appendChild(m);
  }

  function removeImgMenu() {
    var m = root.querySelector('.rb-ed-img-menu');
    if (m) m.remove();
  }

  // ============ MOVE / SNAP (Figma-style) ============

  var dragGhost = null;
  var dropIndicator = null;
  var lastDropTarget = null;
  var lastDropPos = null; // 'before' or 'after'

  function createDragGhost(el) {
    if (dragGhost) dragGhost.remove();
    var r = el.getBoundingClientRect();
    dragGhost = mk('div', 'rb-ed-ghost');
    dragGhost.style.width = r.width + 'px';
    dragGhost.style.height = Math.min(r.height, 120) + 'px';
    dragGhost.style.left = r.left + 'px';
    dragGhost.style.top = r.top + 'px';
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

  function updateDragGhost(x, y) {
    if (!dragGhost) return;
    dragGhost.style.left = (x - parseInt(dragGhost.style.width) / 2) + 'px';
    dragGhost.style.top = (y - 20) + 'px';
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
    var parentStyle = getComputedStyle(targetEl.parentElement);
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
      var pos = getComputedStyle(children[i]).position;
      if (pos === 'absolute' || pos === 'fixed') return true;
    }
    return false;
  }

  var useCoordSwap = false; // set per drag session

  function handleMove(el, e) {
    var parent = el.parentElement;
    if (!parent) return;

    updateDragGhost(e.clientX, e.clientY);

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
        var parentStyle = getComputedStyle(parent);
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

      pushUndo({
        el: el, prop: '__coordswap',
        elTop: elTop, elLeft: elLeft,
        target: lastDropTarget, tTop: tTop, tLeft: tLeft
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
    // Resolve element to container: inline text elements bubble up to parent div
    // Pure inline text elements that bubble up to container
    var INLINE_TAGS = new Set(['SPAN','STRONG','EM','B','I','U','SMALL','CODE','MARK','SUB','SUP','ABBR','CITE','Q','S','DEL','INS','KBD','VAR','SAMP','TIME','DATA','BDI','BDO','RUBY','RT','RP','WBR']);
    // Note: A and LABEL removed — in modern sites they're often styled as buttons/cards/CTAs
    // Visual elements that should NEVER resolve to parent
    var VISUAL_TAGS = new Set(['IMG','VIDEO','IFRAME','CANVAS','SVG','BUTTON','INPUT','TEXTAREA','SELECT','A']);

    // isUselessWrapper is defined in outer scope (used by both layers panel and resolveContainer)

    function drillIntoChild(parentEl, x, y) {
      var stack = document.elementsFromPoint(x, y);
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
          // Walk up from SVG to find the first meaningful container (link, button, logo div)
          var parent = svgEl.parentElement;
          var maxUp = 5;
          while (parent && maxUp-- > 0) {
            if (isEditorEl(parent)) break;
            var ptag = parent.tagName.toUpperCase();
            // Links and buttons are always meaningful
            if (ptag === 'A' || ptag === 'BUTTON') return parent;
            // Container with text next to SVG (logo pattern: icon + text)
            if (parent.children.length > 1) return parent;
            // Has a role or aria-label (logo containers often do)
            if (parent.getAttribute('role') || parent.getAttribute('aria-label')) return parent;
            // Has a meaningful class name hinting at logo/brand
            var cls = (parent.className || '').toString().toLowerCase();
            if (cls.match(/logo|brand|navbar-brand|site-name/)) return parent;
            parent = parent.parentElement;
          }
          // If nothing meaningful found, return the SVG itself
          return svgEl;
        }
      }

      // Visual elements are always directly selectable
      if (VISUAL_TAGS.has(el.tagName)) return el;

      // In Mode E, try to find the semantic block
      if (currentMode === 'E') {
        var sem = el;
        var maxSem = 10;
        while (sem && maxSem-- > 0) {
          if (sem.hasAttribute && sem.hasAttribute('data-rb-semantic')) return sem;
          sem = sem.parentElement;
        }
      }

      // In Mode F, only select elements marked as editable
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
      var maxUp = 5;
      while (current && maxUp-- > 0) {
        if (!INLINE_TAGS.has(current.tagName) && current.tagName !== 'BR') break;
        current = current.parentElement;
      }
      if (!current) return el;

      // Skip useless wrappers — go up to find a meaningful container
      var maxSkip = 3;
      while (current && maxSkip-- > 0 && isUselessWrapper(current)) {
        current = current.parentElement;
      }

      return current || el;
    }

    // Hover — selects containers, not inline text
    var tMove = throttle(function(e) {
      if (isDragging) return;
      if (layerHoverLock) return;
      var rawEl = document.elementFromPoint(e.clientX, e.clientY);
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
    document.addEventListener('mousemove', tMove, {signal: sig, capture: true});

    // Click — 1 click selects, 2nd click on same element enters text edit
    var lastClickEl = null;
    var lastClickTime = 0;

    document.addEventListener('mousedown', function(e) {
      if (isEditorEl(e.target)) return;
      var rawEl = document.elementFromPoint(e.clientX, e.clientY);
      if (!rawEl || !isValid(rawEl)) return;

      var link = e.target.closest('a');
      if (link && !isEditorEl(link)) { e.preventDefault(); }

      var now = Date.now();
      var isRepeatClick = (selectedEl) && (now - lastClickTime < 500) && selectedEl.contains(rawEl);
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
          var s = window.getSelection(); if (s) s.removeAllRanges();
          var newEl = resolveContainer(rawEl);
          if (newEl && isValid(newEl)) { selectEl(newEl); } else { deselectEl(); }
        }
        return;
      }

      e.preventDefault();
      removeImgMenu();

      if (!isRepeatClick) {
        // NEW AREA: reset depth, resolve outermost container
        var el = resolveContainer(rawEl);
        if (!isValid(el)) return;
        selectionDepth = 0;
        selectionAncestor = el;

        if (el.tagName === 'IMG') showImgMenu(el, e.clientX, e.clientY);
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

          if (deeper.tagName === 'IMG') showImgMenu(deeper, e.clientX, e.clientY);
          if (deeper.contentEditable !== 'true') {
            dragStart = {x: e.clientX, y: e.clientY};
            dragThreshold = false;
          }
        } else {
          // Can't drill deeper — if text, enter edit mode
          if (isText(selectedEl) && selectedEl.contentEditable !== 'true') {
            enterTextEdit(selectedEl);
            dragStart = null;
            dragThreshold = false;
          }
        }
      }
    }, {signal: sig, capture: true});

    // Block page clicks — but let overlay modals and editor UI through
    document.addEventListener('click', function(e) {
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

    document.addEventListener('mousemove', function(e) {
      if (!dragStart || !selectedEl) return;
      var dx = e.clientX - dragStart.x;
      var dy = e.clientY - dragStart.y;

      if (!dragThreshold) {
        if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
          dragThreshold = true;
          isDragging = true;
          document.body.classList.add('rb-ed-dragging');

          if (currentMode === 'D') {
            // Mode D: free move — no ghost, just move the element directly
            dragOrigTop = parseInt(selectedEl.style.top) || 0;
            dragOrigLeft = parseInt(selectedEl.style.left) || 0;
            selBox.style.display = 'none';
          } else {
            // Modes A/B/C: ghost + drop indicator
            document.documentElement.classList.add('rb-scroll-locked');
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

    document.addEventListener('mouseup', function() {
      if (isDragging && selectedEl) {
        if (currentMode === 'D') {
          // Mode D: commit the free move, save undo
          var newTop = selectedEl.style.top;
          var newLeft = selectedEl.style.left;
          pushUndo({
            el: selectedEl, prop: '__freemove',
            oldTop: dragOrigTop + 'px', oldLeft: dragOrigLeft + 'px'
          });
          updateSelBox(selectedEl);
        } else {
          // Modes A/B/C: commit the swap
          commitDrop(selectedEl);
          document.documentElement.classList.remove('rb-scroll-locked');
        }
        isDragging = false;
        document.body.classList.remove('rb-ed-dragging');
      }
      dragStart = null;
      dragThreshold = false;
    }, {signal: sig});

    // Block right-click when element is selected
    document.addEventListener('contextmenu', function(e) {
      if (selectedEl && !isEditorEl(e.target)) {
        e.preventDefault();
        // Show feedback
        var existing = document.getElementById('rb-ed-lock');
        if (!existing) {
          var tip = mk('div', 'rb-ed-lock');
          tip.id = 'rb-ed-lock';
          tip.textContent = 'Right-click disabled during edit';
          root.appendChild(tip);
          setTimeout(function() { if (tip.parentNode) tip.remove(); }, 2000);
        }
      }
    }, {signal: sig, capture: true});

    // Keyboard
    document.addEventListener('keydown', function(e) {
      if (e.altKey && (e.key === 'l' || e.key === 'L')) {
        e.preventDefault();
        if (layersPanel) {
          layersPanel.style.display = layersPanel.style.display === 'none' ? '' : 'none';
        }
        return;
      }
      if (e.key === 'Escape') {
        if (isTextEditing) {
          selectedEl.contentEditable = 'false';
          selectedEl.removeAttribute('data-rb-editing');
          selectedEl.classList.add('rb-ed-movable');
          exitTextEdit();
          isTextEditing = false;
          var s = window.getSelection(); if (s) s.removeAllRanges();
          updateSelBox(selectedEl);
          return;
        }
        if (selectedEl && selectionDepth > 0) {
          var parent = selectedEl.parentElement;
          if (parent && parent !== document.body && isValid(parent)) {
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
    window.addEventListener('scroll', tScroll, {signal: sig, capture: true});
    window.addEventListener('resize', tScroll, {signal: sig});

    // Unlock CSS constraints that prevent resize
    function unlockResize(el, dir) {
      var cs = getCS(el);
      var unlocked = [];

      // Remove max-width/max-height constraints
      if (cs.maxWidth !== 'none' && cs.maxWidth !== '0px') {
        unlocked.push({prop: 'maxWidth', old: el.style.maxWidth});
        el.style.maxWidth = 'none';
      }
      if (cs.maxHeight !== 'none' && cs.maxHeight !== '0px') {
        unlocked.push({prop: 'maxHeight', old: el.style.maxHeight});
        el.style.maxHeight = 'none';
      }
      // Remove min-width/min-height that prevent shrinking
      if (dir.indexOf('w') !== -1 || dir.indexOf('e') !== -1) {
        if (cs.minWidth && cs.minWidth !== '0px') {
          unlocked.push({prop: 'minWidth', old: el.style.minWidth});
          el.style.minWidth = '0';
        }
      }
      // Convert percentage width to px for precise control
      if (cs.width && cs.width.indexOf('%') !== -1) {
        var rect = el.getBoundingClientRect();
        unlocked.push({prop: 'width', old: el.style.width});
        el.style.width = rect.width + 'px';
      }
      // Handle margin:auto (prevents left expansion)
      if (dir.indexOf('w') !== -1) {
        if (cs.marginLeft === cs.marginRight && parseFloat(cs.marginLeft) > 0) {
          // margin: 0 auto — unlock by setting explicit margin-left
          unlocked.push({prop: 'marginLeft', old: el.style.marginLeft});
          unlocked.push({prop: 'marginRight', old: el.style.marginRight});
          el.style.marginLeft = cs.marginLeft;
          el.style.marginRight = cs.marginRight;
        }
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
        var origML = parseFloat(getCS(selectedEl).marginLeft) || 0;
        var origMT = parseFloat(getCS(selectedEl).marginTop) || 0;
        var unlocked = unlockResize(selectedEl, dir);

        function onM(ev) {
          var dx = ev.clientX - sx, dy = ev.clientY - sy;
          var w = origW, h = origH;

          // Simple directional resize
          if (dir.indexOf('e') !== -1) w += dx;
          if (dir.indexOf('w') !== -1) w -= dx;
          if (dir.indexOf('s') !== -1) h += dy;
          if (dir.indexOf('n') !== -1) h -= dy;

          selectedEl.style.width = Math.max(20, w) + 'px';
          selectedEl.style.height = Math.max(20, h) + 'px';

          updateSelBox(selectedEl);
          updateSpacingGuides(selectedEl);
        }

        function onU() {
          document.removeEventListener('mousemove', onM);
          document.removeEventListener('mouseup', onU);
          // Save undo with all unlocked props
          pushUndo({
            el: selectedEl, prop: '__resize',
            oldW: origW + 'px', oldH: origH + 'px',
            oldML: origML + 'px', oldMT: origMT + 'px',
            unlocked: unlocked
          });
        }

        document.addEventListener('mousemove', onM);
        document.addEventListener('mouseup', onU);
      }, {signal: sig});
    });

    // Editor attention (from background.js)
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

  // ============ DEACTIVATE ============

  function deactivate() {
    saveState();
    if (autoSaveInterval) clearInterval(autoSaveInterval);
    window.removeEventListener('beforeunload', onBeforeUnload);
    // Clean up any stale FAB from older builds (defensive — the FAB feature
    // was removed but a leftover DOM node could persist on a page reload)
    var staleFab = document.getElementById('rb-ed-fab');
    if (staleFab) staleFab.remove();
    var hk = document.getElementById('rb-hover-kill');
    if (hk) hk.remove();
    document.documentElement.style.removeProperty('--rb-insp-width');
    document.documentElement.style.removeProperty('--rb-layers-width');

    if (layersPanel && layersPanel.parentElement) {
      layersPanel.parentElement.removeChild(layersPanel);
    }

    window.__rbEditorActive = false;
    ac.abort();
    root.remove();
    document.body.classList.remove('rb-ed-active', 'rb-ed-dragging');
    document.documentElement.classList.remove('rb-scroll-locked');
    document.body.style.paddingTop = '';

    // Clean up rebuild engine
    if (window.__rbRebuild) {
      window.__rbRebuild.destroy();
    }

    document.querySelectorAll('[data-rb-editing]').forEach(function(el) {
      el.contentEditable = 'false';
      el.removeAttribute('data-rb-editing');
    });
    document.querySelectorAll('.rb-ed-movable,.rb-ed-text-hint').forEach(function(el) {
      el.classList.remove('rb-ed-movable', 'rb-ed-text-hint');
    });

    var edStyles = document.getElementById('rb-editor-styles');
    if (edStyles) edStyles.remove();

    chrome.runtime.sendMessage({action: 'reopenPanel'}, function() {
      if (chrome.runtime.lastError) { /* ignore */ }
    });
  }

})();
