import { describe, expect, it } from 'vitest';
import { buildChassisManifest } from './chassis-manifest.js';
import { auditChassisTransfer, createTransplantBlueprint, renderTransplantInstructions } from './chassis-transplant.js';

const capture = {
  capturedAt: '2026-08-07T10:00:00.000Z', viewport: { width: 1440, height: 1000 },
  sections: [
    { id: 'hero', role: 'hero', order: 1, text: { heading: { value: 'Reference headline' }, visibleCharacters: 40 }, mediaSlotIds: ['hero-media'], motionTrackIds: [] },
    { id: 'work', role: 'showcase', order: 2, text: { visibleCharacters: 80 }, mediaSlotIds: [], motionTrackIds: [] },
  ],
  anchors: [], mediaSlots: [{ id: 'hero-media', sectionId: 'hero', role: 'hero-background' }], motionTracks: [], metrics: { sectionCount: 2 },
};
const manifest = buildChassisManifest({ reference: { title: 'Old Brand', url: 'https://old.example' }, captures: [capture] });

describe('chassis transplant contract', () => {
  it('turns a manifest into a generation-locked section ledger', () => {
    const blueprint = createTransplantBlueprint({ manifest, target: { brand: 'Flux' } });
    expect(blueprint.sections).toHaveLength(2);
    expect(blueprint.acceptance.generationAuthorized).toBe(false);
    expect(renderTransplantInstructions(blueprint)).toContain('Target brand: Flux');
  });

  it('audits structure, identity replacement, media coverage, and responsive evidence', () => {
    const blueprint = createTransplantBlueprint({ manifest, target: { brand: 'Flux' } });
    expect(auditChassisTransfer({
      blueprint,
      outputEvidence: { sections: [{ role: 'hero' }, { role: 'showcase' }], mediaSlots: [{}], responsiveCompared: true },
      visibleText: 'Flux turns industrial data into decisions.',
    })).toMatchObject({ ok: true, scores: { structure: 100, mediaCoverage: 100 } });
    const failed = auditChassisTransfer({ blueprint, outputEvidence: { sections: [{ role: 'showcase' }] }, visibleText: 'Old Brand' });
    expect(failed.ok).toBe(false);
    expect(failed.checks.identityReplaced).toBe(false);
  });
});
