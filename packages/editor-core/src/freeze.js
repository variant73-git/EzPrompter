// RepixBridge — Animation Freeze
// Kills animations and forces all elements to their final visual state

(function() {
  'use strict';

  // CSS that forces all elements to final state
  var FREEZE_CSS = [
    '/* RepixBridge Freeze — kill all animations */',
    '*, *::before, *::after {',
    '  animation: none !important;',
    '  animation-play-state: paused !important;',
    '  transition: none !important;',
    '  scroll-behavior: auto !important;',
    '}',
    '',
    '/* Force smooth scroll libraries to stop */',
    'html.lenis, html.lenis body { scroll-behavior: auto !important; }',
    '.lenis-content, [data-lenis-prevent] { transform: none !important; }',
    '',
    '/* Kill custom cursors and preloaders */',
    '[class*="cursor"], [class*="loader"], [class*="preload"] {',
    '  display: none !important;',
    '}'
  ].join('\n');

  // Webflow-specific freeze
  function freezeWebflow(features) {
    // 1. Kill GSAP timeline
    if (features.gsap && window.gsap) {
      try {
        gsap.globalTimeline.pause();
        // Kill all tweens and timelines
        gsap.killTweensOf('*');
        // Get all ScrollTrigger instances and kill them
        if (gsap.ScrollTrigger) {
          gsap.ScrollTrigger.getAll().forEach(function(st) {
            // Force each trigger to its end state before killing
            st.scroll(st.end);
            st.kill();
          });
        }
        if (window.ScrollTrigger) {
          ScrollTrigger.getAll().forEach(function(st) {
            st.scroll(st.end);
            st.kill();
          });
        }
      } catch(e) { console.warn('[RB Freeze] GSAP kill error:', e); }
    }

    // 2. Kill Lenis smooth scroll
    if (features.lenis) {
      try {
        if (window.__lenis) window.__lenis.destroy();
        if (window.lenis) window.lenis.destroy();
        // Some sites store it differently
        document.querySelectorAll('[data-lenis-prevent]').forEach(function(el) {
          el.removeAttribute('data-lenis-prevent');
        });
      } catch(e) { console.warn('[RB Freeze] Lenis kill error:', e); }
    }

    // 3. Kill Webflow Interactions IX2/IX3
    if (window.Webflow) {
      try {
        var ix2 = Webflow.require('ix2');
        if (ix2 && ix2.destroy) ix2.destroy();
      } catch(e) {}
    }

    // 4. Force GSAP split text elements to final state
    document.querySelectorAll('[class*="gsap_split"]').forEach(function(el) {
      el.style.setProperty('transform', 'none', 'important');
      el.style.setProperty('opacity', '1', 'important');
      // Remove clip masks
      if (el.style.overflow === 'clip' || el.style.overflow === 'hidden') {
        el.style.overflow = 'visible';
      }
    });

    // 5. Force all hidden-by-animation elements to visible
    forceRevealAll();
  }

  // Framer-specific freeze (placeholder for future)
  function freezeFramer() {
    // Kill Framer Motion
    if (window.__framer_importedModules) {
      try {
        // Framer stores motion values in CSS custom properties
        document.querySelectorAll('[style*="--framer-"]').forEach(function(el) {
          el.style.setProperty('opacity', '1', 'important');
        });
      } catch(e) {}
    }
    forceRevealAll();
  }

  // Generic freeze — works on any site
  function freezeGeneric() {
    forceRevealAll();
  }

  // Force all elements that were hidden by animations to their final visible state
  function forceRevealAll() {
    // Elements with inline opacity: 0
    document.querySelectorAll('*').forEach(function(el) {
      if (el.id && el.id.indexOf('rb-') === 0) return; // skip our own elements
      var s = el.style;
      // Force opacity
      if (s.opacity === '0') {
        s.setProperty('opacity', '1', 'important');
      }
      // Force transform reveals (translate Y/X used for slide-in animations)
      var t = s.transform || s.webkitTransform || '';
      if (t && t !== 'none') {
        // Check if it's a reveal animation (translate Y > 20px or translate X > 50%)
        var match = t.match(/translate[XY3d]*\([^)]*\)/);
        if (match) {
          var val = match[0];
          // translateY(100%) or translateY(50px) = reveal animation, kill it
          if (val.indexOf('100%') !== -1 || val.indexOf('50px') !== -1 ||
              val.indexOf('80px') !== -1 || val.indexOf('100px') !== -1 ||
              val.indexOf('120px') !== -1 || val.indexOf('200px') !== -1) {
            s.setProperty('transform', 'none', 'important');
          }
        }
      }
      // Force visibility
      if (s.visibility === 'hidden') {
        var cs = getComputedStyle(el);
        // Only force visible if the element has content (not intentionally hidden UI)
        if (el.innerText && el.innerText.trim().length > 0) {
          s.setProperty('visibility', 'visible', 'important');
        }
      }
      // Force clip-path reveals
      if (s.clipPath && s.clipPath !== 'none') {
        var cp = s.clipPath;
        if (cp.indexOf('inset(100%') !== -1 || cp.indexOf('inset(0% 100%') !== -1) {
          s.setProperty('clip-path', 'none', 'important');
        }
      }
    });
  }

  // Main freeze entry point
  window.__rbFreeze = function(builderInfo) {
    // 1. Inject freeze CSS
    var style = document.createElement('style');
    style.id = 'rb-freeze-css';
    style.textContent = FREEZE_CSS;
    document.head.appendChild(style);

    // 2. Apply builder-specific freeze
    var builder = builderInfo ? builderInfo.builder : 'generic';
    switch(builder) {
      case 'webflow': freezeWebflow(builderInfo.features || {}); break;
      case 'framer': freezeFramer(); break;
      default: freezeGeneric(); break;
    }

    console.log('[RepixBridge] Site frozen (' + builder + ')');
    return true;
  };

  // Unfreeze — restore original state (for when user exits editor)
  window.__rbUnfreeze = function() {
    var style = document.getElementById('rb-freeze-css');
    if (style) style.remove();
    // Note: inline style changes from forceRevealAll are NOT reverted
    // A full page reload would be needed for perfect restoration
  };
})();
