import { describe, expect, it } from 'vitest';
import { buildChassisManifest } from './chassis-manifest.js';
import {
  approveChassisTargetContract,
  createChassisTargetContractPreview,
  hashChassisTargetContract,
} from './chassis-target-contract.js';

function capture(width) {
  return {
    capturedAt: '2026-08-09T10:00:00.000Z', viewport: { width, height: 900 },
    sections: [{
      id: 'hero', role: 'hero', order: 1,
      text: { heading: { value: 'Reference heading' }, body: { value: 'Reference body' }, visibleCharacters: 32 },
      mediaSlotIds: ['hero-media'], motionTrackIds: ['hero-reveal'],
    }],
    anchors: [],
    mediaSlots: [{ id: 'hero-media', sectionId: 'hero', role: 'hero-background' }],
    motionTracks: [{ id: 'hero-reveal', sectionId: 'hero', driver: 'scroll' }],
    metrics: { sectionCount: 1 },
  };
}

const manifest = buildChassisManifest({
  reference: { title: 'Reference', url: 'https://reference.example' },
  captures: [capture(1440), capture(390)],
  guidance: { worthBorrowing: 'The deliberate hero pacing.', avoid: 'Reference brand marks.' },
});

const readyTarget = {
  authorityType: 'url', brand: 'Target Brand', url: 'https://target.example',
  intent: 'Modernize this seasonal group game without making it childish.',
};

const readyEvidence = {
  hash: 'e'.repeat(64), sourceUrl: 'https://target.example/', brand: 'Target Brand',
  title: 'Target Brand', description: 'Create a group and invite your friends for the holiday game.',
  language: 'en', headings: ['Create your group'], callsToAction: ['Start now'],
  colors: ['#D9382E', '#F7F1E8'], fonts: ['Archivo'], logos: [],
  counts: { sections: 3, visibleCharacters: 420, media: 0 },
};

describe('chassis target contract', () => {
  it('builds a reviewable section ledger while every execution surface stays locked', () => {
    const contract = createChassisTargetContractPreview({ manifest, input: readyTarget, evidence: readyEvidence });
    expect(contract).toMatchObject({
      schemaVersion: 2, status: 'preview', approvable: true, manifestHash: manifest.hash,
      summary: { sections: 1, mediaSlots: 1, motionTracks: 1 },
      locks: { generationAuthorized: false, creditSpendAuthorized: false, canvasMutationAuthorized: false },
    });
    expect(contract.ledger[0]).toMatchObject({
      role: 'hero',
      capacity: { headingCharacters: 17, bodyCharacters: 14, visibleCharacters: 32 },
      mediaBindings: [{ role: 'hero-background', status: 'planned-original' }],
      motionPortability: [{ id: 'hero-reveal', portable: true }],
    });
    expect(contract.target).toMatchObject({
      brand: 'Target Brand',
      readiness: { content: true, designSystem: true, media: true },
    });
    expect(contract.strategy).toMatchObject({
      selected: { identityDistance: 'evolve', seasonality: 'translated', representation: 'people-system' },
      mediaPlan: { mode: 'original-people', status: 'planned' },
    });
    expect(contract.strategy.hypotheses.map((item) => item.id)).toEqual(expect.arrayContaining([
      'recognizable-modernization', 'seasonal-translation', 'controlled-play', 'visible-participation',
    ]));
    expect(contract.guidance).toEqual({ worthBorrowing: 'The deliberate hero pacing.', avoid: 'Reference brand marks.' });
    expect(contract.hash).toHaveLength(64);
  });

  it('surfaces missing automatically observed inputs as honest approval blockers', () => {
    const contract = createChassisTargetContractPreview({
      manifest,
      input: readyTarget,
      evidence: {
        hash: 'x'.repeat(64), sourceUrl: 'https://target.example/', brand: 'Target Brand',
        title: '', description: '', headings: [], callsToAction: [], colors: [], fonts: [], logos: [],
        counts: { sections: 0, visibleCharacters: 0, media: 0 },
      },
    });
    expect(contract.approvable).toBe(false);
    expect(contract.gaps.map((gap) => gap.code)).toEqual(['target-content-missing', 'target-design-system-missing']);
    expect(() => approveChassisTargetContract(contract, contract.hash)).toThrow('target_contract_blocked');
  });

  it('ties approval to the manifest, evidence, prompt, and exact strategy choices', () => {
    const contract = createChassisTargetContractPreview({ manifest, input: readyTarget, evidence: readyEvidence });
    const approved = approveChassisTargetContract(contract, contract.hash);
    expect(approved.status).toBe('approved');
    expect(approved.hash).toBe(contract.hash);
    expect(hashChassisTargetContract(approved)).toBe(contract.hash);

    const changed = createChassisTargetContractPreview({
      manifest,
      input: { ...readyTarget, strategySelections: { identityDistance: 'reinvent' } },
      evidence: readyEvidence,
    });
    expect(changed.hash).not.toBe(contract.hash);
    expect(() => approveChassisTargetContract(changed, contract.hash)).toThrow('target_contract_stale');
  });
});
