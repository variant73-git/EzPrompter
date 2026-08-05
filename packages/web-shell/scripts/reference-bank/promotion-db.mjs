import {
  normalizePromotionAggregator,
  normalizePromotionAppearance,
  normalizePromotionSite,
  promotionAppearanceKey,
} from '../../lib/reference-bank-promotion.js';

export const PROMOTION_WRITE_TABLES = Object.freeze([
  'reference_aggregators',
  'reference_sites',
  'reference_appearances',
]);

export const PROMOTION_PROTECTED_TABLES = Object.freeze([
  'boards',
  'nodes',
  'credit_ledger',
  'generation_reference_uses',
  'reference_preferences',
  'reference_review_cohorts',
  'reference_review_cohort_members',
]);

function assertSchemaName(schema) {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) {
    throw new Error(`Unsafe PostgreSQL schema name: ${schema}`);
  }
  return schema;
}

function qualified(schema, table) {
  return `"${assertSchemaName(schema)}"."${table}"`;
}

function siteJsonRows(sites) {
  return sites.map((site) => ({
    id: site.id,
    canonical_url: site.canonicalUrl,
    host: site.host,
    title: site.title,
    description: site.description || '',
    thumbnail_url: site.thumbnailUrl || null,
    categories: site.categories || [],
    tags: site.tags || [],
    editorial_consensus: Number(site.editorialConsensus),
    curation_weight: String(site.curationWeight),
    curation_rank: site.curationRank == null ? null : Number(site.curationRank),
    featured: Boolean(site.featured),
    is_private: Boolean(site.isPrivate),
    privacy_reason: site.privacyReason || null,
    template_platform: site.templatePlatform || null,
    published_at: site.publishedAt || null,
    generated_at: site.generatedAt || null,
    availability_status: site.availabilityStatus,
    lifecycle_state: site.lifecycleState,
    analysis_status: site.analysisStatus,
  }));
}

function appearanceJsonRows(appearances) {
  return appearances.map((appearance) => ({
    reference_site_id: appearance.referenceSiteId,
    source_id: appearance.sourceId,
    source_name: appearance.sourceName,
    source_record_id: String(appearance.sourceRecordId),
    listing_url: appearance.listingUrl,
    detail_url: appearance.detailUrl || null,
    thumbnail_url: appearance.thumbnailUrl || null,
    source_taxonomy: appearance.sourceTaxonomy || {},
  }));
}

function appearanceIdentityRows(appearances) {
  return appearances.map((appearance) => ({
    reference_site_id: appearance.referenceSiteId,
    source_id: appearance.sourceId,
    source_record_id: String(appearance.sourceRecordId),
  }));
}

function aggregatorJsonRows(aggregators) {
  return aggregators.map((aggregator) => ({
    id: aggregator.id,
    name: aggregator.name,
    homepage_url: aggregator.homepageUrl || null,
    overall_rating: Number(aggregator.overallRating),
    editorial_quality: aggregator.editorialQuality == null ? null : Number(aggregator.editorialQuality),
    motion_density: aggregator.motionDensity == null ? null : Number(aggregator.motionDensity),
    metadata_quality: aggregator.metadataQuality == null ? null : Number(aggregator.metadataQuality),
    noise_control: aggregator.noiseControl == null ? null : Number(aggregator.noiseControl),
    status: aggregator.status,
  }));
}

const SITE_RECORDSET = `
  id TEXT, canonical_url TEXT, host TEXT, title TEXT, description TEXT,
  thumbnail_url TEXT, categories TEXT[], tags TEXT[], editorial_consensus SMALLINT,
  curation_weight NUMERIC, curation_rank INTEGER, featured BOOLEAN,
  is_private BOOLEAN, privacy_reason VARCHAR, template_platform VARCHAR,
  published_at TEXT, generated_at TIMESTAMPTZ, availability_status VARCHAR,
  lifecycle_state VARCHAR, analysis_status VARCHAR
`;

const APPEARANCE_RECORDSET = `
  reference_site_id TEXT, source_id VARCHAR, source_name TEXT,
  source_record_id TEXT, listing_url TEXT, detail_url TEXT,
  thumbnail_url TEXT, source_taxonomy JSONB
`;

