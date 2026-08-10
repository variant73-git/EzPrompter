import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const REVIEWED_PROMOTION_VERSION = 1;

export const REVIEWED_ARTIFACTS = Object.freeze([
  {
    key: 'proofSeed',
    kind: 'seed',
    relativePath: '.firecrawl/reference-proof/reference-bank.proof.seed.json',
    sha256: 'c30074562c6226ef251052f8a8d42ded52b78c7c1d1577322c4225b508b93778',
  },
  {
    key: 'proofReport',
    kind: 'report',
    relativePath: '.firecrawl/reference-proof/reference-bank.proof.report.json',
    sha256: 'b367adb074b83d022eb315a9e7db8947f7917b107cddfaa6a185e58468761f75',
  },
  {
    key: 'incrementSeed',
    kind: 'seed',
    relativePath: '.firecrawl/reference-increment-1/reference-bank.increment.seed.json',
    sha256: 'b452a369ee2990cf7635b44e0d0ebee377167b4befab9f9bc1345e93fe0664af',
  },
  {
    key: 'incrementReport',
    kind: 'report',
    relativePath: '.firecrawl/reference-increment-1/reference-bank.increment.report.json',
    sha256: 'f9eac7b65aab01d1d86f1668edb15724960d244b8e3a46f21258608e0adadd51',
  },
  {
    key: 'landbookPilotSeed',
    kind: 'seed',
    relativePath: '.firecrawl/reference-landbook-pilot/reference-bank.landbook.seed.json',
    sha256: 'c638c7a9714e825261a154ff557c7808987100ab19de4c85c5a0341641b27859',
  },
  {
    key: 'landbookPilotReport',
    kind: 'report',
    relativePath: '.firecrawl/reference-landbook-pilot/reference-bank.landbook.report.json',
    sha256: 'e3d975304665dac9f0734b0b5df4750ae38eb79a6b6b0760b68906507ce11a70',
  },
  {
    key: 'landbookPagesSeed',
    kind: 'seed',
    relativePath: '.firecrawl/reference-landbook-pages-6-10/reference-bank.landbook-pages-6-10.seed.json',
    sha256: '418c041a1f5da4b4161ad88b86859b99fe0873531d4e316e38bacee81b888928',
  },
  {
    key: 'landbookPagesReport',
    kind: 'report',
    relativePath: '.firecrawl/reference-landbook-pages-6-10/reference-bank.landbook-pages-6-10.report.json',
    sha256: 'be3f68773b52fed0a8cd1432a185dcea6d91f2635b38deb6fdbbab61a1c703c3',
  },
]);

const TWO_SOURCE_IDS = new Set(['minimalgallery', 'siteofsites']);
const EXPECTED_SOURCE_COUNTS = Object.freeze({
  minimalgallery: 92,
  siteofsites: 71,
  landbook: 152,
});

const HOMEPAGE_URLS = Object.freeze({
  landbook: 'https://land-book.com/',
  minimalgallery: 'https://minimal.gallery/',
  siteofsites: 'https://www.siteofsites.co/',
});

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function appearanceKey(appearance) {
  return [appearance.referenceSiteId, appearance.sourceId, appearance.sourceRecordId].join('\u0000');
}

