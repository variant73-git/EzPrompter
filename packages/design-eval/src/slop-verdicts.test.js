import { describe, expect, it } from 'vitest';
import { COVERAGE, coveredCriterionIds, judgeObservations, splitFamilies } from './slop-verdicts.js';

// Verdicts are PURE: they consume facts observed in the browser (slop-observe.js)
// and never touch HTML. That split is what ended three rounds of parsing bugs —
// the browser owns parsing, this file owns judgement.

const obs = (over = {}) => ({
  unobservedStylesheets: 0,
  fontFamilies: [],
  monoElements: 0,
  italicElements: 0,
  colors: [],
  gradientTextElements: 0,
  sideStripeElements: 0,
  viewportHeightRules: 0,
  layoutAnimations: 0,
  text: 'Some copy',
  imgSrcs: [],
  ...over,
});

const at = (o, id, ground) => judgeObservations(o, ground).results.find((r) => r.id === id);

describe('font family splitting', () => {
  it('respects quotes, so one family with a comma is not two families', () => {
    expect(splitFamilies('"Inter, Display", serif')).toEqual(['inter, display', 'serif']);
    expect(splitFamilies('Inter, sans-serif')).toEqual(['inter', 'sans-serif']);
  });
});

describe('verdicts', () => {
  it('flags banned faces but not names that merely start alike', () => {
    expect(at(obs({ fontFamilies: ['Inter, sans-serif'] }), 'banned-fonts').status).toBe('violation');
    expect(at(obs({ fontFamilies: ['"JetBrains Mono", monospace'] }), 'banned-fonts').status).toBe('violation');
    expect(at(obs({ fontFamilies: ['Interstate, sans-serif'] }), 'banned-fonts').status).toBe('notDetected');
    // A single family whose NAME contains a comma must not be split into "inter".
    expect(at(obs({ fontFamilies: ['"Inter, Display"'] }), 'banned-fonts').status).toBe('notDetected');
  });

  it('judges pure black and white from normalised colours only', () => {
    expect(at(obs({ colors: ['rgb(0, 0, 0)'] }), 'no-pure-bw').status).toBe('violation');
    expect(at(obs({ colors: ['rgb(255, 255, 255)'] }), 'no-pure-bw').status).toBe('violation');
    expect(at(obs({ colors: ['rgba(0, 0, 0, 0.08)'] }), 'no-pure-bw').status).toBe('notDetected'); // tinted shadow
    expect(at(obs({ colors: ['rgb(10, 10, 10)'] }), 'no-pure-bw').status).toBe('notDetected');
  });

  it('names which purity was found', () => {
    expect(at(obs({ colors: ['rgb(255, 255, 255)'] }), 'no-pure-bw').detail).toMatch(/white/);
    expect(at(obs({ colors: ['rgb(255, 255, 255)'] }), 'no-pure-bw').detail).not.toMatch(/black/);
  });

  it('matches a measured palette through notation differences', () => {
    const ground = { palette: ['#123456'] };
    expect(at(obs({ colors: ['rgb(18, 52, 86)'] }), 'palette-match', ground).status).toBe('notDetected');
    expect(at(obs({ colors: ['rgb(1, 2, 3)'] }), 'palette-match', ground).status).toBe('violation');
    expect(at(obs({ colors: [] }), 'palette-match').status).toBe('unjudged'); // no ground truth
  });

  it('counts italic against ground truth, in ELEMENTS both sides', () => {
    expect(at(obs({ italicElements: 2 }), 'no-hallucinated-italic', { italicCount: 0 }).status).toBe('violation');
    expect(at(obs({ italicElements: 2 }), 'no-hallucinated-italic', { italicCount: 2 }).status).toBe('notDetected');
    expect(at(obs({ italicElements: 2 }), 'no-hallucinated-italic').status).toBe('unjudged');
  });

  it('refuses to rule on mono scope from a boolean', () => {
    const mono = { monoElements: 3, fontFamilies: ['ui-monospace, monospace'] };
    expect(at(obs(mono), 'no-mono', { monoInSource: false }).status).toBe('violation');
    expect(at(obs(mono), 'no-mono', { monoInSource: true }).status).toBe('unjudged');
    expect(at(obs({ monoElements: 0 }), 'no-mono').status).toBe('notDetected');
  });

  it('reads copy from rendered text', () => {
    expect(at(obs({ text: 'Ship 🚀' }), 'no-emoji').status).toBe('violation');
    expect(at(obs({ text: 'fast — cheap' }), 'no-emdash').status).toBe('violation');
    expect(at(obs({ text: '' }), 'no-emoji').status).toBe('unjudged'); // nothing to judge
  });

  it('nulls every CSS-dependent check when a stylesheet could not be read', () => {
    const blind = obs({ unobservedStylesheets: 1 });
    expect(at(blind, 'banned-fonts').status).toBe('unjudged');
    expect(at(blind, 'no-pure-bw').status).toBe('unjudged');
    expect(at(blind, 'no-emoji').status).toBe('notDetected'); // copy is still observable
  });
});

