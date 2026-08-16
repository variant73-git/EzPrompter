import { describe, expect, it, vi } from 'vitest';
import { analyzeChassisReference, normalizeReferenceUrl } from './chassis-analyzer.js';

function evidence(viewport) {
  return {
    capturedAt: '2026-08-07T10:00:00.000Z', viewport,
    sections: [{ id: 'hero', role: 'hero', order: 1, rect: { x: 0, y: 0, width: viewport.width, height: viewport.height }, text: { visibleCharacters: 100 }, mediaSlotIds: [], motionTrackIds: [] }],
    anchors: [], mediaSlots: [], motionTracks: [], metrics: { sectionCount: 1 },
  };
}

describe('chassis analyzer', () => {
  it('normalizes only http references', () => {
    expect(normalizeReferenceUrl('https://example.com/path#hero')).toBe('https://example.com/path');
    expect(() => normalizeReferenceUrl('file:///tmp/site.html')).toThrow('invalid_reference_url');
  });

  it('captures desktop and mobile evidence without retaining screenshots or HTML', async () => {
    const capture = vi.fn(async (_url, options) => ({
      html: '<html>large capture</html>', screenshotDataUrl: 'data:image/png;base64,large',
      chassisEvidence: evidence(options.viewport),
    }));
    const validate = vi.fn(async (url) => url);
    const manifest = await analyzeChassisReference({ reference: { id: 'ref_1', url: 'https://example.com' }, capture, validate });
    expect(capture).toHaveBeenCalledTimes(2);
    expect(manifest.evidence.viewports).toEqual([{ width: 1440, height: 1000 }, { width: 390, height: 844 }]);
    expect(JSON.stringify(manifest)).not.toContain('large capture');
    expect(JSON.stringify(manifest)).not.toContain('base64');
    expect(capture).toHaveBeenCalledWith('https://example.com/', expect.objectContaining({ publicNetworkOnly: true }));
  });
});
