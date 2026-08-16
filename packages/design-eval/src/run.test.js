import { describe, expect, it, vi } from 'vitest';
import { runDesignEval, runDesignEvalOnPage } from './run.js';

// One call for the common case, so a consumer does not have to remember the order
// (observe → judge → integrity) or which of the three takes the raw HTML.
describe('runDesignEval', () => {
  const fakePage = (obs) => ({ setContent: vi.fn(), evaluate: vi.fn(async () => obs) });
  const baseObs = {
    unobservedStylesheets: 0, fontFamilies: [], monoElements: 0, italicElements: 0,
    colors: [], gradientTextElements: 0, sideStripeElements: 0, viewportHeightRules: 0,
    layoutAnimations: 0, text: 'copy', imgSrcs: [],
  };

  it('returns verdict, integrity and the raw observations together', async () => {
    const out = await runDesignEval(fakePage({ ...baseObs, colors: ['rgb(0, 0, 0)'] }), '<p>copy</p>');
    expect(out.violations).toContain('no-pure-bw');
    expect(out.integrity.failed).toEqual([]);
    expect(out.observations).toBeTruthy();
    expect(out.score).toBeUndefined(); // still not a grade
  });

  it('judges the artifact string and the rendered page in one pass', async () => {
    // Truncation comes from the source string; the placeholder image now comes
    // from the parsed DOM, so both lanes report in the same call.
    const out = await runDesignEval(
      fakePage({ ...baseObs, imgSrcs: ['path/to/x.png'] }),
      '<div>ok</div><img sr',
    );
    expect(out.integrity.failed).toContain('no-truncation');
    expect(out.violations).toContain('img-src-not-placeholder');
  });

  it('passes ground truth through to the verdicts', async () => {
    const out = await runDesignEval(fakePage({ ...baseObs, italicElements: 3 }), '<p>x</p>', { italicCount: 0 });
    expect(out.violations).toContain('no-hallucinated-italic');
  });
});

// Requested by the Amigo Secreto session: their system lives in an external
// system.css, so setContent (which lands on about:blank) makes the sheet
// cross-origin and blinds every CSS check. They navigate to a real URL instead.
describe('runDesignEvalOnPage — for a page the caller already loaded', () => {
  const fakePage = (obs) => ({ setContent: vi.fn(), evaluate: vi.fn(async () => obs) });
  const baseObs = {
    unobservedStylesheets: 0, fontFamilies: [], monoElements: 0, italicElements: 0,
    colors: [], gradientTextElements: 0, sideStripeElements: 0, viewportHeightRules: 0,
    layoutAnimations: 0, text: 'copy', imgSrcs: [],
  };

  it('never navigates — the caller owns where the page is', async () => {
    const page = fakePage(baseObs);
    await runDesignEvalOnPage(page);
    expect(page.setContent).not.toHaveBeenCalled();
    expect(page.evaluate).toHaveBeenCalled();
  });

  it('judges the rendered page exactly as the html path does', async () => {
    const out = await runDesignEvalOnPage(fakePage({ ...baseObs, colors: ['rgb(0, 0, 0)'] }));
    expect(out.violations).toContain('no-pure-bw');
  });

  it('refuses to judge integrity without the original source', async () => {
    // page.content() would return the SERIALISED DOM, and the browser repairs a
    // truncated document — so asking the page destroys the very evidence.
    const out = await runDesignEvalOnPage(fakePage(baseObs));
    expect(out.integrity.results.every((r) => r.status === 'unjudged')).toBe(true);
    expect(out.integrity.results[0].detail).toMatch(/source/i);
  });

  it('judges integrity when the caller passes the source text it fetched', async () => {
    const out = await runDesignEvalOnPage(fakePage(baseObs), null, { source: '<div>ok</div><img sr' });
    expect(out.integrity.failed).toContain('no-truncation');
  });
});

describe('the unjudged-integrity placeholder is not shared state', () => {
  const fakePage = () => ({ setContent: () => {}, evaluate: async () => ({
    unobservedStylesheets: 0, fontFamilies: [], monoElements: 0, italicElements: 0,
    colors: [], gradientTextElements: 0, sideStripeElements: 0, viewportHeightRules: 0,
    layoutAnimations: 0, text: 'copy', imgSrcs: [],
  }) });

  it('hands each call its own object, so one consumer cannot poison the next', async () => {
    const a = await runDesignEvalOnPage(fakePage());
    a.integrity.failed.push('inventado');
    a.integrity.results[0].detail = 'sobrescrito';

    const b = await runDesignEvalOnPage(fakePage());
    expect(b.integrity.failed).toEqual([]);
    expect(b.integrity.results[0].detail).not.toBe('sobrescrito');
  });
});
