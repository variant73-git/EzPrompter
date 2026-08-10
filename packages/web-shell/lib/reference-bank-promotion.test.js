import { describe, expect, it } from 'vitest';
import {
  buildPromotionPlan,
  sha256,
  stableStringify,
} from './reference-bank-promotion.js';
import {
  PROMOTION_PROTECTED_TABLES,
  PROMOTION_WRITE_TABLES,
} from '../scripts/reference-bank/promotion-db.mjs';
import { assertDistinctDatabaseTargets } from '../scripts/reference-bank/isolated-env.mjs';

function candidate(id) {
  return {
    id,
    canonicalUrl: `https://${id}.example/`,
    host: `${id}.example`,
    title: id.toUpperCase(),
    description: `${id} description`,
    thumbnailUrl: null,
    categories: ['landing-page'],
    tags: ['fixture'],
    editorialConsensus: 1,
    curationWeight: '1',
    featured: false,
    isPrivate: false,
    privacyReason: null,
    templatePlatform: null,
    publishedAt: null,
    generatedAt: null,
    availabilityStatus: 'unknown',
    lifecycleState: 'listed',
    analysisStatus: 'listed',
  };
}

function appearance(referenceSiteId, sourceId) {
  return {
    referenceSiteId,
    sourceId,
    sourceName: sourceId === 'source-a' ? 'Source A' : 'Source B',
    sourceRecordId: `${sourceId}:${referenceSiteId}`,
    listingUrl: `https://${sourceId}.example/list`,
    detailUrl: `https://${sourceId}.example/${referenceSiteId}`,
    thumbnailUrl: null,
    sourceTaxonomy: { lane: 'ordinary' },
  };
}

function reviewedCatalog() {
  const references = [candidate('alpha'), candidate('beta'), candidate('gamma')];
  const appearances = [appearance('alpha', 'source-a'), appearance('beta', 'source-a'), appearance('gamma', 'source-b')];
  const aggregators = [
    { id: 'source-a', name: 'Source A', homepageUrl: 'https://source-a.example/' },
    { id: 'source-b', name: 'Source B', homepageUrl: 'https://source-b.example/' },
  ];
  const body = { version: 1, references, appearances, aggregators };
  return { ...body, catalogSha256: sha256(stableStringify(body)) };
}

function snapshotSite(id, curationRank) {
  return {
    ...candidate(id),
    curationRank,
  };
}

function baselineSnapshot(overrides = {}) {
  return {
    version: 1,
    target: 'isolated-fixture',
    capturedAt: '2026-08-01T12:00:00.000Z',
    counts: { sites: 2, appearances: 0, aggregators: 0, maxRank: 9 },
    sites: [snapshotSite('alpha', 4), snapshotSite('legacy', 9)],
    appearances: [],
    aggregators: [],
    protected: [
      { table: 'boards', rows: 2, checksum: 'boards-stable' },
      { table: 'reference_preferences', rows: 4, checksum: 'preferences-stable' },
    ],
    ...overrides,
  };
}

