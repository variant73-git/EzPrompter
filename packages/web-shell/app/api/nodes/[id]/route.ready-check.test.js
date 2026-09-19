import { describe, expect, it, vi } from 'vitest';
vi.mock('../../../../lib/auth.js', () => ({ requireUser: vi.fn(async () => ({ user: { id: 42 } })) }));
const sqlMock = vi.fn();
vi.mock('../../../../lib/db.js', () => ({ db: vi.fn(async () => sqlMock) }));
const { GET } = await import('./route.js');

const P = (id) => ({ params: Promise.resolve({ id }) });

describe('ready_check nativeReady', () => {
  it('reports nativeReady from the structural lineage (bundle uuid + manifest v2 + native source)', async () => {
    sqlMock
      .mockResolvedValueOnce([{ id: 'n1', current_snapshot_id: 's1' }])
      .mockResolvedValueOnce([{ ready: true, source: 'native-bundle', native_bundle_id: '33333333-3333-4333-8333-333333333333', motion_manifest_version: 2 }]);
    const res = await GET(new Request('http://t/api/nodes/n1?ready_check=1'), P('n1'));
    expect(await res.json()).toEqual({ ready: true, snapshotId: 's1', nativeReady: true });
  });

  it('a handoff snapshot is ready but NOT nativeReady', async () => {
    sqlMock
      .mockResolvedValueOnce([{ id: 'n1', current_snapshot_id: 's1' }])
      .mockResolvedValueOnce([{ ready: true, source: 'handoff', native_bundle_id: null, motion_manifest_version: null }]);
    const res = await GET(new Request('http://t/api/nodes/n1?ready_check=1'), P('n1'));
    expect(await res.json()).toEqual({ ready: true, snapshotId: 's1', nativeReady: false });
  });

  it('no snapshot → not ready, not native', async () => {
    sqlMock.mockResolvedValueOnce([{ id: 'n1', current_snapshot_id: null }]);
    const res = await GET(new Request('http://t/api/nodes/n1?ready_check=1'), P('n1'));
    expect(await res.json()).toEqual({ ready: false, snapshotId: null, nativeReady: false });
  });
});