describe('substitutable vs forbidden — not a weight, a different remedy', () => {
  it('treats Inter as substitutable and says what to do instead', () => {
    const r = at(obs({ fontFamilies: ['Inter, sans-serif'] }), 'banned-fonts');
    expect(r.status).toBe('violation');
    expect(r.remedy).toBe('substitute');
    expect(r.detail).toMatch(/helvetica-like/i);
  });

  it('treats JetBrains as forbidden, with no substitution offered', () => {
    const r = at(obs({ fontFamilies: ['"JetBrains Mono", monospace'] }), 'banned-fonts');
    expect(r.status).toBe('violation');
    expect(r.remedy).toBe('forbidden');
  });

  it('stands down when the user explicitly asked for that face', () => {
    const g = { explicitFonts: ['JetBrains Mono'] };
    expect(at(obs({ fontFamilies: ['"JetBrains Mono", monospace'] }), 'banned-fonts', g).status).toBe('notDetected');
    expect(at(obs({ fontFamilies: ['Inter, sans-serif'] }), 'banned-fonts', { explicitFonts: ['Inter'] }).status).toBe('notDetected');
  });
});

describe('the detector contract', () => {
  it('claims no criterion as fully covered', () => {
    expect(coveredCriterionIds()).toEqual([]);
    for (const entry of Object.values(COVERAGE)) {
      expect(entry.level).toBe('partial');
      expect(entry.blind).toBeTruthy();
    }
  });

  it('reports violations found, and never a green score', () => {
    // A page where nothing was detected is NOT a page that passed. With zero full
    // coverage there is no honest way to publish a percentage.
    const clean = judgeObservations(obs());
    expect(clean.violations).toEqual([]);
    expect(clean.score).toBeUndefined();
    expect(clean.passed).toBeUndefined();

    const dirty = judgeObservations(obs({ colors: ['rgb(0, 0, 0)'] }));
    expect(dirty.violations).toContain('no-pure-bw');
  });

  it('separates what it could not judge from what it cleared', () => {
    const out = judgeObservations(obs({ unobservedStylesheets: 1 }));
    expect(out.unjudged).toContain('no-pure-bw');
    expect(out.notDetected).toContain('no-emoji');
  });
});

