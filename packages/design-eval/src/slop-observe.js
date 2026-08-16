/**
 * slop-observe.js — collect FACTS about a rendered page, in the browser.
 *
 * WHY THIS EXISTS (three audit rounds paid for it)
 *   The first version of the deterministic layer read HTML/CSS as a string. Three
 *   adversarial rounds produced ~35 findings, and they were never independent
 *   bugs — each round surfaced a NEW CLASS of the same root cause: a string
 *   reader has no parsing context. `content:"font-style:italic"` looked like a
 *   declaration; `var(--white)` looked like white; `<template>` copy looked
 *   rendered; a `;` inside a string split a rule.
 *
 *   This repo already paid for that lesson once — CLAUDE.md items 163/164, the
 *   pixelated-hero bug: "Regex não estabelece contexto de parsing de HTML/CSS —
 *   o fix DEFINITIVO roda no DOM via CSSOM". `pinDomViewportUnits` exists for
 *   exactly this reason. This module applies the same conclusion to the eval.
 *
 * THE SPLIT: this file OBSERVES, it does not judge.
 *   The browser reports facts (computed colours, resolved font stacks, rendered
 *   copy). The verdict logic lives in slop-verdicts.js and stays pure, so it is
 *   unit-testable without a browser and cannot silently depend on page state.
 *
 * WHAT THE BROWSER GIVES US FOR FREE — each one killed an audit finding:
 *   - getComputedStyle normalises every colour notation to rgb()/rgba(), so
 *     hsl(), percentage channels and `black` stop being separate problems.
 *   - The cascade is resolved: a gradient in one rule and background-clip:text in
 *     another are seen together, as the page actually renders them.
 *   - var(), shorthands and !important are already applied.
 *   - innerText excludes <template>, [hidden] and display:none — copy means copy.
 *   - Entities are decoded by the HTML parser, not by a table of seven names.
 *   - A `content` string is a VALUE. It can never be mistaken for a declaration.
 */

/**
 * Runs INSIDE the page. Returns plain data only (must survive structured clone).
 * Kept as one self-contained function because page.evaluate cannot close over
 * module scope.
 */
