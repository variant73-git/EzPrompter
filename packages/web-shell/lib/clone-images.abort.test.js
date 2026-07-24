// clone-images.abort.test.js — the deadline signal must reach the per-region
// crop work so a timed-out clone/styleclone stops launching further paid GPT
// image edits mid-embed (audit 2026-07-23, Sol round 2 #3). Witnesses the
// embed→crop threading with an injected cropFn (no real browser).
import { describe, it, expect, vi } from 'vitest';
import { embedClonedImageRegions } from './clone-images.js';

describe('embedClonedImageRegions signal threading', () => {
  it('passes the abort signal through to the crop function', async () => {
    let received = 'UNSET';
    const cropFn = vi.fn(async (_url, _regions, signal) => { received = signal; return [null]; });
    const controller = new AbortController();

    await embedClonedImageRegions(
      '<div data-clone-crop="0,0,10,10"></div>',
      'data:image/png;base64,iVBORw0KGgo=',
      { cropFn, signal: controller.signal },
    );

    expect(cropFn).toHaveBeenCalled();
    expect(received).toBe(controller.signal);
  });
});
