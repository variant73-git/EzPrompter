(function() {
  if (window.__rbEditorActive) { deactivate(); return; }
  window.__rbEditorActive = true;

  var ac = new AbortController(), sig = ac.signal;
  var selectedEl = null, lastHoverEl = null, isDragging = false;
  var selectionDepth = 0;
  var selectionAncestor = null;
  var currentMode = 'A';
  var undoStack = [];
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

  // DOM root
  var root = document.createElement('div');
  root.id = 'rb-editor-root';
  document.body.appendChild(root);
  document.body.classList.add('rb-ed-active');

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
        Array.from(sheet.cssRules || []).forEach(function(rule) {
          if (rule.selectorText && (
            rule.selectorText.includes(':hover') ||
            rule.selectorText.includes(':focus') ||
            rule.selectorText.includes(':active')
          )) {
            // Disable by overriding with !important revert
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

  // ============ HELPERS ============

  function mk(tag, cls) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    return e;
  }

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
      ? 'Live Remix \u2014 click any element'
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
    x.addEventListener('click', deactivate, {signal: sig});
    b.appendChild(x);
    root.appendChild(b);
    b.querySelectorAll('.rb-ed-mode').forEach(function(btn) {
      btn.addEventListener('click', function() {
        switchMode(btn.dataset.mode);
        b.querySelectorAll('.rb-ed-mode').forEach(function(m) { m.classList.remove('active'); });
        btn.classList.add('active');
      }, {signal: sig});
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

  // ============ MODE E: AI SEMANTIC ============

  var semanticMap = null;
  var semanticGroups = [];

  function activateModeE() {
    // Show loading in inspector
    inspBody.innerHTML = '';
    var loading = mk('div', 'rb-insp-empty');
    loading.textContent = 'AI is mapping this site...';
    inspBody.appendChild(loading);

    // Listen for result
    chrome.runtime.onMessage.addListener(function onSemantic(msg) {
      if (msg.action === 'semanticResult') {
        chrome.runtime.onMessage.removeListener(onSemantic);
        semanticMap = msg.map;
        applySemantic(semanticMap, msg.fromCache);
      }
      if (msg.action === 'semanticError') {
        chrome.runtime.onMessage.removeListener(onSemantic);
        inspBody.innerHTML = '';
        var err = mk('div', 'rb-insp-empty');
        err.textContent = 'AI error: ' + msg.error;
        err.style.color = '#f87171';
        inspBody.appendChild(err);
      }
    });

    // Request analysis from background
    chrome.runtime.sendMessage({ action: 'semanticAnalyze' });
  }

  function applySemantic(map, fromCache) {
    inspBody.innerHTML = '';
    var info = mk('div', 'rb-insp-empty');

    if (!map || !map.sections || !map.sections.length) {
      info.textContent = 'AI mapped 0 sections. Try a different page.';
      inspBody.appendChild(info);
      return;
    }

    info.textContent = 'AI mapped ' + map.sections.length + ' sections.' + (fromCache ? ' (cached)' : '');
    info.style.color = '#22c55e';
    inspBody.appendChild(info);

    // Re-analyze button (force refresh, ignores cache)
    if (fromCache) {
      var reBtn = mk('button', 'rb-insp-inp');
      reBtn.textContent = 'Re-analyze';
      reBtn.style.cssText = 'cursor:pointer;text-align:center;margin-top:4px;width:100%;';
      reBtn.addEventListener('click', function() {
        semanticGroups.forEach(function(g) { g.remove(); });
        semanticGroups = [];
        inspBody.innerHTML = '';
        var loading = mk('div', 'rb-insp-empty');
        loading.textContent = 'Re-analyzing...';
        inspBody.appendChild(loading);
        chrome.runtime.onMessage.addListener(function onRe(msg) {
          if (msg.action === 'semanticResult') {
            chrome.runtime.onMessage.removeListener(onRe);
            semanticMap = msg.map;
            applySemantic(semanticMap, false);
          }
          if (msg.action === 'semanticError') {
            chrome.runtime.onMessage.removeListener(onRe);
            inspBody.innerHTML = '';
            var err = mk('div', 'rb-insp-empty');
            err.textContent = 'Error: ' + msg.error;
            err.style.color = '#f87171';
            inspBody.appendChild(err);
          }
        });
        chrome.runtime.sendMessage({ action: 'semanticAnalyze', forceRefresh: true });
      });
      inspBody.appendChild(reBtn);
    }

    // Highlight sections on the page
    semanticGroups = [];
    map.sections.forEach(function(section) {
      if (!section.bounds) return;
      var b = section.bounds;
      var overlay = mk('div', 'rb-ed-semantic-block');
      overlay.style.cssText = 'position:fixed;top:'+b.y+'px;left:'+b.x+'px;width:'+b.width+'px;height:'+b.height+'px;pointer-events:none;';
      var label = mk('span', 'rb-ed-semantic-label');
      label.textContent = section.type + (section.id ? ' #' + section.id : '');
      overlay.appendChild(label);
      root.appendChild(overlay);
      semanticGroups.push(overlay);

      // Find and mark the real DOM element at this position
      var centerX = b.x + b.width / 2;
      var centerY = b.y + b.height / 2;
      var realEl = document.elementFromPoint(centerX, centerY);
      if (realEl && isValid(realEl)) {
        realEl.setAttribute('data-rb-semantic', section.type);
      }
    });

    // After 3s, fade out overlays — selection works via normal click on marked elements
    setTimeout(function() {
      semanticGroups.forEach(function(g) {
        g.style.opacity = '0';
        g.style.transition = 'opacity 800ms';
      });
      setTimeout(function() {
        semanticGroups.forEach(function(g) { g.remove(); });
        semanticGroups = [];
      }, 800);
    }, 3000);
  }

  function cleanupMode() {
    // Clean Mode E semantic overlays
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
      if (child.id === 'rb-editor-root' || child.id === 'rb-ed-fab' || child.id === 'rb-ed-canvas-wrapper') return;
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

  function onBeforeUnload(e) {
    if (undoStack.length > 0) {
      e.preventDefault();
      e.returnValue = '';
    }
  }
  window.addEventListener('beforeunload', onBeforeUnload);

  // ============ PAUSE/RESUME FAB ============

  var editorPaused = false;

  function buildFab() {
    var fab = mk('div', 'rb-ed-fab');
    fab.id = 'rb-ed-fab';
    fab.innerHTML = '<span class="rb-ed-fab-icon">✏️</span><span class="rb-ed-fab-label">Live Remix</span>';
    fab.style.display = 'none'; // hidden while editor is active
    fab.addEventListener('click', function() {
      resumeEditor();
    });
    // Append to body, not root (so it persists when root is hidden)
    document.body.appendChild(fab);
  }
  buildFab();

  function pauseEditor() {
    editorPaused = true;
    deselectEl();
    root.style.display = 'none';
    document.body.classList.remove('rb-ed-active');
    var fab = document.getElementById('rb-ed-fab');
    if (fab) fab.style.display = 'flex';
  }

  function resumeEditor() {
    editorPaused = false;
    root.style.display = '';
    document.body.classList.add('rb-ed-active');
    var fab = document.getElementById('rb-ed-fab');
    if (fab) fab.style.display = 'none';
  }

  // ============ LAYERS + INSPECTOR ============

  var inspector, inspBody;
  var layersPanel, layersBody;
  var showInertLayers = false;

  // Does this element have its own visual contribution?
  // true = hiding it would have NO visible effect (pure structural wrapper)
  function isVisuallyInert(el) {
    if (!el) return true;
    var tag = el.tagName;
    // Non-div containers are never inert (semantic tags, links, buttons, media)
    if (tag !== 'DIV' && tag !== 'SPAN') return false;
    var cs;
    try { cs = getComputedStyle(el); } catch(e) { return false; }
    // Already hidden = inert
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return true;
    // Has own background color (non-transparent)?
    var bg = cs.backgroundColor;
    if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') return false;
    // Has background image/gradient?
    if (cs.backgroundImage && cs.backgroundImage !== 'none') return false;
    // Has visible border?
    var bw = parseFloat(cs.borderWidth) || 0;
    if (bw > 0 && cs.borderStyle !== 'none') return false;
    // Has box shadow?
    if (cs.boxShadow && cs.boxShadow !== 'none') return false;
    // Has outline?
    var ow = parseFloat(cs.outlineWidth) || 0;
    if (ow > 0 && cs.outlineStyle !== 'none') return false;
    // Has its own text content (not from children)?
    for (var i = 0; i < el.childNodes.length; i++) {
      if (el.childNodes[i].nodeType === 3 && el.childNodes[i].textContent.trim().length > 0) return false;
    }
    // Has overflow clip that crops children (visual effect)?
    if ((cs.overflow === 'hidden' || cs.overflow === 'clip') && (cs.borderRadius && cs.borderRadius !== '0px')) return false;
    return true;
  }

  // Backward compat alias
  function isUselessWrapper(el) {
    return isVisuallyInert(el);
  }

  // Get short label for an element: tag.firstClass
  function elLabel(el) {
    var tag = el.tagName.toLowerCase();
    var cls = '';
    if (el.className && typeof el.className === 'string') {
      var first = el.className.split(' ').filter(function(c) {
        return c.indexOf('rb-') === -1 && c.length < 25;
      })[0];
      if (first) cls = '.' + first;
    }
    return tag + cls;
  }

  // Get visible children of an element (filtered)
  function getVisibleChildren(el) {
    var kids = [];
    for (var i = 0; i < el.children.length; i++) {
      var ch = el.children[i];
      if (SKIP.has(ch.tagName) || isEditorEl(ch)) continue;
      var cr = ch.getBoundingClientRect();
      if (cr.width >= 2 || cr.height >= 2) kids.push(ch);
    }
    return kids;
  }

  function buildLayerRow(el, depth) {
    if (!el || !el.tagName || SKIP.has(el.tagName) || isEditorEl(el)) return null;
    var r = el.getBoundingClientRect();
    if (r.width < 2 && r.height < 2) return null;

    var tag = el.tagName.toLowerCase();
    var isInert = isVisuallyInert(el);

    // Skip inert layers unless "show all" is toggled
    if (isInert && !showInertLayers) {
      // But still render children — skip this wrapper, render its kids at same depth
      var skipContainer = mk('div');
      skipContainer.setAttribute('data-rb-layer-skip', '');
      var vk = getVisibleChildren(el);
      for (var si = 0; si < vk.length; si++) {
        var childRow = buildLayerRow(vk[si], depth);
        if (childRow) skipContainer.appendChild(childRow);
      }
      return skipContainer.children.length > 0 ? skipContainer : null;
    }

    // Collapse chains of single-child wrappers: div.a > div.b > div.c → show as collapsed chain
    var chainLabels = [];
    var chainEnd = el;
    if (isWrapper) {
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
    if (isWrapper) row.classList.add('rb-layer-wrapper');

    if (hasVisibleChildren) {
      var chev = mk('div', 'rb-layer-chev');
      chev.innerHTML = '<svg viewBox="0 0 8 8" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 1l4 3-4 3"/></svg>';
      chev.addEventListener('click', function(e) {
        e.stopPropagation();
        var childContainer = container.querySelector('.rb-layer-children');
        if (!childContainer) return;
        var isOpen = childContainer.classList.contains('rb-layer-expanded');
        if (!isOpen) {
          if (childContainer.children.length === 0) {
            renderLayerChildren(effectiveEl, childContainer, depth + 1);
          }
          childContainer.classList.add('rb-layer-expanded');
          chev.classList.add('rb-layer-open');
        } else {
          childContainer.classList.remove('rb-layer-expanded');
          chev.classList.remove('rb-layer-open');
        }
      });
      row.appendChild(chev);
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

    // Hover → highlight element on page (lock prevents tMove from clearing it)
    row.addEventListener('mouseenter', function() {
      layerHoverLock = true;
      updateHoverBox(el);
    });
    row.addEventListener('mouseleave', function() {
      layerHoverLock = false;
      hoverBox.style.display = 'none';
    });

    // Click → select element
    row.addEventListener('click', function(e) {
      e.stopPropagation();
      selectEl(el);
      selectionDepth = depth;
      selectionAncestor = null;
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
        // If it's a skip container (inert wrapper skipped), append its children directly
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

  function populateLayers() {
    if (!layersBody) return;
    layersBody.innerHTML = '';
    renderLayerChildren(document.body, layersBody, 0);
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

      if (!found && i > 0) {
        // Row doesn't exist — force-render it
        var rowContainer = buildLayerRow(target, i);
        if (rowContainer) {
          currentContainer.appendChild(rowContainer);
          var forceRow = rowContainer.querySelector('.rb-layer-row');
          if (i === chain.length - 1) {
            forceRow.classList.add('rb-layer-selected');
            forceRow.scrollIntoView({block: 'nearest', behavior: 'smooth'});
          } else {
            var forceChild = rowContainer.querySelector('.rb-layer-children');
            if (forceChild) {
              if (forceChild.children.length === 0) {
                renderLayerChildren(target, forceChild, i + 1);
              }
              forceChild.classList.add('rb-layer-expanded');
              var forceChev = forceRow.querySelector('.rb-layer-chev');
              if (forceChev) forceChev.classList.add('rb-layer-open');
              currentContainer = forceChild;
            }
          }
        }
      }
    }
  }

  function buildInspector() {
    inspector = mk('div');
    inspector.id = 'rb-editor-inspector';

    // Header
    var hd = mk('div');
    hd.id = 'rb-ed-insp-header';
    hd.innerHTML = '<div><span class="rb-ed-logo"><i>Repix</i></span>' +
      '<span class="rb-ed-logo-live">Live Remix</span></div>';

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

    expBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      expDD.hidden = !expDD.hidden;
    }, {signal: sig});
    document.addEventListener('click', function() { expDD.hidden = true; }, {signal: sig});

    exportWrap.appendChild(expBtn);
    exportWrap.appendChild(expDD);
    hd.appendChild(exportWrap);

    // Minimize/maximize button
    var minBtn = mk('button', 'rb-ed-minmax-btn');
    minBtn.innerHTML = '<span class="rb-ed-icon-minimize"></span>';
    minBtn.title = 'Minimize panel';
    var isMinimized = false;
    minBtn.addEventListener('click', function() {
      isMinimized = !isMinimized;
      inspector.classList.toggle('rb-ed-minimized', isMinimized);
      minBtn.innerHTML = isMinimized
        ? '<span class="rb-ed-icon-maximize"></span>'
        : '<span class="rb-ed-icon-minimize"></span>';
      minBtn.title = isMinimized ? 'Maximize panel' : 'Minimize panel';
    }, {signal: sig});
    hd.appendChild(minBtn);

    inspector.appendChild(hd);

    // Body
    inspBody = mk('div');
    inspBody.id = 'rb-ed-insp-body';
    showGlobalCSS();
    inspector.appendChild(inspBody);
    root.appendChild(inspector);

    // ---- LAYERS PANEL (left side) ----
    layersPanel = mk('div');
    layersPanel.id = 'rb-editor-layers';

    var layersHd = mk('div');
    layersHd.id = 'rb-ed-layers-header';
    var layersTitle = mk('span');
    layersTitle.textContent = 'Layers';
    layersHd.appendChild(layersTitle);

    // "Show hidden layers" toggle
    var showInertBtn = mk('button', 'rb-layer-toggle-inert');
    showInertBtn.textContent = 'Show all';
    showInertBtn.title = 'Show visually inert layers';
    showInertBtn.addEventListener('click', function() {
      showInertLayers = !showInertLayers;
      showInertBtn.textContent = showInertLayers ? 'Hide inert' : 'Show all';
      populateLayers();
    }, {signal: sig});
    layersHd.appendChild(showInertBtn);

    var layersMinBtn = mk('button', 'rb-ed-minmax-btn');
    layersMinBtn.innerHTML = '<span class="rb-ed-icon-minimize"></span>';
    layersMinBtn.title = 'Minimize layers';
    var layersMinimized = false;
    layersMinBtn.addEventListener('click', function() {
      layersMinimized = !layersMinimized;
      layersPanel.classList.toggle('rb-ed-minimized', layersMinimized);
      layersMinBtn.innerHTML = layersMinimized
        ? '<span class="rb-ed-icon-maximize"></span>'
        : '<span class="rb-ed-icon-minimize"></span>';
    }, {signal: sig});
    layersHd.appendChild(layersMinBtn);

    layersPanel.appendChild(layersHd);

    layersBody = mk('div');
    layersBody.id = 'rb-ed-layers-body';
    layersPanel.appendChild(layersBody);

    root.appendChild(layersPanel);

    populateLayers();
  }

  function showGlobalCSS() {
    inspBody.innerHTML = '';
    var cs = getComputedStyle(document.body);
    var docEl = getComputedStyle(document.documentElement);

    // Page info
    var pageSec = addSection('Page', false);
    addRow(pageSec, 'URL', window.location.hostname);
    addRow(pageSec, 'Title', (document.title || '').slice(0, 30));
    addRow(pageSec, 'Viewport', window.innerWidth + ' × ' + window.innerHeight);
    addRow(pageSec, 'Sheets', document.styleSheets.length + ' stylesheets');

    // Global typography
    var typSec = addSection('Typography', false);
    addRow(typSec, 'Font', cs.fontFamily.split(',')[0].replace(/['"]/g, '').trim());
    addRow(typSec, 'Size', cs.fontSize);
    addRow(typSec, 'Weight', cs.fontWeight);
    addRow(typSec, 'Line H', cs.lineHeight);
    addRow(typSec, 'Color', rgbHex(cs.color) || '#000000');

    // Detect fonts used on the page
    var fontsUsed = new Set();
    document.querySelectorAll('h1,h2,h3,p,a,span,div,li,button').forEach(function(el) {
      if(fontsUsed.size > 8) return;
      var f = getCS(el).fontFamily.split(',')[0].replace(/['"]/g, '').trim();
      if(f) fontsUsed.add(f);
    });
    if(fontsUsed.size > 0) {
      var pills = mk('div', 'rb-insp-pills');
      fontsUsed.forEach(function(f) {
        var p = mk('span', 'rb-insp-pill'); p.textContent = f;
        p.style.fontFamily = f;
        pills.appendChild(p);
      });
      addRow(typSec, 'In use', pills);
    }

    // Colors
    var colSec = addSection('Colors', false);
    var bodyBg = cs.backgroundColor;
    if (!bodyBg || bodyBg === 'rgba(0, 0, 0, 0)' || bodyBg === 'transparent') {
      bodyBg = getComputedStyle(document.documentElement).backgroundColor || '#ffffff';
    }
    var bgHexGlobal = rgbHex(bodyBg) || 'transparent';
    var bgSw = mk('div', 'rb-insp-swatch');
    bgSw.style.background = isTransparent(bodyBg) ? '#fff' : bodyBg;
    bgSw.title = bgHexGlobal;
    addRow(colSec, 'Body BG', bgSw);

    var txtHexGlobal = rgbHex(cs.color) || '#000000';
    var txtSw = mk('div', 'rb-insp-swatch');
    txtSw.style.background = cs.color;
    txtSw.title = txtHexGlobal;
    addRow(colSec, 'Text', txtSw);

    var link = document.querySelector('a');
    if (link) addRow(colSec, 'Links', rgbHex(getComputedStyle(link).color) || '#0000ff');

    // Background — separated into Colors and Images
    var bgSec = addSection('Background', false);

    // Scan all bg colors
    var bgColors = new Set();
    var bgImages = [];
    var bgCandidates = [document.body, document.documentElement];
    document.querySelectorAll('section,header,main,footer,div,article').forEach(function(el) {
      if (isEditorEl(el)) return;
      var r = el.getBoundingClientRect();
      if (r.width < 100 || r.height < 50) return;
      bgCandidates.push(el);
    });
    bgCandidates.forEach(function(el) {
      var elCs = getCS(el);
      var bgC = rgbHex(elCs.backgroundColor);
      if (bgC) bgColors.add(bgC);
      var bgImg = elCs.backgroundImage;
      if (bgImg && bgImg !== 'none') {
        if (!bgImages.some(function(b) { return b.bgImg === bgImg; })) {
          bgImages.push({ el: el, bgImg: bgImg });
        }
      }
    });

    // Colors subsection
    if (bgColors.size > 0) {
      var colRow = mk('div', 'rb-insp-color-row');
      colRow.style.flexWrap = 'wrap';
      colRow.style.gap = '3px';
      bgColors.forEach(function(hex) {
        var sw = mk('div', 'rb-insp-swatch');
        sw.style.background = hex;
        sw.title = hex;
        colRow.appendChild(sw);
      });
      addRow(bgSec, 'Colors', colRow);
    }

    // Images subsection — small swatches that expand on click
    var IMPORT_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>';

    if (bgImages.length > 0) {
      var imgRow = mk('div');
      imgRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;';
      bgImages.forEach(function(item) {
        var thumb = mk('div');
        thumb.style.cssText = 'width:32px;height:32px;border-radius:6px;background-image:'+item.bgImg+';background-size:cover;background-position:center;cursor:pointer;transition:all 150ms;';
        // Click to expand
        thumb.addEventListener('click', function() {
          if (thumb.style.width === '32px') {
            thumb.style.width = '100%';
            thumb.style.height = '80px';
          } else {
            thumb.style.width = '32px';
            thumb.style.height = '32px';
          }
        });
        imgRow.appendChild(thumb);
      });
      // Import button
      var impBtn = mk('button', 'rb-insp-align-btn');
      impBtn.innerHTML = IMPORT_ICON;
      impBtn.title = 'Upload background';
      var impFile = mk('input');
      impFile.type = 'file'; impFile.accept = 'image/*'; impFile.style.display = 'none';
      impBtn.addEventListener('click', function() { impFile.click(); });
      impFile.addEventListener('change', function(e) {
        var f = e.target.files[0]; if (!f) return;
        var reader = new FileReader();
        reader.onload = function() {
          bgImages[0].el.style.backgroundImage = 'url('+reader.result+')';
          bgImages[0].el.style.backgroundSize = 'cover';
        };
        reader.readAsDataURL(f);
      });
      imgRow.appendChild(impFile);
      imgRow.appendChild(impBtn);
      addRow(bgSec, 'Images', imgRow);
    } else {
      var noneRow = mk('div');
      noneRow.style.cssText = 'display:flex;gap:4px;align-items:center;';
      var noneLabel = mk('span', 'rb-insp-val');
      noneLabel.textContent = 'none';
      noneLabel.style.flex = '1';
      var impBtn = mk('button', 'rb-insp-align-btn');
      impBtn.innerHTML = IMPORT_ICON;
      impBtn.title = 'Upload background';
      var impFile = mk('input');
      impFile.type = 'file'; impFile.accept = 'image/*'; impFile.style.display = 'none';
      impBtn.addEventListener('click', function() { impFile.click(); });
      impFile.addEventListener('change', function(e) {
        var f = e.target.files[0]; if (!f) return;
        var reader = new FileReader();
        reader.onload = function() {
          document.body.style.backgroundImage = 'url('+reader.result+')';
          document.body.style.backgroundSize = 'cover';
          noneLabel.textContent = 'uploaded';
        };
        reader.readAsDataURL(f);
      });
      noneRow.appendChild(noneLabel);
      noneRow.appendChild(impFile);
      noneRow.appendChild(impBtn);
      addRow(bgSec, 'Images', noneRow);
    }

    // Advanced (merged: Layout + CSS Variables)
    var advSec = addSection('Advanced', true);
    addRow(advSec, 'Display', cs.display);
    addRow(advSec, 'Box Size', cs.boxSizing);
    addRow(advSec, 'Overflow', cs.overflow);
    addRow(advSec, 'Margin', cs.margin);
    addRow(advSec, 'Padding', cs.padding);

    // CSS Variables inside Advanced
    var vars = [];
    try {
      var sheets = document.styleSheets;
      for (var i = 0; i < sheets.length && vars.length < 10; i++) {
        try {
          var rules = sheets[i].cssRules || [];
          for (var j = 0; j < rules.length && vars.length < 10; j++) {
            if (rules[j].selectorText === ':root' || rules[j].selectorText === ':root, :host') {
              var ruleText = rules[j].cssText;
              var matches = ruleText.match(/--[\w-]+/g);
              if (matches) matches.forEach(function(v) { if (vars.length < 10) vars.push(v); });
            }
          }
        } catch(e) {}
      }
    } catch(e) {}
    if (vars.length > 0) {
      vars.forEach(function(v) {
        var val = docEl.getPropertyValue(v).trim();
        if (val) addRow(advSec, v.replace('--',''), val.slice(0, 20));
      });
    }

    // Hint
    var hint = mk('div', 'rb-insp-empty');
    hint.textContent = 'Click any element to inspect';
    hint.style.paddingTop = '12px';
    hint.style.paddingBottom = '12px';
    inspBody.appendChild(hint);
  }

  // ============ SECTIONS & ROWS ============

  function addSection(title, collapsed) {
    var sec = mk('div', 'rb-insp-sec');
    sec.setAttribute('data-rb-sec', title.toLowerCase());
    if (collapsed) sec.classList.add('collapsed');
    var hd = mk('div', 'rb-insp-sec-hd');
    hd.innerHTML = '<span class="rb-insp-sec-title">' + title + '</span>' +
      '<svg class="rb-insp-sec-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">' +
      '<path d="M6 9l6 6 6-6"/></svg>';
    hd.addEventListener('click', function() { sec.classList.toggle('collapsed'); }, {signal: sig});
    var body = mk('div', 'rb-insp-sec-body');
    sec.appendChild(hd);
    sec.appendChild(body);
    inspBody.appendChild(sec);
    return body;
  }

  function addRow(parent, label, content) {
    var row = mk('div', 'rb-insp-row');
    var lbl = mk('span', 'rb-insp-lbl');
    lbl.textContent = label;
    row.appendChild(lbl);
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

  function addInput(parent, label, value, el, prop) {
    var numVal = parseFloat(value);
    var hasUnit = /px|em|rem|%|pt|vw|vh/.test(String(value));
    var unit = hasUnit ? String(value).replace(/[\d.-]/g, '').trim() || 'px' : '';
    var isNumeric = !isNaN(numVal) && String(value).trim() !== '';

    // Font size gets a dropdown with presets
    if (prop === 'fontSize') {
      var wrap = mk('div');
      wrap.style.cssText = 'display:flex;align-items:center;gap:2px;';
      var sel = mk('select', 'rb-insp-inp');
      var currentPx = Math.round(numVal);
      var hasMatch = false;
      FONT_SIZES.forEach(function(s) {
        var o = mk('option'); o.value = s + 'px'; o.textContent = s;
        if (s === currentPx) { o.selected = true; hasMatch = true; }
        sel.appendChild(o);
      });
      if (!hasMatch) {
        var custom = mk('option'); custom.value = value; custom.textContent = currentPx;
        custom.selected = true;
        sel.insertBefore(custom, sel.firstChild);
      }
      sel.addEventListener('change', function() { applyStyle(el, prop, sel.value); }, {signal: sig});
      wrap.appendChild(sel);
      addRow(parent, label, wrap);
      return sel;
    }

    // Convert value for applying to CSS (opacity % → 0-1)
    var applyVal = function(raw) {
      if (prop === 'opacity') {
        var pct = parseFloat(raw) || 0;
        return String(Math.min(1, Math.max(0, pct / 100)));
      }
      return raw;
    };

    // Numeric values get stepper arrows + drag-to-adjust
    if (isNumeric) {
      var wrap = mk('div');
      wrap.style.cssText = 'display:flex;align-items:center;gap:1px;';
      var inp = mk('input', 'rb-insp-inp');
      inp.type = 'text';
      inp.value = value;
      inp.style.flex = '1';
      inp.addEventListener('change', function() { applyStyle(el, prop, applyVal(inp.value)); }, {signal: sig});

      // Drag-to-adjust: drag handle label to the left of the input
      var dragHandle = mk('div');
      dragHandle.style.cssText = 'cursor:ew-resize;display:flex;align-items:center;padding:0 3px;user-select:none;opacity:0.4;transition:opacity 150ms;';
      dragHandle.innerHTML = '<svg width="8" height="12" viewBox="0 0 8 12" fill="none"><polygon points="0,6 3,3 3,9" fill="currentColor"/><polygon points="8,6 5,3 5,9" fill="currentColor"/></svg>';
      dragHandle.title = 'Drag to adjust';
      dragHandle.addEventListener('mouseenter', function() { dragHandle.style.opacity = '1'; });
      dragHandle.addEventListener('mouseleave', function() { dragHandle.style.opacity = '0.4'; });

      var dragIcon = mk('div');
      dragIcon.style.cssText = 'position:fixed;pointer-events:none;display:none;z-index:999999;';
      dragIcon.innerHTML = '<svg width="16" height="10" viewBox="0 0 16 10" fill="none"><polygon points="0,5 5,1 5,9" fill="#0095FF" stroke="#fff" stroke-width="0.8"/><polygon points="16,5 11,1 11,9" fill="#0095FF" stroke="#fff" stroke-width="0.8"/></svg>';

      dragHandle.addEventListener('mousedown', function(e) {
        e.preventDefault();
        e.stopPropagation();
        var dragStartX = e.clientX;
        var dragStartVal = parseFloat(inp.value) || 0;
        document.body.appendChild(dragIcon);
        dragIcon.style.display = 'block';
        dragIcon.style.left = (e.clientX - 8) + 'px';
        dragIcon.style.top = (e.clientY - 5) + 'px';
        dragHandle.style.opacity = '1';

        var onMove = function(me) {
          var dx = me.clientX - dragStartX;
          var newVal = dragStartVal + Math.round(dx / 2);
          if (prop === 'opacity') newVal = Math.max(0, Math.min(100, newVal));
          inp.value = newVal + unit;
          applyStyle(el, prop, applyVal(inp.value));
          dragIcon.style.left = (me.clientX - 8) + 'px';
          dragIcon.style.top = (me.clientY - 5) + 'px';
        };
        var onUp = function() {
          dragIcon.style.display = 'none';
          if (dragIcon.parentElement) dragIcon.parentElement.removeChild(dragIcon);
          dragHandle.style.opacity = '0.4';
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });

      var btnWrap = mk('div');
      btnWrap.style.cssText = 'display:flex;flex-direction:column;gap:0;';
      var upBtn = mk('button', 'rb-insp-step');
      upBtn.textContent = '▲';
      upBtn.addEventListener('click', function() {
        var n = parseFloat(inp.value) || 0;
        var nv = (n + 1) + unit;
        if (prop === 'opacity') nv = Math.min(100, n + 1) + unit;
        inp.value = nv;
        applyStyle(el, prop, applyVal(inp.value));
      }, {signal: sig});
      var dnBtn = mk('button', 'rb-insp-step');
      dnBtn.textContent = '▼';
      dnBtn.addEventListener('click', function() {
        var n = parseFloat(inp.value) || 0;
        inp.value = Math.max(0, n - 1) + unit;
        applyStyle(el, prop, applyVal(inp.value));
      }, {signal: sig});
      btnWrap.appendChild(upBtn);
      btnWrap.appendChild(dnBtn);
      wrap.appendChild(dragHandle);
      wrap.appendChild(inp);
      wrap.appendChild(btnWrap);
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
    var wrap = mk('div', 'rb-insp-color-row');
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
    txt.style.cursor = 'pointer';
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
    wrap.appendChild(swatch);
    wrap.appendChild(txt);
    addRow(parent, label, wrap);
  }

  // ============ UPDATE INSPECTOR ============

  function updateInspector(el) {
    inspBody.innerHTML = '';
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
    inspBody.appendChild(breadcrumb);

    // ---- POSITION ----
    var posSec = addSection('Position', false);

    // Alignment row (6 Figma-style SVG icons)
    var IC14 = 'width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"';
    var alignRow = mk('div', 'rb-insp-align-row');
    var aligns = [
      // First 3: HORIZONTAL — position div inside its parent
      {svg: '<svg '+IC14+'><line x1="2" y1="2" x2="2" y2="14" stroke-width="2"/><line x1="4" y1="4" x2="13" y2="4"/><line x1="4" y1="8" x2="10" y2="8"/><line x1="4" y1="12" x2="13" y2="12"/></svg>',
       title: 'Align left', fn: function() { var p = el.parentElement; if (!p) return; var pcs = getCS(p); if (pcs.display !== 'flex' && pcs.display !== 'grid') { p.style.display = 'flex'; } p.style.alignItems = 'flex-start'; p.style.justifyContent = pcs.flexDirection === 'column' ? p.style.justifyContent : 'flex-start'; if (pcs.flexDirection === 'column') p.style.alignItems = 'flex-start'; el.style.marginRight = 'auto'; el.style.marginLeft = ''; }},
      {svg: '<svg '+IC14+'><line x1="3" y1="4" x2="13" y2="4"/><line x1="5" y1="8" x2="11" y2="8"/><line x1="3" y1="12" x2="13" y2="12"/><line x1="8" y1="2" x2="8" y2="14" stroke-width="2"/></svg>',
       title: 'Center H', fn: function() { var p = el.parentElement; if (!p) return; var pcs = getCS(p); if (pcs.display !== 'flex' && pcs.display !== 'grid') { p.style.display = 'flex'; } if (pcs.flexDirection === 'column') { p.style.alignItems = 'center'; } else { el.style.marginLeft = 'auto'; el.style.marginRight = 'auto'; } }},
      {svg: '<svg '+IC14+'><line x1="14" y1="2" x2="14" y2="14" stroke-width="2"/><line x1="3" y1="4" x2="12" y2="4"/><line x1="6" y1="8" x2="12" y2="8"/><line x1="3" y1="12" x2="12" y2="12"/></svg>',
       title: 'Align right', fn: function() { var p = el.parentElement; if (!p) return; var pcs = getCS(p); if (pcs.display !== 'flex' && pcs.display !== 'grid') { p.style.display = 'flex'; } if (pcs.flexDirection === 'column') { p.style.alignItems = 'flex-end'; } else { el.style.marginLeft = 'auto'; el.style.marginRight = ''; } }},
      // Last 3: VERTICAL — position div inside its parent
      {svg: '<svg '+IC14+'><line x1="2" y1="2" x2="14" y2="2"/><rect x="5" y="4" width="6" height="3" rx="0.5" fill="currentColor" stroke="none"/><rect x="4" y="9" width="8" height="3" rx="0.5" fill="currentColor" stroke="none" opacity="0.3"/></svg>',
       title: 'Align top', fn: function() { var p = el.parentElement; if (!p) return; var pcs = getCS(p); if (pcs.display !== 'flex' && pcs.display !== 'grid') { p.style.display = 'flex'; p.style.flexDirection = 'column'; } if (pcs.flexDirection === 'column') { p.style.justifyContent = 'flex-start'; } else { p.style.alignItems = 'flex-start'; } }},
      {svg: '<svg '+IC14+'><rect x="5" y="3" width="6" height="3" rx="0.5" fill="currentColor" stroke="none" opacity="0.3"/><line x1="2" y1="8" x2="14" y2="8"/><rect x="4" y="10" width="8" height="3" rx="0.5" fill="currentColor" stroke="none" opacity="0.3"/></svg>',
       title: 'Center V', fn: function() { var p = el.parentElement; if (!p) return; var pcs = getCS(p); if (pcs.display !== 'flex' && pcs.display !== 'grid') { p.style.display = 'flex'; p.style.flexDirection = 'column'; } if (pcs.flexDirection === 'column') { p.style.justifyContent = 'center'; } else { p.style.alignItems = 'center'; } }},
      {svg: '<svg '+IC14+'><rect x="5" y="4" width="6" height="3" rx="0.5" fill="currentColor" stroke="none" opacity="0.3"/><rect x="4" y="9" width="8" height="3" rx="0.5" fill="currentColor" stroke="none"/><line x1="2" y1="14" x2="14" y2="14"/></svg>',
       title: 'Align bottom', fn: function() { var p = el.parentElement; if (!p) return; var pcs = getCS(p); if (pcs.display !== 'flex' && pcs.display !== 'grid') { p.style.display = 'flex'; p.style.flexDirection = 'column'; } if (pcs.flexDirection === 'column') { p.style.justifyContent = 'flex-end'; } else { p.style.alignItems = 'flex-end'; } }}
    ];
    aligns.forEach(function(a, i) {
      var btn = mk('button', 'rb-insp-align-btn');
      btn.innerHTML = a.svg;
      btn.title = a.title;
      btn.addEventListener('click', function() {
        a.fn();
        updateSelBox(el);
        updateSpacingGuides(el);
        alignRow.querySelectorAll('.rb-insp-align-btn').forEach(function(b) { b.classList.remove('active'); });
        btn.classList.add('active');
      });
      if (i === 3) {
        var sep = mk('div');
        sep.style.cssText = 'width:1px;height:16px;background:rgba(255,255,255,0.08);margin:0 2px;';
        alignRow.appendChild(sep);
      }
      alignRow.appendChild(btn);
    });
    addRow(posSec, 'Alignment', alignRow);

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
    posRow.style.cssText = 'display:flex;gap:4px;';
    addRow(posSec, 'Position', posRow);

    // Rotation
    addInput(posSec, 'Rotation', cs.transform === 'none' ? '0\u00B0' : cs.transform, el, 'transform');

    // ---- LAYOUT ----
    var laySec = addSection('Layout', false);

    // Dimensions W x H
    var dimRow = mk('div');
    dimRow.style.cssText = 'display:flex;gap:4px;';
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
    addRow(laySec, 'Dimensions', dimRow);

    // Spacing (T/R/B/L) as visual box
    var spacingRow = mk('div', 'rb-insp-spacing-box');
    var sides = [
      {label: 'T', prop: 'paddingTop'},
      {label: 'R', prop: 'paddingRight'},
      {label: 'B', prop: 'paddingBottom'},
      {label: 'L', prop: 'paddingLeft'}
    ];
    sides.forEach(function(s) {
      var field = mk('div', 'rb-insp-spacing-field');
      field.innerHTML = '<span class="rb-insp-spacing-label">' + s.label + '</span>';
      var inp = mk('input', 'rb-insp-inp');
      inp.value = parseInt(cs[s.prop]) || 0;
      inp.style.width = '36px';
      inp.style.textAlign = 'center';
      inp.addEventListener('change', function() {
        applyStyle(el, s.prop, inp.value + 'px');
      });
      field.appendChild(inp);
      spacingRow.appendChild(field);
    });
    addRow(laySec, 'Spacing', spacingRow);

    // Advanced (collapsed)
    var advSec = addSection('Advanced', true);
    addSelect(advSec, 'Display', ['block','flex','grid','inline','inline-block','none'], cs.display, el, 'display');
    addSelect(advSec, 'Position', ['static','relative','absolute','fixed','sticky'], cs.position, el, 'position');

    // ---- APPEARANCE ----
    var appSec = addSection('Appearance', false);
    addInput(appSec, 'Opacity', Math.round(parseFloat(cs.opacity) * 100) + '%', el, 'opacity');
    addInput(appSec, 'Radius', cs.borderRadius, el, 'borderRadius');

    // ---- TYPOGRAPHY ----
    var typSec = addSection('Typography', false);
    // Font family
    var curFont = cs.fontFamily.split(',')[0].replace(/['"]/g, '').trim();
    var fontSel = mk('select', 'rb-insp-font-sel');
    var fonts = [curFont,'Arial','Helvetica','Verdana','Georgia','Times New Roman','Courier New','system-ui','Roboto','Inter'];
    fonts.forEach(function(f, i) {
      var o = mk('option'); o.value = f; o.textContent = f;
      if (i === 0) o.selected = true;
      fontSel.appendChild(o);
    });
    fontSel.addEventListener('change', function() { applyStyle(el, 'fontFamily', fontSel.value); });
    addRow(typSec, 'Font', fontSel);

    // Weight + Size row
    var wsRow = mk('div');
    wsRow.style.cssText = 'display:flex;gap:4px;';
    var weightSel = mk('select', 'rb-insp-inp');
    ['100','200','300','400','500','600','700','800','900'].forEach(function(w) {
      var o = mk('option'); o.value = w; o.textContent = w;
      if (w === cs.fontWeight) o.selected = true;
      weightSel.appendChild(o);
    });
    weightSel.addEventListener('change', function() { applyStyle(el, 'fontWeight', weightSel.value); });
    weightSel.style.width = '48%';
    var sizeSel = mk('select', 'rb-insp-inp');
    var curSize = Math.round(parseFloat(cs.fontSize)) || 16;
    var sizePresets = [10,11,12,13,14,15,16,20,24,32,36,40,48,64,96,128];
    var hasMatch = false;
    sizePresets.forEach(function(s) {
      var o = mk('option'); o.value = s; o.textContent = s;
      if (s === curSize) { o.selected = true; hasMatch = true; }
      sizeSel.appendChild(o);
    });
    if (!hasMatch) {
      var custom = mk('option'); custom.value = curSize; custom.textContent = curSize;
      custom.selected = true;
      sizeSel.insertBefore(custom, sizeSel.firstChild);
    }
    sizeSel.style.width = '48%';
    sizeSel.addEventListener('change', function() { applyStyle(el, 'fontSize', sizeSel.value + 'px'); });
    wsRow.appendChild(weightSel);
    wsRow.appendChild(sizeSel);
    addRow(typSec, 'Style', wsRow);

    // Line height + Letter spacing — side by side, icons inside fields
    var lhLsRow = mk('div');
    lhLsRow.style.cssText = 'display:flex;gap:6px;';

    // Line height field with icon inside
    var lhWrap = mk('div');
    lhWrap.style.cssText = 'flex:1;display:flex;flex-direction:column;gap:2px;';
    var lhLabel = mk('span', 'rb-insp-label');
    lhLabel.textContent = 'Line height';
    lhLabel.style.cssText = 'font-size:9px;opacity:0.5;';
    var lhField = mk('div');
    lhField.style.cssText = 'display:flex;align-items:center;background:rgba(255,255,255,0.05);border-radius:4px;padding:0 4px;';
    var lhIcon = mk('span');
    lhIcon.innerHTML = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="#EFEEEB" stroke-width="1.5" stroke-linecap="round"><path d="M5 3L8 1L11 3"/><line x1="8" y1="1.5" x2="8" y2="6"/><path d="M5 13L8 15L11 13"/><line x1="8" y1="15" x2="8" y2="10"/><line x1="3" y1="5.5" x2="13" y2="5.5" stroke-width="1" opacity="0.3"/><line x1="3" y1="10.5" x2="13" y2="10.5" stroke-width="1" opacity="0.3"/></svg>';
    lhIcon.style.cssText = 'flex-shrink:0;display:flex;margin-right:4px;';
    var lhInp = mk('input', 'rb-insp-inp');
    lhInp.value = cs.lineHeight === 'normal' ? 'auto' : (Math.round(parseFloat(cs.lineHeight) / parseFloat(cs.fontSize) * 100) + '%');
    lhInp.style.cssText = 'flex:1;background:none;border:none;padding:2px 0;';
    lhInp.addEventListener('change', function() {
      var v = lhInp.value.trim();
      if (v.indexOf('%') !== -1) v = String(parseFloat(v) / 100);
      applyStyle(el, 'lineHeight', v);
    });
    lhField.appendChild(lhIcon);
    lhField.appendChild(lhInp);
    lhWrap.appendChild(lhLabel);
    lhWrap.appendChild(lhField);

    // Letter spacing field with icon inside
    var lsWrap = mk('div');
    lsWrap.style.cssText = 'flex:1;display:flex;flex-direction:column;gap:2px;';
    var lsLabel = mk('span', 'rb-insp-label');
    lsLabel.textContent = 'Letter spacing';
    lsLabel.style.cssText = 'font-size:9px;opacity:0.5;';
    var lsField = mk('div');
    lsField.style.cssText = 'display:flex;align-items:center;background:rgba(255,255,255,0.05);border-radius:4px;padding:0 4px;';
    var lsIcon = mk('span');
    lsIcon.innerHTML = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="#EFEEEB" stroke-width="1.5" stroke-linecap="round"><line x1="1" y1="4" x2="1" y2="12"/><line x1="15" y1="4" x2="15" y2="12"/><path d="M4 8L1.5 8"/><path d="M3 6L1 8L3 10"/><path d="M12 8L14.5 8"/><path d="M13 6L15 8L13 10"/><text x="5.5" y="11" font-size="8" font-weight="600" fill="#EFEEEB" stroke="none" font-family="sans-serif">A</text></svg>';
    lsIcon.style.cssText = 'flex-shrink:0;display:flex;margin-right:4px;';
    var lsInp = mk('input', 'rb-insp-inp');
    var lsRaw = parseFloat(cs.letterSpacing) || 0;
    lsInp.value = (cs.letterSpacing === 'normal') ? '0%' : (Math.round(lsRaw / parseFloat(cs.fontSize) * 100) + '%');
    lsInp.style.cssText = 'flex:1;background:none;border:none;padding:2px 0;';
    lsInp.addEventListener('change', function() {
      var v = lsInp.value.trim();
      if (v.indexOf('%') !== -1) {
        var pct = parseFloat(v) || 0;
        v = (pct / 100 * parseFloat(cs.fontSize)) + 'px';
      }
      applyStyle(el, 'letterSpacing', v);
    });
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
    taSep.style.cssText = 'width:1px;height:16px;background:rgba(255,255,255,0.08);margin:0 2px;';
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
    vertAligns.forEach(function(va) {
      var btn = mk('button', 'rb-insp-align-btn');
      btn.innerHTML = va.svg;
      btn.title = va.title;
      btn.classList.add('rb-ta-v');
      btn.addEventListener('click', function() {
        va.fn();
        taRow.querySelectorAll('.rb-insp-align-btn.rb-ta-v').forEach(function(b) { b.classList.remove('active'); });
        btn.classList.add('active');
      });
      taRow.appendChild(btn);
    });
    addRow(typSec, 'Alignment', taRow);

    // Case (text-transform): none, uppercase, lowercase, capitalize
    var caseRow = mk('div', 'rb-insp-align-row');
    var cases = [
      {svg: '<svg '+IC14+'><line x1="4" y1="12" x2="12" y2="12" stroke-width="2"/></svg>', val: 'none', title: 'None'},
      {svg: '<svg '+IC14+'><text x="2" y="12" font-size="11" font-weight="700" fill="currentColor" stroke="none" font-family="sans-serif">AG</text></svg>', val: 'uppercase', title: 'UPPERCASE'},
      {svg: '<svg '+IC14+'><text x="2" y="12" font-size="11" font-weight="400" fill="currentColor" stroke="none" font-family="sans-serif">ag</text></svg>', val: 'lowercase', title: 'lowercase'},
      {svg: '<svg '+IC14+'><text x="1" y="12" font-size="11" font-weight="400" fill="currentColor" stroke="none" font-family="sans-serif">Ag</text></svg>', val: 'capitalize', title: 'Sentence Case'}
    ];
    cases.forEach(function(c) {
      var btn = mk('button', 'rb-insp-align-btn');
      btn.innerHTML = c.svg;
      btn.title = c.title;
      if (cs.textTransform === c.val) btn.classList.add('active');
      btn.addEventListener('click', function() {
        applyStyle(el, 'textTransform', c.val);
        caseRow.querySelectorAll('.rb-insp-align-btn').forEach(function(b) { b.classList.remove('active'); });
        btn.classList.add('active');
      });
      caseRow.appendChild(btn);
    });
    addRow(typSec, 'Case', caseRow);

    // Decoration (text-decoration): none, underline, line-through
    var decRow = mk('div', 'rb-insp-align-row');
    var decos = [
      {svg: '<svg '+IC14+'><line x1="4" y1="8" x2="12" y2="8" stroke-width="2"/></svg>', val: 'none', title: 'None'},
      {svg: '<svg '+IC14+'><text x="3" y="10" font-size="10" font-weight="600" fill="currentColor" stroke="none" font-family="sans-serif">U</text><line x1="3" y1="13" x2="11" y2="13" stroke-width="1.5"/></svg>', val: 'underline', title: 'Underline'},
      {svg: '<svg '+IC14+'><text x="2" y="11" font-size="11" font-weight="400" fill="currentColor" stroke="none" font-family="sans-serif">S</text><line x1="2" y1="8" x2="12" y2="8" stroke-width="1.5"/></svg>', val: 'line-through', title: 'Strikethrough'}
    ];
    decos.forEach(function(d) {
      var btn = mk('button', 'rb-insp-align-btn');
      btn.innerHTML = d.svg;
      btn.title = d.title;
      if (cs.textDecorationLine === d.val || cs.textDecoration.indexOf(d.val) !== -1) btn.classList.add('active');
      btn.addEventListener('click', function() {
        applyStyle(el, 'textDecoration', d.val);
        decRow.querySelectorAll('.rb-insp-align-btn').forEach(function(b) { b.classList.remove('active'); });
        btn.classList.add('active');
      });
      decRow.appendChild(btn);
    });
    addRow(typSec, 'Decoration', decRow);

    // Text color — show own color, plus scan visible text children
    addColor(typSec, 'Color', cs.color, el, 'color');
    if (el.children.length > 0) {
      var childColors = [];
      el.querySelectorAll('*').forEach(function(child) {
        if (child.closest('svg')) return;
        // Only elements with direct text nodes
        var hasText = false;
        for (var cn = 0; cn < child.childNodes.length; cn++) {
          if (child.childNodes[cn].nodeType === 3 && child.childNodes[cn].textContent.trim().length > 0) { hasText = true; break; }
        }
        if (!hasText) return;
        var cr = child.getBoundingClientRect();
        if (cr.width < 1 || cr.height < 1) return;
        var cc = getCS(child).color;
        var hex = rgbHex(cc);
        if (hex && childColors.indexOf(hex) === -1 && hex !== rgbHex(cs.color)) {
          childColors.push(hex);
        }
      });
      if (childColors.length > 0) {
        var ccRow = mk('div', 'rb-insp-color-row');
        ccRow.style.flexWrap = 'wrap';
        ccRow.style.gap = '3px';
        childColors.forEach(function(hex) {
          var sw = mk('div', 'rb-insp-swatch');
          sw.style.background = hex;
          sw.title = hex;
          sw.style.position = 'relative';
          var cinp = mk('input');
          cinp.type = 'color';
          cinp.value = hex;
          sw.appendChild(cinp);
          ccRow.appendChild(sw);
        });
        addRow(typSec, 'Nested', ccRow);
      }
    }

    // ---- FILL ----
    var fillSec = addSection('Fill', false);
    addColor(fillSec, 'Background', cs.backgroundColor, el, 'backgroundColor');

    // Show current background image as preview swatch
    var currentBgImg = cs.backgroundImage;
    if (currentBgImg && currentBgImg !== 'none') {
      var bgPreviewRow = mk('div');
      bgPreviewRow.style.cssText = 'display:flex;gap:4px;align-items:center;flex-wrap:wrap;';
      var bgThumb = mk('div');
      bgThumb.style.cssText = 'width:32px;height:32px;border-radius:6px;background-image:'+currentBgImg+';background-size:cover;background-position:center;cursor:pointer;transition:all 150ms;border:1px solid rgba(255,255,255,0.15);';
      bgThumb.title = 'Click to expand';
      bgThumb.addEventListener('click', function() {
        if (bgThumb.style.width === '32px') {
          bgThumb.style.width = '100%';
          bgThumb.style.height = '80px';
        } else {
          bgThumb.style.width = '32px';
          bgThumb.style.height = '32px';
        }
      });
      var bgSizeLabel = mk('span', 'rb-insp-val');
      bgSizeLabel.textContent = cs.backgroundSize || 'auto';
      bgSizeLabel.style.flex = '1';
      // Remove bg button
      var rmBgBtn = mk('button', 'rb-insp-align-btn');
      rmBgBtn.innerHTML = '×';
      rmBgBtn.title = 'Remove background image';
      rmBgBtn.addEventListener('click', function() {
        undoStack.push({el: el, prop: 'backgroundImage', old: el.style.backgroundImage});
        el.style.backgroundImage = 'none';
        updateInspector();
      });
      bgPreviewRow.appendChild(bgThumb);
      bgPreviewRow.appendChild(bgSizeLabel);
      bgPreviewRow.appendChild(rmBgBtn);
      addRow(fillSec, 'Image', bgPreviewRow);
    }

    // Background image upload + URL
    var bgUploadRow = mk('div');
    bgUploadRow.style.cssText = 'display:flex;gap:4px;align-items:center;';
    var UPLOAD_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>';
    var bgFileBtn = mk('button', 'rb-insp-align-btn');
    bgFileBtn.innerHTML = UPLOAD_ICON;
    bgFileBtn.title = 'Upload background image';
    var bgFileInp = mk('input');
    bgFileInp.type = 'file';
    bgFileInp.accept = 'image/*';
    bgFileInp.style.display = 'none';
    bgFileBtn.addEventListener('click', function() { bgFileInp.click(); });
    bgFileInp.addEventListener('change', function(e) {
      var file = e.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function() {
        undoStack.push({el: el, prop: 'backgroundImage', old: el.style.backgroundImage});
        el.style.backgroundImage = 'url(' + reader.result + ')';
        el.style.backgroundSize = 'cover';
        el.style.backgroundPosition = 'center';
        updateInspector();
      };
      reader.readAsDataURL(file);
    });

    // URL paste
    var bgUrlInp = mk('input', 'rb-insp-inp');
    bgUrlInp.placeholder = 'Paste image URL';
    bgUrlInp.style.flex = '1';
    bgUrlInp.addEventListener('change', function() {
      var url = bgUrlInp.value.trim();
      if (url) {
        undoStack.push({el: el, prop: 'backgroundImage', old: el.style.backgroundImage});
        el.style.backgroundImage = 'url(' + url + ')';
        el.style.backgroundSize = 'cover';
        el.style.backgroundPosition = 'center';
        updateInspector();
      }
    });
    bgUploadRow.appendChild(bgFileInp);
    bgUploadRow.appendChild(bgUrlInp);
    bgUploadRow.appendChild(bgFileBtn);
    addRow(fillSec, currentBgImg && currentBgImg !== 'none' ? 'Replace' : 'Image', bgUploadRow);

    // ---- STROKE ----
    var strkSec = addSection('Stroke', true);
    addInput(strkSec, 'Width', cs.borderWidth, el, 'borderWidth');
    addSelect(strkSec, 'Style', ['none','solid','dashed','dotted'], cs.borderStyle, el, 'borderStyle');
    addColor(strkSec, 'Color', cs.borderColor, el, 'borderColor');
    addInput(strkSec, 'Radius', cs.borderRadius, el, 'borderRadius');

    // ---- EFFECTS ----
    var fxSec = addSection('Effects', true);
    addInput(fxSec, 'Shadow', cs.boxShadow === 'none' ? '' : cs.boxShadow, el, 'boxShadow');
  }

  // ============ APPLY STYLE ============

  // Properties that should cascade to children when applied to a container
  var CASCADE_PROPS = new Set(['color','fontFamily','fontSize','fontWeight','fontStyle',
    'lineHeight','letterSpacing','textAlign','textTransform','textDecoration']);

  function applyStyle(el, prop, value) {
    var old = el.style[prop] || getCS(el)[prop];
    undoStack.push({el: el, prop: prop, old: old});

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

  // ============ UNDO ============

  function undo() {
    if (!undoStack.length) return;
    var u = undoStack.pop();
    if (u.prop === '__removed') {
      u.parent.insertBefore(u.el, u.next);
    } else if (u.prop === '__move') {
      if (u.next) {
        u.parent.insertBefore(u.el, u.next);
      } else {
        u.parent.appendChild(u.el);
      }
    } else if (u.prop === '__coordswap') {
      u.el.style.top = u.elTop;
      u.el.style.left = u.elLeft;
      u.target.style.top = u.tTop;
      u.target.style.left = u.tLeft;
    } else if (u.prop === '__freemove') {
      u.el.style.top = u.oldTop;
      u.el.style.left = u.oldLeft;
    } else if (u.prop === '__resize') {
      u.el.style.width = u.oldW;
      u.el.style.height = u.oldH;
      u.el.style.marginLeft = u.oldML;
      u.el.style.marginTop = u.oldMT || '';
      u.el.style.transform = '';
      if (u.unlocked) {
        u.unlocked.forEach(function(item) {
          if (item.prop === '__parentOverflow') {
            item.el.style.overflow = item.old || '';
          } else {
            u.el.style[item.prop] = item.old || '';
          }
        });
      }
    } else if (u.prop === '__src') {
      u.el.src = u.old;
    } else {
      u.el.style[u.prop] = u.old || '';
    }
    if (selectedEl) {
      updateSelBox(selectedEl);
      updateInspector(selectedEl);
    }
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

  function enterTextEdit(el) {
    el.contentEditable = 'true';
    el.setAttribute('data-rb-editing', '');
    el.classList.remove('rb-ed-movable');
    selBox.style.display = 'none';
    isTextEditing = true;
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
        undoStack.push({ el: targetEl, prop: prop, old: dragStartValue + 'px' });
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
        undoStack.push({el: img, prop: '__src', old: img.src});
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

      undoStack.push({
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

      undoStack.push({ el: el, prop: '__move', parent: oldParent, next: oldNext });

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
    var layerHoverLock = false; // true when hovering a layer row — prevents tMove from clearing hoverBox

    var tMove = throttle(function(e) {
      if (isDragging) return;
      if (layerHoverLock) return;
      var rawEl = document.elementFromPoint(e.clientX, e.clientY);
      if (!rawEl || !isValid(rawEl)) {
        if (lastHoverEl) { lastHoverEl.classList.remove('rb-ed-text-hint'); lastHoverEl = null; }
        hoverBox.style.display = 'none';
        return;
      }
      var el = resolveContainer(rawEl);
      if (!isValid(el) || el === selectedEl) { hoverBox.style.display = 'none'; return; }
      if (lastHoverEl && lastHoverEl !== el) lastHoverEl.classList.remove('rb-ed-text-hint');
      lastHoverEl = el;
      if (isText(el)) el.classList.add('rb-ed-text-hint');
      updateHoverBox(el);
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

      // Already in text edit mode — let browser handle
      if (selectedEl && selectedEl.contentEditable === 'true') {
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
          if (isText(deeper) && deeper.children.length === 0) {
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
          undoStack.push({
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
      // Ctrl/Cmd+Shift+E = toggle pause/resume
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'E') {
        e.preventDefault();
        if (editorPaused) resumeEditor(); else pauseEditor();
        return;
      }
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
        e.preventDefault();
        e.stopPropagation();
        undo();
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedEl && selectedEl.contentEditable !== 'true') {
          e.preventDefault();
          var parent = selectedEl.parentElement;
          var next = selectedEl.nextElementSibling;
          undoStack.push({el: selectedEl, prop: '__removed', parent: parent, next: next});
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
          undoStack.push({
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
    var fab = document.getElementById('rb-ed-fab');
    if (fab) fab.remove();
    var hk = document.getElementById('rb-hover-kill');
    if (hk) hk.remove();

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
