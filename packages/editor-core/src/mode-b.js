/**
 * Repix Mode B — DOM Mirror engine.
 *
 * Strategy: clone the rendered body + extract all accessible stylesheets (via
 * _target().styleSheets.cssRules), producing a frozen snapshot with preserved
 * cascade, @media queries, @keyframes, and @font-face. Links are neutralized
 * so the mirrored page doesn't navigate. Cross-origin stylesheets throw on
 * cssRules access — we try/catch and skip them (nothing we can do client-side).
 *
 * Why this exists: Mode E (Vision-to-Code) regenerates HTML from screenshots
 * and takes ~12 min with inconsistent fidelity. Mode B copies what's already
 * rendered, in seconds, at ~99% visual fidelity. It freezes state at capture —
 * no live JS, no hydration, no dynamic content — but that's fine for an editor
 * context where the designer just wants to edit.
 *
 * Reference: Reforge (build.reforge.com) and ClonewebX use the same approach.
 *
 * Isolation: no "use strict", fully try/catched, dedicated globals with rb-
 * prefix. The previous rebuild.js v5 attempt lived inside rebuild.js and
 * crashed the editor silently — this file is separate so a bug here cannot
 * abort editor.js initialization.
 */
(function() {
  if (window.__rbModeB) return;

  // Mode B operates on TARGET (the site). Public API stays on the
  // script's window so editor.js can invoke it directly.
  function _target() {
    return (window.__rbTarget && window.__rbTarget.doc) || document;
  }
  function _targetWin() {
    return (window.__rbTarget && window.__rbTarget.win) || window;
  }

  var _rbState = null; // { originalChildren, scrollY, wrapper }

  function isEditorEl(el) {
    if (!el || !el.id) return false;
    var id = el.id;
    return id.indexOf('rb-editor') === 0 || id.indexOf('rb-ed-') === 0;
  }

  function absUrl(url, base) {
    if (!url) return url;
    if (url.indexOf('data:') === 0 || url.indexOf('blob:') === 0) return url;
    try { return new URL(url, base || _target().baseURI).href; } catch (e) { return url; }
  }

  // Rewrite url(...) inside CSS text so relative paths resolve against the
  // stylesheet's origin (site-relative paths don't work once we move the CSS
  // into an inline <style> tag).
  function absolutizeCssUrls(cssText, base) {
    if (!cssText) return cssText;
    try {
      return cssText.replace(/url\(\s*(['"]?)([^'")\s][^'")]*?)\1\s*\)/g, function(match, quote, url) {
        if (!url || url.indexOf('data:') === 0 || url.indexOf('blob:') === 0) return match;
        if (/^https?:\/\//i.test(url)) return match;
        var abs = absUrl(url, base);
        return 'url("' + abs + '")';
      });
    } catch (e) { return cssText; }
  }

  // Walk _target().styleSheets and collect cssText. Cross-origin sheets throw
  // on .cssRules — caught and skipped. Our own editor stylesheets are skipped
  // explicitly so they don't bleed into the mirror.
  function extractAllCSS() {
    var chunks = [];
    var sheets = _target().styleSheets;
    for (var i = 0; i < sheets.length; i++) {
      var sheet = sheets[i];
      try {
        var node = sheet.ownerNode;
        if (node && node.id && (node.id.indexOf('rb-editor') === 0 ||
                                 node.id.indexOf('rb-ed-') === 0 ||
                                 node.id === 'rb-override-sheet' ||
                                 node.id === 'rb-hover-kill')) continue;
        var rules = sheet.cssRules || sheet.rules;
        if (!rules || !rules.length) continue;
        var base = sheet.href || _target().baseURI;
        for (var j = 0; j < rules.length; j++) {
          var rule = rules[j];
          var txt = rule.cssText;
          if (txt) chunks.push(absolutizeCssUrls(txt, base));
        }
      } catch (e) {
        // Cross-origin stylesheet — cssRules access denied. Skip.
      }
    }
    return chunks.join('\n');
  }

  // Deep-clone body children, skipping editor elements and script/style tags.
  // Also absolutizes src/href on img/a/source/video inside the clone so assets
  // keep loading from their original URLs after we strip the live JS context.
  function cloneBody() {
    var wrap = _target().createElement('div');
    wrap.id = 'rb-mode-b-body';
    var children = _target().body.children;
    for (var i = 0; i < children.length; i++) {
      var child = children[i];
      if (isEditorEl(child)) continue;
      var tag = child.tagName;
      if (tag === 'SCRIPT' || tag === 'NOSCRIPT') continue;
      try {
        var clone = child.cloneNode(true);
        absolutizeAssetAttrs(clone);
        wrap.appendChild(clone);
      } catch (e) {}
    }
    return wrap;
  }

  function absolutizeAssetAttrs(root) {
    if (!root || !root.querySelectorAll) return;
    var base = _target().baseURI;
    try {
      root.querySelectorAll('img[src]').forEach(function(img) {
        var s = img.getAttribute('src');
        if (s) img.setAttribute('src', absUrl(s, base));
      });
      root.querySelectorAll('img[srcset]').forEach(function(img) {
        var ss = img.getAttribute('srcset');
        if (ss) {
          var parts = ss.split(',').map(function(p) {
            p = p.trim();
            var sp = p.split(/\s+/);
            sp[0] = absUrl(sp[0], base);
            return sp.join(' ');
          });
          img.setAttribute('srcset', parts.join(', '));
        }
      });
      root.querySelectorAll('source[src], source[srcset], video[src], video[poster], audio[src]').forEach(function(el) {
        ['src','srcset','poster'].forEach(function(attr) {
          if (el.hasAttribute(attr)) {
            var v = el.getAttribute(attr);
            if (attr === 'srcset') {
              var parts = v.split(',').map(function(p) { p = p.trim(); var sp = p.split(/\s+/); sp[0] = absUrl(sp[0], base); return sp.join(' '); });
              el.setAttribute(attr, parts.join(', '));
            } else {
              el.setAttribute(attr, absUrl(v, base));
            }
          }
        });
      });
      root.querySelectorAll('a[href]').forEach(function(a) {
        var h = a.getAttribute('href');
        if (h) a.setAttribute('href', absUrl(h, base));
      });
      // Background images set via inline style — absolutize url(...) too.
      root.querySelectorAll('[style]').forEach(function(el) {
        var s = el.getAttribute('style');
        if (s && s.indexOf('url(') !== -1) {
          el.setAttribute('style', absolutizeCssUrls(s, base));
        }
      });
    } catch (e) {}
  }

  // Neutralize navigation on anchors in the mirror. Links should LOOK live but
  // clicks should just preventDefault so the editor doesn't navigate away.
  function disableInteractivity(root) {
    if (!root || !root.querySelectorAll) return;
    try {
      root.querySelectorAll('a').forEach(function(a) {
        a.addEventListener('click', function(e) { e.preventDefault(); }, true);
      });
      // Kill form submissions too.
      root.querySelectorAll('form').forEach(function(f) {
        f.addEventListener('submit', function(e) { e.preventDefault(); }, true);
      });
    } catch (e) {}
  }

  function getEditorElsInBody() {
    var out = [];
    var kids = _target().body.children;
    for (var i = 0; i < kids.length; i++) {
      if (isEditorEl(kids[i])) out.push(kids[i]);
    }
    return out;
  }

  function run() {
    if (_rbState) restore();
    var scrollY = _targetWin().scrollY;

    var css = '';
    try { css = extractAllCSS(); } catch (e) { css = ''; }

    var mirror;
    try { mirror = cloneBody(); } catch (e) { return null; }

    var wrapper = _target().createElement('div');
    wrapper.id = 'rb-mode-b-clone';
    wrapper.setAttribute('data-rb-mode-b', '1');

    // Scoped stylesheet: inline all extracted CSS. Placed inside the wrapper
    // so the browser resolves URLs relative to _target().baseURI (same as
    // the original page).
    var styleTag = _target().createElement('style');
    styleTag.id = 'rb-mode-b-style';
    styleTag.textContent = css;
    wrapper.appendChild(styleTag);
    wrapper.appendChild(mirror);

    disableInteractivity(wrapper);

    // Detach the original non-editor children into a holding array so restore
    // can put them back verbatim.
    var saved = [];
    var kids = Array.prototype.slice.call(_target().body.children);
    kids.forEach(function(child) {
      if (isEditorEl(child)) return;
      saved.push(child);
      _target().body.removeChild(child);
    });

    // Insert wrapper before editor panels if any exist.
    var editorEls = getEditorElsInBody();
    if (editorEls.length > 0) {
      _target().body.insertBefore(wrapper, editorEls[0]);
    } else {
      _target().body.appendChild(wrapper);
    }

    _rbState = { originalChildren: saved, scrollY: scrollY, wrapper: wrapper };

    // Push undo so Cmd+Z reverts the entire mirror. Mirrors the pattern used
    // by Mode E (__modeERun).
    try {
      if (typeof window.__rbPushUndo === 'function') {
        window.__rbPushUndo({
          prop: '__modeBRun',
          originalChildren: saved,
          scrollY: scrollY,
          wrapper: wrapper
        });
      }
    } catch (e) {}

    _targetWin().scrollTo(0, 0);
    return { sheetsCount: _target().styleSheets.length, cssSize: css.length, mirrorNodes: mirror.querySelectorAll('*').length };
  }

  function restore() {
    if (!_rbState) {
      var orphan = _target().getElementById('rb-mode-b-clone');
      if (orphan) orphan.remove();
      return;
    }
    var wrapper = _rbState.wrapper;
    if (wrapper && wrapper.parentNode) wrapper.remove();

    var editorEls = getEditorElsInBody();
    var before = editorEls[0] || null;
    _rbState.originalChildren.forEach(function(child) {
      if (before) _target().body.insertBefore(child, before);
      else _target().body.appendChild(child);
    });
    _targetWin().scrollTo(0, _rbState.scrollY || 0);
    _rbState = null;
  }

  window.__rbModeB = {
    run: run,
    restore: restore
  };
})();
