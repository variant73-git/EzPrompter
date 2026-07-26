import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../../../lib/auth.js', () => ({
  requireUser: vi.fn(async () => ({ user: { id: 42 } })),
}));

const sqlMock = vi.fn();
sqlMock._results = [];
sqlMock.mockImplementation(() => Promise.resolve(sqlMock._results.shift() || []));

vi.mock('../../../../../../lib/db.js', () => ({ db: async () => sqlMock }));

const { GET } = await import('./route.js');

beforeEach(() => { sqlMock.mockClear(); sqlMock._results = []; });

const req = () => new Request('http://test/api/nodes/n1/snapshots/snap-1');
const params = { params: Promise.resolve({ id: 'n1', snapId: 'snap-1' }) };

describe('GET /api/nodes/[id]/snapshots/[snapId]', () => {
  it('404 when snapshot not found / not owned / wrong node', async () => {
    sqlMock._results = [[]];
    const res = await GET(req(), params);
    expect(res.status).toBe(404);
  });

  it('returns the version content for preview / thumbnail', async () => {
    const legacySnapshot = {
      id: 'snap-1', html: '<html>v1</html>', design_md: null,
      screenshot_url: null, source: 'edit', created_at: '2026-06-23T01:00:00Z',
    };
    sqlMock._results = [[legacySnapshot]];
    const res = await GET(req(), params);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.snapshot).toEqual(legacySnapshot);
    expect(json.snapshot).not.toHaveProperty('nativeBundle');
    expect(json.snapshot).not.toHaveProperty('motionManifest');
  });

  it('returns validated native bundle and manifest metadata when present', async () => {
    const motionManifest = {
      schemaVersion: 2,
      baseBundleId: '11111111-1111-4111-8111-111111111111',
      transactions: [],
      controlManifest: {},
      responsiveManifest: {},
      runtimeFingerprint: `sha256:${'a'.repeat(64)}`,
    };
    sqlMock._results = [[{
      id: 'snap-native', html: null, design_md: null, screenshot_url: null,
      source: 'native-edit', created_at: '2026-07-26T01:00:00Z',
      native_bundle_id: motionManifest.baseBundleId,
      motion_manifest: motionManifest,
      motion_manifest_version: 2,
      native_bundle_schema_version: 1,
      native_bundle_content_hash: `sha256:${'b'.repeat(64)}`,
      native_bundle_entry_path: 'index.html',
      native_bundle_runtime_fingerprint: motionManifest.runtimeFingerprint,
    }]];
    const res = await GET(req(), params);
    const json = await res.json();
    expect(json.snapshot).toMatchObject({
      id: 'snap-native',
      nativeBundle: {
        schemaVersion: 1,
        bundleId: motionManifest.baseBundleId,
        contentHash: `sha256:${'b'.repeat(64)}`,
        entryPath: 'index.html',
        runtimeFingerprint: motionManifest.runtimeFingerprint,
      },
      motionManifest,
      motionManifestVersion: 2,
    });
    expect(json.snapshot).not.toHaveProperty('native_bundle_id');
  });
});