const AGGREGATOR_RECORDSET = `
  id VARCHAR, name TEXT, homepage_url TEXT, overall_rating SMALLINT,
  editorial_quality SMALLINT, motion_density SMALLINT, metadata_quality SMALLINT,
  noise_control SMALLINT, status VARCHAR
`;

function siteProjection(alias = 'site') {
  return `
    ${alias}.id,
    ${alias}.canonical_url AS "canonicalUrl",
    ${alias}.host,
    ${alias}.title,
    ${alias}.description,
    ${alias}.thumbnail_url AS "thumbnailUrl",
    ${alias}.categories,
    ${alias}.tags,
    ${alias}.editorial_consensus::int AS "editorialConsensus",
    ${alias}.curation_weight::text AS "curationWeight",
    ${alias}.curation_rank AS "curationRank",
    ${alias}.featured,
    ${alias}.is_private AS "isPrivate",
    ${alias}.privacy_reason AS "privacyReason",
    ${alias}.template_platform AS "templatePlatform",
    ${alias}.published_at AS "publishedAt",
    CASE WHEN ${alias}.generated_at IS NULL THEN NULL
      ELSE to_char(${alias}.generated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    END AS "generatedAt",
    ${alias}.availability_status AS "availabilityStatus",
    ${alias}.lifecycle_state AS "lifecycleState",
    ${alias}.analysis_status AS "analysisStatus"
  `;
}

function appearanceProjection(alias = 'appearance') {
  return `
    ${alias}.reference_site_id AS "referenceSiteId",
    ${alias}.source_id AS "sourceId",
    ${alias}.source_name AS "sourceName",
    ${alias}.source_record_id AS "sourceRecordId",
    ${alias}.listing_url AS "listingUrl",
    ${alias}.detail_url AS "detailUrl",
    ${alias}.thumbnail_url AS "thumbnailUrl",
    ${alias}.source_taxonomy AS "sourceTaxonomy"
  `;
}

function aggregatorProjection(alias = 'aggregator') {
  return `
    ${alias}.id,
    ${alias}.name,
    ${alias}.homepage_url AS "homepageUrl",
    ${alias}.overall_rating::int AS "overallRating",
    ${alias}.editorial_quality::int AS "editorialQuality",
    ${alias}.motion_density::int AS "motionDensity",
    ${alias}.metadata_quality::int AS "metadataQuality",
    ${alias}.noise_control::int AS "noiseControl",
    ${alias}.status
  `;
}

export async function fetchProtectedFingerprints(sql, schema = 'public') {
  assertSchemaName(schema);
  const rows = [];
  for (const table of PROMOTION_PROTECTED_TABLES) {
    const relation = `${schema}.${table}`;
    const [exists] = await sql('SELECT to_regclass($1) IS NOT NULL AS present', [relation]);
    if (!exists?.present) continue;
    const [fingerprint] = await sql(`
      SELECT
        COUNT(*)::int AS rows,
        md5(COALESCE(
          string_agg(md5(to_jsonb(item)::text), ',' ORDER BY md5(to_jsonb(item)::text)),
          ''
        )) AS checksum
      FROM ${qualified(schema, table)} item
    `);
    rows.push({ table, rows: Number(fingerprint.rows), checksum: fingerprint.checksum });
  }
  return rows.sort((a, b) => a.table.localeCompare(b.table));
}

