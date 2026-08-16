import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../../lib/auth.js', () => ({
  requireUser: vi.fn(async () => ({ user: { id: 42 } })),
}));

const sqlMock = vi.fn();
sqlMock._results = [];
sqlMock.mockImplementation(() => Promise.resolve(sqlMock._results.shift() || []));

vi.mock('../../../../../lib/db.js', () => ({ db: async () => sqlMock }));

const { GET } = await import('./route.js');

beforeEach(() => { sqlMock.mockClear(); sqlMock._results = []; });

const req = () => new Request('http://test/api/nodes/n1/snapshots');
const params = { params: Promise.resolve({ id: 'n1' }) };

describe('GET /api/nodes/[id]/snapshots', () => {
  it('404 when node not owned', async () => {
    sqlMock._results = [[]]; // ownership empty
    const res = await GET(req(), params);
    expect(res.status).toBe(404);
  });

  it('lists snapshots metadata, flags current, no html', async () => {
    sqlMock._results = [
      [{ id: 'n1', current_snapshot_id: 'snap-2' }], // ownership + current
      [
        { id: 'snap-2', source: 'edit', created_at: '2026-06-23T02:00:00Z', hasScreenshot: false },
        { id: 'snap-1', source: 'capture', created_at: '2026-06-23T01:00:00Z', hasScreenshot: true },
      ],
    ];
    const res = await GET(req(), params);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.snapshots).toHaveLength(2);
    expect(json.snapshots[0]).toEqual({
      id: 'snap-2', source: 'edit', created_at: '2026-06-23T02:00:00Z',
      hasScreenshot: false, isCurrent: true,
    });
    expect(json.snapshots[1].isCurrent).toBe(false);
    expect(json.snapshots[1].hasScreenshot).toBe(true);
    // no html leaked
    expect(JSON.stringify(json)).not.toContain('html');
    expect(json.snapshots[0]).not.toHaveProperty('nativeBundleId');
    expect(json.snapshots[0]).not.toHaveProperty('motionManifestVersion');
  });

  it('adds native bundle metadata only to native snapshots', async () => {
    sqlMock._results = [
      [{ id: 'n1', current_snapshot_id: 'snap-native' }],
      [{
        id: 'snap-native', source: 'native-edit', created_at: '2026-07-26T02:00:00Z',
        hasScreenshot: false, native_bundle_id: 'bundle-1', motion_manifest_version: 2,
      }],
    ];
    const res = await GET(req(), params);
    const json = await res.json();
    expect(json.snapshots[0]).toMatchObject({
      id: 'snap-native', nativeBundleId: 'bundle-1', motionManifestVersion: 2,
    });
  });

  it('does not invent a manifest version for an unedited native base snapshot', async () => {
    sqlMock._results = [
      [{ id: 'n1', current_snapshot_id: 'snap-native' }],
      [{
        id: 'snap-native', source: 'native', created_at: '2026-07-26T01:00:00Z',
        hasScreenshot: false, native_bundle_id: 'bundle-1', motion_manifest_version: null,
      }],
    ];
    const res = await GET(req(), params);
    const json = await res.json();
    expect(json.snapshots[0].nativeBundleId).toBe('bundle-1');
    expect(json.snapshots[0]).not.toHaveProperty('motionManifestVersion');
  });
});
