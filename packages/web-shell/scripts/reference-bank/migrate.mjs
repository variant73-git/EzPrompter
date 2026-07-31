import { neon } from '@neondatabase/serverless';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const target = process.argv.includes('--isolated') ? 'isolated' : 'shared';
const databaseUrl = target === 'isolated'
  ? process.env.E2E_ISOLATED_DATABASE_URL
  : process.env.DATABASE_URL;

if (!databaseUrl) throw new Error(`${target === 'isolated' ? 'E2E_ISOLATED_DATABASE_URL' : 'DATABASE_URL'} is required.`);

const migrationPath = path.resolve('migrations/2026-07-31-reference-bank.sql');
const migration = await readFile(migrationPath, 'utf8');
const statements = migration
  .replace(/^\s*--.*$/gm, '')
  .split(/;\s*(?:\n|$)/)
  .map((statement) => statement.trim())
  .filter(Boolean);
const sql = neon(databaseUrl);

for (const statement of statements) await sql(statement);

const [counts] = await sql`
  SELECT
    (SELECT COUNT(*)::int FROM reference_sites) AS sites,
    (SELECT COUNT(*)::int FROM reference_appearances) AS appearances,
    (SELECT COUNT(*)::int FROM reference_preferences) AS preferences,
    (SELECT COUNT(*)::int FROM generation_reference_uses) AS plans
`;

console.log(JSON.stringify({ target, migrated: true, counts }, null, 2));
