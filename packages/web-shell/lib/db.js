import { neon } from '@neondatabase/serverless';
import fs from 'node:fs/promises';
import path from 'node:path';

let _sql = null;
let initialized = false;

function getSql() {
  if (_sql) return _sql;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL env var missing — required for canvas server routes.');
  }
  _sql = neon(url);
  return _sql;
}

// Backwards-compat: callers `import { sql }` directly. We expose a callable
// proxy that lazily resolves to the real neon client on first invocation.
export const sql = new Proxy(function () {}, {
  apply(_t, _thisArg, args) { return getSql()(...args); },
  get(_t, prop) { return getSql()[prop]; }
});

export async function initDB() {
  if (initialized) return;
  const schemaPath = path.join(process.cwd(), 'schema.sql');
  const schema = await fs.readFile(schemaPath, 'utf8');
  // Strip line comments before splitting so they don't gate later statements.
  const stripped = schema.replace(/^\s*--.*$/gm, '');
  const statements = stripped
    .split(/;\s*(?:\n|$)/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const client = getSql();
  for (const stmt of statements) {
    // neon's tagged-template client also accepts plain string queries.
    await client(stmt);
  }
  initialized = true;
}

export async function db() {
  if (!initialized) await initDB();
  return getSql();
}