export function observeInPage() {
  const LAYOUT_PROPS = ['width', 'height', 'top', 'left', 'right', 'bottom', 'margin', 'padding', 'inset', 'min-width', 'max-width', 'min-height', 'max-height'];

  const COLOR_PROPS = ['color', 'background-color', 'border-color', 'border-left-color', 'border-top-color', 'fill', 'stroke', 'outline-color'];

  const out = {
    unobservedStylesheets: 0,
    fontFamilies: [],
    monoElements: 0,
    italicElements: 0,
    colors: [],
    gradientTextElements: 0,
    sideStripeElements: 0,
    viewportHeightRules: 0,
    layoutAnimations: 0,
    text: '',
    imgSrcs: [],
  };

  // AUTHORED colours only, normalised by the browser itself.
  //
  // Computed style is the wrong source here: Chrome's default text colour is
  // rgb(0, 0, 0), so reading computed colour would report "pure black" on every
  // page that never sets one — a false positive on literally everything. The
  // criterion is about what the AUTHOR chose, so read authored declarations and
  // push each through a probe element to get one canonical notation. That is how
  // `black`, `#000`, `hsl(0 0% 0%)` and `rgb(0 0 0 / 100%)` all become the same
  // string without this file knowing anything about colour syntax.
  // The probe lives in a CLOSED SHADOW ROOT on a custom host, and the host is
  // display:none !important. A bare <span> appended to <html> was styled by page
  // rules (`span{display:block;border-left:2px solid red}` made the instrument
  // itself render, and it was then counted as an element) and it shifted
  // structural selectors like :last-child. The observer must not change the page
  // it measures. Colour still resolves inside a hidden shadow root — verified.
  const probeHost = document.createElement('uncraft-probe-host');
  probeHost.style.setProperty('display', 'none', 'important');
  document.documentElement.appendChild(probeHost);
  const probe = document.createElement('span');
  probeHost.attachShadow({ mode: 'closed' }).appendChild(probe);
  // INLINE !important, on purpose. A page rule like `span{color:blue!important}` —
  // including one from a stylesheet we could not otherwise read — would otherwise
  // win over the probe and make every colour we "observe" blue. Inline important
  // is the top of the author cascade, so the probe reports the value we set.
  const normaliseColor = (value) => {
    probe.style.removeProperty('color');
    probe.style.setProperty('color', value, 'important');
    const c = getComputedStyle(probe).color;
    return probe.style.getPropertyValue('color') ? c : null; // invalid values do not stick
  };
  // CSS-wide keywords are not colour choices. `initial` in particular normalises
  // to rgb(0,0,0), so a plain `border:0` reset would otherwise read as "pure black
  // authored" — a false positive on every button in a design system.
  const NOT_A_COLOUR_CHOICE = /var\(|currentcolor|inherit|transparent|\b(initial|unset|revert|revert-layer)\b/i;

  const collectColors = (style) => {
    if (!style) return;
    for (const prop of COLOR_PROPS) {
      const v = style.getPropertyValue(prop);
      if (!v || NOT_A_COLOUR_CHOICE.test(v)) continue;
      const n = normaliseColor(v);
      if (n) out.colors.push(n);
    }
    // DESIGN TOKENS. A token-driven system declares the palette once
    // (`--brand:#c8ff3d`) and uses var() everywhere after that. Reading only colour
    // PROPERTIES reported the whole palette as absent on exactly the systems that
    // follow the house rules. A custom property whose value parses as a colour IS
    // an authored colour; the probe rejects `--gap:12px` for free.
    for (let i = 0; i < style.length; i += 1) {
      const prop = style[i];
      if (!prop || !prop.startsWith('--')) continue;
      const v = style.getPropertyValue(prop);
      if (!v || NOT_A_COLOUR_CHOICE.test(v)) continue;
      const n = normaliseColor(v.trim());
      if (n) out.colors.push(n);
    }
  };

  // A stylesheet whose rules we cannot read is styling we cannot see. Saying
  // "no violation found" about it would be a fabricated verdict.
  //
  // `document.styleSheets` is not the whole story: constructed sheets attached via
  // adoptedStyleSheets, and sheets living inside shadow roots, style the page and
  // do not appear there. Missing them would not be a blind spot the caller could
  // see — it would silently read as compliance.
  const readableRules = [];
  const collectSheets = (sheets) => {
    for (const sheet of Array.from(sheets || [])) {
      try {
        const rules = sheet.cssRules;
        if (!rules) { out.unobservedStylesheets += 1; continue; }
        readableRules.push(...Array.from(rules));
      } catch {
        out.unobservedStylesheets += 1; // cross-origin, or not yet loaded
      }
    }
  };
  collectSheets(document.styleSheets);
  collectSheets(document.adoptedStyleSheets);

  // Open shadow roots: their elements and their sheets. A CLOSED root is
  // unreachable by construction, and nothing here can even detect one — that
  // limitation is stated in the package README rather than papered over.
  const SHADOW_MAX_DEPTH = 6; // levels actually visited, matching what the docs claim
  const shadowRoots = [];
  const findShadowRoots = (root, depth) => {
    if (depth >= SHADOW_MAX_DEPTH) return;
    for (const el of Array.from(root.querySelectorAll('*'))) {
      if (el.shadowRoot) {
        shadowRoots.push(el.shadowRoot);
        collectSheets(el.shadowRoot.styleSheets);
        collectSheets(el.shadowRoot.adoptedStyleSheets);
        findShadowRoots(el.shadowRoot, depth + 1);
      }
    }
  };
  findShadowRoots(document, 0);

  // Flatten grouping rules (@media, @supports, @layer) so nesting is not a blind spot.
  const flat = [];
  const walk = (rules, depth) => {
    if (depth > 8) return;
    for (const rule of rules) {
      flat.push(rule);
      if (rule.cssRules) walk(Array.from(rule.cssRules), depth + 1);
    }
  };
  walk(readableRules, 0);

  for (const rule of flat) {
    const style = rule.style;
    if (style) {
      // Authored 100vh survives here even though computed style is px.
      for (const prop of ['height', 'min-height']) {
        const v = style.getPropertyValue(prop);
        if (v && /\b100vh\b/.test(v)) out.viewportHeightRules += 1;
      }
      collectColors(style);
    }
    // Transitions are NOT read here any more. Reading them from rules could not
    // resolve var(), could not apply the cascade, and counted rules that match
    // nothing on the page. They are read from computed style, per element, below.
  }

  // Keyframes that ANIMATE layout, collected now and filtered later by whether an
  // element actually runs them. Counting every @keyframes block reported motion on
  // pages that merely declare a dead one — documenting that as a blind spot did
  // not stop it from being a false `violation`.
  const layoutKeyframeNames = new Set();
  for (const rule of flat) {
    // rule.type against the intrinsic, not constructor.name: a polyfill that
    // reassigns prototype.constructor breaks name-sniffing.
    if (rule.cssRules && rule.type === CSSRule.KEYFRAMES_RULE) {
      for (const kf of Array.from(rule.cssRules)) {
        if (kf.style && LAYOUT_PROPS.some((p) => kf.style.getPropertyValue(p))) {
          layoutKeyframeNames.add(rule.name);
          break;
        }
      }
    }
  }

  // innerText, not textContent: text inside a hidden descendant is not text the
  // reader sees, and counting it made structure decide the verdict.
  const hasVisibleText = (el) => {
    const t = el.innerText;
    return !!(t && t.trim());
  };

  // An element that paints no box paints no violation. A border on a zero-area
  // span and a gradient clipped to text on an EMPTY heading were both reported.
  // checkVisibility walks ANCESTORS. Reading the element's own computed opacity
  // missed `<div style="opacity:0"><h1>…</h1></div>`, where the child is opacity 1
  // and paints nothing.
  const isVisible = (el) => {
    const r = el.getBoundingClientRect();
    if (!(r.width > 0 && r.height > 0)) return false;
    return typeof el.checkVisibility === 'function'
      ? el.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true })
      : true;
  };

  const allElements = [
    ...Array.from(document.querySelectorAll('*')),
    ...shadowRoots.flatMap((root) => Array.from(root.querySelectorAll('*'))),
  ];
  const usedAnimations = new Set();
  const positiveTime = (tok) => {
    const m = /^(\d*\.?\d+)(s|ms)$/.exec(String(tok).trim());
    return !!m && parseFloat(m[1]) > 0;
  };

  for (const el of allElements) {
    if (el === probeHost) continue; // never measure the instrument
    const tag = el.tagName.toLowerCase();
    if (tag === 'script' || tag === 'style' || tag === 'template' || tag === 'head' || tag === 'meta' || tag === 'link' || tag === 'title') continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;

    out.fontFamilies.push(cs.fontFamily);
    if (/\bmonospace\b/i.test(cs.fontFamily)) out.monoElements += 1;
    if (cs.fontStyle === 'italic' && hasVisibleText(el)) out.italicElements += 1;

    collectColors(el.style); // inline style attribute = authored too

    // Transitions read from COMPUTED style, not from rules: this resolves var(),
    // applies the cascade, and only reports rules that actually match something.
    const names = String(cs.transitionProperty).split(',').map((t) => t.trim());
    const durs = String(cs.transitionDuration).split(',').map((t) => t.trim());
    const animatesLayout = names.some((n, i) => {
      if (n.startsWith('--')) return false;
      if (n !== 'all' && !LAYOUT_PROPS.includes(n)) return false;
      return positiveTime(durs.length ? durs[i % durs.length] : '0s');
    });
    if (animatesLayout) out.layoutAnimations += 1;

    if (positiveTime(String(cs.animationDuration).split(',')[0])) {
      for (const n of String(cs.animationName).split(',')) usedAnimations.add(n.trim());
    }

    const clip = cs.webkitBackgroundClip || cs.backgroundClip;
    if (clip === 'text' && /gradient\(/i.test(cs.backgroundImage) && hasVisibleText(el) && isVisible(el)) {
      out.gradientTextElements += 1;
    }

    // A side stripe is an ACCENT ON ONE SIDE. A uniform ring — `border:3px solid`
    // on an avatar, which the house style explicitly asks for — has all four sides
    // drawn and is not a stripe. Counting any left border > 1px turned every ring
    // into a violation.
    const drawn = (side) => {
      const st = cs[`border${side}Style`];
      const transparent = /rgba\([^)]*,\s*0\s*\)/.test(cs[`border${side}Color`]);
      return parseFloat(cs[`border${side}Width`]) > 0 && st !== 'none' && st !== 'hidden' && !transparent;
    };
    const perpendicular = drawn('Top') || drawn('Bottom');
    if (isVisible(el) && !perpendicular) {
      // Count the ELEMENT once: a left+right frame is one decision, not two stripes.
      const striped = ['Left', 'Right'].some((side) => parseFloat(cs[`border${side}Width`]) > 1 && drawn(side));
      if (striped) out.sideStripeElements += 1;
    }

    // A responsive image may legitimately carry only srcset. Reporting it as an
    // empty src made valid content a placeholder.
    if (tag === 'img') {
      const declared = (el.getAttribute('src') || '').trim();
      const hasSrcset = !!(el.getAttribute('srcset') || '').trim();
      out.imgSrcs.push(declared || (hasSrcset ? el.currentSrc || 'srcset' : ''));
    }
  }

  // Only keyframes something actually runs.
  for (const name of usedAnimations) {
    if (layoutKeyframeNames.has(name)) out.layoutAnimations += 1;
  }

  probeHost.remove();

  // innerText, not textContent: this is what a reader actually sees.
  out.text = (document.body && document.body.innerText) ? document.body.innerText : '';
  return out;
}

/**
 * Render `html` in a page and observe it.
 * @param page a Playwright Page
 */
export async function observeHtml(page, html) {
  await page.setContent(html, { waitUntil: 'domcontentloaded' });
  return page.evaluate(observeInPage);
}
