// RepixBridge — Design System Extractor
// Runs in page context. Returns tokens, clean HTML, section bounds, and DESIGN.md.
// Deterministic: no AI, no interpretation — just computed values.

(function() {
  if (window.__rbExtractor) return window.__rbExtractor;

  const RB = window.__rbExtractor = {};

  // ─── Color utilities ───────────────────────────────────────────────────────

  function rgbToHex(rgb) {
    if (!rgb || typeof rgb !== 'string') return null;
    // Accept already-hex input (stylesheet rule.style can return hex directly)
    const hex = rgb.trim().match(/^#([0-9a-f]{3,8})$/i);
    if (hex) {
      let h = hex[1];
      if (h.length === 3) return '#' + h.split('').map(c => c + c).join('').toLowerCase();
      if (h.length === 4) return '#' + h.slice(0, 3).split('').map(c => c + c).join('').toLowerCase();
      if (h.length >= 6) return '#' + h.slice(0, 6).toLowerCase();
    }
    const m = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (!m) return null;
    return '#' + [m[1], m[2], m[3]]
      .map(n => parseInt(n).toString(16).padStart(2, '0'))
      .join('');
  }

  function colorLuminance(hex) {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  function isLight(hex) { return colorLuminance(hex) > 0.5; }

  // ─── Tailwind translators ─────────────────────────────────────────────────
  // Map pixel values to the closest Tailwind class or arbitrary-value syntax.
  // Used so the LLM receives ready-to-copy class strings instead of raw px.

  var TW_SPACING = {
    0:'0', 1:'px', 2:'0.5', 4:'1', 6:'1.5', 8:'2', 10:'2.5',
    12:'3', 14:'3.5', 16:'4', 20:'5', 24:'6', 28:'7', 32:'8',
    36:'9', 40:'10', 44:'11', 48:'12', 56:'14', 64:'16', 80:'20',
    96:'24', 112:'28', 128:'32', 144:'36', 160:'40', 192:'48',
    224:'56', 256:'64', 288:'72', 320:'80', 384:'96'
  };
  var TW_PROP_PREFIX = {
    'padding':'p', 'padding-x':'px', 'padding-y':'py',
    'margin':'m', 'gap':'gap', 'width':'w', 'height':'h'
  };

  function pxToTw(value, prop) {
    if (value == null || value === '' || value === 'auto') return null;
    var px = parseFloat(value);
    if (isNaN(px)) return null;
    var prefix = TW_PROP_PREFIX[prop] || '';
    var key = TW_SPACING[px];
    if (key !== undefined) return prefix ? prefix + '-' + key : key;
    return prefix ? prefix + '-[' + px + 'px]' : '[' + px + 'px]';
  }

  var TW_RADIUS = {
    0:'rounded-none', 2:'rounded-sm', 4:'rounded', 6:'rounded-md',
    8:'rounded-lg', 12:'rounded-xl', 16:'rounded-2xl', 24:'rounded-3xl'
  };

  function radiusToTw(value) {
    if (!value) return null;
    var px = parseFloat(value);
    if (isNaN(px)) return null;
    if (px >= 500 || px >= 9999) return 'rounded-full';
    if (TW_RADIUS[px]) return TW_RADIUS[px];
    return 'rounded-[' + px + 'px]';
  }

  // Common Tailwind text sizes mapped to px (for classification only)
  var TW_TEXT_MAP = [
    {px:12, cls:'text-xs'}, {px:14, cls:'text-sm'}, {px:16, cls:'text-base'},
    {px:18, cls:'text-lg'}, {px:20, cls:'text-xl'}, {px:24, cls:'text-2xl'},
    {px:30, cls:'text-3xl'}, {px:36, cls:'text-4xl'}, {px:48, cls:'text-5xl'},
    {px:60, cls:'text-6xl'}, {px:72, cls:'text-7xl'}, {px:96, cls:'text-8xl'},
    {px:128,cls:'text-9xl'}
  ];

  function fontSizeToTw(value) {
    var px = parseFloat(value);
    if (isNaN(px)) return null;
    // Viewport-relative for huge display sizes
    if (px > 140) {
      var vw = Math.round(px / window.innerWidth * 100);
      return 'text-[' + vw + 'vw]';
    }
    // Find nearest named scale
    var best = TW_TEXT_MAP[0];
    for (var i = 0; i < TW_TEXT_MAP.length; i++) {
      if (Math.abs(TW_TEXT_MAP[i].px - px) < Math.abs(best.px - px)) best = TW_TEXT_MAP[i];
    }
    if (Math.abs(best.px - px) <= 1) return best.cls;
    return 'text-[' + px + 'px]';
  }

  function fontWeightToTw(value) {
    var w = parseInt(value, 10);
    if (isNaN(w)) return null;
    var map = {100:'font-thin', 200:'font-extralight', 300:'font-light',
               400:'font-normal', 500:'font-medium', 600:'font-semibold',
               700:'font-bold', 800:'font-extrabold', 900:'font-black'};
    return map[Math.round(w/100)*100] || null;
  }

  function lineHeightToTw(value, fontSize) {
    if (!value || value === 'normal') return null;
    var lh = parseFloat(value);
    if (isNaN(lh)) return null;
    // Unitless line-height is already a ratio (CSS allows this). With px unit,
    // divide by font-size to get the ratio.
    var ratio;
    if (/px$/.test(value)) {
      var fs = parseFloat(fontSize);
      if (isNaN(fs) || fs === 0) return null;
      ratio = lh / fs;
    } else {
      ratio = lh;
    }
    if (ratio < 0.95) return 'leading-[' + ratio.toFixed(2) + ']';
    if (ratio < 1.05) return 'leading-none';
    if (ratio < 1.2) return 'leading-tight';
    if (ratio < 1.3) return 'leading-snug';
    if (ratio < 1.55) return 'leading-normal';
    if (ratio < 1.7) return 'leading-relaxed';
    return 'leading-loose';
  }

  function trackingToTw(value, fontSize) {
    if (!value || value === 'normal') return null;
    var ls = parseFloat(value);
    var fs = parseFloat(fontSize) || 16;
    var em = ls / fs;
    if (Math.abs(em) < 0.005) return null;
    if (em < -0.04) return 'tracking-tighter';
    if (em < -0.01) return 'tracking-tight';
    if (em < 0.015) return 'tracking-normal';
    if (em < 0.04) return 'tracking-wide';
    if (em < 0.08) return 'tracking-wider';
    return 'tracking-widest';
  }

  // ─── Color descriptor ─────────────────────────────────────────────────────
  // Produce a short human-readable name like "warm off-white" or "deep forest green"
  // for a hex value. Used to annotate palette entries in DESIGN.md.

  function colorName(hex) {
    if (!hex || hex.length < 7) return '';
    var r = parseInt(hex.slice(1,3), 16);
    var g = parseInt(hex.slice(3,5), 16);
    var b = parseInt(hex.slice(5,7), 16);
    var max = Math.max(r,g,b), min = Math.min(r,g,b), d = max - min;
    var l = (max + min) / 510;
    var s = d === 0 ? 0 : (l > 0.5 ? d / (510 - max - min) : d / (max + min));

    var lb;
    if (l >= 0.9) lb = 'off-white';
    else if (l > 0.75) lb = 'light';
    else if (l > 0.45) lb = 'medium';
    else if (l > 0.2) lb = 'dark';
    else if (l > 0.08) lb = 'deep';
    else lb = 'near-black';

    // Treat low-chroma colors as tinted neutrals. Very light or very dark
    // colors tolerate higher saturation before reading as "chromatic".
    var desatCutoff = 0.12;
    if (l >= 0.85 || l <= 0.15) desatCutoff = 0.35;
    if (s < desatCutoff) {
      if (r > g && g > b + 2) return lb + ' beige';
      if (g > r && g > b) return lb + ' sage';
      if (b > r) return lb + ' slate';
      return lb + ' gray';
    }

    var h = 0;
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)); break;
      case g: h = ((b - r) / d + 2); break;
      case b: h = ((r - g) / d + 4); break;
    }
    h *= 60;

    var hue;
    if (h < 15 || h >= 345) hue = 'red';
    else if (h < 45) hue = 'orange';
    else if (h < 70) hue = 'yellow';
    else if (h < 95) hue = 'lime';
    else if (h < 160) hue = 'green';
    else if (h < 190) hue = 'teal';
    else if (h < 230) hue = 'blue';
    else if (h < 270) hue = 'indigo';
    else if (h < 310) hue = 'purple';
    else hue = 'pink';

    // Saturation modifier
    var satMod = s > 0.7 ? 'vibrant ' : (s < 0.3 ? 'muted ' : '');
    return (satMod + lb + ' ' + hue).trim();
  }

  // ─── Semantic color role classifier ───────────────────────────────────────
  // Given a color's usage counts across the document, assign a semantic role
  // so the LLM understands what the color is FOR, not just where it appears.

  function classifyColorRole(hex, u, bodyBg, bodyText) {
    // Body/document colors
    if (hex === bodyBg) return 'surface-base';
    if (hex === bodyText) return 'primary-text';

    // Selection highlight is a strong signal of brand accent
    if (u.selection > 0) return 'accent-selection';

    // Used in ::selection only
    if (u.total < 3) return 'accent-decorative';

    // Large surface (section bg)
    if (u.sectionBg >= 1) return 'surface-section';

    // Button background (primary CTA)
    if (u.buttonBg >= 2 && u.text < 3) return 'brand-primary';

    // Pill/tag border
    if (u.pillBorder >= 3) return 'border-tag';

    // Generic border
    if (u.border > u.text && u.border > u.bg) return 'border-subtle';

    // Text
    if (u.text > u.bg + u.border) return 'text-secondary';

    // Generic background
    if (u.bg > u.text + u.border) return 'surface-neutral';

    return 'accent';
  }

  // ─── Layout structure detector ────────────────────────────────────────────
  // Captures the structural facts that are invisible in a screenshot:
  // sticky headers, fixed sidebars, background grid patterns, section paddings.

  function detectLayoutStructure() {
    var out = {
      sticky: [],
      sidebars: [],
      gridBackgrounds: [],
      sectionPaddings: [],
      hasBackdropBlur: false
    };

    // Sticky / fixed navigation elements
    document.querySelectorAll('header, nav, [role="banner"], [role="navigation"], .header, .navbar').forEach(function(el) {
      var s = getComputedStyle(el);
      if (s.position !== 'sticky' && s.position !== 'fixed') return;
      var r = el.getBoundingClientRect();
      if (r.width < 100 || r.height < 20) return;
      var blur = null;
      if (s.backdropFilter && s.backdropFilter !== 'none') {
        blur = s.backdropFilter;
        out.hasBackdropBlur = true;
      } else if (s.webkitBackdropFilter && s.webkitBackdropFilter !== 'none') {
        blur = s.webkitBackdropFilter;
        out.hasBackdropBlur = true;
      }
      out.sticky.push({
        tag: el.tagName.toLowerCase(),
        height: Math.round(r.height),
        heightTw: pxToTw(r.height, 'height'),
        position: s.position,
        backdropFilter: blur,
        bgColor: rgbToHex(s.backgroundColor)
      });
    });

    // Narrow fixed sidebars (like the litebox 12px right rail)
    document.querySelectorAll('aside, [class*="sidebar"], nav').forEach(function(el) {
      var s = getComputedStyle(el);
      if (s.position !== 'fixed' && s.position !== 'sticky') return;
      var r = el.getBoundingClientRect();
      if (r.width > 120 || r.height < window.innerHeight * 0.4) return;
      out.sidebars.push({
        side: r.left < 80 ? 'left' : 'right',
        width: Math.round(r.width),
        widthTw: pxToTw(r.width, 'width'),
        bgColor: rgbToHex(s.backgroundColor)
      });
    });

    // Graph-paper backgrounds (linear-gradient with transparent + background-size)
    var seenGrids = new Set();
    document.querySelectorAll('body, section, main, div, header').forEach(function(el) {
      var s = getComputedStyle(el);
      var bi = s.backgroundImage;
      if (!bi || bi === 'none') return;
      if (bi.indexOf('linear-gradient') === -1) return;
      if (bi.indexOf('transparent') === -1 && bi.indexOf('0 0') === -1) return;
      var bs = s.backgroundSize;
      if (!bs || bs === 'auto') return;
      if (!/\d+px/.test(bs)) return;
      var key = bs + '|' + bi.slice(0, 60);
      if (seenGrids.has(key)) return;
      seenGrids.add(key);
      out.gridBackgrounds.push({
        size: bs,
        tag: el.tagName.toLowerCase()
      });
    });

    // Dominant section paddings
    var padCounts = {};
    document.querySelectorAll('section, main > div, [class*="section"]').forEach(function(el) {
      var s = getComputedStyle(el);
      var r = el.getBoundingClientRect();
      if (r.width < 400 || r.height < 100) return;
      var pt = parseFloat(s.paddingTop) || 0;
      var pb = parseFloat(s.paddingBottom) || 0;
      var avg = Math.round((pt + pb) / 2 / 4) * 4; // bucket to nearest 4
      if (avg > 0) padCounts[avg] = (padCounts[avg] || 0) + 1;
    });
    out.sectionPaddings = Object.keys(padCounts)
      .map(function(k) { return {px: parseInt(k, 10), count: padCounts[k]}; })
      .sort(function(a, b) { return b.count - a.count; })
      .slice(0, 3)
      .map(function(e) { return {px: e.px, tw: pxToTw(e.px, 'padding-y'), count: e.count}; });

    return out;
  }

  // ─── Interaction state extractor ──────────────────────────────────────────
  // Parses stylesheets for :hover, ::selection, @keyframes, and reads computed
  // transitions on interactive elements. These are invisible in screenshots.

  function extractInteractionStates() {
    var out = {
      selection: null,
      hovers: [],
      keyframes: [],
      transitions: [],
      hasMarquee: false
    };
    var hoverSeen = new Set();

    try {
      var sheets = document.styleSheets;
      for (var i = 0; i < sheets.length; i++) {
        try {
          var rules = sheets[i].cssRules || sheets[i].rules;
          if (!rules) continue;
          for (var j = 0; j < rules.length && j < 3000; j++) {
            var rule = rules[j];
            if (!rule) continue;

            // ::selection
            if (rule.selectorText && rule.selectorText.indexOf('::selection') !== -1) {
              var st = rule.style || {};
              if (!out.selection) {
                // Try both backgroundColor and background shorthand
                var bgVal = st.backgroundColor || '';
                if (!bgVal && st.background) {
                  var bgMatch = st.background.match(/(#[0-9a-f]{3,8}|rgba?\([^)]+\))/i);
                  if (bgMatch) bgVal = bgMatch[1];
                }
                out.selection = {
                  bg: rgbToHex(bgVal),
                  color: rgbToHex(st.color || '')
                };
              }
            }

            // @keyframes
            if (rule.type === 7 /* KEYFRAMES_RULE */) {
              var name = rule.name || '';
              if (name && out.keyframes.indexOf(name) === -1 && out.keyframes.length < 15) {
                out.keyframes.push(name);
                if (/marquee|scroll|ticker|slide/i.test(name)) out.hasMarquee = true;
              }
            }

            // :hover rules with meaningful properties
            if (rule.selectorText && rule.selectorText.indexOf(':hover') !== -1) {
              if (rule.selectorText.indexOf('#rb-') !== -1) continue;
              var hst = rule.style || {};
              var props = {};
              if (hst.backgroundColor) props.bg = rgbToHex(hst.backgroundColor) || hst.backgroundColor;
              if (hst.color) props.color = rgbToHex(hst.color) || hst.color;
              if (hst.transform) props.transform = hst.transform;
              if (hst.opacity && hst.opacity !== '1') props.opacity = hst.opacity;
              if (hst.borderColor) props.border = rgbToHex(hst.borderColor) || hst.borderColor;
              if (Object.keys(props).length === 0) continue;
              var sig = rule.selectorText.slice(0, 60) + JSON.stringify(props);
              if (hoverSeen.has(sig)) continue;
              hoverSeen.add(sig);
              if (out.hovers.length < 12) {
                out.hovers.push({
                  selector: rule.selectorText.slice(0, 80),
                  props: props
                });
              }
            }
          }
        } catch(e) { /* cross-origin stylesheet */ }
      }
    } catch(e) {}

    // Computed transitions on interactive elements
    var transitionSet = new Set();
    document.querySelectorAll('a, button, [role="button"], [class*="btn"]').forEach(function(el) {
      var s = getComputedStyle(el);
      var t = s.transition;
      if (!t || t === 'all 0s ease 0s' || t === 'none 0s ease 0s') return;
      transitionSet.add(t.slice(0, 80));
    });
    out.transitions = [...transitionSet].slice(0, 6);

    return out;
  }

  // ─── Token extraction (legacy, still used by editor) ──────────────────────

  RB.extractTokens = function() {
    const colorFreq = {};
    const fonts = new Set();
    const radii = new Set();
    const shadows = new Set();

    const elements = document.querySelectorAll(
      'h1,h2,h3,h4,p,a,button,nav,header,section,footer,main,[class*="hero"],[class*="btn"]'
    );

    elements.forEach(el => {
      const s = getComputedStyle(el);
      [s.color, s.backgroundColor, s.borderColor].forEach(c => {
        const hex = rgbToHex(c);
        if (hex) colorFreq[hex] = (colorFreq[hex] || 0) + 1;
      });
      const ff = s.fontFamily.split(',')[0].replace(/['"]/g, '').trim();
      if (ff) fonts.add(ff);
      const br = s.borderRadius;
      if (br && br !== '0px') radii.add(br);
      if (s.boxShadow && s.boxShadow !== 'none') shadows.add(s.boxShadow);
    });

    const sortedColors = Object.entries(colorFreq)
      .sort((a, b) => b[1] - a[1])
      .map(([hex]) => hex)
      .slice(0, 12);

    return {
      colors: sortedColors,
      fonts: [...fonts].slice(0, 6),
      radii: [...radii].slice(0, 4),
      shadows: [...shadows].slice(0, 3),
    };
  };

  // ─── Clean HTML ────────────────────────────────────────────────────────────

  RB.extractCleanHTML = function() {
    const clone = document.documentElement.cloneNode(true);
    clone.querySelectorAll(
      'script,style,link[rel="stylesheet"],noscript,canvas,iframe,video,audio'
    ).forEach(el => el.remove());

    // Keep small inline SVGs as they are often icons
    clone.querySelectorAll('svg').forEach(svg => {
      if (svg.outerHTML.length > 500) svg.remove();
    });

    clone.querySelectorAll('*').forEach(el => {
      [...el.attributes].forEach(attr => {
        if (attr.name.startsWith('on') || attr.name.startsWith('data-')) {
          el.removeAttribute(attr.name);
        }
      });
    });

    const body = clone.querySelector('body');
    if (!body) return '';

    return trimDepth(body, 6).innerHTML
      .replace(/\s{2,}/g, ' ')
      .replace(/>\s+</g, '><')
      .trim()
      .slice(0, 30000);
  };

  function trimDepth(el, maxDepth, current) {
    current = current || 0;
    if (current >= maxDepth) {
      el.innerHTML = el.textContent.trim().slice(0, 100) || '';
      return el;
    }
    [...el.children].forEach(function(child) { trimDepth(child, maxDepth, current + 1); });
    return el;
  }

  // ─── Section bounds ────────────────────────────────────────────────────────

  RB.extractSectionBounds = function() {
    const candidates = document.querySelectorAll(
      'header, nav, main, section, footer, [class*="hero"], [class*="banner"], ' +
      '[class*="features"], [class*="pricing"], [class*="testimonial"], [class*="cta"]'
    );

    return [...candidates]
      .filter(el => {
        const r = el.getBoundingClientRect();
        return r.width > 200 && r.height > 60;
      })
      .map(el => {
        const r = el.getBoundingClientRect();
        return {
          selector: getSelector(el),
          tag: el.tagName.toLowerCase(),
          className: el.className.toString().slice(0, 80),
          bounds: {
            x: Math.round(r.left + window.scrollX),
            y: Math.round(r.top + window.scrollY),
            w: Math.round(r.width),
            h: Math.round(r.height)
          }
        };
      })
      .slice(0, 20);
  };

  function getSelector(el) {
    if (el.id) return '#' + el.id;
    if (el.className && typeof el.className === 'string') {
      const cls = el.className.trim().split(/\s+/)[0];
      if (cls) return el.tagName.toLowerCase() + '.' + cls;
    }
    return el.tagName.toLowerCase();
  }

  // ─── DESIGN.MD Generator (Aura-style) ─────────────────────────────────────
  // Generates a semantic markdown design system document for LLM context.

  RB.generateDesignMD = function() {
    var md = [];

    // ── Overview ──
    md.push('# Design System\n');
    md.push('## Overview');
    var bodyCs = getComputedStyle(document.body);
    var docCs = getComputedStyle(document.documentElement);
    var bodyBg = rgbToHex(bodyCs.backgroundColor) || rgbToHex(docCs.backgroundColor) || '#ffffff';
    var bodyColor = rgbToHex(bodyCs.color) || '#000000';
    var theme = isLight(bodyBg) ? 'light' : 'dark';
    var bodyFont = bodyCs.fontFamily.split(',')[0].replace(/['"]/g, '').trim();
    // Reserve a slot for the tone sentence — filled in at the end once we
    // have collected shapes, palette dominance, and structural signals.
    var toneSlotIndex = md.length;
    md.push(''); // placeholder

    md.push('- **Theme**: ' + theme + ' mode (background: `' + bodyBg + '`, text: `' + bodyColor + '`)');
    md.push('- **Primary font**: ' + bodyFont);
    md.push('- **URL**: ' + location.href);
    md.push('- **Title**: ' + (document.title || '').slice(0, 60));
    md.push('- **Viewport**: ' + window.innerWidth + ' x ' + window.innerHeight);
    md.push('');

    // Pre-compute structural + interaction data (used across multiple sections)
    var layout = detectLayoutStructure();
    var interactions = extractInteractionStates();

    // ── Layout & Grid ── (before Colors so LLM gets structure first)
    md.push('## Layout & Grid\n');
    if (layout.sticky.length > 0) {
      layout.sticky.forEach(function(el) {
        var line = '- **' + el.position.charAt(0).toUpperCase() + el.position.slice(1) + ' ' + el.tag + '**: '
                 + 'height ' + el.height + 'px' + (el.heightTw ? ' (`' + el.heightTw + '`)' : '');
        if (el.backdropFilter) line += ', backdrop-filter `' + el.backdropFilter + '` (`backdrop-blur-md`)';
        if (el.bgColor) line += ', bg `' + el.bgColor + '`';
        md.push(line);
      });
    }
    if (layout.sidebars.length > 0) {
      layout.sidebars.forEach(function(sb) {
        md.push('- **Fixed ' + sb.side + ' sidebar**: width ' + sb.width + 'px'
              + (sb.widthTw ? ' (`' + sb.widthTw + '`)' : '')
              + (sb.bgColor ? ', bg `' + sb.bgColor + '`' : ''));
      });
    }
    if (layout.gridBackgrounds.length > 0) {
      layout.gridBackgrounds.slice(0, 3).forEach(function(g) {
        md.push('- **Graph-paper background** on `' + g.tag + '`: size `' + g.size
              + '` (use `bg-[size:' + g.size.replace(/\s+/g, '_') + ']`)');
      });
    }
    if (layout.sectionPaddings.length > 0) {
      var padStr = layout.sectionPaddings.map(function(p) {
        return p.px + 'px' + (p.tw ? ' (`' + p.tw + '`)' : '');
      }).join(', ');
      md.push('- **Dominant section paddings**: ' + padStr);
    }
    md.push('- **Separation strategy**: thin 1px borders between sections, use `border border-[<color>]`');
    md.push('');

    // ── Color Palette (semantic roles) ──
    md.push('## Color Palette\n');
    var colorUsage = {}; // hex → usage counts by semantic context
    function bumpColor(hex, ctx) {
      if (!hex) return;
      if (!colorUsage[hex]) {
        colorUsage[hex] = {text:0, bg:0, border:0, selection:0, buttonBg:0, pillBorder:0, sectionBg:0, total:0};
      }
      colorUsage[hex][ctx]++;
      colorUsage[hex].total++;
    }

    var allEls = document.querySelectorAll(
      'h1,h2,h3,h4,h5,h6,p,a,span,button,nav,header,section,footer,main,div,li,input,textarea,aside,article'
    );
    allEls.forEach(function(el) {
      var s = getComputedStyle(el);
      var r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return;

      var tc = rgbToHex(s.color);
      var bg = rgbToHex(s.backgroundColor);
      var bc = rgbToHex(s.borderColor);
      var tag = el.tagName;
      var cls = (el.className && typeof el.className === 'string') ? el.className : '';

      if (tc) bumpColor(tc, 'text');

      if (bg) {
        bumpColor(bg, 'bg');
        // Large surface = section background
        if ((tag === 'SECTION' || tag === 'MAIN' || tag === 'ARTICLE') && r.width > 400 && r.height > 200) {
          bumpColor(bg, 'sectionBg');
        }
        // Button background
        if (tag === 'BUTTON' || /\b(btn|button)\b/i.test(cls)) {
          bumpColor(bg, 'buttonBg');
        }
      }

      if (bc && (parseFloat(s.borderWidth) || 0) > 0 && s.borderStyle !== 'none') {
        bumpColor(bc, 'border');
        // Pill/tag border: small, fully rounded, outlined
        var br = parseFloat(s.borderRadius) || 0;
        if (br >= 100 && r.width < 240 && r.height < 50) {
          bumpColor(bc, 'pillBorder');
        }
      }
    });

    // Add selection color if detected from stylesheets
    if (interactions.selection && interactions.selection.bg) {
      bumpColor(interactions.selection.bg, 'selection');
    }

    // Classify each color's role
    var classified = [];
    Object.keys(colorUsage).forEach(function(hex) {
      var u = colorUsage[hex];
      if (u.total < 2) return; // skip noise
      u.role = classifyColorRole(hex, u, bodyBg, bodyColor);
      u.name = colorName(hex);
      classified.push({hex: hex, u: u});
    });

    // Order by role priority (surface-base → primary-text → borders → surfaces → brand → accents)
    var ROLE_ORDER = [
      'surface-base', 'primary-text', 'border-subtle', 'border-tag',
      'surface-section', 'surface-neutral', 'brand-primary',
      'accent-selection', 'accent', 'accent-decorative', 'text-secondary'
    ];
    classified.sort(function(a, b) {
      var ai = ROLE_ORDER.indexOf(a.u.role);
      var bi = ROLE_ORDER.indexOf(b.u.role);
      if (ai === -1) ai = 999;
      if (bi === -1) bi = 999;
      if (ai !== bi) return ai - bi;
      return b.u.total - a.u.total;
    });

    // Output grouped by role
    var ROLE_LABEL = {
      'surface-base':      'Background (Base)',
      'primary-text':      'Primary Text & Elements',
      'border-subtle':     'Borders & Grid Lines',
      'border-tag':        'Tag Borders',
      'surface-section':   'Section Surfaces',
      'surface-neutral':   'Neutral Surfaces',
      'brand-primary':     'Brand Primary',
      'accent-selection':  'Accent (Selection)',
      'accent':            'Accent',
      'accent-decorative': 'Accent (Decorative)',
      'text-secondary':    'Secondary Text'
    };
    var seenRoles = {};
    var accentIndex = 0;
    classified.slice(0, 12).forEach(function(c) {
      var role = c.u.role;
      var label = ROLE_LABEL[role] || 'Other';
      // Number accents (Accent 1, Accent 2, Accent 3) like Aura
      if (role === 'accent' || role === 'accent-decorative') {
        accentIndex++;
        label = 'Accent ' + accentIndex + (role === 'accent-decorative' ? ' (Decorative)' : '');
      }
      var ctxList = [];
      if (c.u.selection > 0) ctxList.push('selection');
      if (c.u.sectionBg > 0) ctxList.push('section backgrounds');
      if (c.u.buttonBg > 0) ctxList.push('buttons');
      if (c.u.pillBorder > 0) ctxList.push('tag borders');
      var ctxStr = ctxList.length > 0 ? ' — used for ' + ctxList.join(', ') : '';
      md.push('- **' + label + '**: `' + c.hex + '` (' + c.u.name + ') → `bg-[' + c.hex + ']` / `text-[' + c.hex + ']` / `border-[' + c.hex + ']`' + ctxStr);
    });
    md.push('');

    // ── Typography ──
    md.push('## Typography\n');
    var fontMap = {}; // fontFamily → {weights: Set, usedIn: [], sizes: Set, lineHeights: Set, letterSpacings: Set}
    document.querySelectorAll('h1,h2,h3,h4,h5,h6,p,a,span,button,li,label,input,td,th,blockquote,figcaption').forEach(function(el) {
      var s = getComputedStyle(el);
      var r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return;
      var ff = s.fontFamily.split(',')[0].replace(/['"]/g, '').trim();
      if (!ff) return;
      if (!fontMap[ff]) fontMap[ff] = {weights: new Set(), usedIn: new Set(), sizes: new Set(), lineHeights: new Set(), letterSpacings: new Set()};
      var fm = fontMap[ff];
      fm.weights.add(s.fontWeight);
      fm.sizes.add(s.fontSize);
      if (s.letterSpacing && s.letterSpacing !== 'normal') fm.letterSpacings.add(s.letterSpacing);
      if (s.lineHeight && s.lineHeight !== 'normal') fm.lineHeights.add(s.lineHeight);

      var tag = el.tagName.toLowerCase();
      if (/^h[1-6]$/.test(tag)) fm.usedIn.add('headings');
      else if (tag === 'p' || tag === 'span' || tag === 'li') fm.usedIn.add('body text');
      else if (tag === 'a') fm.usedIn.add('links');
      else if (tag === 'button' || tag === 'input') fm.usedIn.add('UI elements');
      else if (tag === 'blockquote') fm.usedIn.add('quotes');
      else if (tag === 'figcaption' || tag === 'label') fm.usedIn.add('labels');
    });

    // Detect if monospace is used (important design signal)
    var hasMonospace = false;
    Object.keys(fontMap).forEach(function(ff) {
      var lower = ff.toLowerCase();
      if (lower.indexOf('mono') !== -1 || lower === 'courier' || lower === 'courier new' || lower === 'consolas') {
        hasMonospace = true;
      }
    });

    Object.keys(fontMap).forEach(function(ff) {
      var fm = fontMap[ff];
      var lower = ff.toLowerCase();
      var isMono = lower.indexOf('mono') !== -1 || lower === 'courier' || lower === 'courier new' || lower === 'consolas';
      md.push('### ' + (isMono ? 'Monospace: ' : 'Sans-Serif: ') + ff);

      // Weights with Tailwind class annotations
      var weightList = [...fm.weights].sort().map(function(w) {
        var tw = fontWeightToTw(w);
        return tw ? w + ' (`' + tw + '`)' : w;
      });
      md.push('- **Weights**: ' + weightList.join(', '));
      md.push('- **Used in**: ' + [...fm.usedIn].join(', '));

      // Sizes with Tailwind class annotations
      var sizes = [...fm.sizes].sort(function(a, b) { return parseFloat(a) - parseFloat(b); });
      if (sizes.length > 0) {
        var sizeList = sizes.slice(0, 8).map(function(sz) {
          var tw = fontSizeToTw(sz);
          return tw ? sz + ' (`' + tw + '`)' : sz;
        });
        md.push('- **Sizes**: ' + sizeList.join(', '));
      }

      // Letter-spacing with Tailwind class annotations
      if (fm.letterSpacings.size > 0) {
        var lsList = [...fm.letterSpacings].slice(0, 3).map(function(ls) {
          // Use a representative font size from this family for em conversion
          var repFs = sizes[Math.floor(sizes.length / 2)] || '16px';
          var tw = trackingToTw(ls, repFs);
          return tw ? ls + ' (`' + tw + '`)' : ls;
        });
        md.push('- **Letter-spacing**: ' + lsList.join(', '));
      }
      md.push('');
    });

    // Heading hierarchy with full Tailwind annotations
    md.push('### Hierarchy');
    ['h1','h2','h3','h4'].forEach(function(tag) {
      var el = document.querySelector(tag);
      if (!el) return;
      var s = getComputedStyle(el);
      var parts = [];
      var fsTw = fontSizeToTw(s.fontSize);
      var fwTw = fontWeightToTw(s.fontWeight);
      var lhTw = lineHeightToTw(s.lineHeight, s.fontSize);
      var lsTw = trackingToTw(s.letterSpacing, s.fontSize);
      parts.push(s.fontSize + (fsTw ? ' (`' + fsTw + '`)' : ''));
      parts.push('weight ' + s.fontWeight + (fwTw ? ' (`' + fwTw + '`)' : ''));
      if (s.lineHeight && s.lineHeight !== 'normal') {
        parts.push('line-height ' + s.lineHeight + (lhTw ? ' (`' + lhTw + '`)' : ''));
      }
      if (s.letterSpacing && s.letterSpacing !== 'normal' && lsTw) {
        parts.push('(`' + lsTw + '`)');
      }
      md.push('- **' + tag.toUpperCase() + '**: ' + parts.join(', '));
    });
    md.push('');

    // ── Elevation ──
    md.push('## Elevation\n');
    var hasShadows = false;
    var hasBorders = false;
    var borderWidths = new Set();
    document.querySelectorAll('div,section,header,footer,nav,article,aside,main').forEach(function(el) {
      var s = getComputedStyle(el);
      var r = el.getBoundingClientRect();
      if (r.width < 100 || r.height < 30) return;
      if (s.boxShadow && s.boxShadow !== 'none') hasShadows = true;
      var bw = parseFloat(s.borderWidth) || 0;
      if (bw > 0 && s.borderStyle !== 'none') {
        hasBorders = true;
        borderWidths.add(s.borderWidth);
      }
    });

    if (hasBorders && !hasShadows) {
      md.push('- **Strategy**: Border-driven separation (no heavy shadows)');
    } else if (hasShadows && !hasBorders) {
      md.push('- **Strategy**: Shadow-based elevation');
    } else if (hasShadows && hasBorders) {
      md.push('- **Strategy**: Mixed (borders + shadows)');
    }
    if (borderWidths.size > 0) md.push('- **Border widths**: ' + [...borderWidths].slice(0, 4).join(', '));

    // Background patterns detection
    var bgPatterns = new Set();
    document.querySelectorAll('*').forEach(function(el) {
      var s = getComputedStyle(el);
      var bgImg = s.backgroundImage;
      if (bgImg && bgImg !== 'none') {
        if (bgImg.indexOf('url(') !== -1 && bgImg.indexOf('data:') === -1) {
          var match = bgImg.match(/url\(["']?([^"')]+)["']?\)/);
          if (match && match[1].indexOf('.svg') !== -1) bgPatterns.add(match[1]);
        }
      }
    });
    if (bgPatterns.size > 0) {
      md.push('- **Background textures**: SVG patterns detected (' + bgPatterns.size + ')');
    }
    md.push('');

    // ── Components ──
    md.push('## Components\n');

    // Match the hover state from stylesheets to this specific element
    function findHoverForElement(el) {
      if (!el || !interactions.hovers.length) return null;
      var tag = el.tagName.toLowerCase();
      var cls = (el.className && typeof el.className === 'string') ? el.className.split(/\s+/).filter(Boolean) : [];
      for (var i = 0; i < interactions.hovers.length; i++) {
        var sel = interactions.hovers[i].selector;
        // Match on tag
        if (sel.indexOf(tag + ':hover') !== -1) return interactions.hovers[i].props;
        // Match on class
        for (var j = 0; j < cls.length; j++) {
          if (sel.indexOf('.' + cls[j] + ':hover') !== -1) return interactions.hovers[i].props;
        }
      }
      return null;
    }

    // Build a Tailwind class string summary for one element
    function elementToTwSummary(el) {
      var s = getComputedStyle(el);
      var parts = [];

      // Background
      var bg = rgbToHex(s.backgroundColor);
      if (bg) parts.push('bg-[' + bg + ']');

      // Text color
      var color = rgbToHex(s.color);
      if (color) parts.push('text-[' + color + ']');

      // Border (if any)
      var bw = parseFloat(s.borderWidth) || 0;
      if (bw > 0 && s.borderStyle !== 'none') {
        var bc = rgbToHex(s.borderColor);
        parts.push('border' + (bw > 1 ? '-' + Math.round(bw) : ''));
        if (bc) parts.push('border-[' + bc + ']');
      }

      // Border-radius
      var br = parseFloat(s.borderRadius) || 0;
      if (br > 0) {
        var rtw = radiusToTw(br);
        if (rtw) parts.push(rtw);
      }

      // Padding (x/y if asymmetric, or all)
      var pt = parseFloat(s.paddingTop) || 0;
      var pb = parseFloat(s.paddingBottom) || 0;
      var pl = parseFloat(s.paddingLeft) || 0;
      var pr = parseFloat(s.paddingRight) || 0;
      if (pt === pb && pl === pr && pt > 0) {
        if (pt === pl) {
          var ptw = pxToTw(pt, 'padding'); if (ptw) parts.push(ptw);
        } else {
          var pxTw = pxToTw(pl, 'padding-x'); if (pxTw) parts.push(pxTw);
          var pyTw = pxToTw(pt, 'padding-y'); if (pyTw) parts.push(pyTw);
        }
      }

      // Font size
      if (s.fontSize) {
        var fs = fontSizeToTw(s.fontSize);
        if (fs) parts.push(fs);
      }

      // Font weight
      if (s.fontWeight) {
        var fw = fontWeightToTw(s.fontWeight);
        if (fw && fw !== 'font-normal') parts.push(fw);
      }

      // Hover state (if matched from stylesheets)
      var hover = findHoverForElement(el);
      if (hover) {
        if (hover.bg)        parts.push('hover:bg-[' + hover.bg + ']');
        if (hover.color)     parts.push('hover:text-[' + hover.color + ']');
        if (hover.opacity)   parts.push('hover:opacity-' + Math.round(parseFloat(hover.opacity) * 100));
      }

      return parts.join(' ');
    }

    // Group elements by visual signature (so we describe component TYPES not every instance)
    function signatureOf(el) {
      var s = getComputedStyle(el);
      var br = parseFloat(s.borderRadius) || 0;
      var bw = parseFloat(s.borderWidth) || 0;
      var bg = rgbToHex(s.backgroundColor) || 'none';
      var hasBorder = bw > 0 && s.borderStyle !== 'none';
      return bg + '|' + (br >= 100 ? 'pill' : br >= 12 ? 'rounded' : 'square') + '|' + (hasBorder ? 'border' : 'solid');
    }

    // ── Buttons ──
    var buttons = document.querySelectorAll('button, a[class*="btn"], a[class*="button"], [role="button"]');
    var btnBySig = {};
    buttons.forEach(function(btn) {
      var r = btn.getBoundingClientRect();
      if (r.width < 10 || r.height < 10) return;
      var sig = signatureOf(btn);
      if (!btnBySig[sig]) btnBySig[sig] = {count: 0, example: btn};
      btnBySig[sig].count++;
    });
    var btnVariants = Object.values(btnBySig).sort(function(a, b) { return b.count - a.count; }).slice(0, 4);
    if (btnVariants.length > 0) {
      md.push('### Buttons');
      btnVariants.forEach(function(v, i) {
        var tw = elementToTwSummary(v.example);
        // Inner icon container detection (e.g., a circular div inside the button)
        var innerIconContainer = '';
        var kids = v.example.querySelectorAll(':scope > *');
        for (var k = 0; k < kids.length; k++) {
          var ks = getComputedStyle(kids[k]);
          var kr = kids[k].getBoundingClientRect();
          if (kr.width > 0 && kr.width === kr.height && (parseFloat(ks.borderRadius) || 0) >= kr.width / 2) {
            var kbg = rgbToHex(ks.backgroundColor);
            if (kbg) innerIconContainer = ', inner icon container `rounded-full bg-[' + kbg + ']`';
            break;
          }
        }
        md.push('- **Variant ' + (i + 1) + '** (' + v.count + ' instances): `' + tw + '`' + innerIconContainer);
      });
      md.push('');
    }

    // ── Pills / Tags ──
    var pillEls = [];
    document.querySelectorAll('span, div, a').forEach(function(el) {
      var s = getComputedStyle(el);
      var r = el.getBoundingClientRect();
      if (r.width < 30 || r.width > 240 || r.height > 50 || r.height < 18) return;
      var br = parseFloat(s.borderRadius) || 0;
      if (br < 100) return;
      var bw = parseFloat(s.borderWidth) || 0;
      var hasBorder = bw > 0 && s.borderStyle !== 'none';
      var hasBg = s.backgroundColor && !/rgba?\([^,]+,[^,]+,[^,]+,\s*0\)/.test(s.backgroundColor);
      if (!hasBorder && !hasBg) return;
      pillEls.push(el);
    });
    if (pillEls.length > 0) {
      var pillBySig = {};
      pillEls.forEach(function(p) {
        var sig = signatureOf(p);
        if (!pillBySig[sig]) pillBySig[sig] = {count: 0, example: p};
        pillBySig[sig].count++;
      });
      var pillVariants = Object.values(pillBySig).sort(function(a, b) { return b.count - a.count; }).slice(0, 3);
      md.push('### Pills / Tags');
      pillVariants.forEach(function(v, i) {
        md.push('- **Variant ' + (i + 1) + '** (' + v.count + ' instances): `' + elementToTwSummary(v.example) + '`');
      });
      md.push('');
    }

    // ── Sticky Header summary (descriptive) ──
    if (layout.sticky.length > 0) {
      md.push('### Header');
      layout.sticky.forEach(function(h) {
        var line = '- **' + h.tag + '**: `sticky top-0 z-50';
        if (h.heightTw) line += ' ' + h.heightTw;
        if (h.backdropFilter) line += ' backdrop-blur-md';
        if (h.bgColor) line += ' bg-[' + h.bgColor + ']';
        line += '`';
        md.push(line);
      });
      md.push('');
    }

    // Legacy animation presence detection (kept for Do's/Don'ts logic)
    var hasMarquee = interactions.hasMarquee;
    var hasAnimations = interactions.keyframes.length > 0;
    document.querySelectorAll('*').forEach(function(el) {
      if (hasMarquee && hasAnimations) return;
      var s = getComputedStyle(el);
      if (s.animation && s.animation !== 'none') {
        hasAnimations = true;
        if (s.animation.indexOf('marquee') !== -1 || s.animation.indexOf('scroll') !== -1) hasMarquee = true;
      }
    });
    md.push('');

    // ── Graphic Elements & Shapes ──
    // Detect decorative elements: solid-colored divs with extreme border-radii,
    // rotation, and no text content. These are the abstract graphic blocks
    // a designer places around headlines (litebox-style).
    var shapeGroups = { extremeRadius: [], rotated: [], tallPill: [], roundFull: [] };
    var hasExtremeRadii = false;
    var hasRotatedShapes = false;
    var hasTallPills = false;

    document.querySelectorAll('div, span, i, b').forEach(function(el) {
      var r = el.getBoundingClientRect();
      if (r.width < 16 || r.height < 16 || r.width > 600 || r.height > 600) return;
      // Skip elements with meaningful text
      var text = (el.textContent || '').trim();
      if (text.length > 2) return;
      // Skip elements with children that have their own layout
      if (el.children.length > 2) return;

      var s = getComputedStyle(el);
      var bg = rgbToHex(s.backgroundColor);
      if (!bg) return; // must have a solid fill

      var br = parseFloat(s.borderRadius) || 0;
      var transform = s.transform || 'none';
      var hasRotate = transform !== 'none' && /matrix|rotate/.test(transform) && transform !== 'matrix(1, 0, 0, 1, 0, 0)';

      // Extract rotation angle from matrix if present
      var rotateDeg = 0;
      if (hasRotate) {
        var mm = transform.match(/matrix\(([^)]+)\)/);
        if (mm) {
          var parts = mm[1].split(',').map(parseFloat);
          if (parts.length >= 4) rotateDeg = Math.round(Math.atan2(parts[1], parts[0]) * 180 / Math.PI);
        }
      }

      var aspect = r.width / r.height;
      var shapeEntry = {
        bg: bg,
        w: Math.round(r.width),
        h: Math.round(r.height),
        radius: br,
        rotate: rotateDeg,
        radiusTw: radiusToTw(br),
        widthTw: pxToTw(Math.round(r.width), 'width'),
        heightTw: pxToTw(Math.round(r.height), 'height')
      };

      // Classify the shape
      if (br >= 500 || br >= Math.min(r.width, r.height) / 2 - 2) {
        // Fully rounded (pill or circle)
        if (aspect > 0.3 && aspect < 0.75 && r.height > r.width * 1.3) {
          shapeGroups.tallPill.push(shapeEntry);
          hasTallPills = true;
        } else {
          shapeGroups.roundFull.push(shapeEntry);
        }
      } else if (br >= 24) {
        shapeGroups.extremeRadius.push(shapeEntry);
        hasExtremeRadii = true;
      }
      if (hasRotate && Math.abs(rotateDeg) >= 3) {
        shapeGroups.rotated.push(shapeEntry);
        hasRotatedShapes = true;
      }
    });

    var totalShapes = shapeGroups.extremeRadius.length + shapeGroups.rotated.length
                    + shapeGroups.tallPill.length + shapeGroups.roundFull.length;

    if (totalShapes > 0) {
      md.push('## Graphic Elements & Shapes\n');
      md.push('- The design uses CSS-drawn decorative shapes (not images) placed around headings and sections.');

      if (shapeGroups.tallPill.length > 0) {
        var samples = shapeGroups.tallPill.slice(0, 3).map(function(sh) {
          return '`w-[' + sh.w + 'px] h-[' + sh.h + 'px] rounded-full bg-[' + sh.bg + ']`';
        }).join(', ');
        md.push('- **Tall pill shapes** (' + shapeGroups.tallPill.length + '): vertical rounded-full bars, likely decorative punctuation between words. Examples: ' + samples);
      }

      if (shapeGroups.roundFull.length > 0) {
        var samples2 = shapeGroups.roundFull.slice(0, 3).map(function(sh) {
          return '`w-[' + sh.w + 'px] h-[' + sh.h + 'px] rounded-full bg-[' + sh.bg + ']`';
        }).join(', ');
        md.push('- **Round/pill blocks** (' + shapeGroups.roundFull.length + '): ' + samples2);
      }

      if (shapeGroups.extremeRadius.length > 0) {
        var samples3 = shapeGroups.extremeRadius.slice(0, 3).map(function(sh) {
          return '`' + sh.radiusTw + ' bg-[' + sh.bg + ']`';
        }).join(', ');
        md.push('- **Abstract blocks with extreme border-radii** (' + shapeGroups.extremeRadius.length + '): ' + samples3);
      }

      if (shapeGroups.rotated.length > 0) {
        var samples4 = shapeGroups.rotated.slice(0, 3).map(function(sh) {
          return '`rotate-[' + sh.rotate + 'deg] bg-[' + sh.bg + ']`';
        }).join(', ');
        md.push('- **Rotated decorative blocks** (' + shapeGroups.rotated.length + '): ' + samples4);
      }

      md.push('- **Implementation guidance**: reproduce each shape as a `<div>` with Tailwind classes. Do NOT use inline SVG for these — CSS `border-radius` + `transform` is the source technique.');
      md.push('');
    }

    // ── Animations & Interactions ──
    md.push('## Animations & Interactions\n');

    // Selection colors
    if (interactions.selection && (interactions.selection.bg || interactions.selection.color)) {
      var selParts = [];
      if (interactions.selection.bg)    selParts.push('`selection:bg-[' + interactions.selection.bg + ']`');
      if (interactions.selection.color) selParts.push('`selection:text-[' + interactions.selection.color + ']`');
      md.push('- **Custom text selection**: ' + selParts.join(' '));
    }

    // Hover states
    if (interactions.hovers.length > 0) {
      md.push('- **Hover states detected** (preserve these interactions):');
      interactions.hovers.slice(0, 8).forEach(function(h) {
        var parts = [];
        if (h.props.bg)        parts.push('`hover:bg-[' + h.props.bg + ']`');
        if (h.props.color)     parts.push('`hover:text-[' + h.props.color + ']`');
        if (h.props.transform) parts.push('`hover:' + h.props.transform.replace(/\s+/g, '-') + '`');
        if (h.props.opacity)   parts.push('`hover:opacity-' + Math.round(parseFloat(h.props.opacity) * 100) + '`');
        if (h.props.border)    parts.push('`hover:border-[' + h.props.border + ']`');
        md.push('  - `' + h.selector + '` → ' + parts.join(' '));
      });
    }

    // Transitions on interactive elements
    if (interactions.transitions.length > 0) {
      md.push('- **Transitions on interactive elements**:');
      interactions.transitions.forEach(function(t) {
        md.push('  - `' + t + '`');
      });
    }

    // Keyframes (named animations)
    if (interactions.keyframes.length > 0) {
      md.push('- **Named keyframe animations**: `' + interactions.keyframes.join('`, `') + '`');
    }

    // Marquee-specific cue
    if (hasMarquee) {
      md.push('- **Marquee motion**: continuous scrolling text or logo row detected. Implement with `@keyframes` + `animation: marquee <duration> linear infinite` on a track with duplicated content.');
    }

    // Fallback message if nothing detected
    if (!interactions.selection && interactions.hovers.length === 0 && interactions.transitions.length === 0 && !hasMarquee) {
      md.push('- Minimal interactive motion detected on the page.');
    }
    md.push('');

    // ── CSS Custom Properties ──
    var cssVars = [];
    try {
      var sheets = document.styleSheets;
      for (var i = 0; i < sheets.length && cssVars.length < 20; i++) {
        try {
          var rules = sheets[i].cssRules || sheets[i].rules;
          if (!rules) continue;
          for (var j = 0; j < rules.length && cssVars.length < 20; j++) {
            var rule = rules[j];
            if (rule.selectorText === ':root' || rule.selectorText === ':root, :host') {
              for (var k = 0; k < rule.style.length; k++) {
                var prop = rule.style[k];
                if (prop.startsWith('--')) {
                  cssVars.push({name: prop, value: rule.style.getPropertyValue(prop).trim()});
                }
              }
            }
          }
        } catch(e) { /* cross-origin */ }
      }
    } catch(e) {}

    if (cssVars.length > 0) {
      md.push('## CSS Custom Properties\n');
      cssVars.slice(0, 15).forEach(function(v) {
        var val = v.value.slice(0, 60);
        var twHint = '';

        // Infer Tailwind equivalents from the value type
        var hex = rgbToHex(val);
        if (hex) {
          twHint = ' → `bg-[' + hex + ']` / `text-[' + hex + ']` / `border-[' + hex + ']`';
        } else if (/^[\d.]+$/.test(val) && parseFloat(val) > 0 && parseFloat(val) < 3) {
          // Unitless small number — line-height ratio (checked BEFORE numeric px)
          twHint = ' → `leading-[' + val + ']`';
        } else if (/^-?\d+(\.\d+)?(px|rem)$/.test(val)) {
          // Numeric value with explicit unit — spacing or radius token
          var px = parseFloat(val);
          if (/rem$/.test(val)) px = px * 16;
          if (!isNaN(px) && px >= 0 && px <= 500) {
            var twSpacing = pxToTw(px);
            var twRadius  = radiusToTw(px);
            if (twSpacing && twSpacing !== String(px) + 'px') {
              twHint = ' → spacing `' + twSpacing + '` / radius `' + twRadius + '`';
            }
          }
        } else if (/font|serif|sans|mono/i.test(val)) {
          twHint = ' → font-family token';
        }

        md.push('- `' + v.name + '`: `' + val + '`' + twHint);
      });
      md.push('');
    }

    // ── Assets ──
    md.push('## Assets\n');

    // Fonts
    var fontUrls = new Set();
    try {
      var sheets = document.styleSheets;
      for (var i = 0; i < sheets.length; i++) {
        try {
          var rules = sheets[i].cssRules || sheets[i].rules;
          if (!rules) continue;
          for (var j = 0; j < rules.length; j++) {
            if (rules[j].type === CSSRule.FONT_FACE_RULE) {
              var src = rules[j].style.getPropertyValue('src');
              var urlMatch = src.match(/url\(["']?([^"')]+)["']?\)/);
              if (urlMatch) fontUrls.add(urlMatch[1]);
            }
          }
        } catch(e) {}
      }
    } catch(e) {}

    if (fontUrls.size > 0) {
      fontUrls.forEach(function(url) { md.push('- **Font**: ' + url); });
    }

    // Images with context (where they appear, what they likely are)
    var imgEntries = [];
    document.querySelectorAll('img[src]').forEach(function(img) {
      var src = img.src;
      if (!src || src.indexOf('data:') !== -1) return;
      var r = img.getBoundingClientRect();
      if (r.width < 20 || r.height < 20) return;

      // Detect context
      var context = '';
      var alt = (img.alt || '').toLowerCase();
      var cls = ((img.className || '') + ' ' + (img.parentElement ? img.parentElement.className || '' : '')).toLowerCase();
      var parent = img.parentElement;
      var inHeader = false;
      var walk = img;
      for (var w = 0; w < 6 && walk; w++) {
        var tag = walk.tagName;
        if (tag === 'HEADER' || tag === 'NAV') { inHeader = true; break; }
        walk = walk.parentElement;
      }

      if (inHeader || alt.indexOf('logo') !== -1 || cls.indexOf('logo') !== -1 || cls.indexOf('brand') !== -1) {
        context = 'logo';
      } else if (r.width > 600 && r.height > 300) {
        context = 'hero/banner';
      } else if (r.width < 60 && r.height < 60) {
        context = 'icon';
      } else if (alt.indexOf('avatar') !== -1 || cls.indexOf('avatar') !== -1 || (r.width < 100 && r.width === r.height)) {
        context = 'avatar';
      } else {
        context = 'photo';
      }

      imgEntries.push({src: src, context: context, w: Math.round(r.width), h: Math.round(r.height), alt: img.alt || ''});
    });
    if (imgEntries.length > 0) {
      imgEntries.slice(0, 15).forEach(function(e) {
        md.push('- **Image (' + e.context + ')**: `' + e.w + 'x' + e.h + '` ' + (e.alt ? '"' + e.alt.slice(0, 40) + '" ' : '') + e.src);
      });
    }

    // Background-image assets (all URLs used via CSS background-image)
    // Distinct from the Graphic Elements & Shapes section (that one is for
    // CSS-drawn shapes; this one is for raster/vector ASSETS placed via background).
    var bgAssets = [];
    var bgSeen = new Set();
    document.querySelectorAll('*').forEach(function(el) {
      var s = getComputedStyle(el);
      var bi = s.backgroundImage;
      if (!bi || bi === 'none') return;
      if (bi.indexOf('url(') === -1 || bi.indexOf('data:') !== -1) return;
      var m = bi.match(/url\(["']?([^"')]+)["']?\)/);
      if (!m) return;
      var url = m[1];
      if (bgSeen.has(url)) return;
      bgSeen.add(url);

      var r = el.getBoundingClientRect();
      if (r.width < 16 || r.height < 16) return;

      // Classify context by ext + size + ancestry
      var ctx = 'background';
      if (/\.svg(\?|$)/i.test(url)) ctx = 'svg-pattern';
      else if (r.width > 600 && r.height > 300) ctx = 'hero/banner';
      else if (r.width < 80 && r.height < 80) ctx = 'icon';
      // Walk up to header/nav
      var walk = el;
      for (var w = 0; w < 6 && walk; w++) {
        if (walk.tagName === 'HEADER' || walk.tagName === 'NAV') { ctx = 'logo-or-header'; break; }
        walk = walk.parentElement;
      }
      // Detect CSS tiled pattern (repeat)
      if (s.backgroundRepeat === 'repeat' || s.backgroundRepeat === 'repeat-x' || s.backgroundRepeat === 'repeat-y') {
        ctx = 'tiled-texture';
      }

      bgAssets.push({
        url: url,
        ctx: ctx,
        w: Math.round(r.width),
        h: Math.round(r.height),
        size: s.backgroundSize || 'auto',
        position: s.backgroundPosition || '0% 0%'
      });
    });

    if (bgAssets.length > 0) {
      // Sort: logo/hero first, then patterns, then others
      var ctxOrder = {'logo-or-header':1, 'hero/banner':2, 'svg-pattern':3, 'tiled-texture':4, 'icon':5, 'background':6};
      bgAssets.sort(function(a, b) { return (ctxOrder[a.ctx]||9) - (ctxOrder[b.ctx]||9); });
      bgAssets.slice(0, 12).forEach(function(a) {
        md.push('- **Background-image (' + a.ctx + ')**: `' + a.w + 'x' + a.h
              + '` size=`' + a.size + '` position=`' + a.position + '` → ' + a.url);
      });
    }

    // Legacy SVG pattern list (for backward compat — may overlap with above)
    if (bgPatterns.size > 0 && bgAssets.length === 0) {
      [...bgPatterns].slice(0, 10).forEach(function(url) { md.push('- **SVG pattern**: ' + url); });
    }
    md.push('');

    // ── Source Implementation Cues ──
    // Prompt-ready directives that tell the downstream LLM which source
    // behaviors MUST be preserved. These are the "invisible-in-screenshot"
    // rules that distinguish a clone from a reinterpretation.
    var cues = [];

    if (layout.sticky.length > 0) {
      var stickyEl = layout.sticky[0];
      cues.push('Source uses a ' + stickyEl.position + ' `' + stickyEl.tag + '` (height ' + stickyEl.height + 'px'
              + (stickyEl.backdropFilter ? ', with `backdrop-filter: ' + stickyEl.backdropFilter + '`' : '')
              + '). Preserve this positioning and the blur effect exactly.');
    }

    if (layout.sidebars.length > 0) {
      var sb = layout.sidebars[0];
      cues.push('Source has a fixed ' + sb.side + ' sidebar (' + sb.width + 'px wide). Preserve this structural element — it is invisible in a partial screenshot crop but present in the layout.');
    }

    if (layout.gridBackgrounds.length > 0) {
      cues.push('Source uses a graph-paper background pattern (size `' + layout.gridBackgrounds[0].size + '`). Reproduce with linear-gradient, not images.');
    }

    if (interactions.selection) {
      var sb1 = interactions.selection.bg || '?';
      var sf1 = interactions.selection.color || '?';
      cues.push('Source defines custom text selection colors (`selection:bg-[' + sb1 + '] selection:text-[' + sf1 + ']`). Preserve this rule.');
    }

    if (interactions.hovers.length > 0) {
      cues.push('Source has ' + interactions.hovers.length + ' distinct hover states defined. Preserve the exact hover behaviors listed in the Animations & Interactions section — do not substitute generic hover styles.');
    }

    if (hasMarquee) {
      cues.push('Marquee-style motion is present in the source. Implement it with CSS `@keyframes` + duplicated content, not a static section.');
    }

    if (hasTallPills) {
      cues.push('Source uses tall `rounded-full` vertical pill shapes as decorative typographic punctuation (not circles). Reproduce as `<div>` elements with fixed width/height + `rounded-full`, placed inline with the text.');
    }

    if (hasExtremeRadii) {
      cues.push('Source uses abstract blocks with extreme border-radii (≥24px, some full). These are CSS shapes, NOT images. Reproduce each as a `<div>` with `rounded-[Npx]` Tailwind classes. Do NOT replace with inline SVG.');
    }

    if (hasRotatedShapes) {
      cues.push('Source uses slight rotation (`transform: rotate`) on decorative blocks. Preserve these angles — they are intentional visual accents.');
    }

    // Large fluid typography (common in modern brutalist layouts)
    var hasLargeVwType = false;
    ['h1', 'h2'].forEach(function(tag) {
      var el = document.querySelector(tag);
      if (!el) return;
      var fs = parseFloat(getComputedStyle(el).fontSize);
      if (fs > 120) hasLargeVwType = true;
    });
    if (hasLargeVwType) {
      cues.push('Source uses fluid viewport-relative display typography (>120px rendered). Use `text-[Nvw]` or `clamp()` — do not hardcode fixed px sizes that would break on other viewports.');
    }

    if (hasMonospace) {
      cues.push('Source uses a monospace typeface for specific metadata/labels. Preserve the font-family on those elements — do not substitute sans.');
    }

    if (hasBorders && !hasShadows) {
      cues.push('Source separates surfaces with 1px borders (not shadows). Match the border strategy — do not add box-shadows for depth.');
    }

    // CSS custom properties presence signals a tokenized design system
    if (cssVars.length >= 4) {
      cues.push('Source defines ' + cssVars.length + '+ CSS custom properties in `:root`. Preserve these token names when possible; they encode the design system.');
    }

    if (cues.length > 0) {
      md.push('## Source Implementation Cues\n');
      md.push('These are MUST-preserve behaviors detected in the source. They are often invisible in the screenshot alone:');
      md.push('');
      cues.forEach(function(cue) { md.push('- ' + cue); });
      md.push('');
    }

    // ── Do's and Don'ts (auto-generated from patterns) ──
    md.push("## Do's and Don'ts\n");
    if (hasMonospace) md.push('- **Do**: Use monospaced fonts for technical/metadata labels as the source does.');
    if (hasBorders && !hasShadows) md.push("- **Don't**: Use heavy box shadows; the source uses thin borders for elevation.");
    if (hasShadows && !hasBorders) md.push('- **Do**: Use box shadows for depth as the source does.');
    if (theme === 'dark') md.push('- **Do**: Maintain high contrast between dark backgrounds and light text.');
    if (bgPatterns.size > 0) md.push('- **Do**: Use SVG background patterns to break up monochromatic sections.');
    md.push("- **Don't**: Replace the source's font families with system defaults.");
    md.push("- **Don't**: Add design interpretation beyond what's visible in the screenshot.");
    md.push('');

    // ── Compose the tone sentence retroactively into the Overview slot ──
    // Uses every signal we collected: borders vs shadows, fluid typography,
    // decorative shapes, palette warmth, accent saturation.
    var adjectives = [];
    var techniques = [];

    // Structural personality
    if (hasBorders && !hasShadows) adjectives.push('brutalist-leaning');
    else if (hasShadows && !hasBorders) adjectives.push('soft and elevated');
    if (hasLargeVwType) adjectives.push('bold');

    // Shape personality
    var shapePersonality = '';
    if (hasTallPills || hasExtremeRadii || hasRotatedShapes) {
      shapePersonality = 'friendly';
      techniques.push('decorative CSS shapes');
    }
    if (hasRotatedShapes) techniques.push('slight rotations');

    // Typography as a technique
    if (hasLargeVwType) techniques.push('oversized display typography');

    // Layout techniques
    if (hasBorders && !hasShadows) techniques.push('thin visible borders');
    if (layout.gridBackgrounds.length > 0) techniques.push('a graph-paper background');

    // Palette warmth + saturation
    var paletteDescriptor = '';
    var bodyBgName = colorName(bodyBg);
    var isWarmBase = /beige|orange|yellow|red|pink/.test(bodyBgName);
    var isCoolBase = /slate|blue|teal|indigo/.test(bodyBgName);
    var hasVibrantAccent = false;
    try {
      classified.forEach(function(c) {
        if (c.u.role.indexOf('accent') !== -1 && c.u.name.indexOf('vibrant') !== -1) hasVibrantAccent = true;
      });
    } catch(e) {}
    if (isWarmBase && hasVibrantAccent) paletteDescriptor = 'earthy-yet-vibrant';
    else if (isWarmBase) paletteDescriptor = 'warm, earthy';
    else if (isCoolBase && hasVibrantAccent) paletteDescriptor = 'cool with vibrant accents';
    else if (hasVibrantAccent) paletteDescriptor = 'high-contrast with vibrant accents';
    else paletteDescriptor = 'restrained';

    if (shapePersonality && adjectives.indexOf('brutalist-leaning') !== -1) {
      // The "brutalist yet friendly" paradox that defines this style
      adjectives = adjectives.map(function(a) { return a === 'brutalist-leaning' ? 'brutalist-inspired yet friendly' : a; });
    } else if (shapePersonality) {
      adjectives.push(shapePersonality);
    }

    function joinNatural(arr) {
      if (arr.length === 0) return '';
      if (arr.length === 1) return arr[0];
      if (arr.length === 2) return arr[0] + ' and ' + arr[1];
      return arr.slice(0, -1).join(', ') + ', and ' + arr[arr.length - 1];
    }
    var adjStr = adjectives.length > 0 ? joinNatural(adjectives) : 'minimal';
    var techStr = techniques.length > 0 ? ' that relies on ' + joinNatural(techniques) : '';
    var palStr = paletteDescriptor ? ' — ' + paletteDescriptor + ' color palette' : '';
    md[toneSlotIndex] = '- **Tone**: A ' + adjStr + ' design' + techStr + palStr + '.';

    return md.join('\n');
  };

  // ─── Full extraction ───────────────────────────────────────────────────────

  RB.extract = function() {
    return {
      tokens: RB.extractTokens(),
      cleanHTML: RB.extractCleanHTML(),
      sections: RB.extractSectionBounds(),
      designMD: RB.generateDesignMD(),
      pageUrl: location.href,
      pageTitle: document.title,
      viewport: { w: window.innerWidth, h: window.innerHeight }
    };
  };

  return RB;
})();
