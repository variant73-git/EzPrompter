// RepixBridge — Design System Extractor
// Runs in page context. Returns tokens, clean HTML, section bounds, and DESIGN.md.
// Deterministic: no AI, no interpretation — just computed values.

(function() {
  if (window.__rbExtractor) return window.__rbExtractor;

  const RB = window.__rbExtractor = {};

  // ─── Color utilities ───────────────────────────────────────────────────────

  function rgbToHex(rgb) {
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
    md.push('- **Theme**: ' + theme + ' mode (background: `' + bodyBg + '`, text: `' + bodyColor + '`)');
    md.push('- **Primary font**: ' + bodyFont);
    md.push('- **URL**: ' + location.href);
    md.push('- **Title**: ' + (document.title || '').slice(0, 60));
    md.push('- **Viewport**: ' + window.innerWidth + ' x ' + window.innerHeight);
    md.push('');

    // ── Colors ──
    md.push('## Colors\n');
    var colorUsage = {}; // hex → {text: n, bg: n, border: n}
    var allEls = document.querySelectorAll('h1,h2,h3,h4,h5,h6,p,a,span,button,nav,header,section,footer,main,div,li,input,textarea');
    allEls.forEach(function(el) {
      var s = getComputedStyle(el);
      var r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return;

      var tc = rgbToHex(s.color);
      var bg = rgbToHex(s.backgroundColor);
      var bc = rgbToHex(s.borderColor);

      if (tc) {
        if (!colorUsage[tc]) colorUsage[tc] = {text: 0, bg: 0, border: 0};
        colorUsage[tc].text++;
      }
      if (bg) {
        if (!colorUsage[bg]) colorUsage[bg] = {text: 0, bg: 0, border: 0};
        colorUsage[bg].bg++;
      }
      if (bc && (parseFloat(s.borderWidth) || 0) > 0 && s.borderStyle !== 'none') {
        if (!colorUsage[bc]) colorUsage[bc] = {text: 0, bg: 0, border: 0};
        colorUsage[bc].border++;
      }
    });

    // Categorize colors
    var brandColors = [];
    var textColors = [];
    var bgColors = [];
    var borderColors = [];

    Object.keys(colorUsage).forEach(function(hex) {
      var u = colorUsage[hex];
      var total = u.text + u.bg + u.border;
      if (total < 2) return; // skip noise
      if (u.text > u.bg && u.text > u.border) textColors.push({hex: hex, count: u.text});
      else if (u.bg > u.border) bgColors.push({hex: hex, count: u.bg});
      else borderColors.push({hex: hex, count: u.border});
    });

    // Top colors are likely brand
    var allByTotal = Object.entries(colorUsage)
      .map(function(e) { return {hex: e[0], total: e[1].text + e[1].bg + e[1].border}; })
      .filter(function(e) { return e.total >= 3 && e.hex !== '#000000' && e.hex !== '#ffffff' && e.hex !== bodyBg && e.hex !== bodyColor; })
      .sort(function(a, b) { return b.total - a.total; })
      .slice(0, 5);

    if (allByTotal.length > 0) {
      md.push('### Brand / Accent');
      allByTotal.forEach(function(c) { md.push('- `' + c.hex + '` (used ' + c.total + ' times)'); });
      md.push('');
    }

    md.push('### Text Colors');
    textColors.sort(function(a, b) { return b.count - a.count; });
    textColors.slice(0, 6).forEach(function(c) { md.push('- `' + c.hex + '` (' + c.count + ' elements)'); });
    md.push('');

    md.push('### Background Colors');
    bgColors.sort(function(a, b) { return b.count - a.count; });
    bgColors.slice(0, 6).forEach(function(c) { md.push('- `' + c.hex + '` (' + c.count + ' elements)'); });
    md.push('');

    if (borderColors.length > 0) {
      md.push('### Border Colors');
      borderColors.sort(function(a, b) { return b.count - a.count; });
      borderColors.slice(0, 4).forEach(function(c) { md.push('- `' + c.hex + '` (' + c.count + ' elements)'); });
      md.push('');
    }

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
      md.push('- **Weights**: ' + [...fm.weights].sort().join(', '));
      md.push('- **Used in**: ' + [...fm.usedIn].join(', '));
      var sizes = [...fm.sizes].sort(function(a, b) { return parseFloat(a) - parseFloat(b); });
      if (sizes.length > 0) md.push('- **Sizes**: ' + sizes.slice(0, 6).join(', '));
      if (fm.letterSpacings.size > 0) md.push('- **Letter-spacing**: ' + [...fm.letterSpacings].slice(0, 3).join(', '));
      md.push('');
    });

    // Heading hierarchy
    md.push('### Hierarchy');
    ['h1','h2','h3','h4'].forEach(function(tag) {
      var el = document.querySelector(tag);
      if (!el) return;
      var s = getComputedStyle(el);
      md.push('- **' + tag.toUpperCase() + '**: ' + s.fontSize + ', weight ' + s.fontWeight + ', line-height ' + s.lineHeight);
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

    // Buttons
    var buttons = document.querySelectorAll('button, a[class*="btn"], a[class*="button"], [role="button"]');
    if (buttons.length > 0) {
      var btnStyles = new Set();
      buttons.forEach(function(btn) {
        var s = getComputedStyle(btn);
        var r = btn.getBoundingClientRect();
        if (r.width < 10) return;
        var bg = rgbToHex(s.backgroundColor);
        var border = (parseFloat(s.borderWidth) || 0) > 0 && s.borderStyle !== 'none';
        if (bg && !isLight(bg) && !border) btnStyles.add('solid-dark');
        else if (bg && isLight(bg) && !border) btnStyles.add('solid-light');
        else if (border) btnStyles.add('outline');
      });
      md.push('- **Buttons**: ' + [...btnStyles].join(', ') + ' variants (' + buttons.length + ' total)');
    }

    // Sticky header
    var header = document.querySelector('header, nav');
    if (header) {
      var hs = getComputedStyle(header);
      if (hs.position === 'sticky' || hs.position === 'fixed') {
        md.push('- **Sticky Header**: ' + hs.position + ', height ' + header.getBoundingClientRect().height + 'px');
      }
    }

    // Marquee/animation detection
    var hasMarquee = false;
    var hasAnimations = false;
    document.querySelectorAll('*').forEach(function(el) {
      var s = getComputedStyle(el);
      if (s.animation && s.animation !== 'none') {
        hasAnimations = true;
        if (s.animation.indexOf('marquee') !== -1 || s.animation.indexOf('scroll') !== -1) hasMarquee = true;
      }
    });
    if (hasMarquee) md.push('- **Marquee**: Scrolling content animation detected');
    if (hasAnimations) md.push('- **Motion**: CSS animations present');
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
        md.push('- `' + v.name + '`: `' + v.value.slice(0, 60) + '`');
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

    // Background SVG patterns
    if (bgPatterns.size > 0) {
      [...bgPatterns].slice(0, 10).forEach(function(url) { md.push('- **Background**: ' + url); });
    }
    md.push('');

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
