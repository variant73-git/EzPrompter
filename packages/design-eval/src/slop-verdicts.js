/**
 * slop-verdicts.js — judgement over facts observed in the browser.
 *
 * Pure by design: input is the plain object from slop-observe.js, output is a
 * verdict list. No HTML, no CSS, no parsing. The browser already did that.
 *
 * THE CONTRACT — this layer is a DETECTOR, not a certifier
 *   Three audit rounds established that no criterion here is FULLY covered (see
 *   COVERAGE, where every entry names what it cannot see). A layer with zero full
 *   coverage has no honest way to publish "85% passed": the number would count
 *   silence as compliance.
 *
 *   So the output has no score and no `passed`. It has:
 *     - violations  — a check found something. Strong evidence; act on it.
 *     - notDetected — this reader found nothing. NOT a clean bill of health.
 *     - unjudged    — the input needed was missing. Never counted as either.
 *
 *   Every criterion still goes to the vision judge (rubric.js). What this layer
 *   buys is a cheap, deterministic head start on the failures a machine CAN see —
 *   and, because it cannot say "pass", it cannot lie.
 */

/**
 * Per-CRITERION coverage. Nothing is `full`; each entry states its blind spot.
 * Moving an entry to `full` requires asserting EVERY clause of the criterion's
 * text — the audit killed three `full` claims that had not.
 */
export const COVERAGE = {
  'type-no-ai-fonts': { level: 'partial', blind: 'the criterion bans "the rest of the AI-default set" — an OPEN set, against this closed list' },
  'color-no-pure-bw': { level: 'partial', blind: 'the criterion also caps accent saturation below 80%, which nothing here measures' },
  'content-no-emoji-emdash': { level: 'partial', blind: 'text inside images, canvas or CSS-generated content is not read' },
  'type-no-mono': { level: 'partial', blind: 'whether the source authorised mono, and at what scope' },
  'type-no-italic': { level: 'partial', blind: 'whether italic is genuine emphasis or decoration — a judgement, not a count' },
  'banned-gradient-text': { level: 'partial', blind: 'gradient text painted by SVG or an image rather than background-clip' },
  'banned-side-stripe': { level: 'partial', blind: 'stripes drawn with pseudo-elements, shadows or background gradients' },
  'layout-constrain-containers': { level: 'partial', blind: 'whether outer containers are constrained; only the 100vh hero unit is read' },
  'motion-transform-opacity': { level: 'partial', blind: 'JS-driven animation, and the easing/duration clauses of the criterion' },
  'content-real-numbers': { level: 'partial', blind: 'only obvious placeholder image sources; invented numbers, names and claims in copy are a judgement' },
  'absorb-block': { level: 'partial', blind: 'the whole reference doctrine except palette presence' },
};

/** Criteria covered COMPLETELY — empty, and the audit is why. */
export function coveredCriterionIds() {
  return Object.entries(COVERAGE).filter(([, v]) => v.level === 'full').map(([k]) => k);
}

/** Criteria this layer samples — all of them, and all still judged. */
export function partiallyCoveredCriterionIds() {
  return Object.entries(COVERAGE).filter(([, v]) => v.level === 'partial').map(([k]) => k);
}

/** Split a font stack, honouring quotes: `"Inter, Display", serif` is TWO families. */
export function splitFamilies(stack) {
  const out = [];
  let buf = '';
  let quote = null;
  for (const ch of String(stack)) {
    if (quote) { if (ch === quote) quote = null; else buf += ch; continue; }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === ',') { out.push(buf); buf = ''; continue; }
    buf += ch;
  }
  out.push(buf);
  return out.map((t) => t.trim().toLowerCase()).filter(Boolean);
}

/**
 * Two different remedies, NOT two different weights (Adilson, 2026-08-12):
 * "usar Inter não é um crime, mas no lugar podemos usar qualquer helvetica-like
 * parecida. JetBrains é [crime]. A não ser que seja uma demanda explícita do usuário."
 *
 * SUBSTITUTABLE: the face is an AI tell, and the fix is mechanical — swap it for an
 * equivalent. Reporting it as a grade would be noise; reporting the swap is useful.
 * FORBIDDEN: no substitution is offered because the rule is absolute.
 * Either way, an EXPLICIT user request wins. The criteria are build instructions,
 * and an instruction the user overrode is not a violation.
 */