export async function fetchPromotionTargetSnapshot(sql, catalog, {
  catalogSchema = 'public',
  protectedSchema = 'public',
  target = 'isolated',
} = {}) {
  assertSchemaName(catalogSchema);
  const sitesTable = qualified(catalogSchema, 'reference_sites');
  const appearancesTable = qualified(catalogSchema, 'reference_appearances');
  const aggregatorsTable = qualified(catalogSchema, 'reference_aggregators');
  const desiredIdentities = appearanceIdentityRows(catalog.appearances);
  const desiredAggregatorIds = catalog.aggregators.map((aggregator) => aggregator.id);

  const [sites, appearances, aggregators, counts, protectedRows] = await Promise.all([
    sql(`SELECT ${siteProjection()} FROM ${sitesTable} site ORDER BY site.id`),
    sql(`
      WITH desired AS (
        SELECT *
        FROM jsonb_to_recordset($1::jsonb) AS item(
          reference_site_id TEXT, source_id VARCHAR, source_record_id TEXT
        )
      )
      SELECT ${appearanceProjection()}
      FROM ${appearancesTable} appearance
      JOIN desired ON
        desired.reference_site_id = appearance.reference_site_id
        AND desired.source_id = appearance.source_id
        AND desired.source_record_id = appearance.source_record_id
      ORDER BY appearance.reference_site_id, appearance.source_id, appearance.source_record_id
    `, [JSON.stringify(desiredIdentities)]),
    sql(`
      SELECT ${aggregatorProjection()}
      FROM ${aggregatorsTable} aggregator
      WHERE aggregator.id = ANY($1::text[])
      ORDER BY aggregator.id
    `, [desiredAggregatorIds]),
    sql(`
      SELECT
        (SELECT COUNT(*)::int FROM ${sitesTable}) AS sites,
        (SELECT COUNT(*)::int FROM ${appearancesTable}) AS appearances,
        (SELECT COUNT(*)::int FROM ${aggregatorsTable}) AS aggregators,
        (SELECT COALESCE(MAX(curation_rank), 0)::int FROM ${sitesTable}) AS "maxRank"
    `),
    fetchProtectedFingerprints(sql, protectedSchema),
  ]);

  return {
    version: 1,
    target,
    capturedAt: new Date().toISOString(),
    counts: counts[0],
    sites: sites.map(normalizePromotionSite),
    appearances: appearances.map(normalizePromotionAppearance),
    aggregators: aggregators.map(normalizePromotionAggregator),
    protected: protectedRows,
  };
}

function siteMatchPredicate(siteAlias, expectedAlias) {
  return `ROW(
    ${siteAlias}.canonical_url, ${siteAlias}.host, ${siteAlias}.title, ${siteAlias}.description,
    ${siteAlias}.thumbnail_url, ${siteAlias}.categories, ${siteAlias}.tags,
    ${siteAlias}.editorial_consensus, ${siteAlias}.curation_weight, ${siteAlias}.curation_rank,
    ${siteAlias}.featured, ${siteAlias}.is_private, ${siteAlias}.privacy_reason,
    ${siteAlias}.template_platform, ${siteAlias}.published_at, ${siteAlias}.generated_at,
    ${siteAlias}.availability_status, ${siteAlias}.lifecycle_state, ${siteAlias}.analysis_status
  ) IS NOT DISTINCT FROM ROW(
    ${expectedAlias}.canonical_url, ${expectedAlias}.host, ${expectedAlias}.title, ${expectedAlias}.description,
    ${expectedAlias}.thumbnail_url, ${expectedAlias}.categories, ${expectedAlias}.tags,
    ${expectedAlias}.editorial_consensus, ${expectedAlias}.curation_weight, ${expectedAlias}.curation_rank,
    ${expectedAlias}.featured, ${expectedAlias}.is_private, ${expectedAlias}.privacy_reason,
    ${expectedAlias}.template_platform, ${expectedAlias}.published_at, ${expectedAlias}.generated_at,
    ${expectedAlias}.availability_status, ${expectedAlias}.lifecycle_state, ${expectedAlias}.analysis_status
  )`;
}

function appearanceMatchPredicate(appearanceAlias, expectedAlias) {
  return `ROW(
    ${appearanceAlias}.source_name, ${appearanceAlias}.listing_url, ${appearanceAlias}.detail_url,
    ${appearanceAlias}.thumbnail_url, ${appearanceAlias}.source_taxonomy
  ) IS NOT DISTINCT FROM ROW(
    ${expectedAlias}.source_name, ${expectedAlias}.listing_url, ${expectedAlias}.detail_url,
    ${expectedAlias}.thumbnail_url, ${expectedAlias}.source_taxonomy
  )`;
}

function aggregatorMatchPredicate(aggregatorAlias, expectedAlias) {
  return `ROW(
    ${aggregatorAlias}.name, ${aggregatorAlias}.homepage_url, ${aggregatorAlias}.overall_rating,
    ${aggregatorAlias}.editorial_quality, ${aggregatorAlias}.motion_density,
    ${aggregatorAlias}.metadata_quality, ${aggregatorAlias}.noise_control, ${aggregatorAlias}.status
  ) IS NOT DISTINCT FROM ROW(
    ${expectedAlias}.name, ${expectedAlias}.homepage_url, ${expectedAlias}.overall_rating,
    ${expectedAlias}.editorial_quality, ${expectedAlias}.motion_density,
    ${expectedAlias}.metadata_quality, ${expectedAlias}.noise_control, ${expectedAlias}.status
  )`;
}

