import { neon } from '@neondatabase/serverless';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildPromotionPlan,
  loadReviewedPromotion,
  sha256,
  stableStringify,
} from '../../lib/reference-bank-promotion.js';
import {
  applyPromotionPlan,
  fetchPromotionTargetSnapshot,
} from './promotion-db.mjs';
import { loadIsolatedDatabaseConfig } from './isolated-env.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const worktreeRoot = path.resolve(scriptDir, '../../../..');
const baselineSeedPath = path.join(worktreeRoot, 'packages/web-shell/lib/reference-bank.seed.json');
const EXPECTED_BASELINE_SHA256 = 'e496fcdf309e341aaea097e1df32c9857a7d344b04ed05be264212eb8d389d3c';
const schema = `reference_delta_proof_${Date.now()}_${process.pid}`;

function qualified(table) {
  return `"${schema}"."${table}"`;
}

function chunk(records, size = 100) {
  const chunks = [];
  for (let offset = 0; offset < records.length; offset += size) chunks.push(records.slice(offset, offset + size));
  return chunks;
}

function baselineRows(seed) {
  const sites = seed.references.map((reference, index) => ({
    id: reference.id,
    canonical_url: reference.url,
    host: reference.host,
    title: reference.title,
    description: reference.description || '',
    thumbnail_url: reference.thumbnailUrl || null,
    categories: reference.categories || [],
    tags: reference.tags || [],
    editorial_consensus: Number(reference.editorialConsensus || 1),
    curation_weight: String(reference.curationWeight || 1),
    curation_rank: index + 1,
    featured: Boolean(reference.featured),
    published_at: reference.publishedAt || null,
    generated_at: reference.generatedAt || seed.generatedAt || null,
    analysis_status: reference.analysisStatus || 'listed',
  }));
  const appearanceMap = new Map();
  const aggregatorMap = new Map();
  const homepages = {
    codrops: 'https://tympanus.net/codrops/webzibition/',
    pafolios: 'https://pafolios.com/',
    siteinspire: 'https://www.siteinspire.com/',
  };
  for (const reference of seed.references) {
    for (const source of reference.sources || []) {
      const appearance = {
        reference_site_id: reference.id,
        source_id: source.id,
        source_name: source.name,
        source_record_id: String(source.recordId || source.detailUrl || reference.url),
        listing_url: source.listingUrl,
        detail_url: source.detailUrl || null,
        thumbnail_url: source.thumbnailUrl || null,
        source_taxonomy: source.taxonomy || {},
      };
      const key = [appearance.reference_site_id, appearance.source_id, appearance.source_record_id].join('\u0000');
      appearanceMap.set(key, appearance);
      aggregatorMap.set(source.id, {
        id: source.id,
        name: source.name,
        homepage_url: homepages[source.id] || null,
      });
    }
  }
  return {
    sites,
    appearances: [...appearanceMap.values()],
    aggregators: [...aggregatorMap.values()],
  };
}

async function createFixture(sql) {
  await sql(`CREATE SCHEMA "${schema}"`);
  await sql.transaction((tx) => [
    tx(`
      CREATE TABLE ${qualified('reference_sites')} (
        id TEXT PRIMARY KEY,
        canonical_url TEXT UNIQUE NOT NULL,
        host TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        thumbnail_url TEXT,
        categories TEXT[] NOT NULL DEFAULT '{}',
        tags TEXT[] NOT NULL DEFAULT '{}',
        editorial_consensus SMALLINT NOT NULL DEFAULT 1 CHECK (editorial_consensus > 0),
        curation_weight NUMERIC(7,3) NOT NULL DEFAULT 1,
        curation_rank INTEGER CHECK (curation_rank IS NULL OR curation_rank > 0),
        featured BOOLEAN NOT NULL DEFAULT FALSE,
        published_at TEXT,
        generated_at TIMESTAMPTZ,
        availability_status VARCHAR(16) NOT NULL DEFAULT 'unknown',
        lifecycle_state VARCHAR(16) NOT NULL DEFAULT 'listed',
        analysis_status VARCHAR(20) NOT NULL DEFAULT 'listed',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `),
    tx(`
      CREATE TABLE ${qualified('reference_aggregators')} (
        id VARCHAR(32) PRIMARY KEY,
        name TEXT NOT NULL,
        homepage_url TEXT,
        overall_rating SMALLINT NOT NULL DEFAULT 3 CHECK (overall_rating BETWEEN 1 AND 5),
        editorial_quality SMALLINT CHECK (editorial_quality BETWEEN 1 AND 5),
        motion_density SMALLINT CHECK (motion_density BETWEEN 1 AND 5),
        metadata_quality SMALLINT CHECK (metadata_quality BETWEEN 1 AND 5),
        noise_control SMALLINT CHECK (noise_control BETWEEN 1 AND 5),
        status VARCHAR(16) NOT NULL DEFAULT 'active',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `),
    tx(`
      CREATE TABLE ${qualified('reference_appearances')} (
        id BIGSERIAL PRIMARY KEY,
        reference_site_id TEXT NOT NULL REFERENCES ${qualified('reference_sites')}(id) ON DELETE CASCADE,
        source_id VARCHAR(32) NOT NULL,
        source_name TEXT NOT NULL,
        source_record_id TEXT NOT NULL,
        listing_url TEXT NOT NULL,
        detail_url TEXT,
        thumbnail_url TEXT,
        source_taxonomy JSONB NOT NULL DEFAULT '{}'::jsonb,
        first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(reference_site_id, source_id, source_record_id)
      )
    `),
  ]);
}