const SUBSTITUTABLE_FACES = new Map([
  ['inter', 'any helvetica-like grotesque'],
  ['inter tight', 'any helvetica-like grotesque'],
  ['bricolage grotesque', 'any helvetica-like grotesque'],
  ['bricolage', 'any helvetica-like grotesque'],
]);
const isForbiddenFace = (f) => f.startsWith('jetbrains');

const PLACEHOLDER_SRC = /^(path\/to|your[-_]|placeholder|example\.(com|org)|#)|(\bplaceholder\b)/i;

const MONO_FIRST = new Set(['monospace', 'ui-monospace', 'sf mono', 'menlo', 'consolas', 'roboto mono', 'ibm plex mono', 'space mono', 'courier', 'courier new']);

/** "rgb(18, 52, 86)" / "rgba(0, 0, 0, 0.08)" → { r, g, b, a }. */
function parseRgb(value) {
  const m = /rgba?\(([^)]*)\)/i.exec(String(value));
  if (!m) return null;
  const p = m[1].split(/[\s,/]+/).map((x) => x.trim()).filter(Boolean);
  if (p.length < 3) return null;
  return { r: parseFloat(p[0]), g: parseFloat(p[1]), b: parseFloat(p[2]), a: p.length > 3 ? parseFloat(p[3]) : 1 };
}

