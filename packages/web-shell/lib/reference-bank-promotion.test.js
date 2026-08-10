import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  REVIEWED_ARTIFACTS,
  buildPromotionPlan,
  loadReviewedPromotion,
} from './reference-bank-promotion.js';
import {
  PROMOTION_PROTECTED_TABLES,
  PROMOTION_WRITE_TABLES,
  summarizePromotionIdentities,
} from '../scripts/reference-bank/promotion-db.mjs';
import { assertDistinctDatabaseTargets } from '../scripts/reference-bank/isolated-env.mjs';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const worktreeRoot = path.resolve(testDir, '../../..');

function siteFromSeed(reference, index) {
  return {
    id: reference.id,
    canonicalUrl: reference.url,
    host: reference.host,
    title: reference.title,
    description: reference.description || '',
    thumbnailUrl: reference.thumbnailUrl || null,
    categories: reference.categories || [],
    tags: reference.tags || [],
    editorialConsensus: Number(reference.editorialConsensus || 1),
    curationWeight: String(reference.curationWeight || 1),
    curationRank: index + 1,
    featured: Boolean(reference.featured),
    isPrivate: Boolean(reference.isPrivate),
    privacyReason: reference.privacyReason || null,
    templatePlatform: reference.templatePlatform || null,
    publishedAt: reference.publishedAt || null,
    generatedAt: reference.generatedAt || null,
    availabilityStatus: 'unknown',
    lifecycleState: 'listed',
    analysisStatus: reference.analysisStatus || 'listed',
  };
}

function uniqueAppearanceCount(seed) {
  const keys = new Set();
  for (const reference of seed.references) {
    for (const source of reference.sources || []) {
      keys.add([
        reference.id,
        source.id,
        String(source.recordId || source.detailUrl || reference.url),
      ].join('\u0000'));
    }
  }
  return keys.size;
}

async function baselineSnapshot(overrides = {}) {
  const seed = JSON.parse(await readFile(
    path.join(worktreeRoot, 'packages/web-shell/lib/reference-bank.seed.json'),
    'utf8',
  ));
  const sites = seed.references.map(siteFromSeed);
  return {
    version: 1,
    target: 'isolated',
    capturedAt: '2026-08-01T12:00:00.000Z',
    counts: {
      sites: sites.length,
      appearances: uniqueAppearanceCount(seed),
      aggregators: 3,
      maxRank: sites.length,
    },
    sites,
    appearances: [],
    aggregators: [],
    protected: [
      { table: 'boards', rows: 2, checksum: 'boards-stable' },
      { table: 'reference_preferences', rows: 4, checksum: 'preferences-stable' },
    ],
    ...overrides,
  };
}

describe('reviewed reference delta artifacts', () => {
  it('accepts only the eight exact reviewed artifacts and reconstructs the bounded union', async () => {
    const reviewed = await loadReviewedPromotion(worktreeRoot);

    expect(Object.keys(reviewed.artifacts)).toHaveLength(8);
    expect(Object.values(reviewed.artifacts).map((artifact) => artifact.sha256)).toEqual(
      REVIEWED_ARTIFACTS.map((artifact) => artifact.sha256),
    );
    expect(summarizePromotionIdentities(reviewed.catalog)).toEqual({
      sites: 305,
      appearances: 315,
      sourceCounts: {
        siteofsites: 71,
        minimalgallery: 92,
        landbook: 152,
      },
    });
  });
});

