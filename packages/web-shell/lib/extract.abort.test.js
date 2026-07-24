// extract.abort.test.js — when the route's deadline aborts mid-run, runExtract
// must stop LAUNCHING further paid stages. Witnesses the between-stage abort
// checks in the multi-call styleclone/clone paths (audit 2026-07-23, Sol #2:
// timed-out work is discarded but not harmless → orphan provider spend).
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { cloneImageToHtml, embedClonedImageRegions, generateDesignMd } = vi.hoisted(() => ({
  cloneImageToHtml: vi.fn(),
  embedClonedImageRegions: vi.fn(),
  generateDesignMd: vi.fn(),
}));

vi.mock('./extract-llm.js', () => ({
  cloneImageToHtml,
  describeSiteAsPrompt: vi.fn(),
  describeImageAsTokens: vi.fn(),
  describeImageAsPrompt: vi.fn(),
}));
vi.mock('./clone-images.js', () => ({ embedClonedImageRegions }));
vi.mock('./design-md.js', () => ({ generateDesignMd, DESIGN_MD_SYSTEM: '' }));
vi.mock('./demarcelize.js', () => ({ extractContent: vi.fn() }));

import { runExtract } from './extract.js';

const assetNode = { id: 'a1', kind: 'asset', meta: { dataUrl: 'data:image/png;base64,iVBORw0KGgo=', name: 'shot' } };

beforeEach(() => {
  cloneImageToHtml.mockReset().mockResolvedValue('<html>clone</html>');
  embedClonedImageRegions.mockReset().mockResolvedValue('<html>embedded</html>');
  generateDesignMd.mockReset().mockResolvedValue({ md: '# spec', truncated: false });
});

describe('runExtract between-stage cancellation', () => {
  it('styleclone: an abort after the clone stage skips the embed AND the 2nd LLM call', async () => {
    const controller = new AbortController();
    // The deadline fires during/after the first paid stage.
    cloneImageToHtml.mockImplementation(async () => { controller.abort(); return '<html>clone</html>'; });

    await expect(
      runExtract({ to: 'styleclone', node: assetNode, signal: controller.signal })
    ).rejects.toThrow(/cancelled/i);

    expect(cloneImageToHtml).toHaveBeenCalledTimes(1);
    expect(embedClonedImageRegions).not.toHaveBeenCalled(); // no image cropping after abort
    expect(generateDesignMd).not.toHaveBeenCalled();        // no orphan 2nd LLM call
  });

  it('styleclone: with no abort it runs all three stages to completion', async () => {
    const out = await runExtract({ to: 'styleclone', node: assetNode });
    expect(cloneImageToHtml).toHaveBeenCalledTimes(1);
    expect(embedClonedImageRegions).toHaveBeenCalledTimes(1);
    expect(generateDesignMd).toHaveBeenCalledTimes(1);
    expect(out.designMd).toBe('# spec');
  });

  it('threads the deadline signal into embedClonedImageRegions (so the crop loop can cancel too)', async () => {
    const controller = new AbortController();
    await runExtract({ to: 'styleclone', node: assetNode, signal: controller.signal });
    expect(embedClonedImageRegions).toHaveBeenCalledWith(
      expect.anything(), expect.anything(), expect.objectContaining({ signal: controller.signal })
    );
  });
});