/** @returns {r,g,b} or null when the entry is not an OPAQUE hex we can compare. */
function hexToRgb(hex) {
  const s = String(hex).trim().replace(/^#/, '').toLowerCase();
  if (!/^[0-9a-f]+$/.test(s)) return null;
  let rgb;
  // 4 and 8 digits carry ALPHA. Dropping it made `#fff8` match opaque white and
  // miss the translucent one — wrong in both directions. This layer only compares
  // opaque colours, so an alpha-bearing entry is not comparable, not "opaque".
  if (s.length === 3) rgb = s.split('').map((c) => c + c).join('');
  else if (s.length === 6) rgb = s;
  else return null; // 4/5/7/8 → not comparable here
  return { r: parseInt(rgb.slice(0, 2), 16), g: parseInt(rgb.slice(2, 4), 16), b: parseInt(rgb.slice(4, 6), 16), a: 1 };
}

const CSS_DEPENDENT = new Set([
  'banned-fonts', 'no-mono', 'no-hallucinated-italic', 'no-pure-bw',
  'no-gradient-text', 'palette-match', 'no-side-stripe', 'hero-dvh', 'motion-transform-opacity',
]);

const CHECK_DEFS = [
  {
    id: 'banned-fonts', criterion: 'type-no-ai-fonts',
    run: (o, g) => {
      const asked = new Set((g?.explicitFonts || []).map((f) => String(f).toLowerCase()));
      const faces = [...new Set(o.fontFamilies.flatMap(splitFamilies))].filter((f) => !asked.has(f));
      const forbidden = faces.filter(isForbiddenFace);
      if (forbidden.length) {
        return { pass: false, remedy: 'forbidden', detail: `forbidden face: ${forbidden.join(', ')}` };
      }
      const substitutable = faces.filter((f) => SUBSTITUTABLE_FACES.has(f));
      if (substitutable.length) {
        const swap = SUBSTITUTABLE_FACES.get(substitutable[0]);
        return { pass: false, remedy: 'substitute', detail: `AI-tell face ${substitutable.join(', ')} — swap for ${swap}` };
      }
      return { pass: true };
    },
  },
  {
    id: 'no-mono', criterion: 'type-no-mono',
    run: (o, g) => {
      // Read the FIRST family in the stack. That is not the same as the face that
      // drew the glyphs — the computed stack says nothing about which fonts are
      // installed — but it is the authored intent, and `Arial, monospace` is an
      // Arial page with a fallback, not a monospace page.
      const monoFirst = o.fontFamilies.some((stack) => {
        const first = splitFamilies(stack)[0];
        return first && MONO_FIRST.has(first);
      });
      if (!o.monoElements || !monoFirst) return { pass: true };
      if (g?.monoInSource === false) return { pass: false, detail: `${o.monoElements} element(s) whose first declared family is monospace` };
      return { pass: null, detail: 'mono present; a boolean cannot establish the authorised scope' };
    },
  },
  {
    id: 'no-hallucinated-italic', criterion: 'type-no-italic',
    // CONTRACT: ground.italicCount is a count of ELEMENTS rendered italic, measured
    // the same way on the source. Comparing elements to declarations would be two
    // units wearing one name.
    run: (o, g) => {
      if (typeof g?.italicCount !== 'number') return { pass: null, detail: 'no ground-truth italic count supplied' };
      return o.italicElements > g.italicCount
        ? { pass: false, detail: `${o.italicElements} italic elements vs ${g.italicCount} in the source` }
        : { pass: true };
    },
  },
  {
    id: 'no-pure-bw', criterion: 'color-no-pure-bw',
    run: (o) => {
      let black = false;
      let white = false;
      for (const c of o.colors) {
        const p = parseRgb(c);
        if (!p || p.a !== 1) continue; // translucent black is the tinted-shadow idiom
        if (p.r === 0 && p.g === 0 && p.b === 0) black = true;
        if (p.r === 255 && p.g === 255 && p.b === 255) white = true;
      }
      if (black || white) {
        return { pass: false, detail: `pure ${[black && 'black', white && 'white'].filter(Boolean).join(' and ')} authored` };
      }
      // A colour this reader cannot parse might BE black. Clearing the check over
      // it would be the fabricated verdict; only a proven violation outranks it.
      const unreadable = o.colors.filter((c) => !parseRgb(c));
      if (unreadable.length) {
        return { pass: null, detail: `${unreadable.length} colour(s) in a notation this reader cannot parse: ${[...new Set(unreadable)].slice(0, 3).join(', ')}` };
      }
      return { pass: true };
    },
  },
  {
    id: 'no-gradient-text', criterion: 'banned-gradient-text',
    run: (o) => (o.gradientTextElements
      ? { pass: false, detail: `${o.gradientTextElements} element(s) with gradient-clipped text` }
      : { pass: true }),
  },
  {
    id: 'palette-match', criterion: 'absorb-block',
    run: (o, g) => {
      const palette = g?.palette;
      if (!Array.isArray(palette) || !palette.length) return { pass: null, detail: 'no measured palette supplied' };
      const bad = palette.filter((hex) => !hexToRgb(hex));
      if (bad.length) return { pass: null, detail: `palette entries are not usable hex: ${bad.join(', ')}` };
      const present = o.colors.map(parseRgb).filter((p) => p && p.a === 1);
      const missing = palette.filter((hex) => {
        const t = hexToRgb(hex);
        return !present.some((p) => p.r === t.r && p.g === t.g && p.b === t.b);
      });
      if (!missing.length) return { pass: true }; // proven present; nothing to withhold
      // Only NOW does an unreadable notation matter: the missing colour might be
      // sitting in the one we could not parse (CSS Color 4 does not serialise as rgb()).
      const unreadable = o.colors.filter((c) => !parseRgb(c));
      if (unreadable.length) {
        return { pass: null, detail: `${missing.length} palette colour(s) not found, but ${unreadable.length} colour(s) are in a notation this reader cannot compare: ${[...new Set(unreadable)].slice(0, 3).join(', ')}` };
      }
      return { pass: false, detail: `measured palette colours absent: ${missing.join(', ')}` };
    },
  },
  {
    id: 'no-side-stripe', criterion: 'banned-side-stripe',
    run: (o) => (o.sideStripeElements
      ? { pass: false, detail: `${o.sideStripeElements} coloured side-stripe border(s) > 1px` }
      : { pass: true }),
  },
  {
    id: 'hero-dvh', criterion: 'layout-constrain-containers',
    run: (o) => (o.viewportHeightRules
      ? { pass: false, detail: `${o.viewportHeightRules} rule(s) using 100vh instead of 100dvh` }
      : { pass: true }),
  },
  {
    id: 'motion-transform-opacity', criterion: 'motion-transform-opacity',
    run: (o) => (o.layoutAnimations
      ? { pass: false, detail: `${o.layoutAnimations} rule(s) animating layout properties` }
      : { pass: true }),
  },
  {
    id: 'img-src-not-placeholder', criterion: 'content-real-numbers',
    // Fed by the PARSED DOM (observations.imgSrcs), not by a regex over markup.
    // The regex version mis-split `<img alt="2 > 1" src="real.png">`, matched an
    // `<img>` written inside a <script> string, and took the LAST duplicate `src`
    // where the parser takes the first.
    run: (o) => {
      if (!o.imgSrcs.length) return { pass: null, detail: 'no images on the page' };
      const bad = o.imgSrcs.filter((s) => !s || PLACEHOLDER_SRC.test(s));
      return bad.length
        ? { pass: false, detail: `${bad.length} placeholder image src: ${bad.slice(0, 3).join(', ')}` }
        : { pass: true };
    },
  },
  {
    id: 'no-emoji', criterion: 'content-no-emoji-emdash',
    run: (o) => {
      if (!o.text.trim()) return { pass: null, detail: 'no rendered copy to judge' };
      // Extended_Pictographic is a SEGMENTATION property, not a claim about emoji
      // presentation: it matches © ® ™ ↔, so every footer read as a violation
      // (audit r4, reproduced by running it). What renders as emoji is
      // Emoji_Presentation, plus any pictograph forced by a variation selector.
      const hits = o.text.match(/\p{Emoji_Presentation}|\p{Extended_Pictographic}\uFE0F/gu) || [];
      return hits.length ? { pass: false, detail: `${hits.length} emoji in copy: ${[...new Set(hits)].join(' ')}` } : { pass: true };
    },
  },
  {
    id: 'no-emdash', criterion: 'content-no-emoji-emdash',
    run: (o) => {
      if (!o.text.trim()) return { pass: null, detail: 'no rendered copy to judge' };
      const hits = o.text.match(/—/g) || [];
      return hits.length ? { pass: false, detail: `${hits.length} em dash(es) in copy` } : { pass: true };
    },
  },
];

export const CHECKS = CHECK_DEFS.map((c) => ({ ...c, covers: COVERAGE[c.criterion]?.level || 'partial' }));

/**
 * Judge one page's observations.
 * @param o observations from slop-observe.js
 * @param ground { palette:[hex], italicCount, monoInSource }
 * @param opts  { off: [criterionId] }
 * @returns { results, violations, notDetected, unjudged } — deliberately NO score.
 */
export function judgeObservations(o, ground, opts = {}) {
  const off = new Set(opts.off || []);
  const results = CHECKS.filter((c) => !off.has(c.criterion)).map((check) => {
    let out = check.run(o, ground) || {};
    // An unreadable stylesheet is a blind spot, not an eraser. A violation we
    // ALREADY observed stays observed; only a clean result becomes unjudged,
    // because "found nothing" over partly-unread CSS proves nothing.
    if (o.unobservedStylesheets > 0 && CSS_DEPENDENT.has(check.id) && out.pass !== false) {
      out = { pass: null, detail: `${o.unobservedStylesheets} stylesheet(s) could not be read` };
    }
    const pass = out.pass === undefined ? null : out.pass;
    return {
      id: check.id,
      criterion: check.criterion,
      covers: check.covers,
      // No boolean. `pass: true` read as approval, which this layer never grants.
      status: pass === false ? 'violation' : pass === true ? 'notDetected' : 'unjudged',
      remedy: out.remedy,
      detail: out.detail || '',
    };
  });

  return {
    results,
    violations: results.filter((r) => r.status === 'violation').map((r) => r.id),
    notDetected: results.filter((r) => r.status === 'notDetected').map((r) => r.id),
    unjudged: results.filter((r) => r.status === 'unjudged').map((r) => r.id),
  };
}
