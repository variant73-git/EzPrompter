import { neon } from '@neondatabase/serverless';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { loadIsolatedDatabaseConfig } from './isolated-env.mjs';

if (!process.argv.includes('--isolated')) {
  throw new Error('Proof import refuses shared targets. Pass --isolated and configure E2E_ISOLATED_DATABASE_URL.');
}
const seedFlag = process.argv.indexOf('--seed');
const seedPath = seedFlag >= 0 ? process.argv[seedFlag + 1] : null;
if (!seedPath) throw new Error('--seed <path> is required.');
const { databaseUrl } = loadIsolatedDatabaseConfig();

const seed = JSON.parse(await readFile(path.resolve(seedPath), 'utf8'));
if (seed?.stats?.proof == null) throw new Error('The supplied seed is not a bounded proof seed.');
const sql = neon(databaseUrl);
const batchSize = 100;

for (let offset = 0; offset < seed.references.length; offset += batchSize) {
  const records = seed.references.slice(offset, offset + batchSize).map((reference, index) => ({
    id: reference.id,
    canonical_url: reference.url,
    host: reference.host,
    title: reference.title,
    description: reference.description || '',
    thumbnail_url: reference.thumbnailUrl || null,
    categories: reference.categories || [],
    tags: reference.tags || [],
    editorial_consensus: reference.editorialConsensus || 1,
    curation_weight: reference.curationWeight || 1,
    curation_rank: offset + index + 1,
    featured: Boolean(reference.featured),
    published_at: reference.publishedAt || null,
    generated_at: reference.generatedAt || seed.generatedAt || null,
    analysis_status: reference.analysisStatus || 'listed',
  }));
  await sql`
    INSERT INTO reference_sites (
      id, canonical_url, host, title, description, thumbnail_url, categories, tags,
      editorial_consensus, curation_weight, curation_rank, featured, published_at,
      generated_at, analysis_status, updated_at
    )
    SELECT
      item.id, item.canonical_url, item.host, item.title, item.description,
      item.thumbnail_url, item.categories, item.tags, item.editorial_consensus,
      item.curation_weight, item.curation_rank, item.featured, item.published_at,
      item.generated_at, item.analysis_status, NOW()
    FROM jsonb_to_recordset(${JSON.stringify(records)}::jsonb) AS item(
      id TEXT, canonical_url TEXT, host TEXT, title TEXT, description TEXT,
      thumbnail_url TEXT, categories TEXT[], tags TEXT[], editorial_consensus SMALLINT,
      curation_weight NUMERIC, curation_rank INTEGER, featured BOOLEAN,
      published_at TEXT, generated_at TIMESTAMPTZ, analysis_status VARCHAR
    )
    ON CONFLICT (id) DO UPDATE SET
      canonical_url = EXCLUDED.canonical_url,
      host = EXCLUDED.host,
      title = EXCLUDED.title,
      description = EXCLUDED.description,
      thumbnail_url = EXCLUDED.thumbnail_url,
      categories = EXCLUDED.categories,
      tags = EXCLUDED.tags,
      editorial_consensus = EXCLUDED.editorial_consensus,
      curation_weight = EXCLUDED.curation_weight,
      curation_rank = EXCLUDED.curation_rank,
      featured = EXCLUDED.featured,
      published_at = EXCLUDED.published_at,
      generated_at = EXCLUDED.generated_at,
      analysis_status = EXCLUDED.analysis_status,
      updated_at = NOW()
  `;
}

const appearances = [...new Map(seed.references.flatMap((reference) => (reference.sources || []).map((source) => {
  const record = {
    reference_site_id: reference.id,
    source_id: source.id,
    source_name: source.name,
    source_record_id: String(source.recordId || source.detailUrl || reference.url),
    listing_url: source.listingUrl,
    detail_url: source.detailUrl || null,
    thumbnail_url: source.thumbnailUrl || null,
    source_taxonomy: source.taxonomy || {},
  };
  return [`${record.reference_site_id}\u0000${record.source_id}\u0000${record.source_record_id}`, record];
}))).values()];
const homepageUrls = {
  landbook: 'https://land-book.com/',
  minimalgallery: 'https://minimal.gallery/',
  siteofsites: 'https://www.siteofsites.co/',
};
const aggregators = [...new Map(appearances.map((appearance) => [appearance.source_id, {
  id: appearance.source_id,
  name: appearance.source_name,
  homepage_url: homepageUrls[appearance.source_id] || null,
}])).values()];
await sql`
  INSERT INTO reference_aggregators (id, name, homepage_url)
  SELECT item.id, item.name, item.homepage_url
  FROM jsonb_to_recordset(${JSON.stringify(aggregators)}::jsonb)
    AS item(id VARCHAR, name TEXT, homepage_url TEXT)
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    homepage_url = COALESCE(EXCLUDED.homepage_url, reference_aggregators.homepage_url),
    updated_at = NOW()
`;

for (let offset = 0; offset < appearances.length; offset += batchSize) {
  const records = appearances.slice(offset, offset + batchSize);
  await sql`
    INSERT INTO reference_appearances (
      reference_site_id, source_id, source_name, source_record_id,
      listing_url, detail_url, thumbnail_url, source_taxonomy, last_seen_at
    )
    SELECT
      item.reference_site_id, item.source_id, item.source_name, item.source_record_id,
      item.listing_url, item.detail_url, item.thumbnail_url, item.source_taxonomy, NOW()
    FROM jsonb_to_recordset(${JSON.stringify(records)}::jsonb) AS item(
      reference_site_id TEXT, source_id VARCHAR, source_name TEXT,
      source_record_id TEXT, listing_url TEXT, detail_url TEXT,
      thumbnail_url TEXT, source_taxonomy JSONB
    )
    ON CONFLICT (reference_site_id, source_id, source_record_id) DO UPDATE SET
      source_name = EXCLUDED.source_name,
      listing_url = EXCLUDED.listing_url,
      detail_url = EXCLUDED.detail_url,
      thumbnail_url = EXCLUDED.thumbnail_url,
      source_taxonomy = EXCLUDED.source_taxonomy,
      last_seen_at = NOW()
  `;
}

const proofSourceIds = ['minimalgallery', 'siteofsites'];
const [counts] = await sql`
  SELECT
    (SELECT COUNT(*)::int FROM reference_sites) AS sites,
    (SELECT COUNT(*)::int FROM reference_appearances) AS appearances,
    (SELECT COUNT(*)::int FROM reference_appearances WHERE source_id = ANY(${proofSourceIds})) AS proof_appearances,
    (SELECT COUNT(DISTINCT reference_site_id)::int FROM reference_appearances WHERE source_id = ANY(${proofSourceIds})) AS proof_sites,
    (SELECT COUNT(*)::int FROM reference_aggregators WHERE id = ANY(${proofSourceIds})) AS proof_aggregators
`;

console.log(JSON.stringify({ target: 'isolated', imported: true, seedPath, counts }, null, 2));