// Audit round 4. Each case here is a false positive Codex reproduced by running
// the code — a wrong `violation` on legitimate content, which is the only thing
// this layer actually asserts.
describe('audit r4 — false positives on legitimate content', () => {
  it('does not call a copyright or trademark sign an emoji', () => {
    // Extended_Pictographic is a segmentation property, not "renders as emoji".
    // It matches © ® ™ ↔, so every footer was a violation.
    for (const text of ['\u00a9 2026 Uncraft', 'Uncraft\u00ae', 'Uncraft\u2122', 'a \u2194 b']) {
      expect(at(obs({ text }), 'no-emoji').status, text).toBe('notDetected');
    }
  });

  it('still catches real emoji, including the ones that need a variation selector', () => {
    expect(at(obs({ text: 'Ship \ud83d\ude80' }), 'no-emoji').status).toBe('violation');
    expect(at(obs({ text: 'Love \u2764\ufe0f it' }), 'no-emoji').status).toBe('violation');
  });

  it('does not read a mono FALLBACK as a page set in monospace', () => {
    // The first available family is what draws. `Arial, monospace` is not mono.
    expect(at(obs({ monoElements: 0, fontFamilies: ['Arial, monospace'] }), 'no-mono', { monoInSource: false }).status).toBe('notDetected');
  });

  it('does not report a palette absent when a colour could not be parsed', () => {
    // CSS Color 4 (oklch, color(display-p3 ...)) does not serialise as rgb().
    // Claiming "absent" over a notation we cannot read is a fabricated verdict.
    const r = at(obs({ colors: ['oklch(1 0 0)'] }), 'palette-match', { palette: ['#ffffff'] });
    expect(r.status).toBe('unjudged');
  });

  it('rejects a malformed palette entry instead of calling the colour missing', () => {
    // 5 and 7 digits are not CSS hex; the old parser read them as a colour.
    for (const bad of ['#12345', 'not-a-colour', '#1234567']) {
      expect(at(obs({ colors: ['rgb(255, 255, 255)'] }), 'palette-match', { palette: [bad] }).status, bad).toBe('unjudged');
    }
  });

  it('accepts the opaque hex forms', () => {
    // Superseded by the r5 case below for 4/8 digits: those carry alpha, which this
    // layer cannot compare, so they are unjudged rather than silently opaque.
    for (const hex of ['#fff', '#ffffff', '#FFFFFF']) {
      expect(at(obs({ colors: ['rgb(255, 255, 255)'] }), 'palette-match', { palette: [hex] }).status, hex).toBe('notDetected');
    }
  });

  it('keeps an observed violation even when another stylesheet is unreadable', () => {
    // Erasing evidence we already have is worse than admitting the blind spot.
    const o = obs({ unobservedStylesheets: 1, colors: ['rgb(0, 0, 0)'] });
    expect(at(o, 'no-pure-bw').status).toBe('violation');
  });

  it('turns only a CLEAN result into unjudged when a stylesheet is unreadable', () => {
    const o = obs({ unobservedStylesheets: 1, colors: ['rgb(10, 10, 10)'] });
    expect(at(o, 'no-pure-bw').status).toBe('unjudged');
  });
});

describe('audit r4 — the contract stops saying "pass"', () => {
  it('reports a status, never a boolean that reads as approval', () => {
    const out = judgeObservations(obs({ colors: ['rgb(0, 0, 0)'] }));
    const r = out.results.find((x) => x.id === 'no-pure-bw');
    expect(r.status).toBe('violation');
    expect(r.pass).toBeUndefined();
    expect(new Set(out.results.map((x) => x.status)))
      .toEqual(new Set([...new Set(out.results.map((x) => x.status))].filter((v) => ['violation', 'notDetected', 'unjudged'].includes(v))));
  });
});

// Audit round 5.
describe('audit r5 — alpha, unreadable notations and the img lane', () => {
  it('refuses a palette entry that carries transparency instead of pretending it is opaque', () => {
    // `#fff8` is white at 53% alpha. Dropping the alpha made it match opaque white
    // AND miss the translucent one — wrong in both directions.
    expect(at(obs({ colors: ['rgb(255, 255, 255)'] }), 'palette-match', { palette: ['#fff8'] }).status).toBe('unjudged');
    expect(at(obs({ colors: ['rgba(255, 255, 255, 0.533)'] }), 'palette-match', { palette: ['#fff8'] }).status).toBe('unjudged');
  });

  it('does not clear pure-black when a colour was in a notation it cannot read', () => {
    // oklch(0 0 0) IS black. Ignoring it silently and reporting notDetected would
    // be the fabricated verdict this layer exists to avoid.
    expect(at(obs({ colors: ['oklch(0 0 0)'] }), 'no-pure-bw').status).toBe('unjudged');
  });

  it('still reports black when another colour already proves it', () => {
    expect(at(obs({ colors: ['oklch(0.7 0.1 200)', 'rgb(0, 0, 0)'] }), 'no-pure-bw').status).toBe('violation');
  });

  it('does not withhold a palette match that is already proven', () => {
    const g = { palette: ['#ffffff'] };
    const o = obs({ colors: ['rgb(255, 255, 255)', 'oklch(0.7 0.1 200)'] });
    expect(at(o, 'palette-match', g).status).toBe('notDetected');
  });

  it('judges placeholder images from the parsed DOM, not from a regex over markup', () => {
    expect(at(obs({ imgSrcs: ['path/to/x.png'] }), 'img-src-not-placeholder').status).toBe('violation');
    expect(at(obs({ imgSrcs: ['/real.png'] }), 'img-src-not-placeholder').status).toBe('notDetected');
    expect(at(obs({ imgSrcs: [] }), 'img-src-not-placeholder').status).toBe('unjudged');
  });
});