function catalogGuardQuery(schema, phase) {
  const sitesTable = qualified(schema, 'reference_sites');
  const appearancesTable = qualified(schema, 'reference_appearances');
  const aggregatorsTable = qualified(schema, 'reference_aggregators');
  return `
    WITH
      expected_sites AS (
        SELECT * FROM jsonb_to_recordset($5::jsonb) AS item(${SITE_RECORDSET})
      ),
      desired_appearance_ids AS (
        SELECT * FROM jsonb_to_recordset($6::jsonb) AS item(
          reference_site_id TEXT, source_id VARCHAR, source_record_id TEXT
        )
      ),
      expected_appearances AS (
        SELECT * FROM jsonb_to_recordset($7::jsonb) AS item(${APPEARANCE_RECORDSET})
      ),
      expected_aggregators AS (
        SELECT * FROM jsonb_to_recordset($8::jsonb) AS item(${AGGREGATOR_RECORDSET})
      )
    SELECT
      CASE WHEN (SELECT COUNT(*)::int FROM ${sitesTable}) = $1::int
      THEN 1 ELSE CAST('promotion_${phase}_site_count_guard_failed_' || current_setting('server_version_num') AS INTEGER) END AS site_count_guard,
      CASE WHEN (SELECT COUNT(*)::int FROM ${appearancesTable}) = $2::int
      THEN 1 ELSE CAST('promotion_${phase}_appearance_total_guard_failed_' || current_setting('server_version_num') AS INTEGER) END AS appearance_total_guard,
      CASE WHEN (SELECT COUNT(*)::int FROM ${aggregatorsTable}) = $3::int
      THEN 1 ELSE CAST('promotion_${phase}_aggregator_total_guard_failed_' || current_setting('server_version_num') AS INTEGER) END AS aggregator_total_guard,
      CASE WHEN (SELECT COALESCE(MAX(curation_rank), 0)::int FROM ${sitesTable}) = $4::int
      THEN 1 ELSE CAST('promotion_${phase}_max_rank_guard_failed_' || current_setting('server_version_num') AS INTEGER) END AS max_rank_guard,
      CASE WHEN
        (SELECT COUNT(*)::int FROM expected_sites) = (
        SELECT COUNT(*)::int FROM ${sitesTable} site JOIN expected_sites expected ON expected.id = site.id
      )
        AND NOT EXISTS (
        SELECT 1 FROM expected_sites expected
        JOIN ${sitesTable} site ON site.id = expected.id
        WHERE NOT (${siteMatchPredicate('site', 'expected')})
      )
      THEN 1 ELSE CAST('promotion_${phase}_site_guard_failed_' || current_setting('server_version_num') AS INTEGER) END AS site_guard,
      CASE WHEN
        (SELECT COUNT(*)::int FROM expected_appearances) = (
        SELECT COUNT(*)::int FROM ${appearancesTable} appearance
        JOIN desired_appearance_ids desired ON
          desired.reference_site_id = appearance.reference_site_id
          AND desired.source_id = appearance.source_id
          AND desired.source_record_id = appearance.source_record_id
      )
      THEN 1 ELSE CAST('promotion_${phase}_appearance_count_guard_failed_' || current_setting('server_version_num') AS INTEGER) END AS appearance_count_guard,
      CASE WHEN NOT EXISTS (
        SELECT 1 FROM expected_appearances expected
        JOIN ${appearancesTable} appearance ON
          appearance.reference_site_id = expected.reference_site_id
          AND appearance.source_id = expected.source_id
          AND appearance.source_record_id = expected.source_record_id
        WHERE NOT (${appearanceMatchPredicate('appearance', 'expected')})
      )
      THEN 1 ELSE CAST('promotion_${phase}_appearance_guard_failed_' || current_setting('server_version_num') AS INTEGER) END AS appearance_guard,
      CASE WHEN
        (SELECT COUNT(*)::int FROM expected_aggregators) = (
        SELECT COUNT(*)::int FROM ${aggregatorsTable} aggregator
        JOIN expected_aggregators expected ON expected.id = aggregator.id
      )
      THEN 1 ELSE CAST('promotion_${phase}_aggregator_count_guard_failed_' || current_setting('server_version_num') AS INTEGER) END AS aggregator_count_guard,
      CASE WHEN NOT EXISTS (
        SELECT 1 FROM expected_aggregators expected
        JOIN ${aggregatorsTable} aggregator ON aggregator.id = expected.id
        WHERE NOT (${aggregatorMatchPredicate('aggregator', 'expected')})
      )
      THEN 1 ELSE CAST('promotion_${phase}_aggregator_guard_failed_' || current_setting('server_version_num') AS INTEGER) END AS aggregator_guard
  `;
}

