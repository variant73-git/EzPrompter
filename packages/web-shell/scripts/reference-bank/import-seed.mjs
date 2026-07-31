import { neon } from '@neondatabase/serverless';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const target = process.argv.includes('--isolated') ? 'isolated' : 'shared';
const databaseUrl = target === 'isolated'
  ? process.env.E2E_ISOLATED_DATABASE_URL
  : process.env.DATABASE_URL;
if (!databaseUrl) throw new Error(`${target === 'isolated' ? 'E2E_ISOLATED_DATABASE_URL' : 'DATABASE_URL'} is required.`);

const seed = JSON.parse(await readFile(path.resolve('lib/reference-bank.seed.json'), 'utf8'));
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
  };
  return [`${record.reference_site_id}\u0000${record.source_id}\u0000${record.source_record_id}`, record];
}))).values()];

for (let offset = 0; offset < appearances.length; offset += batchSize) {
  const records = appearances.slice(offset, offset + batchSize);
  await sql`
    INSERT INTO reference_appearances (
      reference_site_id, source_id, source_name, source_record_id,
      listing_url, detail_url, thumbnail_url, last_seen_at
    )
    SELECT
      item.reference_site_id, item.source_id, item.source_name, item.source_record_id,
      item.listing_url, item.detail_url, item.thumbnail_url, NOW()
    FROM jsonb_to_recordset(${JSON.stringify(records)}::jsonb) AS item(
      reference_site_id TEXT, source_id VARCHAR, source_name TEXT,
      source_record_id TEXT, listing_url TEXT, detail_url TEXT, thumbnail_url TEXT
    )
    ON CONFLICT (reference_site_id, source_id, source_record_id) DO UPDATE SET
      source_name = EXCLUDED.source_name,
      listing_url = EXCLUDED.listing_url,
      detail_url = EXCLUDED.detail_url,
      thumbnail_url = EXCLUDED.thumbnail_url,
      last_seen_at = NOW()
  `;
}

const [counts] = await sql`
  SELECT
    (SELECT COUNT(*)::int FROM reference_sites) AS sites,
    (SELECT COUNT(*)::int FROM reference_appearances) AS appearances,
    (SELECT COUNT(*)::int FROM reference_sites WHERE curation_rank <= 24) AS review_candidates
`;
console.log(JSON.stringify({ target, imported: true, counts }, null, 2));