describe('shared-safe reference delta planning', () => {
  it('plans exactly 283 append-only sites and 315 appearances from the landed baseline', async () => {
    const reviewed = await loadReviewedPromotion(worktreeRoot);
    const snapshot = await baselineSnapshot();
    const plan = buildPromotionPlan(reviewed.catalog, snapshot);

    expect(plan.summary).toEqual({
      targetBefore: {
        sites: 1636,
        appearances: 1704,
        aggregators: 3,
        maxRank: 1636,
      },
      sites: { candidates: 305, insert: 283, preserve: 22 },
      appearances: { reviewed: 315, insert: 315, update: 0, noop: 0 },
      aggregators: { reviewed: 3, insert: 3, preserve: 0 },
      targetAfter: {
        sites: 1919,
        appearances: 2019,
        aggregators: 6,
        maxRank: 1919,
      },
    });
    expect(plan.operations.insertSites.map((site) => site.curationRank)).toEqual(
      Array.from({ length: 283 }, (_, index) => 1637 + index),
    );
    expect(plan.rollback).toMatchObject({
      order: [
        'deleteInsertedAppearances',
        'restoreUpdatedAppearances',
        'deleteInsertedSites',
        'deleteInsertedAggregators',
      ],
      restoreUpdatedAppearances: [],
    });
    expect(plan.rollback.deleteInsertedAppearances).toHaveLength(315);
    expect(plan.rollback.deleteInsertedSites).toHaveLength(283);
    expect(plan.rollback.deleteInsertedAggregators).toHaveLength(3);
  });

  it('preserves every existing canonical field and rank instead of accepting seed drift', async () => {
    const reviewed = await loadReviewedPromotion(worktreeRoot);
    const snapshot = await baselineSnapshot();
    const existing = snapshot.sites.find((site) => reviewed.catalog.references.some((candidate) => candidate.id === site.id));
    existing.title = 'Shared title wins';
    existing.description = 'Shared description wins';
    existing.curationWeight = '4.875';
    existing.availabilityStatus = 'available';
    existing.lifecycleState = 'enriched';
    existing.analysisStatus = 'complete';
    const plan = buildPromotionPlan(reviewed.catalog, snapshot);
    const preserved = plan.operations.preserveSites.find((site) => site.id === existing.id);

    expect(preserved).toEqual(existing);
    expect(plan.operations.insertSites.some((site) => site.id === existing.id)).toBe(false);
  });

  it('reports a second identical run as all no-ops', async () => {
    const reviewed = await loadReviewedPromotion(worktreeRoot);
    const firstPlan = buildPromotionPlan(reviewed.catalog, await baselineSnapshot());
    const secondSnapshot = {
      version: 1,
      target: 'isolated',
      capturedAt: '2026-08-01T12:05:00.000Z',
      counts: firstPlan.summary.targetAfter,
      sites: [...firstPlan.snapshot.sites, ...firstPlan.operations.insertSites],
      appearances: reviewed.catalog.appearances,
      aggregators: firstPlan.operations.insertAggregators,
      protected: firstPlan.snapshot.protected,
    };
    const secondPlan = buildPromotionPlan(reviewed.catalog, secondSnapshot);

    expect(secondPlan.summary.sites).toEqual({ candidates: 305, insert: 0, preserve: 305 });
    expect(secondPlan.summary.appearances).toEqual({ reviewed: 315, insert: 0, update: 0, noop: 315 });
    expect(secondPlan.summary.aggregators).toEqual({ reviewed: 3, insert: 0, preserve: 3 });
    expect(secondPlan.summary.targetAfter).toEqual(firstPlan.summary.targetAfter);
  });

  it('plans source-specific appearance repair without changing canonical site metadata', async () => {
    const reviewed = await loadReviewedPromotion(worktreeRoot);
    const firstPlan = buildPromotionPlan(reviewed.catalog, await baselineSnapshot());
    const appearances = structuredClone(reviewed.catalog.appearances);
    appearances[0].sourceTaxonomy = { drifted: true };
    const snapshot = {
      version: 1,
      target: 'isolated',
      capturedAt: '2026-08-01T12:05:00.000Z',
      counts: firstPlan.summary.targetAfter,
      sites: [...firstPlan.snapshot.sites, ...firstPlan.operations.insertSites],
      appearances,
      aggregators: firstPlan.operations.insertAggregators,
      protected: firstPlan.snapshot.protected,
    };
    const repairPlan = buildPromotionPlan(reviewed.catalog, snapshot);

    expect(repairPlan.summary.appearances).toEqual({ reviewed: 315, insert: 0, update: 1, noop: 314 });
    expect(repairPlan.summary.sites.insert).toBe(0);
  });

  it('fails closed when an existing canonical URL belongs to another id', async () => {
    const reviewed = await loadReviewedPromotion(worktreeRoot);
    const snapshot = await baselineSnapshot();
    const candidate = reviewed.catalog.references.find(
      (reference) => !snapshot.sites.some((site) => site.id === reference.id),
    );
    snapshot.sites[0].canonicalUrl = candidate.canonicalUrl;

    expect(() => buildPromotionPlan(reviewed.catalog, snapshot)).toThrow(/already belongs to target id/);
  });

  it('keeps the plan approval hash stable when only capture time changes', async () => {
    const reviewed = await loadReviewedPromotion(worktreeRoot);
    const snapshot = await baselineSnapshot();
    const later = structuredClone(snapshot);
    later.capturedAt = '2026-08-01T12:10:00.000Z';

    expect(buildPromotionPlan(reviewed.catalog, snapshot).planSha256)
      .toBe(buildPromotionPlan(reviewed.catalog, later).planSha256);
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
