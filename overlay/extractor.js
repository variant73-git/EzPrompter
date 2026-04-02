// RepixBridge — CSS Token Extractor
// Runs in page context. Returns tokens + clean HTML + element bounds.
// Deterministic: no AI, no interpretation — just computed values.

(function() {
  if (window.__rbExtractor) return window.__rbExtractor;

  const RB = window.__rbExtractor = {};

  // ─── Color utilities ───────────────────────────────────────────────────────

  function parseColor(str) {
    if (!str || str === 'transparent' || str === 'rgba(0, 0, 0, 0)') return null;
    const d = document.createElement('div');
    d.style.color = str;
    document.body.appendChild(d);
    const computed = getComputedStyle(d).color;
    document.body.removeChild(d);
    return computed || null;
  }

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

  // ─── Token extraction ──────────────────────────────────────────────────────

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

      // Colors
      [s.color, s.backgroundColor, s.borderColor].forEach(c => {
        const hex = rgbToHex(c);
        if (hex && hex !== '#000000' && hex !== '#ffffff') {
          colorFreq[hex] = (colorFreq[hex] || 0) + 1;
        }
      });

      // Always include pure black/white if used
      if (s.color === 'rgb(0, 0, 0)') colorFreq['#000000'] = (colorFreq['#000000'] || 0) + 1;
      if (s.color === 'rgb(255, 255, 255)') colorFreq['#ffffff'] = (colorFreq['#ffffff'] || 0) + 1;

      // Fonts
      const ff = s.fontFamily.split(',')[0].replace(/['"]/g, '').trim();
      if (ff) fonts.add(ff);

      // Border radius
      const br = s.borderRadius;
      if (br && br !== '0px') radii.add(br);

      // Box shadows
      if (s.boxShadow && s.boxShadow !== 'none') shadows.add(s.boxShadow);
    });

    // Sort colors by frequency, deduplicate similar ones
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
  // Strips scripts, styles, event handlers — gives AI clean structure to read

  RB.extractCleanHTML = function() {
    const clone = document.documentElement.cloneNode(true);

    // Remove noise
    clone.querySelectorAll(
      'script,style,link[rel="stylesheet"],noscript,svg,canvas,iframe,video,audio'
    ).forEach(el => el.remove());

    // Strip event handlers and data attributes
    clone.querySelectorAll('*').forEach(el => {
      [...el.attributes].forEach(attr => {
        if (attr.name.startsWith('on') || attr.name.startsWith('data-')) {
          el.removeAttribute(attr.name);
        }
      });
    });

    // Keep only body, limit depth to 4 levels for brevity
    const body = clone.querySelector('body');
    if (!body) return '';

    return trimDepth(body, 4).innerHTML
      .replace(/\s{2,}/g, ' ')
      .replace(/>\s+</g, '><')
      .trim()
      .slice(0, 12000); // ~12k chars is enough for AI
  };

  function trimDepth(el, maxDepth, current = 0) {
    if (current >= maxDepth) {
      el.innerHTML = el.textContent.trim().slice(0, 80) || '';
      return el;
    }
    [...el.children].forEach(child => trimDepth(child, maxDepth, current + 1));
    return el;
  }

  // ─── Section bounds ────────────────────────────────────────────────────────
  // Maps real DOM elements to their visual positions

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
    if (el.id) return `#${el.id}`;
    if (el.className && typeof el.className === 'string') {
      const cls = el.className.trim().split(/\s+/)[0];
      if (cls) return `${el.tagName.toLowerCase()}.${cls}`;
    }
    return el.tagName.toLowerCase();
  }

  // ─── Full extraction ───────────────────────────────────────────────────────

  RB.extract = function() {
    return {
      tokens: RB.extractTokens(),
      cleanHTML: RB.extractCleanHTML(),
      sections: RB.extractSectionBounds(),
      pageUrl: location.href,
      pageTitle: document.title,
      viewport: { w: window.innerWidth, h: window.innerHeight }
    };
  };

  return RB;
})();
