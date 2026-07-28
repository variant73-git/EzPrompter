// Integration tests for the native-motion fixture seed. Gated on the isolated DB env
// (E2E_ISOLATED_DATABASE_URL); skipped otherwise so CI without the disposable DB stays green.
import { describe, it, expect, beforeAll } from 'vitest';

const HAS_DB = !!process.env.E2E_ISOLATED_DATABASE_URL;
const d = HAS_DB ? describe : describe.skip;

d('seed (isolated DB)', () => {
  let sql, seedUsers, seedBundle, createConfiguredBundleStore, jwt;
  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.E2E_ISOLATED_DATABASE_URL;
    ({ sql } = await import('../../../lib/db.js'));
    ({ seedUsers, seedBundle } = await import('./seed.mjs'));
    ({ createConfiguredBundleStore } = await import('../../../lib/native-clone/bundle-store.js'));
    jwt = (await import('jsonwebtoken')).default;
  });

  it('seedUsers creates an admin + non-admin and a valid non-admin cookie', async () => {
    const r = await seedUsers({ sql });
    expect(typeof r.adminUserId).toBe('number');
    expect(typeof r.nonAdminUserId).toBe('number');
    const decoded = jwt.verify(r.sessionCookie, process.env.JWT_SECRET);
    expect(decoded.userId).toBe(r.nonAdminUserId);
    const [admin] = await sql`SELECT role FROM users WHERE id = ${r.adminUserId}`;
    expect(admin.role).toBe('admin');
    const [owner] = await sql`SELECT role FROM users WHERE id = ${r.nonAdminUserId}`;
    expect(owner.role).toBe('member');
  });

  it('seedUsers is idempotent (re-run returns the same ids)', async () => {
    const a = await seedUsers({ sql });
    const b = await seedUsers({ sql });
    expect(b.adminUserId).toBe(a.adminUserId);
    expect(b.nonAdminUserId).toBe(a.nonAdminUserId);
  });

  it('seedBundle registers a native bundle + descriptor row (idempotent)', async () => {
    const store = createConfiguredBundleStore();
    const first = await seedBundle({ sql, store });
    expect(first.bundleId).toMatch(/^[0-9a-f-]{36}$/);
    expect(first.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    const [row] = await sql`SELECT content_hash FROM native_bundles WHERE bundle_id = ${first.bundleId}`;
    expect(row.content_hash).toBe(first.contentHash);
    const second = await seedBundle({ sql, store });
    expect(second.bundleId).toBe(first.bundleId); // content-addressed → stable
  });
});
