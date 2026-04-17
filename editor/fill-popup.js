// Fill Popup — Color / Gradient / Image / Effects  +  Image Popup (separate) + Color-only Popup
// Exposes: window.__rbFillPopup.open(...)  window.__rbFillPopup.openImage(...)  window.__rbFillPopup.openColorOnly(...)
(function() {
  'use strict';
  if (window.__rbFillPopup) return;

  // ── Helpers ──
  function mk(tag, cls) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    return e;
  }

  // ── Color conversions ──
  function hexToRgb(hex) {
    hex = hex.replace('#', '');
    if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
    var n = parseInt(hex, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  function rgbToHex(r, g, b) {
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  }
  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    var h, s, l = (max + min) / 2;
    if (max === min) { h = s = 0; }
    else {
      var d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
        case g: h = ((b - r) / d + 2) / 6; break;
        case b: h = ((r - g) / d + 4) / 6; break;
      }
    }
    return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
  }
  function rgbToHsb(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    var h, s, v = max;
    var d = max - min;
    s = max === 0 ? 0 : d / max;
    if (max === min) { h = 0; }
    else {
      switch (max) {
        case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
        case g: h = ((b - r) / d + 2) / 6; break;
        case b: h = ((r - g) / d + 4) / 6; break;
      }
    }
    return { h: Math.round(h * 360), s: Math.round(s * 100), b: Math.round(v * 100) };
  }
  function hsbToRgb(h, s, b) {
    h = h / 360; s = s / 100; b = b / 100;
    var r, g, bl;
    var i = Math.floor(h * 6);
    var f = h * 6 - i;
    var p = b * (1 - s);
    var q = b * (1 - f * s);
    var t = b * (1 - (1 - f) * s);
    switch (i % 6) {
      case 0: r = b; g = t; bl = p; break;
      case 1: r = q; g = b; bl = p; break;
      case 2: r = p; g = b; bl = t; break;
      case 3: r = p; g = q; bl = b; break;
      case 4: r = t; g = p; bl = b; break;
      case 5: r = b; g = p; bl = q; break;
    }
    return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(bl * 255) };
  }
  function displayForFormat(hex, alpha, format) {
    var rgb = hexToRgb(hex);
    switch (format) {
      case 'HEX': return hex.toUpperCase();
      case 'RGB': return rgb.r + ', ' + rgb.g + ', ' + rgb.b;
      case 'HSL': { var hsl = rgbToHsl(rgb.r, rgb.g, rgb.b); return hsl.h + '°, ' + hsl.s + '%, ' + hsl.l + '%'; }
      case 'HSB': { var hsb = rgbToHsb(rgb.r, rgb.g, rgb.b); return hsb.h + '°, ' + hsb.s + '%, ' + hsb.b + '%'; }
      case 'CSS': return hex.toUpperCase();
      default: return hex;
    }
  }

  // ── Canvas Color Picker ──
  function buildCanvasPicker(panel, currentHex, currentAlpha, colorFormat, onColorChange) {
    var hsb = (function() {
      var rgb = hexToRgb(currentHex);
      return rgbToHsb(rgb.r, rgb.g, rgb.b);
    })();
    var hue = hsb.h, sat = hsb.s, bri = hsb.b, alpha = currentAlpha;

    // Saturation/Brightness box
    var boxWrap = mk('div', 'rb-fill-box-wrap');
    var boxCanvas = document.createElement('canvas');
    boxCanvas.className = 'rb-fill-box-canvas';
    boxCanvas.width = 232; boxCanvas.height = 160;
    boxWrap.appendChild(boxCanvas);
    var boxHandle = mk('div', 'rb-fill-box-handle');
    boxWrap.appendChild(boxHandle);
    panel.appendChild(boxWrap);

    // Hue slider
    var hueWrap = mk('div', 'rb-fill-slider-wrap');
    var hueCanvas = document.createElement('canvas');
    hueCanvas.className = 'rb-fill-slider-canvas';
    hueCanvas.width = 232; hueCanvas.height = 14;
    hueWrap.appendChild(hueCanvas);
    var hueHandle = mk('div', 'rb-fill-slider-handle');
    hueWrap.appendChild(hueHandle);
    panel.appendChild(hueWrap);

    // Alpha slider
    var alphaWrap = mk('div', 'rb-fill-slider-wrap');
    var alphaCanvas = document.createElement('canvas');
    alphaCanvas.className = 'rb-fill-slider-canvas';
    alphaCanvas.width = 232; alphaCanvas.height = 14;
    alphaWrap.appendChild(alphaCanvas);
    var alphaHandle = mk('div', 'rb-fill-slider-handle');
    alphaWrap.appendChild(alphaHandle);
    panel.appendChild(alphaWrap);

    // Draw functions
    function drawBox() {
      var ctx = boxCanvas.getContext('2d');
      var w = boxCanvas.width, h = boxCanvas.height;
      // Base hue color
      var hueRgb = hsbToRgb(hue, 100, 100);
      ctx.fillStyle = 'rgb(' + hueRgb.r + ',' + hueRgb.g + ',' + hueRgb.b + ')';
      ctx.fillRect(0, 0, w, h);
      // White gradient (left to right)
      var whiteGrad = ctx.createLinearGradient(0, 0, w, 0);
      whiteGrad.addColorStop(0, 'rgba(255,255,255,1)');
      whiteGrad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = whiteGrad;
      ctx.fillRect(0, 0, w, h);
      // Black gradient (top to bottom)
      var blackGrad = ctx.createLinearGradient(0, 0, 0, h);
      blackGrad.addColorStop(0, 'rgba(0,0,0,0)');
      blackGrad.addColorStop(1, 'rgba(0,0,0,1)');
      ctx.fillStyle = blackGrad;
      ctx.fillRect(0, 0, w, h);
      // Position handle
      boxHandle.style.left = (sat / 100 * w) + 'px';
      boxHandle.style.top = ((100 - bri) / 100 * h) + 'px';
    }

    function drawHue() {
      var ctx = hueCanvas.getContext('2d');
      var w = hueCanvas.width, h = hueCanvas.height;
      var grad = ctx.createLinearGradient(0, 0, w, 0);
      for (var i = 0; i <= 6; i++) {
        grad.addColorStop(i / 6, 'hsl(' + (i * 60) + ',100%,50%)');
      }
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.roundRect(0, 0, w, h, 7);
      ctx.fill();
      hueHandle.style.left = (hue / 360 * w) + 'px';
    }

    function drawAlpha() {
      var ctx = alphaCanvas.getContext('2d');
      var w = alphaCanvas.width, h = alphaCanvas.height;
      // Checkerboard
      ctx.clearRect(0, 0, w, h);
      var sz = 5;
      for (var x = 0; x < w; x += sz) {
        for (var y = 0; y < h; y += sz) {
          ctx.fillStyle = ((x / sz + y / sz) % 2 === 0) ? '#ccc' : '#fff';
          ctx.fillRect(x, y, sz, sz);
        }
      }
      // Clip to rounded rect
      ctx.save();
      ctx.globalCompositeOperation = 'destination-in';
      ctx.beginPath();
      ctx.roundRect(0, 0, w, h, 7);
      ctx.fill();
      ctx.restore();
      // Color gradient overlay
      var rgb = hsbToRgb(hue, sat, bri);
      var grad = ctx.createLinearGradient(0, 0, w, 0);
      grad.addColorStop(0, 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',0)');
      grad.addColorStop(1, 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',1)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.roundRect(0, 0, w, h, 7);
      ctx.fill();
      alphaHandle.style.left = (alpha / 100 * w) + 'px';
    }

    function emitChange() {
      var rgb = hsbToRgb(hue, sat, bri);
      var hex = rgbToHex(rgb.r, rgb.g, rgb.b);
      onColorChange(hex, alpha, hue, sat, bri);
    }

    // Box interaction
    function boxDown(e) {
      e.preventDefault(); e.stopImmediatePropagation();
      var rect = boxCanvas.getBoundingClientRect();
      function move(ev) {
        var x = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
        var y = Math.max(0, Math.min(1, (ev.clientY - rect.top) / rect.height));
        sat = Math.round(x * 100);
        bri = Math.round((1 - y) * 100);
        drawBox(); drawAlpha(); emitChange();
      }
      move(e);
      function up() { document.removeEventListener('mousemove', move, true); document.removeEventListener('mouseup', up, true); }
      document.addEventListener('mousemove', move, true);
      document.addEventListener('mouseup', up, true);
    }
    boxCanvas.addEventListener('mousedown', boxDown, { capture: true });

    // Hue interaction
    function hueDown(e) {
      e.preventDefault(); e.stopImmediatePropagation();
      var rect = hueCanvas.getBoundingClientRect();
      function move(ev) {
        var x = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
        hue = Math.round(x * 360);
        drawBox(); drawHue(); drawAlpha(); emitChange();
      }
      move(e);
      function up() { document.removeEventListener('mousemove', move, true); document.removeEventListener('mouseup', up, true); }
      document.addEventListener('mousemove', move, true);
      document.addEventListener('mouseup', up, true);
    }
    hueCanvas.addEventListener('mousedown', hueDown, { capture: true });

    // Alpha interaction
    function alphaDown(e) {
      e.preventDefault(); e.stopImmediatePropagation();
      var rect = alphaCanvas.getBoundingClientRect();
      function move(ev) {
        var x = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
        alpha = Math.round(x * 100);
        drawAlpha(); emitChange();
      }
      move(e);
      function up() { document.removeEventListener('mousemove', move, true); document.removeEventListener('mouseup', up, true); }
      document.addEventListener('mousemove', move, true);
      document.addEventListener('mouseup', up, true);
    }
    alphaCanvas.addEventListener('mousedown', alphaDown, { capture: true });

    // Initial draw
    drawBox(); drawHue(); drawAlpha();

    // Return update function for external hex input
    return {
      setFromHex: function(hex, a) {
        var rgb = hexToRgb(hex);
        var newHsb = rgbToHsb(rgb.r, rgb.g, rgb.b);
        hue = newHsb.h; sat = newHsb.s; bri = newHsb.b;
        if (a !== undefined) alpha = a;
        drawBox(); drawHue(); drawAlpha();
      },
      getAlpha: function() { return alpha; }
    };
  }

  // ── Effects library ──
  var EFFECTS = [
    { name: 'Aurora', css: 'background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);background-size:200% 200%;animation:rb-fx-aurora 4s ease infinite;', keyframes: '@keyframes rb-fx-aurora{0%{background-position:0% 50%}50%{background-position:100% 50%}100%{background-position:0% 50%}}' },
    { name: 'Sunset', css: 'background:linear-gradient(-45deg,#ee7752,#e73c7e,#23a6d5,#23d5ab);background-size:400% 400%;animation:rb-fx-sunset 6s ease infinite;', keyframes: '@keyframes rb-fx-sunset{0%{background-position:0% 50%}50%{background-position:100% 50%}100%{background-position:0% 50%}}' },
    { name: 'Pulse', css: 'background:radial-gradient(circle,#7c3aed,#1e1b4b);animation:rb-fx-pulse 3s ease-in-out infinite;', keyframes: '@keyframes rb-fx-pulse{0%,100%{background-size:100% 100%}50%{background-size:150% 150%}}' },
    { name: 'Ocean', css: 'background:linear-gradient(180deg,#0077b6,#023e8a,#03045e);background-size:100% 300%;animation:rb-fx-ocean 5s ease infinite;', keyframes: '@keyframes rb-fx-ocean{0%{background-position:0% 0%}50%{background-position:0% 100%}100%{background-position:0% 0%}}' },
    { name: 'Neon Grid', css: 'background-color:#0a0a0a;background-image:linear-gradient(rgba(124,58,237,0.15) 1px,transparent 1px),linear-gradient(90deg,rgba(124,58,237,0.15) 1px,transparent 1px);background-size:40px 40px;animation:rb-fx-neongrid 2s linear infinite;', keyframes: '@keyframes rb-fx-neongrid{0%{background-position:0 0}100%{background-position:40px 40px}}' },
    { name: 'Starfield', css: 'background:#0a0a2e;background-image:radial-gradient(2px 2px at 20px 30px,#eee,transparent),radial-gradient(2px 2px at 40px 70px,#fff,transparent),radial-gradient(1px 1px at 90px 40px,#ddd,transparent),radial-gradient(1px 1px at 130px 80px,#fff,transparent),radial-gradient(2px 2px at 160px 30px,#eee,transparent);background-size:200px 100px;animation:rb-fx-stars 4s linear infinite;', keyframes: '@keyframes rb-fx-stars{0%{background-position:0 0}100%{background-position:200px 100px}}' },
    { name: 'Mesh', css: 'background-color:#ff99ee;background-image:radial-gradient(at 80% 20%,#a855f7 0px,transparent 50%),radial-gradient(at 0% 50%,#06b6d4 0px,transparent 50%),radial-gradient(at 80% 80%,#f97316 0px,transparent 50%);', keyframes: '' },
    { name: 'Stripe', css: 'background:repeating-linear-gradient(45deg,#606dbc,#606dbc 10px,#465298 10px,#465298 20px);animation:rb-fx-stripe 1s linear infinite;', keyframes: '@keyframes rb-fx-stripe{0%{background-position:0 0}100%{background-position:28px 0}}' },
    { name: 'Spotlight', css: 'background:#0a0a0a;background-image:radial-gradient(circle at 50% 50%,rgba(124,58,237,0.25),transparent 60%);animation:rb-fx-spot 4s ease-in-out infinite alternate;', keyframes: '@keyframes rb-fx-spot{0%{background-position:30% 30%}100%{background-position:70% 70%}}' },
    { name: 'Noise', css: 'background-color:#1a1a2e;background-image:url("data:image/svg+xml,%3Csvg viewBox=\'0 0 256 256\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'noiseFilter\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.65\' numOctaves=\'3\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23noiseFilter)\' opacity=\'0.3\'/%3E%3C/svg%3E");', keyframes: '' },
    { name: 'Candy', css: 'background:linear-gradient(135deg,#f093fb 0%,#f5576c 50%,#4facfe 100%);background-size:200% 200%;animation:rb-fx-candy 3s ease infinite;', keyframes: '@keyframes rb-fx-candy{0%{background-position:0% 50%}50%{background-position:100% 50%}100%{background-position:0% 50%}}' },
    { name: 'Matrix', css: 'background-color:#000;background-image:linear-gradient(0deg,rgba(0,255,0,0.05) 1px,transparent 1px);background-size:100% 4px;animation:rb-fx-matrix 0.5s steps(10) infinite;', keyframes: '@keyframes rb-fx-matrix{0%{background-position:0 0}100%{background-position:0 40px}}' },
  ];

  var keyframesInjected = false;
  function injectKeyframes() {
    if (keyframesInjected) return;
    keyframesInjected = true;
    var style = document.createElement('style');
    style.id = 'rb-fill-fx-keyframes';
    style.textContent = EFFECTS.filter(function(e) { return e.keyframes; }).map(function(e) { return e.keyframes; }).join('\n');
    document.head.appendChild(style);
  }

  // ── Shared: close any existing fill/image popup ──
  function closeExisting(cls) {
    var existing = document.querySelector('.' + cls);
    if (existing) { existing.remove(); return true; }
    return false;
  }

  // ══════════════════════════════════════════════════════════
  // BACKGROUND POPUP (Color / Gradient / Image / Effects)
  // ══════════════════════════════════════════════════════════
  function openFillPopup(anchorEl, inspector, root, el, prop, sig, callbacks) {
    if (closeExisting('rb-fill-popup')) return;

    var popup = mk('div', 'rb-insp-adv-popup rb-fill-popup');
    var inspRect = inspector.getBoundingClientRect();
    var anchorRect = anchorEl.getBoundingClientRect();
    var popupTop = Math.min(anchorRect.top, window.innerHeight - 460);
    popup.style.cssText = 'position:fixed;top:' + popupTop + 'px;right:' + (window.innerWidth - inspRect.left + 3) + 'px;width:260px;';

    // Current state
    var cs = window.getComputedStyle(el);
    var currentBg = cs.backgroundColor || '';
    var currentHex = '#000000';
    var currentAlpha = 100;
    var rgbaM = currentBg.match(/rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
    if (rgbaM) {
      currentHex = rgbToHex(parseInt(rgbaM[1]), parseInt(rgbaM[2]), parseInt(rgbaM[3]));
      if (rgbaM[4] !== undefined) currentAlpha = Math.round(parseFloat(rgbaM[4]) * 100);
    }
    var colorFormat = 'HEX';

    // ── Header ──
    var header = mk('div', 'rb-fill-header');
    var titleSpan = mk('span', 'rb-insp-sec-title');
    titleSpan.textContent = 'Fill';
    titleSpan.style.cssText = 'text-transform:none;letter-spacing:0;';
    var closeBtn = mk('button', 'rb-ed-minmax-btn');
    closeBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    closeBtn.addEventListener('mousedown', function(e) { e.stopImmediatePropagation(); popup.remove(); }, { capture: true });
    header.appendChild(titleSpan);
    header.appendChild(closeBtn);
    popup.appendChild(header);

    // ── Tabs (4 tabs: Color, Gradient, Image, Effects) ──
    var tabBar = mk('div', 'rb-fill-tabs');
    var tabNames = ['Color', 'Gradient', 'Image', 'Effects'];
    var tabBtns = [];
    var tabPanels = [];

    // Per-tab activate callbacks (set by each tab builder)
    var tabActivate = {};

    tabNames.forEach(function(name, i) {
      var btn = mk('button', 'rb-fill-tab' + (i === 0 ? ' rb-fill-tab-active' : ''));
      btn.textContent = name;
      btn.addEventListener('mousedown', function(e) {
        e.stopImmediatePropagation();
        tabBtns.forEach(function(b) { b.classList.remove('rb-fill-tab-active'); });
        tabPanels.forEach(function(p) { p.style.display = 'none'; });
        btn.classList.add('rb-fill-tab-active');
        tabPanels[i].style.display = '';
        if (tabActivate[i]) tabActivate[i]();
      }, { capture: true });
      tabBtns.push(btn);
      tabBar.appendChild(btn);
    });
    popup.appendChild(tabBar);

    tabNames.forEach(function(_, i) {
      var panel = mk('div', 'rb-fill-panel');
      if (i !== 0) panel.style.display = 'none';
      tabPanels.push(panel);
      popup.appendChild(panel);
    });

    // ────────── TAB 0: COLOR (canvas-based) ──────────
    (function() {
      var panel = tabPanels[0];
      var pickerCtrl = buildCanvasPicker(panel, currentHex, currentAlpha, colorFormat, function(hex, alpha) {
        currentHex = hex; currentAlpha = alpha;
        var rgb = hexToRgb(hex);
        var cssVal = 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',' + (alpha / 100) + ')';
        if (callbacks.apply) callbacks.apply(el, prop, cssVal);
        if (anchorEl) anchorEl.style.background = cssVal;
        valInp.value = displayForFormat(hex, alpha, colorFormat);
        alphaInp.value = alpha + '%';
      });

      // Controls row
      var ctrlRow = mk('div', 'rb-fill-ctrl-row');
      var fmtSelect = mk('select', 'rb-fill-fmt-select');
      ['HEX', 'RGB', 'HSL', 'HSB', 'CSS'].forEach(function(f) {
        var opt = mk('option');
        opt.value = f; opt.textContent = f;
        if (f === colorFormat) opt.selected = true;
        fmtSelect.appendChild(opt);
      });
      fmtSelect.addEventListener('change', function(e) {
        e.stopPropagation();
        colorFormat = fmtSelect.value;
        valInp.value = displayForFormat(currentHex, currentAlpha, colorFormat);
      });
      ctrlRow.appendChild(fmtSelect);

      var valInp = mk('input', 'rb-fill-val-inp');
      valInp.value = displayForFormat(currentHex, currentAlpha, colorFormat);
      valInp.addEventListener('change', function() {
        var v = valInp.value.trim();
        if (/^#?[0-9a-fA-F]{3,8}$/.test(v)) {
          if (v[0] !== '#') v = '#' + v;
          currentHex = v.length <= 7 ? v : v.slice(0, 7);
          pickerCtrl.setFromHex(currentHex);
          var rgb = hexToRgb(currentHex);
          var cssVal = 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',' + (currentAlpha / 100) + ')';
          if (callbacks.apply) callbacks.apply(el, prop, cssVal);
          if (anchorEl) anchorEl.style.background = cssVal;
        }
      });
      valInp.addEventListener('keydown', function(e) { if (e.key === 'Enter') { e.preventDefault(); valInp.blur(); } });
      ctrlRow.appendChild(valInp);

      var alphaInp = mk('input', 'rb-fill-alpha-inp');
      alphaInp.value = currentAlpha + '%';
      alphaInp.addEventListener('change', function() {
        var pct = parseInt(alphaInp.value) || 100;
        pct = Math.max(0, Math.min(100, pct));
        currentAlpha = pct;
        alphaInp.value = pct + '%';
        pickerCtrl.setFromHex(currentHex, pct);
        var rgb = hexToRgb(currentHex);
        var cssVal = 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',' + (pct / 100) + ')';
        if (callbacks.apply) callbacks.apply(el, prop, cssVal);
        if (anchorEl) anchorEl.style.background = cssVal;
      });
      alphaInp.addEventListener('keydown', function(e) { if (e.key === 'Enter') { e.preventDefault(); alphaInp.blur(); } });
      ctrlRow.appendChild(alphaInp);
      panel.appendChild(ctrlRow);

      // Re-apply color when switching back to this tab
      tabActivate[0] = function() {
        // Clear gradient/effect shorthand so backgroundColor takes effect
        el.style.removeProperty('background');
        el.style.removeProperty('background-image');
        el.style.removeProperty('animation');
        var rgb = hexToRgb(currentHex);
        var cssVal = 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',' + (currentAlpha / 100) + ')';
        if (callbacks.apply) callbacks.apply(el, prop, cssVal);
        if (anchorEl) anchorEl.style.background = cssVal;
      };
    })();

    // ────────── TAB 1: GRADIENT ──────────
    (function() {
      var panel = tabPanels[1];
      var gradientApplied = false; // only apply to element after user interacts
      var stops = [
        { pos: 0, color: '#000000', alpha: 100 },
        { pos: 100, color: '#666666', alpha: 100 }
      ];
      var selectedStop = 0;
      var gradientType = 'linear';

      var typeRow = mk('div', 'rb-fill-grad-type-row');
      var typeSelect = mk('select', 'rb-fill-fmt-select');
      ['Linear', 'Radial'].forEach(function(t) {
        var opt = mk('option');
        opt.value = t.toLowerCase(); opt.textContent = t;
        typeSelect.appendChild(opt);
      });
      typeSelect.addEventListener('change', function() { gradientType = typeSelect.value; updateGradient(); });
      typeRow.appendChild(typeSelect);

      var reverseBtn = mk('button', 'rb-fill-icon-btn');
      reverseBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 014-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 01-4 4H3"/></svg>';
      reverseBtn.title = 'Reverse';
      reverseBtn.addEventListener('mousedown', function(e) {
        e.stopImmediatePropagation();
        stops.forEach(function(s) { s.pos = 100 - s.pos; });
        stops.sort(function(a, b) { return a.pos - b.pos; });
        renderStops(); updateGradient();
      }, { capture: true });
      typeRow.appendChild(reverseBtn);
      panel.appendChild(typeRow);

      var preview = mk('div', 'rb-fill-grad-preview');
      panel.appendChild(preview);

      var stopsHd = mk('div', 'rb-fill-grad-stops-hd');
      var stopsLabel = mk('span');
      stopsLabel.textContent = 'Stops';
      stopsLabel.style.cssText = 'font:600 11px/1 "Instrument Sans",sans-serif;color:rgba(239,238,235,0.6);';
      var addStopBtn = mk('button', 'rb-fill-icon-btn');
      addStopBtn.textContent = '+';
      addStopBtn.style.cssText = 'font-size:14px;width:20px;height:20px;';
      addStopBtn.addEventListener('mousedown', function(e) {
        e.stopImmediatePropagation();
        var mid = stops.length >= 2 ? Math.round((stops[stops.length - 2].pos + stops[stops.length - 1].pos) / 2) : 50;
        stops.push({ pos: mid, color: '#888888', alpha: 100 });
        stops.sort(function(a, b) { return a.pos - b.pos; });
        selectedStop = stops.findIndex(function(s) { return s.pos === mid; });
        renderStops(); updateGradient();
      }, { capture: true });
      stopsHd.appendChild(stopsLabel);
      stopsHd.appendChild(addStopBtn);
      panel.appendChild(stopsHd);

      var stopsList = mk('div', 'rb-fill-grad-stops');
      panel.appendChild(stopsList);

      function renderStops() {
        stopsList.innerHTML = '';
        stops.forEach(function(stop, i) {
          var row = mk('div', 'rb-fill-grad-stop-row' + (i === selectedStop ? ' rb-fill-grad-stop-sel' : ''));
          var posInp = mk('input', 'rb-fill-stop-pos');
          posInp.value = stop.pos + '%';
          posInp.addEventListener('change', function() {
            stop.pos = Math.max(0, Math.min(100, parseInt(posInp.value) || 0));
            posInp.value = stop.pos + '%';
            stops.sort(function(a, b) { return a.pos - b.pos; });
            renderStops(); updateGradient();
          });

          var swatch = mk('div', 'rb-fill-stop-swatch');
          swatch.style.cssText = 'position:relative;overflow:hidden;background:' + stop.color;
          var cinp = mk('input');
          cinp.type = 'color'; cinp.value = stop.color;
          cinp.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;opacity:0;cursor:pointer;';
          cinp.addEventListener('input', function() {
            stop.color = cinp.value;
            swatch.style.background = cinp.value;
            hexInp.value = cinp.value.replace('#', '').toUpperCase();
            updateGradient();
          });
          swatch.appendChild(cinp);

          var hexInp = mk('input', 'rb-fill-stop-hex');
          hexInp.value = stop.color.replace('#', '').toUpperCase();
          hexInp.addEventListener('change', function() {
            var v = hexInp.value.trim();
            if (/^[0-9a-fA-F]{3,6}$/.test(v)) {
              stop.color = '#' + v; swatch.style.background = stop.color; cinp.value = stop.color;
              updateGradient();
            }
          });

          var alphaInp = mk('input', 'rb-fill-stop-alpha');
          alphaInp.value = stop.alpha;
          var pctLabel = mk('span');
          pctLabel.textContent = '%';
          pctLabel.style.cssText = 'font:400 11px/1 "Instrument Sans",sans-serif;color:rgba(239,238,235,0.4);';
          alphaInp.addEventListener('change', function() {
            stop.alpha = Math.max(0, Math.min(100, parseInt(alphaInp.value) || 100));
            alphaInp.value = stop.alpha; updateGradient();
          });

          var removeBtn = mk('button', 'rb-fill-icon-btn rb-fill-stop-remove');
          removeBtn.textContent = '\u2014';
          removeBtn.addEventListener('mousedown', function(e) {
            e.stopImmediatePropagation();
            if (stops.length <= 2) return;
            stops.splice(i, 1);
            if (selectedStop >= stops.length) selectedStop = stops.length - 1;
            renderStops(); updateGradient();
          }, { capture: true });

          row.addEventListener('mousedown', function(e) {
            if (e.target === removeBtn || e.target === cinp) return;
            selectedStop = i; renderStops();
          }, { capture: true });

          row.appendChild(posInp); row.appendChild(swatch); row.appendChild(hexInp);
          row.appendChild(alphaInp); row.appendChild(pctLabel); row.appendChild(removeBtn);
          stopsList.appendChild(row);
        });
      }

      function buildGradientCSS() {
        var stopsStr = stops.map(function(s) {
          var rgb = hexToRgb(s.color);
          return 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',' + (s.alpha / 100) + ') ' + s.pos + '%';
        }).join(', ');
        return gradientType === 'radial' ? 'radial-gradient(circle, ' + stopsStr + ')' : 'linear-gradient(135deg, ' + stopsStr + ')';
      }

      function updateGradient() {
        var gradCSS = buildGradientCSS();
        preview.style.background = gradCSS;
        if (gradientApplied) {
          if (callbacks.applyGradient) callbacks.applyGradient(el, gradCSS);
          if (anchorEl) anchorEl.style.background = gradCSS;
        }
      }

      // Apply gradient when tab is activated
      tabActivate[1] = function() {
        gradientApplied = true;
        updateGradient();
      };

      renderStops(); updateGradient();
    })();

    // ────────── TAB 2: IMAGE ──────────
    (function() {
      var panel = tabPanels[2];
      var thumbArea = mk('div', 'rb-fill-img-area');
      var cs2 = window.getComputedStyle(el);
      var existingBgImg = cs2.backgroundImage;
      var hasRealBgImg = existingBgImg && existingBgImg !== 'none' && existingBgImg.indexOf('url(') !== -1;
      if (hasRealBgImg) {
        thumbArea.style.backgroundImage = existingBgImg;
        thumbArea.style.backgroundSize = 'cover';
        thumbArea.style.backgroundPosition = 'center';
      }
      var uploadBtn = mk('button', 'rb-fill-img-upload-btn');
      uploadBtn.textContent = 'Upload from computer';
      var fileInp = mk('input');
      fileInp.type = 'file'; fileInp.accept = 'image/*'; fileInp.style.display = 'none';
      uploadBtn.addEventListener('mousedown', function(e) { e.stopImmediatePropagation(); fileInp.click(); }, { capture: true });
      fileInp.addEventListener('change', function(ev) {
        var f = ev.target.files[0]; if (!f) return;
        var rd = new FileReader();
        rd.onload = function() {
          thumbArea.style.backgroundImage = 'url(' + rd.result + ')';
          thumbArea.style.backgroundSize = 'cover';
          thumbArea.style.backgroundPosition = 'center';
          thumbArea.classList.add('rb-fill-img-has');
          if (callbacks.applyBgImage) callbacks.applyBgImage(el, rd.result);
        };
        rd.readAsDataURL(f);
      });
      thumbArea.appendChild(uploadBtn);
      thumbArea.appendChild(fileInp);
      panel.appendChild(thumbArea);
    })();

    // ────────── TAB 3: EFFECTS ──────────
    (function() {
      var panel = tabPanels[3];
      injectKeyframes();
      var grid = mk('div', 'rb-fill-fx-grid');

      EFFECTS.forEach(function(fx) {
        var card = mk('div', 'rb-fill-fx-card');
        var thumb = mk('div', 'rb-fill-fx-thumb');
        thumb.style.cssText = fx.css;
        card.appendChild(thumb);
        var label = mk('span', 'rb-fill-fx-label');
        label.textContent = fx.name;
        card.appendChild(label);

        card.addEventListener('mousedown', function(e) {
          e.stopImmediatePropagation();
          grid.querySelectorAll('.rb-fill-fx-card').forEach(function(c) { c.classList.remove('rb-fill-fx-selected'); });
          card.classList.add('rb-fill-fx-selected');
          // Use applyEffect callback so editor.js can show effect name
          if (callbacks.applyEffect) callbacks.applyEffect(el, fx);
        }, { capture: true });

        grid.appendChild(card);
      });

      panel.appendChild(grid);
    })();

    root.appendChild(popup);

    // Auto-close
    var closeOutside = function(ev) {
      if (popup && !popup.contains(ev.target) && !anchorEl.contains(ev.target)) {
        if (popup.parentElement) popup.remove();
        document.removeEventListener('mousedown', closeOutside, true);
      }
    };
    setTimeout(function() { document.addEventListener('mousedown', closeOutside, true); }, 50);
  }

  // ══════════════════════════════════════════════════════════
  // IMAGE POPUP (standalone, only image upload)
  // ══════════════════════════════════════════════════════════
  function openImagePopup(anchorEl, inspector, root, el, sig, callbacks) {
    if (closeExisting('rb-fill-img-popup')) return;

    var popup = mk('div', 'rb-insp-adv-popup rb-fill-popup rb-fill-img-popup');
    var inspRect = inspector.getBoundingClientRect();
    var anchorRect = anchorEl.getBoundingClientRect();
    var popupTop = Math.min(anchorRect.top, window.innerHeight - 320);
    popup.style.cssText = 'position:fixed;top:' + popupTop + 'px;right:' + (window.innerWidth - inspRect.left + 3) + 'px;width:260px;';

    // Header
    var header = mk('div', 'rb-fill-header');
    var titleSpan = mk('span', 'rb-insp-sec-title');
    titleSpan.textContent = 'Image';
    titleSpan.style.cssText = 'text-transform:none;letter-spacing:0;';
    var closeBtn = mk('button', 'rb-ed-minmax-btn');
    closeBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    closeBtn.addEventListener('mousedown', function(e) { e.stopImmediatePropagation(); popup.remove(); }, { capture: true });
    header.appendChild(titleSpan);
    header.appendChild(closeBtn);
    popup.appendChild(header);

    // Thumbnail area
    var thumbArea = mk('div', 'rb-fill-img-area');
    var cs = window.getComputedStyle(el);

    // Show existing image (real URL images only, not gradients)
    var existingBgImg = cs.backgroundImage;
    var hasRealImg = existingBgImg && existingBgImg !== 'none' && existingBgImg.indexOf('url(') !== -1;
    var visualEl = null;
    if (el.tagName === 'IMG') visualEl = el;
    else {
      var childImg = el.querySelector(':scope > img');
      if (childImg) visualEl = childImg;
    }

    if (visualEl && visualEl.tagName === 'IMG') {
      thumbArea.style.backgroundImage = 'url(' + visualEl.src + ')';
      thumbArea.style.backgroundSize = 'cover';
      thumbArea.style.backgroundPosition = 'center';
    } else if (hasRealImg) {
      thumbArea.style.backgroundImage = existingBgImg;
      thumbArea.style.backgroundSize = 'cover';
      thumbArea.style.backgroundPosition = 'center';
    }

    var uploadBtn = mk('button', 'rb-fill-img-upload-btn');
    uploadBtn.textContent = 'Upload from computer';
    var fileInp = mk('input');
    fileInp.type = 'file'; fileInp.accept = 'image/*'; fileInp.style.display = 'none';
    uploadBtn.addEventListener('mousedown', function(e) { e.stopImmediatePropagation(); fileInp.click(); }, { capture: true });
    fileInp.addEventListener('change', function(ev) {
      var f = ev.target.files[0]; if (!f) return;
      var rd = new FileReader();
      rd.onload = function() {
        thumbArea.style.backgroundImage = 'url(' + rd.result + ')';
        thumbArea.style.backgroundSize = 'cover';
        thumbArea.style.backgroundPosition = 'center';
        thumbArea.classList.add('rb-fill-img-has');
        if (callbacks.applyImage) callbacks.applyImage(el, rd.result);
      };
      rd.readAsDataURL(f);
    });

    thumbArea.appendChild(uploadBtn);
    thumbArea.appendChild(fileInp);
    popup.appendChild(thumbArea);
    root.appendChild(popup);

    // Auto-close
    var closeOutside = function(ev) {
      if (popup && !popup.contains(ev.target) && !anchorEl.contains(ev.target)) {
        if (popup.parentElement) popup.remove();
        document.removeEventListener('mousedown', closeOutside, true);
      }
    };
    setTimeout(function() { document.addEventListener('mousedown', closeOutside, true); }, 50);
  }

  // ══════════════════════════════════════════════════════════
  // COLOR-ONLY POPUP (for Typography colors)
  // ══════════════════════════════════════════════════════════
  function openColorOnlyPopup(anchorEl, inspector, root, currentHex, currentAlpha, onApply) {
    if (closeExisting('rb-fill-color-popup')) return;

    var popup = mk('div', 'rb-insp-adv-popup rb-fill-popup rb-fill-color-popup');
    var inspRect = inspector.getBoundingClientRect();
    var anchorRect = anchorEl.getBoundingClientRect();
    var popupTop = Math.min(anchorRect.top, window.innerHeight - 340);
    popup.style.cssText = 'position:fixed;top:' + popupTop + 'px;right:' + (window.innerWidth - inspRect.left + 3) + 'px;width:260px;';

    // Header
    var header = mk('div', 'rb-fill-header');
    var titleSpan = mk('span', 'rb-insp-sec-title');
    titleSpan.textContent = 'Color';
    titleSpan.style.cssText = 'text-transform:none;letter-spacing:0;';
    var closeBtn = mk('button', 'rb-ed-minmax-btn');
    closeBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    closeBtn.addEventListener('mousedown', function(e) { e.stopImmediatePropagation(); popup.remove(); }, { capture: true });
    header.appendChild(titleSpan);
    header.appendChild(closeBtn);
    popup.appendChild(header);

    var colorFormat = 'HEX';
    var hex = currentHex || '#000000';
    var alpha = currentAlpha !== undefined ? currentAlpha : 100;

    var pickerCtrl = buildCanvasPicker(popup, hex, alpha, colorFormat, function(newHex, newAlpha) {
      hex = newHex; alpha = newAlpha;
      valInp.value = displayForFormat(newHex, newAlpha, colorFormat);
      alphaInp.value = newAlpha + '%';
      if (anchorEl) anchorEl.style.background = 'rgba(' + hexToRgb(newHex).r + ',' + hexToRgb(newHex).g + ',' + hexToRgb(newHex).b + ',' + (newAlpha / 100) + ')';
      if (onApply) onApply(newHex, newAlpha);
    });

    var ctrlRow = mk('div', 'rb-fill-ctrl-row');
    var fmtSelect = mk('select', 'rb-fill-fmt-select');
    ['HEX', 'RGB', 'HSL', 'HSB', 'CSS'].forEach(function(f) {
      var opt = mk('option');
      opt.value = f; opt.textContent = f;
      if (f === colorFormat) opt.selected = true;
      fmtSelect.appendChild(opt);
    });
    fmtSelect.addEventListener('change', function(e) {
      e.stopPropagation();
      colorFormat = fmtSelect.value;
      valInp.value = displayForFormat(hex, alpha, colorFormat);
    });
    ctrlRow.appendChild(fmtSelect);

    var valInp = mk('input', 'rb-fill-val-inp');
    valInp.value = displayForFormat(hex, alpha, colorFormat);
    valInp.addEventListener('change', function() {
      var v = valInp.value.trim();
      if (/^#?[0-9a-fA-F]{3,8}$/.test(v)) {
        if (v[0] !== '#') v = '#' + v;
        hex = v.length <= 7 ? v : v.slice(0, 7);
        pickerCtrl.setFromHex(hex);
        if (onApply) onApply(hex, alpha);
      }
    });
    valInp.addEventListener('keydown', function(e) { if (e.key === 'Enter') { e.preventDefault(); valInp.blur(); } });
    ctrlRow.appendChild(valInp);

    var alphaInp = mk('input', 'rb-fill-alpha-inp');
    alphaInp.value = alpha + '%';
    alphaInp.addEventListener('change', function() {
      var pct = parseInt(alphaInp.value) || 100;
      pct = Math.max(0, Math.min(100, pct));
      alpha = pct;
      alphaInp.value = pct + '%';
      pickerCtrl.setFromHex(hex, pct);
      if (onApply) onApply(hex, pct);
    });
    alphaInp.addEventListener('keydown', function(e) { if (e.key === 'Enter') { e.preventDefault(); alphaInp.blur(); } });
    ctrlRow.appendChild(alphaInp);
    popup.appendChild(ctrlRow);

    root.appendChild(popup);

    var closeOutside = function(ev) {
      if (popup && !popup.contains(ev.target) && !anchorEl.contains(ev.target)) {
        if (popup.parentElement) popup.remove();
        document.removeEventListener('mousedown', closeOutside, true);
      }
    };
    setTimeout(function() { document.addEventListener('mousedown', closeOutside, true); }, 50);
  }

  // ── Public API ──
  window.__rbFillPopup = {
    open: openFillPopup,
    openImage: openImagePopup,
    openColorOnly: openColorOnlyPopup
  };
})();
