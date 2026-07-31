import { neon } from '@neondatabase/serverless';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const target = process.argv.includes('--isolated') ? 'isolated' : 'shared';
const databaseUrl = target === 'isolated'
  ? process.env.E2E_ISOLATED_DATABASE_URL
  : process.env.DATABASE_URL;

if (!databaseUrl) throw new Error(`${target === 'isolated' ? 'E2E_ISOLATED_DATABASE_URL' : 'DATABASE_URL'} is required.`);

const sql = neon(databaseUrl);
const migrationPaths = [
  'migrations/2026-07-31-reference-bank.sql',
  'migrations/2026-07-31-reference-weighting.sql',
];

for (const migrationPath of migrationPaths) {
  const migration = await readFile(path.resolve(migrationPath), 'utf8');
  const statements = migration
    .replace(/^\s*--.*$/gm, '')
    .split(/;\s*(?:\n|$)/)
    .map((statement) => statement.trim())
    .filter(Boolean);
  for (const statement of statements) await sql(statement);
}

const [counts] = await sql`
  SELECT
    (SELECT COUNT(*)::int FROM reference_sites) AS sites,
    (SELECT COUNT(*)::int FROM reference_appearances) AS appearances,
    (SELECT COUNT(*)::int FROM reference_preferences) AS preferences,
    (SELECT COUNT(*)::int FROM generation_reference_uses) AS plans,
    (SELECT COUNT(*)::int FROM reference_review_cohorts) AS cohorts,
    (SELECT COUNT(*)::int FROM reference_review_cohort_members WHERE cohort_id = 'cohort_v1') AS cohort_v1_members
`;

console.log(JSON.stringify({ target, migrated: true, migrations: migrationPaths, counts }, null, 2));