describe('shared-safe reference delta planning with portable fixtures', () => {
  it('plans append-only sites, provenance, aggregators, and reversible operations', () => {
    const plan = buildPromotionPlan(reviewedCatalog(), baselineSnapshot());

    expect(plan.summary).toEqual({
      targetBefore: { sites: 2, appearances: 0, aggregators: 0, maxRank: 9 },
      sites: { candidates: 3, insert: 2, preserve: 1 },
      appearances: { reviewed: 3, insert: 3, update: 0, noop: 0 },
      aggregators: { reviewed: 2, insert: 2, preserve: 0 },
      targetAfter: { sites: 4, appearances: 3, aggregators: 2, maxRank: 11 },
    });
    expect(plan.operations.insertSites.map((site) => site.curationRank)).toEqual([10, 11]);
    expect(plan.rollback).toMatchObject({
      order: [
        'deleteInsertedAppearances',
        'restoreUpdatedAppearances',
        'deleteInsertedSites',
        'deleteInsertedAggregators',
      ],
      restoreUpdatedAppearances: [],
      deleteInsertedSites: ['beta', 'gamma'],
      deleteInsertedAggregators: ['source-a', 'source-b'],
    });
    expect(plan.rollback.deleteInsertedAppearances).toHaveLength(3);
  });

  it('preserves every existing canonical field and rank instead of accepting catalog drift', () => {
    const snapshot = baselineSnapshot();
    const existing = snapshot.sites.find((site) => site.id === 'alpha');
    existing.title = 'Shared title wins';
    existing.description = 'Shared description wins';
    existing.curationWeight = '4.875';
    existing.availabilityStatus = 'available';
    existing.lifecycleState = 'enriched';
    existing.analysisStatus = 'complete';

    const plan = buildPromotionPlan(reviewedCatalog(), snapshot);
    expect(plan.operations.preserveSites).toContainEqual(existing);
    expect(plan.operations.insertSites.some((site) => site.id === existing.id)).toBe(false);
  });

  it('reports an identical second run as no-ops', () => {
    const catalog = reviewedCatalog();
    const firstPlan = buildPromotionPlan(catalog, baselineSnapshot());
    const secondSnapshot = {
      version: 1,
      target: 'isolated-fixture',
      capturedAt: '2026-08-01T12:05:00.000Z',
      counts: firstPlan.summary.targetAfter,
      sites: [...firstPlan.snapshot.sites, ...firstPlan.operations.insertSites],
      appearances: catalog.appearances,
      aggregators: firstPlan.operations.insertAggregators,
      protected: firstPlan.snapshot.protected,
    };
    const secondPlan = buildPromotionPlan(catalog, secondSnapshot);

    expect(secondPlan.summary.sites).toEqual({ candidates: 3, insert: 0, preserve: 3 });
    expect(secondPlan.summary.appearances).toEqual({ reviewed: 3, insert: 0, update: 0, noop: 3 });
    expect(secondPlan.summary.aggregators).toEqual({ reviewed: 2, insert: 0, preserve: 2 });
    expect(secondPlan.summary.targetAfter).toEqual(firstPlan.summary.targetAfter);
  });

  it('plans source-specific appearance repair without changing canonical site metadata', () => {
    const catalog = reviewedCatalog();
    const firstPlan = buildPromotionPlan(catalog, baselineSnapshot());
    const appearances = structuredClone(catalog.appearances);
    appearances[0].sourceTaxonomy = { drifted: true };
    const repairPlan = buildPromotionPlan(catalog, {
      version: 1,
      target: 'isolated-fixture',
      capturedAt: '2026-08-01T12:05:00.000Z',
      counts: firstPlan.summary.targetAfter,
      sites: [...firstPlan.snapshot.sites, ...firstPlan.operations.insertSites],
      appearances,
      aggregators: firstPlan.operations.insertAggregators,
      protected: firstPlan.snapshot.protected,
    });

    expect(repairPlan.summary.appearances).toEqual({ reviewed: 3, insert: 0, update: 1, noop: 2 });
    expect(repairPlan.summary.sites.insert).toBe(0);
  });

  it('fails closed when an existing canonical URL belongs to another id', () => {
    const catalog = reviewedCatalog();
    const snapshot = baselineSnapshot();
    snapshot.sites.find((site) => site.id === 'legacy').canonicalUrl = catalog.references.find((site) => site.id === 'beta').canonicalUrl;

    expect(() => buildPromotionPlan(catalog, snapshot)).toThrow(/already belongs to target id/);
  });

  it('keeps the approval hash stable when only capture time changes', () => {
    const catalog = reviewedCatalog();
    const snapshot = baselineSnapshot();
    const later = structuredClone(snapshot);
    later.capturedAt = '2026-08-01T12:10:00.000Z';

    expect(buildPromotionPlan(catalog, snapshot).planSha256)
      .toBe(buildPromotionPlan(catalog, later).planSha256);
  });
});

describe('promotion write boundary', () => {
  it('allows writes only to the three catalog/provenance tables', () => {
    expect(PROMOTION_WRITE_TABLES).toEqual([
      'reference_aggregators',
      'reference_sites',
      'reference_appearances',
    ]);
    expect(PROMOTION_PROTECTED_TABLES).toEqual(expect.arrayContaining([
      'boards',
      'nodes',
      'credit_ledger',
      'generation_reference_uses',
      'reference_preferences',
      'reference_review_cohorts',
      'reference_review_cohort_members',
    ]));
    expect(PROMOTION_WRITE_TABLES.some((table) => PROMOTION_PROTECTED_TABLES.includes(table))).toBe(false);
  });

  it('fails closed when isolated and shared targets are equal', () => {
    expect(() => assertDistinctDatabaseTargets(
      'postgresql://fixture.invalid/db',
      '  postgresql://fixture.invalid/db  ',
    )).toThrow(/must not match DATABASE_URL/);
    expect(() => assertDistinctDatabaseTargets(
      'postgresql://isolated.invalid/db',
      'postgresql://shared.invalid/db',
    )).not.toThrow();
  });
});
