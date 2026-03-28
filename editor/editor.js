(function() {
  if (window.__rbEditorActive) { deactivate(); return; }
  window.__rbEditorActive = true;

  var ac = new AbortController(), sig = ac.signal;
  var selectedEl = null, lastHoverEl = null, isDragging = false;
  var undoStack = [];
  var isMac = /Mac/.test(navigator.platform);
  var modKey = isMac ? '\u2318' : 'Ctrl';
  var ftueShown = {};
  try { ftueShown = JSON.parse(localStorage.getItem('rb-ftue') || '{}'); } catch(e) {}

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
    nw: {top:'-3px',left:'-3px'},
    n:  {top:'-3px',left:'50%',marginLeft:'-3px'},
    ne: {top:'-3px',right:'-3px'},
    e:  {top:'50%',right:'-3px',marginTop:'-3px'},
    se: {bottom:'-3px',right:'-3px'},
    s:  {bottom:'-3px',left:'50%',marginLeft:'-3px'},
    sw: {bottom:'-3px',left:'-3px'},
    w:  {top:'50%',left:'-3px',marginTop:'-3px'}
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

  // Build UI components
  buildBanner();
  buildInspector();
  listen();

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
      n = n.parentElement;
    }
    return false;
  }

  function isValid(el) {
    return el && !SKIP.has(el.tagName) && !isEditorEl(el);
  }

  function isText(el) {
    if (!el) return false;
    var nonText = ['IMG','VIDEO','IFRAME','CANVAS','SVG','INPUT','SELECT','TEXTAREA','BUTTON'];
    if (nonText.indexOf(el.tagName) !== -1) return false;
    var txt = '';
    for (var i = 0; i < el.childNodes.length; i++) {
      if (el.childNodes[i].nodeType === 3) txt += el.childNodes[i].textContent;
    }
    return txt.trim().length > 3;
  }

  function px(v) { return parseFloat(v) || 0; }

  function rgbHex(s) {
    if (!s || s === 'transparent') return '#000000';
    var m = s.match(/\d+/g);
    if (!m || m.length < 3) return '#000000';
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

  // ============ BANNER ============

  function buildBanner() {
    var b = mk('div');
    b.id = 'rb-ed-banner';
    b.innerHTML = 'Live Remix \u2014 click any element to edit';
    var x = mk('button');
    x.id = 'rb-ed-banner-close';
    x.innerHTML = CLOSE;
    x.addEventListener('click', deactivate, {signal: sig});
    b.appendChild(x);
    root.appendChild(b);
  }

  // ============ INSPECTOR ============

  var inspector, inspBody;

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
    inspector.appendChild(hd);

    // Body
    inspBody = mk('div');
    inspBody.id = 'rb-ed-insp-body';
    var empty = mk('div', 'rb-insp-empty');
    empty.textContent = 'Select an element';
    inspBody.appendChild(empty);
    inspector.appendChild(inspBody);
    root.appendChild(inspector);
  }

  // ============ SECTIONS & ROWS ============

  function addSection(title, collapsed) {
    var sec = mk('div', 'rb-insp-sec');
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

  function addInput(parent, label, value, el, prop) {
    var inp = mk('input', 'rb-insp-inp');
    inp.type = 'text';
    inp.value = value;
    inp.addEventListener('change', function() {
      applyStyle(el, prop, inp.value);
    }, {signal: sig});
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
    swatch.style.background = value;
    var cinp = mk('input');
    cinp.type = 'color';
    cinp.value = rgbHex(value);
    var txt = mk('span', 'rb-insp-val');
    txt.textContent = rgbHex(value);
    cinp.addEventListener('input', function() {
      swatch.style.background = cinp.value;
      txt.textContent = cinp.value;
      applyStyle(el, prop, cinp.value);
    }, {signal: sig});
    swatch.appendChild(cinp);
    wrap.appendChild(swatch);
    wrap.appendChild(txt);
    addRow(parent, label, wrap);
  }

  // ============ UPDATE INSPECTOR ============

  function updateInspector(el) {
    inspBody.innerHTML = '';
    var cs = getComputedStyle(el);
    var r = getBox(el);

    // Element section
    var elSec = addSection('Element', false);
    addRow(elSec, 'Tag', el.tagName.toLowerCase() + (el.id ? '#' + el.id : ''));
    if (el.classList.length) {
      var pills = mk('div', 'rb-insp-pills');
      Array.from(el.classList).filter(function(c) {
        return c.indexOf('rb-') === -1;
      }).forEach(function(c) {
        var p = mk('span', 'rb-insp-pill');
        p.textContent = '.' + c;
        pills.appendChild(p);
      });
      addRow(elSec, 'Class', pills);
    }
    addInput(elSec, 'Width', Math.round(r.width) + 'px', el, 'width');
    addInput(elSec, 'Height', Math.round(r.height) + 'px', el, 'height');

    // Layout section
    var laySec = addSection('Layout', false);
    addSelect(laySec, 'Display',
      ['block','flex','grid','inline','inline-block','none'], cs.display, el, 'display');
    addSelect(laySec, 'Position',
      ['static','relative','absolute','fixed','sticky'], cs.position, el, 'position');

    // Box model
    var bm = mk('div', 'rb-insp-boxmodel');
    var marginKeys = ['marginTop','marginRight','marginBottom','marginLeft'];
    var paddingKeys = ['paddingTop','paddingRight','paddingBottom','paddingLeft'];
    var bmLabels = {
      marginTop: 'mt', marginRight: 'mr', marginBottom: 'mb', marginLeft: 'ml',
      paddingTop: 'pt', paddingRight: 'pr', paddingBottom: 'pb', paddingLeft: 'pl'
    };

    marginKeys.forEach(function(key) {
      var val = px(cs[key]);
      var l = mk('span', 'rb-insp-bm-lbl');
      l.dataset.s = bmLabels[key];
      l.textContent = val;
      l.addEventListener('click', function() {
        l.textContent = '';
        var inp = mk('input', 'rb-insp-inp');
        inp.type = 'text';
        inp.value = val;
        inp.style.width = '30px';
        inp.style.textAlign = 'center';
        l.appendChild(inp);
        inp.focus();
        inp.addEventListener('blur', function() {
          applyStyle(el, key, inp.value + 'px');
          l.textContent = inp.value;
        });
      });
      bm.appendChild(l);
    });

    var inner = mk('div', 'rb-insp-bm-inner');
    paddingKeys.forEach(function(key) {
      var val = px(cs[key]);
      var l = mk('span', 'rb-insp-bm-lbl');
      l.dataset.s = bmLabels[key];
      l.textContent = val;
      l.addEventListener('click', function() {
        l.textContent = '';
        var inp = mk('input', 'rb-insp-inp');
        inp.type = 'text';
        inp.value = val;
        inp.style.width = '30px';
        inp.style.textAlign = 'center';
        l.appendChild(inp);
        inp.focus();
        inp.addEventListener('blur', function() {
          applyStyle(el, key, inp.value + 'px');
          l.textContent = inp.value;
        });
      });
      inner.appendChild(l);
    });

    var core = mk('div', 'rb-insp-bm-core');
    core.textContent = Math.round(r.width) + ' \u00d7 ' + Math.round(r.height);
    inner.appendChild(core);
    bm.appendChild(inner);
    laySec.appendChild(bm);

    // Typography section
    var typSec = addSection('Typography', false);
    var fontWrap = mk('div');
    var fontSel = mk('select', 'rb-insp-font-sel');
    var curFont = cs.fontFamily.split(',')[0].replace(/['"]/g, '').trim();
    var fonts = [curFont,'Arial','Helvetica','Verdana','Georgia',
      'Times New Roman','Courier New','system-ui','Roboto','Inter','SF Pro Display'];
    fonts.forEach(function(f, i) {
      var o = mk('option');
      o.value = f;
      o.textContent = f;
      if (i === 0) o.selected = true;
      fontSel.appendChild(o);
    });
    fontSel.addEventListener('change', function() {
      applyStyle(el, 'fontFamily', fontSel.value);
    }, {signal: sig});
    fontWrap.appendChild(fontSel);

    var globalBtn = mk('button', 'rb-insp-font-global');
    globalBtn.textContent = 'Apply to entire page';
    globalBtn.addEventListener('click', function() {
      var s = document.getElementById('rb-editor-styles') || (function() {
        var st = mk('style');
        st.id = 'rb-editor-styles';
        document.head.appendChild(st);
        return st;
      })();
      s.textContent += '\n* { font-family: ' + fontSel.value + ' !important; }';
      globalBtn.textContent = 'Applied!';
      setTimeout(function() { globalBtn.textContent = 'Apply to entire page'; }, 2000);
    }, {signal: sig});
    fontWrap.appendChild(globalBtn);
    addRow(typSec, 'Family', fontWrap);

    addInput(typSec, 'Size', cs.fontSize, el, 'fontSize');
    addSelect(typSec, 'Weight',
      ['100','200','300','400','500','600','700','800','900'], cs.fontWeight, el, 'fontWeight');
    addInput(typSec, 'Line H', cs.lineHeight, el, 'lineHeight');
    addInput(typSec, 'Spacing', cs.letterSpacing, el, 'letterSpacing');
    addColor(typSec, 'Color', cs.color, el, 'color');

    // Fill section
    var fillSec = addSection('Fill', false);
    addColor(fillSec, 'Background', cs.backgroundColor, el, 'backgroundColor');
    addInput(fillSec, 'Opacity', cs.opacity, el, 'opacity');

    // Border section
    var brdSec = addSection('Border', true);
    addInput(brdSec, 'Width', cs.borderWidth, el, 'borderWidth');
    addSelect(brdSec, 'Style',
      ['none','solid','dashed','dotted','double'], cs.borderStyle, el, 'borderStyle');
    addColor(brdSec, 'Color', cs.borderColor, el, 'borderColor');
    addInput(brdSec, 'Radius', cs.borderRadius, el, 'borderRadius');

    // Effects section
    var fxSec = addSection('Effects', true);
    addInput(fxSec, 'Shadow', cs.boxShadow === 'none' ? '' : cs.boxShadow, el, 'boxShadow');
    addInput(fxSec, 'Transform', cs.transform === 'none' ? '' : cs.transform, el, 'transform');

    // Spacing section
    var spSec = addSection('Spacing', true);
    var spRow = mk('div', 'rb-insp-row');
    var spLbl = mk('span', 'rb-insp-lbl');
    spLbl.textContent = 'Guides';
    var spBtn = mk('button', 'rb-insp-inp');
    spBtn.textContent = 'Show';
    spBtn.style.cursor = 'pointer';
    spBtn.style.textAlign = 'center';
    spBtn.addEventListener('click', function() {
      var on = spBtn.textContent === 'Show';
      spBtn.textContent = on ? 'Hide' : 'Show';
      if (on) showSpacingGuides(el);
      else hideSpacingGuides();
    }, {signal: sig});
    spRow.appendChild(spLbl);
    spRow.appendChild(spBtn);
    spSec.appendChild(spRow);
  }

  // ============ APPLY STYLE ============

  function applyStyle(el, prop, value) {
    var cssProp = prop.replace(/([A-Z])/g, '-$1').toLowerCase();
    var old = el.style[prop] || getComputedStyle(el)[prop];
    undoStack.push({el: el, prop: prop, old: old});

    var classes = Array.from(el.classList).filter(function(c) {
      return c.indexOf('rb-') === -1 && c.length > 1;
    });
    if (classes.length > 0) {
      var s = document.getElementById('rb-editor-styles') || (function() {
        var st = mk('style');
        st.id = 'rb-editor-styles';
        document.head.appendChild(st);
        return st;
      })();
      s.textContent += '\n.' + classes[0] + ' { ' + cssProp + ': ' + value + ' !important; }';
    } else {
      el.style[prop] = value;
    }

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
      // Undo move: put element back in original position
      if (u.next) {
        u.parent.insertBefore(u.el, u.next);
      } else {
        u.parent.appendChild(u.el);
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

  // ============ SELECT / DESELECT ============

  function selectEl(el) {
    if (selectedEl && selectedEl !== el) {
      selectedEl.contentEditable = 'false';
      selectedEl.removeAttribute('data-rb-editing');
      selectedEl.classList.remove('rb-ed-movable');
    }
    selectedEl = el;
    updateSelBox(el);
    updateParentBox(el);
    updateInspector(el);

    // Lock scroll
    document.body.style.overflow = 'hidden';
    var lock = document.getElementById('rb-ed-lock');
    if (!lock) {
      lock = mk('div', 'rb-ed-lock');
      lock.id = 'rb-ed-lock';
      lock.textContent = 'Scroll locked during edit';
      root.appendChild(lock);
      setTimeout(function() { if (lock.parentNode) lock.remove(); }, 3000);
    }

    el.classList.add('rb-ed-movable');

    if (isText(el)) {
      el.contentEditable = 'true';
      el.setAttribute('data-rb-editing', '');
      el.focus();
      var box = getBox(el);
      showFtue('undo', 'Press <kbd>' + modKey + '+Z</kbd> to undo', box.left, box.top);
    }
  }

  function deselectEl() {
    if (selectedEl) {
      selectedEl.contentEditable = 'false';
      selectedEl.removeAttribute('data-rb-editing');
      selectedEl.classList.remove('rb-ed-movable');
    }
    selectedEl = null;
    selBox.style.display = 'none';
    parentBox.style.display = 'none';
    document.body.style.overflow = '';
    var lock = document.getElementById('rb-ed-lock');
    if (lock) lock.remove();
    hideSpacingGuides();
    inspBody.innerHTML = '';
    var empty = mk('div', 'rb-insp-empty');
    empty.textContent = 'Select an element';
    inspBody.appendChild(empty);
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
    selLabel.textContent = tag + cls + '  ' + Math.round(r.width) + '\u00d7' + Math.round(r.height);
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

  var gapEls = [];

  function showSpacingGuides(el) {
    hideSpacingGuides();
    var cs = getComputedStyle(el);
    var r = getBox(el);

    var margins = {
      top: px(cs.marginTop), right: px(cs.marginRight),
      bottom: px(cs.marginBottom), left: px(cs.marginLeft)
    };
    var pads = {
      top: px(cs.paddingTop), right: px(cs.paddingRight),
      bottom: px(cs.paddingBottom), left: px(cs.paddingLeft)
    };

    // Margin guides
    if (margins.top > 0) addGap(r.top - margins.top, r.left, r.width, margins.top, 1);
    if (margins.bottom > 0) addGap(r.bottom, r.left, r.width, margins.bottom, 1);
    if (margins.left > 0) addGap(r.top, r.left - margins.left, margins.left, r.height, 1);
    if (margins.right > 0) addGap(r.top, r.right, margins.right, r.height, 1);

    // Padding guides
    if (pads.top > 0) addGap(r.top, r.left, r.width, pads.top, 0.6);
    if (pads.bottom > 0) addGap(r.bottom - pads.bottom, r.left, r.width, pads.bottom, 0.6);
    if (pads.left > 0) addGap(r.top, r.left, pads.left, r.height, 0.6);
    if (pads.right > 0) addGap(r.top, r.right - pads.right, pads.right, r.height, 0.6);
  }

  function addGap(top, left, width, height, opacity) {
    var g = mk('div', 'rb-ed-gap');
    Object.assign(g.style, {
      top: top + 'px', left: left + 'px',
      width: width + 'px', height: height + 'px'
    });
    if (opacity !== 1) g.style.opacity = String(opacity);
    root.appendChild(g);
    gapEls.push(g);
  }

  function hideSpacingGuides() {
    gapEls.forEach(function(g) { g.remove(); });
    gapEls = [];
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
      var a = mk('a');
      a.href = img.src;
      a.download = 'image.png';
      a.click();
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
    dragGhost.style.background = getComputedStyle(el).backgroundColor || 'rgba(147,197,253,0.1)';
    dragGhost.style.borderRadius = getComputedStyle(el).borderRadius || '4px';
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

  function handleMove(el, e) {
    var parent = el.parentElement;
    if (!parent) return;

    updateDragGhost(e.clientX, e.clientY);

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
        // Determine if before or after based on cursor position relative to center
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
      // Only show indicator, don't swap yet
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

    var parent = el.parentElement;
    var oldNext = el.nextElementSibling;
    var oldParent = parent;

    // Save undo state
    undoStack.push({ el: el, prop: '__move', parent: oldParent, next: oldNext });

    // Perform the swap
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

    // Snap animation on the dropped element
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
    // Hover
    var tMove = throttle(function(e) {
      if (isDragging) return;
      var el = document.elementFromPoint(e.clientX, e.clientY);
      if (!el || !isValid(el) || el === selectedEl) {
        if (lastHoverEl) {
          lastHoverEl.classList.remove('rb-ed-text-hint');
          lastHoverEl = null;
        }
        hoverBox.style.display = 'none';
        return;
      }
      if (lastHoverEl && lastHoverEl !== el) {
        lastHoverEl.classList.remove('rb-ed-text-hint');
      }
      lastHoverEl = el;
      if (isText(el)) el.classList.add('rb-ed-text-hint');
      updateHoverBox(el);
    }, 16);
    document.addEventListener('mousemove', tMove, {signal: sig, capture: true});

    // Click
    document.addEventListener('click', function(e) {
      var link = e.target.closest('a');
      if (link && !isEditorEl(link)) {
        e.preventDefault();
        e.stopPropagation();
      }

      var el = document.elementFromPoint(e.clientX, e.clientY);
      if (!el || isEditorEl(el)) return;
      if (!isValid(el)) return;

      e.preventDefault();
      e.stopPropagation();
      removeImgMenu();

      if (el.tagName === 'IMG') {
        showImgMenu(el, e.clientX, e.clientY);
        selectEl(el);
        return;
      }

      selectEl(el);
    }, {signal: sig, capture: true});

    // Drag (move elements — Figma-style with ghost + drop indicator)
    var dragStart = null;
    var dragThreshold = false;
    document.addEventListener('mousedown', function(e) {
      if (!selectedEl || isEditorEl(e.target)) return;
      var el = document.elementFromPoint(e.clientX, e.clientY);
      if (el !== selectedEl) return;
      if (selectedEl.contentEditable === 'true') return;
      dragStart = {x: e.clientX, y: e.clientY};
      dragThreshold = false;
    }, {signal: sig});

    document.addEventListener('mousemove', function(e) {
      if (!dragStart || !selectedEl) return;
      var dx = e.clientX - dragStart.x;
      var dy = e.clientY - dragStart.y;
      // Start drag after 5px threshold
      if (!dragThreshold) {
        if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
          dragThreshold = true;
          isDragging = true;
          document.body.classList.add('rb-ed-dragging');
          createDragGhost(selectedEl);
          selBox.style.display = 'none';
        }
        return;
      }
      handleMove(selectedEl, e);
    }, {signal: sig});

    document.addEventListener('mouseup', function() {
      if (isDragging && selectedEl) {
        commitDrop(selectedEl);
        isDragging = false;
        document.body.classList.remove('rb-ed-dragging');
      }
      dragStart = null;
      dragThreshold = false;
    }, {signal: sig});

    // Keyboard
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') { deselectEl(); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
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
      }
    }, 16);
    window.addEventListener('scroll', tScroll, {signal: sig, capture: true});
    window.addEventListener('resize', tScroll, {signal: sig});

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

        function onM(ev) {
          var dx = ev.clientX - sx, dy = ev.clientY - sy;
          var w = origW, h = origH;
          if (dir.indexOf('e') !== -1) w += dx;
          if (dir.indexOf('w') !== -1) w -= dx;
          if (dir.indexOf('s') !== -1) h += dy;
          if (dir.indexOf('n') !== -1) h -= dy;
          selectedEl.style.width = Math.max(20, w) + 'px';
          selectedEl.style.height = Math.max(20, h) + 'px';
          updateSelBox(selectedEl);
        }

        function onU() {
          document.removeEventListener('mousemove', onM);
          document.removeEventListener('mouseup', onU);
          undoStack.push({el: selectedEl, prop: 'width', old: origW + 'px'});
        }

        document.addEventListener('mousemove', onM);
        document.addEventListener('mouseup', onU);
      }, {signal: sig});
    });

    // Editor attention (from background.js)
    chrome.runtime.onMessage.addListener(function(msg, sender, sendResponse) {
      if (msg.action === 'editorAttention') {
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
    window.__rbEditorActive = false;
    ac.abort();
    root.remove();
    document.body.classList.remove('rb-ed-active', 'rb-ed-dragging');
    document.body.style.overflow = '';
    document.body.style.paddingTop = '';

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
