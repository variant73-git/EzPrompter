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

  it('keeps raw curator comments in the locked instructions and preserves a rejected section role', () => {
    const contextualComment = 'Keep the friendly tone, but this opening overemphasizes fashion photography; use other hero that makes the group exchange immediately understandable.';
    const guidedManifest = buildChassisManifest({
      reference: { title: 'Old Brand', url: 'https://old.example', source: 'curated-keep' },
      captures: [capture],
      guidance: { avoid: contextualComment },
    });
    const blueprint = createTransplantBlueprint({ manifest: guidedManifest, target: { brand: 'Flux' } });
    const instructions = renderTransplantInstructions(blueprint);
    expect(blueprint.guidance.avoid).toBe(contextualComment);
    expect(instructions).toContain(`Avoid or replace: ${contextualComment}`);
    expect(instructions).toMatch(/Preserve a section's job unless removal is explicit/i);
    expect(instructions).toMatch(/contextual comment[\s\S]*keep the opening role[\s\S]*materially different/i);
    expect(instructions).toMatch(/Do not search for an exact phrase or keyword/i);
  });

  it('does not apply the bank-only hero substitution rule to a direct reference', () => {
    const directManifest = buildChassisManifest({
      reference: { title: 'Chosen by user', url: 'https://direct.example', source: 'direct-url' },
      captures: [capture],
      guidance: { avoid: 'use other hero' },
    });
    const instructions = renderTransplantInstructions(createTransplantBlueprint({ manifest: directManifest, target: { brand: 'Flux' } }));
    expect(instructions).toMatch(/not an implicitly selected curated-bank reference/i);
    expect(instructions).toMatch(/follow the direct reference and explicit user instructions/i);
    expect(instructions).not.toMatch(/keep the opening role/i);
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
