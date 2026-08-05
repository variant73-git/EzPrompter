import { describe, expect, it } from 'vitest';
import { buildPromotionPlan } from './reference-bank-promotion.js';
import {
  buildUserCalibrationCatalog,
  USER_CALIBRATION_REFERENCES,
  USER_CALIBRATION_SOURCE,
} from './reference-user-calibration.js';

describe('user calibration reference catalog', () => {
  it('freezes all 39 user-supplied references with one provenance appearance each', () => {
    const catalog = buildUserCalibrationCatalog();
    expect(USER_CALIBRATION_REFERENCES).toHaveLength(39);
    expect(catalog.references).toHaveLength(39);
    expect(catalog.appearances).toHaveLength(39);
    expect(new Set(catalog.references.map((reference) => reference.id)).size).toBe(39);
    expect(new Set(catalog.references.map((reference) => reference.canonicalUrl)).size).toBe(39);
    expect(catalog.appearances.every((appearance) => appearance.sourceId === USER_CALIBRATION_SOURCE.id)).toBe(true);
  });

  it('preserves meaningful supplied paths and presets Ideogram conservatively', () => {
    const catalog = buildUserCalibrationCatalog();
    expect(catalog.references.map((reference) => reference.canonicalUrl)).toEqual(expect.arrayContaining([
      'https://apollo.io/pt',
      'https://farmminerals.com/products/croptab',
      'https://palantir.com/platforms/foundry',
    ]));
    expect(catalog.references.find((reference) => reference.host === 'ideogram.ai')).toMatchObject({
      title: 'Ideogram',
      categories: ['saas', 'tool'],
      tags: ['soft-tech', 'minimal', 'technical', 'bold', 'approachable'],
      availabilityStatus: 'available',
    });
    expect(catalog.references.find((reference) => reference.host === 'agentflow.framer.ai')).toMatchObject({
      title: 'AgentFlow',
      categories: ['landing-page', 'saas', 'tool'],
      tags: ['soft-tech', 'corporate', 'technical', 'approachable'],
      isPrivate: true,
      privacyReason: 'webbuilder-template',
      templatePlatform: 'framer',
    });
    expect(catalog.appearances.find((appearance) => appearance.referenceSiteId === catalog.references.find((reference) => reference.host === 'agentflow.framer.ai').id)).toMatchObject({
      listingUrl: 'https://www.framer.com/community/marketplace/templates/agentflow/',
      sourceTaxonomy: { recordType: 'template', templatePlatform: 'framer' },
    });
  });

  it('produces an idempotent plan after the catalog is already present', () => {
    const catalog = buildUserCalibrationCatalog();
    const snapshot = {
      version: 1,
      target: 'isolated',
      counts: { sites: 39, appearances: 39, aggregators: 1, maxRank: 39 },
      sites: catalog.references.map((reference, index) => ({ ...reference, curationRank: index + 1 })),
      appearances: catalog.appearances,
      aggregators: [{
        ...USER_CALIBRATION_SOURCE,
        overallRating: 3,
        editorialQuality: null,
        motionDensity: null,
        metadataQuality: null,
        noiseControl: null,
        status: 'active',
      }],
      protected: [],
    };
    const plan = buildPromotionPlan(catalog, snapshot);
    expect(plan.summary.sites).toMatchObject({ candidates: 39, insert: 0, preserve: 39 });
    expect(plan.summary.appearances).toMatchObject({ reviewed: 39, insert: 0, update: 0, noop: 39 });
    expect(plan.summary.aggregators).toMatchObject({ reviewed: 1, insert: 0, preserve: 1 });
  });
});