async function seedFixture(sql, rows) {
  const queries = [];
  queries.push(sql(`
    INSERT INTO ${qualified('reference_aggregators')} (id, name, homepage_url)
    SELECT item.id, item.name, item.homepage_url
    FROM jsonb_to_recordset($1::jsonb) AS item(id VARCHAR, name TEXT, homepage_url TEXT)
  `, [JSON.stringify(rows.aggregators)]));
  for (const records of chunk(rows.sites)) {
    queries.push(sql(`
      INSERT INTO ${qualified('reference_sites')} (
        id, canonical_url, host, title, description, thumbnail_url, categories, tags,
        editorial_consensus, curation_weight, curation_rank, featured, published_at,
        generated_at, analysis_status
      )
      SELECT
        item.id, item.canonical_url, item.host, item.title, item.description,
        item.thumbnail_url, item.categories, item.tags, item.editorial_consensus,
        item.curation_weight, item.curation_rank, item.featured, item.published_at,
        item.generated_at, item.analysis_status
      FROM jsonb_to_recordset($1::jsonb) AS item(
        id TEXT, canonical_url TEXT, host TEXT, title TEXT, description TEXT,
        thumbnail_url TEXT, categories TEXT[], tags TEXT[], editorial_consensus SMALLINT,
        curation_weight NUMERIC, curation_rank INTEGER, featured BOOLEAN,
        published_at TEXT, generated_at TIMESTAMPTZ, analysis_status VARCHAR
      )
    `, [JSON.stringify(records)]));
  }
  for (const records of chunk(rows.appearances)) {
    queries.push(sql(`
      INSERT INTO ${qualified('reference_appearances')} (
        reference_site_id, source_id, source_name, source_record_id,
        listing_url, detail_url, thumbnail_url, source_taxonomy
      )
      SELECT
        item.reference_site_id, item.source_id, item.source_name, item.source_record_id,
        item.listing_url, item.detail_url, item.thumbnail_url, item.source_taxonomy
      FROM jsonb_to_recordset($1::jsonb) AS item(
        reference_site_id TEXT, source_id VARCHAR, source_name TEXT,
        source_record_id TEXT, listing_url TEXT, detail_url TEXT,
        thumbnail_url TEXT, source_taxonomy JSONB
      )
    `, [JSON.stringify(records)]));
  }
  await sql.transaction(queries, { isolationLevel: 'Serializable' });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const { databaseUrl } = loadIsolatedDatabaseConfig();
const sql = neon(databaseUrl);
const baselineContents = await readFile(baselineSeedPath);
const baselineSha256 = sha256(baselineContents);
assert(baselineSha256 === EXPECTED_BASELINE_SHA256, 'Committed shared baseline seed hash drifted.');
const baselineSeed = JSON.parse(baselineContents.toString('utf8'));
const rows = baselineRows(baselineSeed);
assert(rows.sites.length === 1636, `Baseline fixture requires 1,636 sites, received ${rows.sites.length}.`);
assert(rows.appearances.length === 1704, `Baseline fixture requires 1,704 unique appearances, received ${rows.appearances.length}.`);

const reviewed = await loadReviewedPromotion(worktreeRoot);
let proof;
try {
  await createFixture(sql);
  await seedFixture(sql, rows);
  const before = await fetchPromotionTargetSnapshot(sql, reviewed.catalog, {
    catalogSchema: schema,
    protectedSchema: 'public',
    target: 'isolated-proof',
  });
  const firstPlan = buildPromotionPlan(reviewed.catalog, before);
  assert(firstPlan.summary.sites.insert === 283, 'First proof plan must insert 283 canonical sites.');
  assert(firstPlan.summary.sites.preserve === 22, 'First proof plan must preserve 22 existing canonical sites.');
  assert(firstPlan.summary.appearances.insert === 315, 'First proof plan must insert 315 appearances.');
  const firstRun = await applyPromotionPlan(sql, reviewed.catalog, firstPlan, {
    catalogSchema: schema,
    protectedSchema: 'public',
  });

  await sql(`
    UPDATE ${qualified('reference_aggregators')}
    SET overall_rating = 5, editorial_quality = 4, updated_at = NOW()
    WHERE id = 'landbook'
  `);
  const afterFirst = await fetchPromotionTargetSnapshot(sql, reviewed.catalog, {
    catalogSchema: schema,
    protectedSchema: 'public',
    target: 'isolated-proof',
  });
  const secondPlan = buildPromotionPlan(reviewed.catalog, afterFirst);
  assert(secondPlan.summary.sites.insert === 0, 'Second proof plan must insert zero sites.');
  assert(secondPlan.summary.appearances.insert === 0, 'Second proof plan must insert zero appearances.');
  assert(secondPlan.summary.appearances.update === 0, 'Second proof plan must update zero appearances.');
  const secondRun = await applyPromotionPlan(sql, reviewed.catalog, secondPlan, {
    catalogSchema: schema,
    protectedSchema: 'public',
  });

  const finalSnapshot = await fetchPromotionTargetSnapshot(sql, reviewed.catalog, {
    catalogSchema: schema,
    protectedSchema: 'public',
    target: 'isolated-proof',
  });
  const finalPlan = buildPromotionPlan(reviewed.catalog, finalSnapshot);
  const [reconciliation] = await sql(`
    SELECT
      (SELECT COUNT(*)::int FROM ${qualified('reference_sites')}) AS sites,
      (SELECT COUNT(*)::int FROM ${qualified('reference_appearances')}) AS appearances,
      (SELECT COUNT(DISTINCT curation_rank)::int FROM ${qualified('reference_sites')}) AS "distinctRanks",
      (SELECT COUNT(*)::int FROM ${qualified('reference_sites')} WHERE curation_rank BETWEEN 1637 AND 1919) AS "appendedRanks",
      (SELECT overall_rating::int FROM ${qualified('reference_aggregators')} WHERE id = 'landbook') AS "landbookRating",
      (SELECT editorial_quality::int FROM ${qualified('reference_aggregators')} WHERE id = 'landbook') AS "landbookEditorialQuality"
  `);
  const sourceCounts = await sql(`
    SELECT source_id AS source, COUNT(*)::int AS appearances,
      COUNT(DISTINCT reference_site_id)::int AS sites
    FROM ${qualified('reference_appearances')}
    GROUP BY source_id
    ORDER BY source_id
  `);
  const [baselineRankCheck] = await sql(`
    WITH expected AS (
      SELECT * FROM jsonb_to_recordset($1::jsonb) AS item(id TEXT, curation_rank INTEGER)
    )
    SELECT COUNT(*)::int AS mismatches
    FROM expected
    JOIN ${qualified('reference_sites')} site ON site.id = expected.id
    WHERE site.curation_rank IS DISTINCT FROM expected.curation_rank
  `, [JSON.stringify(rows.sites.map((site) => ({ id: site.id, curation_rank: site.curation_rank })))]);

  assert(reconciliation.sites === 1919, 'Final isolated proof must contain 1,919 sites.');
  assert(reconciliation.appearances === 2019, 'Final isolated proof must contain 2,019 appearances.');
  assert(reconciliation.distinctRanks === 1919, 'Final isolated proof ranks must be globally unique.');
  assert(reconciliation.appendedRanks === 283, 'Final isolated proof must have 283 append-only ranks.');
  assert(reconciliation.landbookRating === 5 && reconciliation.landbookEditorialQuality === 4, 'Second run changed aggregator ratings.');
  assert(baselineRankCheck.mismatches === 0, 'Promotion changed a baseline rank.');
  assert(stableStringify(before.protected) === stableStringify(finalSnapshot.protected), 'Promotion changed protected public rows.');
  assert(finalPlan.summary.sites.insert === 0, 'Final reconciliation still plans site inserts.');
  assert(finalPlan.summary.appearances.noop === 315, 'Final reconciliation does not see 315 appearance no-ops.');

  proof = {
    target: 'isolated-ephemeral-schema',
    baselineSha256,
    reviewedArtifactHashes: Object.fromEntries(
      Object.entries(reviewed.artifacts).map(([key, artifact]) => [key, artifact.sha256]),
    ),
    catalogSha256: reviewed.catalog.catalogSha256,
    firstRun: {
      planSha256: firstPlan.planSha256,
      summary: firstPlan.summary,
      counts: firstRun.counts,
    },
    secondRun: {
      planSha256: secondPlan.planSha256,
      summary: secondPlan.summary,
      counts: secondRun.counts,
    },
    reconciliation: {
      ...reconciliation,
      baselineRankMismatches: baselineRankCheck.mismatches,
      protectedFingerprintsUnchanged: true,
      sourceCounts,
    },
  };
} finally {
  await sql(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
}

process.stdout.write(`${JSON.stringify(proof, null, 2)}\n`);