function protectedGuardQuery(schema, protectedRows) {
  if (!protectedRows.length) return 'SELECT 1 AS guard';
  const unions = protectedRows.map(({ table }) => `
    SELECT '${table}'::text AS "table",
      COUNT(*)::int AS rows,
      md5(COALESCE(
        string_agg(md5(to_jsonb(item)::text), ',' ORDER BY md5(to_jsonb(item)::text)),
        ''
      )) AS checksum
    FROM ${qualified(schema, table)} item
  `).join(' UNION ALL ');
  return `
    WITH actual AS (${unions}),
    expected AS (
      SELECT * FROM jsonb_to_recordset($1::jsonb)
      AS item("table" TEXT, rows INTEGER, checksum TEXT)
    )
    SELECT CASE WHEN
      (SELECT jsonb_agg(to_jsonb(actual) ORDER BY actual."table") FROM actual)
      = (SELECT jsonb_agg(to_jsonb(expected) ORDER BY expected."table") FROM expected)
    THEN 1 ELSE CAST('promotion_protected_guard_failed_' || current_setting('server_version_num') AS INTEGER) END AS guard
  `;
}

function guardParameters(plan, catalog, phase) {
  const post = phase === 'post';
  const sites = post
    ? [...plan.operations.preserveSites, ...plan.operations.insertSites]
    : plan.operations.preserveSites;
  const appearances = post ? catalog.appearances : plan.snapshot.appearances;
  const aggregators = post
    ? [...plan.operations.preserveAggregators, ...plan.operations.insertAggregators]
    : plan.snapshot.aggregators;
  const counts = post ? plan.summary.targetAfter : plan.summary.targetBefore;
  return [
    counts.sites,
    counts.appearances,
    counts.aggregators,
    counts.maxRank,
    JSON.stringify(siteJsonRows(sites)),
    JSON.stringify(appearanceIdentityRows(catalog.appearances)),
    JSON.stringify(appearanceJsonRows(appearances)),
    JSON.stringify(aggregatorJsonRows(aggregators)),
  ];
}

