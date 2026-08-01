import { neon } from '@neondatabase/serverless';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { loadIsolatedDatabaseConfig } from './isolated-env.mjs';

if (!process.argv.includes('--isolated')) {
  throw new Error('Landbook query proof refuses shared targets. Pass --isolated.');
}
const seedFlag = process.argv.indexOf('--seed');
const seedPath = seedFlag >= 0 ? process.argv[seedFlag + 1] : null;
if (!seedPath) throw new Error('--seed <path> is required.');

const seed = JSON.parse(await readFile(path.resolve(seedPath), 'utf8'));
if (seed?.stats?.proof?.scope !== 'bounded-landbook-thumbnail-link-pilot') {
  throw new Error('The supplied seed is not the bounded Landbook thumbnail-and-link pilot.');
}
const expected = new Map((seed.references || []).map((reference) => [reference.id, reference]));
if (!expected.size) throw new Error('Landbook pilot seed has no references to query.');

const { databaseUrl } = loadIsolatedDatabaseConfig();
const sql = neon(databaseUrl);
const ids = [...expected.keys()];
const rows = await sql`
  SELECT
    site.id,
    site.canonical_url,
    site.host,
    site.title,
    site.thumbnail_url,
    COUNT(appearance.id)::int AS landbook_appearances,
    BOOL_OR(appearance.detail_url IS NOT NULL) AS has_landbook_detail
  FROM reference_sites site
  JOIN reference_appearances appearance
    ON appearance.reference_site_id = site.id AND appearance.source_id = 'landbook'
  WHERE site.id = ANY(${ids}) AND site.lifecycle_state <> 'removed'
  GROUP BY site.id
  ORDER BY site.title ASC
`;
const returnedIds = new Set(rows.map((row) => row.id));
const missing = ids.filter((id) => !returnedIds.has(id));
const mismatched = rows.flatMap((row) => {
  const reference = expected.get(row.id);
  const valid = reference
    && row.canonical_url === reference.url
    && row.thumbnail_url === reference.thumbnailUrl
    && Number(row.landbook_appearances) >= 1
    && row.has_landbook_detail === true;
  return valid ? [] : [{ id: row.id, host: row.host }];
});
if (missing.length || mismatched.length) {
  throw new Error(`Landbook query proof failed: ${missing.length} missing and ${mismatched.length} mismatched references.`);
}

process.stdout.write(`${JSON.stringify({
  target: 'isolated',
  sourceFilter: 'landbook',
  expectedReferences: ids.length,
  consultableReferences: rows.length,
  missingReferences: missing.length,
  mismatchedReferences: mismatched.length,
  requiredFields: ['title', 'canonical_url', 'thumbnail_url', 'detail_url'],
  sample: rows.slice(0, 5).map((row) => ({
    title: row.title,
    host: row.host,
    landbookAppearances: Number(row.landbook_appearances),
  })),
}, null, 2)}\n`);
