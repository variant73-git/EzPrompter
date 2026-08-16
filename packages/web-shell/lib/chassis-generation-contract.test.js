import { describe, expect, it } from 'vitest';
import { buildChassisManifest } from './chassis-manifest.js';
import { createTransplantBlueprint } from './chassis-transplant.js';
import { authorizeChassisGeneration, buildDemarcelizerPayload, prepareChassisGeneration } from './chassis-generation-contract.js';

const manifest = buildChassisManifest({
  reference: { url: 'https://reference.example' },
  captures: [{
    capturedAt: '2026-08-07T10:00:00.000Z', viewport: { width: 1440, height: 1000 },
    sections: [{ id: 'hero', role: 'hero', order: 1, text: { visibleCharacters: 20 }, mediaSlotIds: [], motionTrackIds: [] }],
    anchors: [], mediaSlots: [], motionTracks: [], metrics: { sectionCount: 1 },
  }],
});
const blueprint = createTransplantBlueprint({ manifest, target: { brand: 'Flux' } });

describe('chassis generation contract', () => {
  it('prepares complete inputs without authorizing generation or credits', () => {
    const prepared = prepareChassisGeneration({ blueprint, targetHtml: '<main>Flux</main>', referenceHtml: '<main>Reference</main>' });
    expect(prepared).toMatchObject({ engine: 'chassis-transplant-v1', generationAuthorized: false, creditSpendAuthorized: false });
    expect(() => buildDemarcelizerPayload(prepared)).toThrow('generation_not_authorized');
  });

  it('requires the exact manifest and contract hashes before exposing an execution payload', () => {
    const prepared = prepareChassisGeneration({ blueprint, targetHtml: '<main>Flux</main>', referenceHtml: '<main>Reference</main>' });
    const authorized = authorizeChassisGeneration(prepared, { manifestHash: prepared.manifestHash, contractHash: prepared.contractHash, creditSpendAuthorized: true, approvedAt: '2026-08-07T12:00:00.000Z' });
    expect(buildDemarcelizerPayload(authorized)).toMatchObject({ manifestHash: manifest.hash, transferContract: expect.stringContaining('Chassis Transfer Contract') });
  });
});
