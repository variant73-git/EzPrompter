import { neon } from '@neondatabase/serverless';
import fs from 'node:fs/promises';
import path from 'node:path';

export const sql = neon(process.env.DATABASE_URL);

let initialized = false;

export async function initDB() {
  if (initialized) return;
  // Schema is idempotent; safe to run on cold start. For production migrations
  // beyond CREATE TABLE IF NOT EXISTS, switch to a migration tool.
  const schemaPath = path.join(process.cwd(), 'schema.sql');
  const schema = await fs.readFile(schemaPath, 'utf8');
  // neon driver requires statements run individually; split on `;` at line end.
  const statements = schema
    .split(/;\s*\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith('--'));
  for (const stmt of statements) {
    await sql.unsafe(stmt);
  }
  initialized = true;
}

// Helper for routes: ensure schema exists before query (cheap after first call).
export async function db() {
  if (!initialized) await initDB();
  return sql;
}