function normalizeTaxonomy(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function toAppearance(reference, source) {
  return {
    referenceSiteId: reference.id,
    sourceId: source.id,
    sourceName: source.name,
    sourceRecordId: String(source.recordId || source.detailUrl || reference.url),
    listingUrl: source.listingUrl,
    detailUrl: source.detailUrl || null,
    thumbnailUrl: source.thumbnailUrl || null,
    sourceTaxonomy: normalizeTaxonomy(source.taxonomy),
  };
}

function toSite(reference) {
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

function normalizeAppearance(value) {
  return {
    referenceSiteId: value.referenceSiteId,
    sourceId: value.sourceId,
    sourceName: value.sourceName,
    sourceRecordId: String(value.sourceRecordId),
    listingUrl: value.listingUrl,
    detailUrl: value.detailUrl || null,
    thumbnailUrl: value.thumbnailUrl || null,
    sourceTaxonomy: normalizeTaxonomy(value.sourceTaxonomy),
  };
}

function appearanceContentEqual(left, right) {
  return stableStringify(normalizeAppearance(left)) === stableStringify(normalizeAppearance(right));
}

function seedAppearances(seed, sourceFilter = () => true) {
  return (seed.references || []).flatMap((reference) => (reference.sources || [])
    .filter(sourceFilter)
    .map((source) => toAppearance(reference, source)));
}

function assertSeedShape(seed, label) {
  assert(seed && typeof seed === 'object', `${label} must be a JSON object.`);
  assert(Array.isArray(seed.references) && seed.references.length > 0, `${label} has no references.`);
}

export function buildReviewedPromotionCatalog(seeds) {
  const { proofSeed, incrementSeed, landbookPilotSeed, landbookPagesSeed } = seeds;
  for (const [label, seed] of Object.entries(seeds)) assertSeedShape(seed, label);

  assert(proofSeed.stats?.proof?.proofAppearances === 81, 'Proof seed appearance count drifted.');
  assert(incrementSeed.stats?.incremental?.incrementalAppearances === 82, 'Increment seed appearance count drifted.');
  assert(landbookPilotSeed.stats?.landbookPilot?.acceptedAppearances === 75, 'Landbook pilot count drifted.');
  assert(landbookPagesSeed.stats?.landbookPages6To10?.acceptedAppearances === 77, 'Landbook pages 6-10 count drifted.');

  const proofAppearances = seedAppearances(proofSeed, (source) => TWO_SOURCE_IDS.has(source.id));
  const incrementAppearances = seedAppearances(incrementSeed, (source) => TWO_SOURCE_IDS.has(source.id));
  const incrementByKey = new Map(incrementAppearances.map((appearance) => [appearanceKey(appearance), appearance]));
  assert(proofAppearances.length === 81, 'Proof seed no longer contains exactly 81 reviewed appearances.');
  for (const appearance of proofAppearances) {
    const cumulative = incrementByKey.get(appearanceKey(appearance));
    assert(cumulative && appearanceContentEqual(cumulative, appearance), `Cumulative increment lost or changed proof appearance ${appearanceKey(appearance)}.`);
  }

  const references = new Map();
  const appearances = new Map();
  const aggregators = new Map();
  const addSeed = (seed, sourceFilter) => {
    for (const reference of seed.references) {
      const selectedSources = (reference.sources || []).filter(sourceFilter);
      if (!selectedSources.length) continue;
      const site = toSite(reference);
      const existingSite = references.get(site.id);
      if (existingSite) {
        assert(existingSite.canonicalUrl === site.canonicalUrl, `Reference id ${site.id} maps to multiple canonical URLs.`);
      } else {
        references.set(site.id, site);
      }
      for (const source of selectedSources) {
        const appearance = toAppearance(reference, source);
        const key = appearanceKey(appearance);
        assert(!appearances.has(key), `Duplicate reviewed appearance identity ${key}.`);
        appearances.set(key, appearance);
        const aggregator = {
          id: source.id,
          name: source.name,
          homepageUrl: HOMEPAGE_URLS[source.id] || null,
        };
        const existingAggregator = aggregators.get(aggregator.id);
        if (existingAggregator) {
          assert(existingAggregator.name === aggregator.name, `Aggregator ${aggregator.id} has inconsistent names.`);
        } else {
          aggregators.set(aggregator.id, aggregator);
        }
      }
    }
  };

  addSeed(incrementSeed, (source) => TWO_SOURCE_IDS.has(source.id));
  addSeed(landbookPilotSeed, (source) => source.id === 'landbook');
  addSeed(landbookPagesSeed, (source) => source.id === 'landbook');

  const sourceCounts = [...appearances.values()].reduce((counts, appearance) => {
    counts[appearance.sourceId] = (counts[appearance.sourceId] || 0) + 1;
    return counts;
  }, {});
  assert(appearances.size === 315, `Reviewed appearance union must contain 315 identities, received ${appearances.size}.`);
  assert(references.size === 305, `Reviewed site candidate union must contain 305 identities, received ${references.size}.`);
  assert(stableStringify(sourceCounts) === stableStringify(EXPECTED_SOURCE_COUNTS), 'Reviewed source counts drifted.');

  const catalog = {
    version: REVIEWED_PROMOTION_VERSION,
    references: [...references.values()],
    appearances: [...appearances.values()],
    aggregators: [...aggregators.values()].sort((a, b) => a.id.localeCompare(b.id)),
    expected: {
      candidateSites: 305,
      appearances: 315,
      sourceCounts: EXPECTED_SOURCE_COUNTS,
    },
  };
  return { ...catalog, catalogSha256: sha256(stableStringify(catalog)) };
}

export async function loadReviewedPromotion(worktreeRoot) {
  const artifacts = {};
  const parsed = {};
  for (const artifact of REVIEWED_ARTIFACTS) {
    const absolutePath = path.resolve(worktreeRoot, artifact.relativePath);
    const contents = await readFile(absolutePath);
    const actualSha256 = sha256(contents);
    assert(actualSha256 === artifact.sha256, `${artifact.key} hash mismatch: expected ${artifact.sha256}, received ${actualSha256}.`);
    let value;
    try {
      value = JSON.parse(contents.toString('utf8'));
    } catch (error) {
      throw new Error(`${artifact.key} is not valid JSON: ${error.message}`);
    }
    artifacts[artifact.key] = {
      relativePath: artifact.relativePath,
      sha256: actualSha256,
    };
    parsed[artifact.key] = value;
  }

  const catalog = buildReviewedPromotionCatalog({
    proofSeed: parsed.proofSeed,
    incrementSeed: parsed.incrementSeed,
    landbookPilotSeed: parsed.landbookPilotSeed,
    landbookPagesSeed: parsed.landbookPagesSeed,
  });
  return { artifacts, catalog };
}

function normalizeSiteSnapshot(site) {
  return {
    id: site.id,
    canonicalUrl: site.canonicalUrl,
    host: site.host,
    title: site.title,
    description: site.description || '',
    thumbnailUrl: site.thumbnailUrl || null,
    categories: site.categories || [],
    tags: site.tags || [],
    editorialConsensus: Number(site.editorialConsensus),
    curationWeight: String(site.curationWeight),
    curationRank: site.curationRank == null ? null : Number(site.curationRank),
    featured: Boolean(site.featured),
    isPrivate: Boolean(site.isPrivate),
    privacyReason: site.privacyReason || null,
    templatePlatform: site.templatePlatform || null,
    publishedAt: site.publishedAt || null,
    generatedAt: site.generatedAt || null,
    availabilityStatus: site.availabilityStatus,
    lifecycleState: site.lifecycleState,
    analysisStatus: site.analysisStatus,
  };
}

function normalizeAggregatorSnapshot(aggregator) {
  return {
    id: aggregator.id,
    name: aggregator.name,
    homepageUrl: aggregator.homepageUrl || null,
    overallRating: Number(aggregator.overallRating),
    editorialQuality: aggregator.editorialQuality == null ? null : Number(aggregator.editorialQuality),
    motionDensity: aggregator.motionDensity == null ? null : Number(aggregator.motionDensity),
    metadataQuality: aggregator.metadataQuality == null ? null : Number(aggregator.metadataQuality),
    noiseControl: aggregator.noiseControl == null ? null : Number(aggregator.noiseControl),
    status: aggregator.status,
  };
}

export function normalizePromotionSnapshot(snapshot) {
  assert(snapshot?.version === REVIEWED_PROMOTION_VERSION, `Promotion snapshot version must be ${REVIEWED_PROMOTION_VERSION}.`);
  assert(Array.isArray(snapshot.sites), 'Promotion snapshot sites are required.');
  assert(Array.isArray(snapshot.appearances), 'Promotion snapshot appearances are required.');
  assert(Array.isArray(snapshot.aggregators), 'Promotion snapshot aggregators are required.');
  assert(snapshot.counts && Number.isInteger(Number(snapshot.counts.sites)), 'Promotion snapshot counts are required.');
  assert(Number(snapshot.counts.sites) === snapshot.sites.length, 'Promotion snapshot site count does not match its site rows.');
  return {
    version: REVIEWED_PROMOTION_VERSION,
    target: snapshot.target || 'snapshot',
    capturedAt: snapshot.capturedAt || null,
    counts: {
      sites: Number(snapshot.counts.sites),
      appearances: Number(snapshot.counts.appearances),
      aggregators: Number(snapshot.counts.aggregators),
      maxRank: Number(snapshot.counts.maxRank || 0),
    },
    sites: snapshot.sites.map(normalizeSiteSnapshot).sort((a, b) => a.id.localeCompare(b.id)),
    appearances: snapshot.appearances.map(normalizeAppearance).sort((a, b) => appearanceKey(a).localeCompare(appearanceKey(b))),
    aggregators: snapshot.aggregators.map(normalizeAggregatorSnapshot).sort((a, b) => a.id.localeCompare(b.id)),
    protected: (snapshot.protected || []).map((row) => ({
      table: row.table,
      rows: Number(row.rows),
      checksum: row.checksum,
    })).sort((a, b) => a.table.localeCompare(b.table)),
  };
}

function newSiteForPlan(site, curationRank) {
  return { ...site, curationRank };
}

function newAggregatorForPlan(aggregator) {
  return {
    ...aggregator,
    overallRating: 3,
    editorialQuality: null,
    motionDensity: null,
    metadataQuality: null,
    noiseControl: null,
    status: 'active',
  };
}

export function buildPromotionPlan(catalog, rawSnapshot) {
  assert(catalog?.version === REVIEWED_PROMOTION_VERSION, 'Reviewed promotion catalog version is invalid.');
  const snapshot = normalizePromotionSnapshot(rawSnapshot);
  const sitesById = new Map();
  const sitesByUrl = new Map();
  for (const site of snapshot.sites) {
    assert(!sitesById.has(site.id), `Target snapshot has duplicate site id ${site.id}.`);
    assert(!sitesByUrl.has(site.canonicalUrl), `Target snapshot has duplicate canonical URL ${site.canonicalUrl}.`);
    sitesById.set(site.id, site);
    sitesByUrl.set(site.canonicalUrl, site);
  }

  const existingSites = [];
  const insertSites = [];
  for (const site of catalog.references) {
    const byId = sitesById.get(site.id);
    const byUrl = sitesByUrl.get(site.canonicalUrl);
    if (byId) {
      assert(byId.canonicalUrl === site.canonicalUrl, `Target site ${site.id} has canonical URL ${byId.canonicalUrl}, expected ${site.canonicalUrl}.`);
      existingSites.push(byId);
      continue;
    }
    assert(!byUrl, `Canonical URL ${site.canonicalUrl} already belongs to target id ${byUrl?.id}.`);
    insertSites.push(newSiteForPlan(site, snapshot.counts.maxRank + insertSites.length + 1));
  }

  const targetAppearances = new Map(snapshot.appearances.map((appearance) => [appearanceKey(appearance), appearance]));
  const insertAppearances = [];
  const updateAppearances = [];
  const noopAppearances = [];
  const restoreAppearances = [];
  for (const appearance of catalog.appearances) {
    const current = targetAppearances.get(appearanceKey(appearance));
    if (!current) insertAppearances.push(appearance);
    else if (appearanceContentEqual(current, appearance)) noopAppearances.push(appearance);
    else {
      updateAppearances.push(appearance);
      restoreAppearances.push(current);
    }
  }

  const targetAggregators = new Map(snapshot.aggregators.map((aggregator) => [aggregator.id, aggregator]));
  const insertAggregators = [];
  const noopAggregators = [];
  for (const aggregator of catalog.aggregators) {
    const current = targetAggregators.get(aggregator.id);
    if (current) noopAggregators.push(current);
    else insertAggregators.push(newAggregatorForPlan(aggregator));
  }

  const summary = {
    targetBefore: snapshot.counts,
    sites: {
      candidates: catalog.references.length,
      insert: insertSites.length,
      preserve: existingSites.length,
    },
    appearances: {
      reviewed: catalog.appearances.length,
      insert: insertAppearances.length,
      update: updateAppearances.length,
      noop: noopAppearances.length,
    },
    aggregators: {
      reviewed: catalog.aggregators.length,
      insert: insertAggregators.length,
      preserve: noopAggregators.length,
    },
    targetAfter: {
      sites: snapshot.counts.sites + insertSites.length,
      appearances: snapshot.counts.appearances + insertAppearances.length,
      aggregators: snapshot.counts.aggregators + insertAggregators.length,
      maxRank: snapshot.counts.maxRank + insertSites.length,
    },
  };
  const plan = {
    version: REVIEWED_PROMOTION_VERSION,
    catalogSha256: catalog.catalogSha256,
    snapshot,
    operations: {
      insertSites,
      preserveSites: existingSites,
      insertAppearances,
      updateAppearances,
      noopAppearances,
      insertAggregators,
      preserveAggregators: noopAggregators,
    },
    rollback: {
      order: [
        'deleteInsertedAppearances',
        'restoreUpdatedAppearances',
        'deleteInsertedSites',
        'deleteInsertedAggregators',
      ],
      deleteInsertedAppearances: insertAppearances.map((appearance) => ({
        referenceSiteId: appearance.referenceSiteId,
        sourceId: appearance.sourceId,
        sourceRecordId: appearance.sourceRecordId,
      })),
      restoreUpdatedAppearances: restoreAppearances,
      deleteInsertedSites: insertSites.map((site) => site.id),
      deleteInsertedAggregators: insertAggregators.map((aggregator) => aggregator.id),
    },
    summary,
  };
  const fingerprintablePlan = {
    ...plan,
    snapshot: { ...plan.snapshot, capturedAt: null },
  };
  return { ...plan, planSha256: sha256(stableStringify(fingerprintablePlan)) };
}

export const promotionAppearanceKey = appearanceKey;
export const normalizePromotionAppearance = normalizeAppearance;
export const normalizePromotionSite = normalizeSiteSnapshot;
export const normalizePromotionAggregator = normalizeAggregatorSnapshot;
