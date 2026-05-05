// RepixBridge — Web Builder Detection
// Detects which platform built the current site (TARGET).

(function() {
  'use strict';

  function _target() {
    return (window.__rbTarget && window.__rbTarget.doc) || document;
  }
  function _targetWin() {
    return (window.__rbTarget && window.__rbTarget.win) || window;
  }

  window.__rbDetectBuilder = function() {
    var doc = _target();
    var win = _targetWin();
    var html = doc.documentElement;
    var meta = doc.querySelector('meta[name="generator"]');
    var gen = meta ? (meta.getAttribute('content') || '').toLowerCase() : '';

    // Webflow — data-wf-site on <html>, w-mod-* classes
    if (html.getAttribute('data-wf-site') || html.classList.contains('w-mod-js')) {
      return {
        builder: 'webflow',
        features: {
          gsap: !!win.gsap,
          lenis: !!doc.querySelector('.lenis') || !!win.__lenis || !!win.Lenis,
          ix2: html.classList.contains('w-mod-ix'),
          ix3: html.classList.contains('w-mod-ix3')
        }
      };
    }

    // Framer — data-framer-* attributes, framer-specific meta
    if (doc.querySelector('[data-framer-component-type]') ||
        doc.querySelector('[data-framer-name]') ||
        gen.indexOf('framer') !== -1) {
      return {
        builder: 'framer',
        features: {
          motionValues: !!doc.querySelector('[style*="--framer-"]')
        }
      };
    }

    // Squarespace — meta generator or sqs- classes
    if (gen.indexOf('squarespace') !== -1 ||
        doc.querySelector('.sqs-block') ||
        doc.querySelector('#sqs-site-id')) {
      return { builder: 'squarespace', features: {} };
    }

    // Wix — meta generator or wix-specific elements
    if (gen.indexOf('wix') !== -1 ||
        doc.querySelector('[data-mesh-id]') ||
        doc.querySelector('#WIX_ADS')) {
      return { builder: 'wix', features: {} };
    }

    // Readymag — rm-page class
    if (doc.querySelector('.rm-page') ||
        doc.querySelector('[data-readymag]')) {
      return { builder: 'readymag', features: {} };
    }

    // Cargo — cargo-specific
    if (doc.querySelector('[data-cargo]') ||
        gen.indexOf('cargo') !== -1) {
      return { builder: 'cargo', features: {} };
    }

    // WordPress — common WP fingerprints
    if (gen.indexOf('wordpress') !== -1 ||
        doc.querySelector('link[href*="wp-content"]') ||
        doc.querySelector('#wpadminbar')) {
      return { builder: 'wordpress', features: {} };
    }

    // Shopify
    if (doc.querySelector('meta[name="shopify-checkout-api-token"]') ||
        doc.querySelector('link[href*="cdn.shopify.com"]')) {
      return { builder: 'shopify', features: {} };
    }

    // Generic — no known builder detected
    return { builder: 'generic', features: {} };
  };
})();
