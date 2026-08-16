import { describe, expect, it } from 'vitest';
import { buildChassisManifest, hashChassisManifest, inferReferenceTypes, validateChassisManifest } from './chassis-manifest.js';

function capture(width, roles = ['hero', 'features', 'cta']) {
  return {
    capturedAt: '2026-08-07T10:00:00.000Z', viewport: { width, height: width > 500 ? 900 : 844 },
    sections: roles.map((role, index) => ({ id: `s${index + 1}`, role, order: index + 1, rect: { x: 0, y: index * 800, width, height: 800 }, text: { visibleCharacters: 100 }, mediaSlotIds: [], motionTrackIds: [] })),
    anchors: [], mediaSlots: [{ id: 'hero-media', sectionId: 's1', role: 'hero-background', aspectRatio: 1.5 }],
    motionTracks: [{ id: 'hero-reveal', sectionId: 's1', driver: 'scroll' }],
    metrics: { sectionCount: roles.length, coverage: 1 },
  };
}

describe('chassis manifest', () => {
  it('infers site types in Portuguese without requiring manual curation tags', () => {
    expect(inferReferenceTypes({ description: 'Site institucional para uma empresa industrial' })).toEqual(['corporate-site']);
    expect(inferReferenceTypes({ brief: 'Uma landing page para um aplicativo' })).toEqual(['landing-page', 'app']);
  });

  it('builds a stable, validated manifest from desktop and mobile evidence', () => {
    const manifest = buildChassisManifest({
      reference: { id: 'ref_1', title: 'Reference', url: 'https://reference.example', categories: ['landing-page'] },
      captures: [capture(1440), capture(390)],
      guidance: { worthBorrowing: 'Keep the anchored headline.', avoid: 'Do not use the WebGL orb.' },
      createdAt: '2026-08-07T11:00:00.000Z',
    });
    expect(validateChassisManifest(manifest)).toEqual({ ok: true, issues: [] });
    expect(manifest.reference.siteTypes).toEqual(['landing-page']);
    expect(manifest.responsive).toMatchObject({ compared: true, score: 100 });
    expect(manifest.transplant.preserve).toContain('Curator guidance: Keep the anchored headline.');
    expect(manifest.transplant.replace).toContain('Exclude from transfer: Do not use the WebGL orb.');
    expect(manifest.hash).toBe(hashChassisManifest(manifest));
  });

  it('records honest evidence gaps when only one viewport is available', () => {
    const manifest = buildChassisManifest({ reference: { url: 'https://reference.example' }, captures: [capture(1280)] });
    expect(manifest.evidence.confidence).toBe('medium');
    expect(manifest.evidence.gaps).toContain('mobile-not-compared');
    expect(manifest.responsive.compared).toBe(false);
  });
});
