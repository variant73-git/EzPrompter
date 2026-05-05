/**
 * Repix Curate Engine
 * Analisa o DOM do site e MARCA quais elementos são editáveis.
 * O DOM original fica intacto. Edições são CSS inline nos elementos reais.
 *
 * Pipeline: Análise → Classificação → Marcação → Filtragem
 */
(function() {
  'use strict';

  function _target() { return (window.__rbTarget && window.__rbTarget.doc) || document; }
  function _targetWin() { return (window.__rbTarget && window.__rbTarget.win) || window; }

  if (window.__rbNormalize) return;

  var MIN_SIZE = 20;
  var MAX_DEPTH = 12;

  var SKIP = new Set([
    'SCRIPT','STYLE','NOSCRIPT','META','LINK','BR','HR','HEAD','TITLE','BASE',
    'TEMPLATE','SLOT'
  ]);

  // Elements the designer SEES and should be able to select
  var VISUAL = new Set(['IMG','VIDEO','CANVAS','SVG','PICTURE','IFRAME']);
  var INTERACTIVE = new Set(['BUTTON','A','INPUT','SELECT','TEXTAREA']);
  var TEXT_BLOCK = new Set(['H1','H2','H3','H4','H5','H6','P','BLOCKQUOTE','PRE','LI','FIGCAPTION','LABEL','TD','TH']);

  // =========================================================================
  // ANALYSIS — Walk DOM, classify each visible element
  // =========================================================================

  function isVisible(el) {
    if (!el || el.nodeType !== 1) return false;
    var r = el.getBoundingClientRect();
    if (r.width < MIN_SIZE || r.height < MIN_SIZE) return false;
    var cs = _targetWin().getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    if (cs.opacity === '0') return false;
    return true;
  }

  function isEditorEl(el) {
    var n = el;
    while (n) {
      if (n.id && (n.id.indexOf('rb-editor') === 0 || n.id === 'repixbridge-panel' || n.id === 'rb-ed-fab')) return true;
      n = n.parentElement;
    }
    return false;
  }

  function hasDirectText(el) {
    for (var i = 0; i < el.childNodes.length; i++) {
      if (el.childNodes[i].nodeType === 3 && el.childNodes[i].textContent.trim().length > 0) return true;
    }
    return false;
  }

  function hasVisualContent(el) {
    // Does this element have something the designer would see?
    if (VISUAL.has(el.tagName)) return true;
    if (INTERACTIVE.has(el.tagName)) return true;
    if (TEXT_BLOCK.has(el.tagName)) return true;
    if (hasDirectText(el)) return true;

    // Check for background image/color that makes it visible
    var cs = _targetWin().getComputedStyle(el);
    if (cs.backgroundImage && cs.backgroundImage !== 'none') return true;
    if (cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent') {
      // Has a real background color — it's visual
      return true;
    }
    return false;
  }

  // =========================================================================
  // CLASSIFICATION — Decide what role each element plays
  // =========================================================================

  function classify(el) {
    var tag = el.tagName;
    if (VISUAL.has(tag)) return 'visual';
    if (tag === 'BUTTON' || (tag === 'A' && el.querySelector('img,svg,span'))) return 'interactive';
    if (TEXT_BLOCK.has(tag)) return 'text';
    if (hasDirectText(el)) return 'text';

    // Is it a meaningful container?
    var visibleChildren = 0;
    Array.from(el.children).forEach(function(c) {
      if (!SKIP.has(c.tagName) && isVisible(c)) visibleChildren++;
    });
    if (visibleChildren > 0) return 'container';
    if (hasVisualContent(el)) return 'visual';
    return 'empty';
  }

  // =========================================================================
  // SECTION DETECTION — Find major page blocks
  // =========================================================================

  function detectSections() {
    var sections = [];
    var vw = _targetWin().innerWidth;

    // Look for semantic tags first
    var semanticSections = _target().querySelectorAll('header,nav,main,section,article,aside,footer');
    semanticSections.forEach(function(el) {
      if (!isVisible(el) || isEditorEl(el)) return;
      var r = el.getBoundingClientRect();
      // Must span a significant portion of viewport width
      if (r.width < vw * 0.5) return;
      sections.push(el);
    });

    // If no semantic tags found, use direct body children
    if (sections.length === 0) {
      Array.from(_target().body.children).forEach(function(el) {
        if (SKIP.has(el.tagName) || !isVisible(el) || isEditorEl(el)) return;
        var r = el.getBoundingClientRect();
        if (r.width < vw * 0.5) return;
        if (r.height < 30) return;
        sections.push(el);
      });
    }

    return sections;
  }

  // =========================================================================
  // CURATION — Walk a section and mark editable elements
  // =========================================================================

  function curateSection(section, depth) {
    if (depth > MAX_DEPTH) return 0;
    var marked = 0;

    Array.from(section.children).forEach(function(el) {
      if (SKIP.has(el.tagName) || isEditorEl(el)) return;
      if (!isVisible(el)) return;

      var role = classify(el);

      if (role === 'empty') return;

      if (role === 'visual' || role === 'text' || role === 'interactive') {
        // Leaf element — mark as editable
        el.setAttribute('data-rb-editable', role);
        marked++;
        return;
      }

      if (role === 'container') {
        // Check: is this a wrapper with one meaningful child? Skip it.
        var meaningfulChildren = Array.from(el.children).filter(function(c) {
          if (SKIP.has(c.tagName)) return false;
          if (!isVisible(c)) return false;
          return classify(c) !== 'empty';
        });

        if (meaningfulChildren.length === 1 && !hasVisualContent(el)) {
          // Pure wrapper — don't mark, recurse into child
          marked += curateSection(el, depth + 1);
          return;
        }

        // Meaningful container — mark it AND curate children
        el.setAttribute('data-rb-editable', 'container');
        marked++;
        marked += curateSection(el, depth + 1);
      }
    });

    return marked;
  }

  // =========================================================================
  // SECTION TYPE DETECTION
  // =========================================================================

  function getSectionType(el) {
    var tag = el.tagName.toLowerCase();
    if (tag === 'nav' || tag === 'header') return 'nav';
    if (tag === 'footer') return 'footer';
    if (tag === 'main') return 'main';

    var text = ((el.className || '') + ' ' + (el.id || '')).toLowerCase();
    if (text.match(/nav|menu/)) return 'nav';
    if (text.match(/hero|banner/)) return 'hero';
    if (text.match(/footer/)) return 'footer';
    if (text.match(/feature|benefit/)) return 'features';
    if (text.match(/pricing|plan/)) return 'pricing';
    if (text.match(/testimonial|review/)) return 'testimonials';
    if (text.match(/cta|action/)) return 'cta';

    return 'content';
  }

  // =========================================================================
  // API
  // =========================================================================

  var sections = [];
  var totalMarked = 0;

  function normalize() {
    // Clean previous marks
    _target().querySelectorAll('[data-rb-editable]').forEach(function(el) {
      el.removeAttribute('data-rb-editable');
    });
    _target().querySelectorAll('[data-rb-section]').forEach(function(el) {
      el.removeAttribute('data-rb-section');
    });

    // Detect sections
    sections = detectSections();
    totalMarked = 0;

    // Mark sections and curate their children
    sections.forEach(function(sec) {
      var type = getSectionType(sec);
      sec.setAttribute('data-rb-section', type);
      sec.setAttribute('data-rb-editable', 'section');
      totalMarked++;
      totalMarked += curateSection(sec, 0);
    });

    return {
      sectionCount: sections.length,
      elementCount: totalMarked,
      sections: sections.map(function(s) {
        var r = s.getBoundingClientRect();
        return {
          el: s,
          type: s.getAttribute('data-rb-section'),
          bounds: { x: r.left, y: r.top, width: r.width, height: r.height }
        };
      })
    };
  }

  function activate() {
    // Nothing to activate — DOM stays intact, marks are already on elements
  }

  function deactivate() {
    // Remove all marks
    _target().querySelectorAll('[data-rb-editable]').forEach(function(el) {
      el.removeAttribute('data-rb-editable');
    });
    _target().querySelectorAll('[data-rb-section]').forEach(function(el) {
      el.removeAttribute('data-rb-section');
    });
    sections = [];
    totalMarked = 0;
  }

  // =========================================================================
  // EXPOSE
  // =========================================================================

  window.__rbNormalize = {
    normalize: normalize,
    activate: activate,
    deactivate: deactivate,
    getRoot: function() { return null; } // No separate root — uses real DOM
  };

})();