export async function applyPromotionPlan(sql, catalog, plan, {
  catalogSchema = 'public',
  protectedSchema = 'public',
} = {}) {
  assertSchemaName(catalogSchema);
  assertSchemaName(protectedSchema);
  if (plan.catalogSha256 !== catalog.catalogSha256) {
    throw new Error('Promotion plan catalog hash does not match the reviewed catalog.');
  }
  const sitesTable = qualified(catalogSchema, 'reference_sites');
  const appearancesTable = qualified(catalogSchema, 'reference_appearances');
  const aggregatorsTable = qualified(catalogSchema, 'reference_aggregators');
  const beforeGuard = catalogGuardQuery(catalogSchema, 'pre');
  const afterGuard = catalogGuardQuery(catalogSchema, 'post');
  const protectedGuard = protectedGuardQuery(protectedSchema, plan.snapshot.protected);
  const siteRows = siteJsonRows(plan.operations.insertSites);
  const appearanceRows = appearanceJsonRows(catalog.appearances);
  const aggregatorRows = aggregatorJsonRows(plan.operations.insertAggregators);

  const results = await sql.transaction((tx) => [
    tx`SELECT pg_advisory_xact_lock(hashtext('uncraft-reviewed-reference-delta-v1'))`,
    tx(beforeGuard, guardParameters(plan, catalog, 'pre')),
    tx(protectedGuard, plan.snapshot.protected.length ? [JSON.stringify(plan.snapshot.protected)] : []),
    tx(`
      INSERT INTO ${aggregatorsTable} (id, name, homepage_url)
      SELECT item.id, item.name, item.homepage_url
      FROM jsonb_to_recordset($1::jsonb)
        AS item(id VARCHAR, name TEXT, homepage_url TEXT)
      ON CONFLICT (id) DO NOTHING
    `, [JSON.stringify(aggregatorRows)]),
    tx(`
      INSERT INTO ${sitesTable} (
        id, canonical_url, host, title, description, thumbnail_url, categories, tags,
        editorial_consensus, curation_weight, curation_rank, featured, is_private,
        privacy_reason, template_platform, published_at, generated_at,
        availability_status, lifecycle_state, analysis_status, updated_at
      )
      SELECT
        item.id, item.canonical_url, item.host, item.title, item.description,
        item.thumbnail_url, item.categories, item.tags, item.editorial_consensus,
        item.curation_weight, item.curation_rank, item.featured, item.is_private,
        item.privacy_reason, item.template_platform, item.published_at,
        item.generated_at, item.availability_status, item.lifecycle_state,
        item.analysis_status, NOW()
      FROM jsonb_to_recordset($1::jsonb) AS item(${SITE_RECORDSET})
      ON CONFLICT DO NOTHING
    `, [JSON.stringify(siteRows)]),
    tx(`
      INSERT INTO ${appearancesTable} (
        reference_site_id, source_id, source_name, source_record_id,
        listing_url, detail_url, thumbnail_url, source_taxonomy
      )
      SELECT
        item.reference_site_id, item.source_id, item.source_name, item.source_record_id,
        item.listing_url, item.detail_url, item.thumbnail_url, item.source_taxonomy
      FROM jsonb_to_recordset($1::jsonb) AS item(${APPEARANCE_RECORDSET})
      ON CONFLICT (reference_site_id, source_id, source_record_id) DO UPDATE SET
        source_name = EXCLUDED.source_name,
        listing_url = EXCLUDED.listing_url,
        detail_url = EXCLUDED.detail_url,
        thumbnail_url = EXCLUDED.thumbnail_url,
        source_taxonomy = EXCLUDED.source_taxonomy,
        last_seen_at = NOW()
      WHERE ROW(
        ${appearancesTable}.source_name,
        ${appearancesTable}.listing_url,
        ${appearancesTable}.detail_url,
        ${appearancesTable}.thumbnail_url,
        ${appearancesTable}.source_taxonomy
      ) IS DISTINCT FROM ROW(
        EXCLUDED.source_name, EXCLUDED.listing_url, EXCLUDED.detail_url,
        EXCLUDED.thumbnail_url, EXCLUDED.source_taxonomy
      )
    `, [JSON.stringify(appearanceRows)]),
    tx(afterGuard, guardParameters(plan, catalog, 'post')),
    tx(protectedGuard, plan.snapshot.protected.length ? [JSON.stringify(plan.snapshot.protected)] : []),
    tx(`
      SELECT
        (SELECT COUNT(*)::int FROM ${sitesTable}) AS sites,
        (SELECT COUNT(*)::int FROM ${appearancesTable}) AS appearances,
        (SELECT COUNT(*)::int FROM ${aggregatorsTable}) AS aggregators,
        (SELECT COALESCE(MAX(curation_rank), 0)::int FROM ${sitesTable}) AS "maxRank"
    `),
  ], { isolationLevel: 'Serializable' });

  return {
    applied: true,
    planSha256: plan.planSha256,
    summary: plan.summary,
    counts: results.at(-1)?.[0] || null,
    writeTables: PROMOTION_WRITE_TABLES,
    protectedTables: plan.snapshot.protected.map((row) => row.table),
  };
}

export function summarizePromotionIdentities(catalog) {
  const sourceCounts = {};
  const identityHashes = new Set();
  for (const appearance of catalog.appearances) {
    const key = promotionAppearanceKey(appearance);
    if (identityHashes.has(key)) throw new Error(`Duplicate promotion identity ${key}.`);
    identityHashes.add(key);
    sourceCounts[appearance.sourceId] = (sourceCounts[appearance.sourceId] || 0) + 1;
  }
  return {
    sites: catalog.references.length,
    appearances: identityHashes.size,
    sourceCounts,
  };
}
