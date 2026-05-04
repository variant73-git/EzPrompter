// RepixBridge — Web Builder Detection
// Detects which platform built the current site

(function() {
  'use strict';

  window.__rbDetectBuilder = function() {
    var html = document.documentElement;
    var meta = document.querySelector('meta[name="generator"]');
    var gen = meta ? (meta.getAttribute('content') || '').toLowerCase() : '';

    // Webflow — data-wf-site on <html>, w-mod-* classes
    if (html.getAttribute('data-wf-site') || html.classList.contains('w-mod-js')) {
      return {
        builder: 'webflow',
        features: {
          gsap: !!window.gsap,
          lenis: !!document.querySelector('.lenis') || !!window.__lenis || !!window.Lenis,
          ix2: html.classList.contains('w-mod-ix'),
          ix3: html.classList.contains('w-mod-ix3')
        }
      };
    }

    // Framer — data-framer-* attributes, framer-specific meta
    if (document.querySelector('[data-framer-component-type]') ||
        document.querySelector('[data-framer-name]') ||
        gen.indexOf('framer') !== -1) {
      return {
        builder: 'framer',
        features: {
          motionValues: !!document.querySelector('[style*="--framer-"]')
        }
      };
    }

    // Squarespace — meta generator or sqs- classes
    if (gen.indexOf('squarespace') !== -1 ||
        document.querySelector('.sqs-block') ||
        document.querySelector('#sqs-site-id')) {
      return { builder: 'squarespace', features: {} };
    }

    // Wix — meta generator or wix-specific elements
    if (gen.indexOf('wix') !== -1 ||
        document.querySelector('[data-mesh-id]') ||
        document.querySelector('#WIX_ADS')) {
      return { builder: 'wix', features: {} };
    }

    // Readymag — rm-page class
    if (document.querySelector('.rm-page') ||
        document.querySelector('[data-readymag]')) {
      return { builder: 'readymag', features: {} };
    }

    // Cargo — cargo-specific
    if (document.querySelector('[data-cargo]') ||
        gen.indexOf('cargo') !== -1) {
      return { builder: 'cargo', features: {} };
    }

    // WordPress — common WP fingerprints
    if (gen.indexOf('wordpress') !== -1 ||
        document.querySelector('link[href*="wp-content"]') ||
        document.querySelector('#wpadminbar')) {
      return { builder: 'wordpress', features: {} };
    }

    // Shopify
    if (document.querySelector('meta[name="shopify-checkout-api-token"]') ||
        document.querySelector('link[href*="cdn.shopify.com"]')) {
      return { builder: 'shopify', features: {} };
    }

    // Generic — no known builder detected
    return { builder: 'generic', features: {} };
  };
})();
