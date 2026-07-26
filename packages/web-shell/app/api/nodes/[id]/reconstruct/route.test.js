import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../../lib/auth.js', () => ({
  requireUser: vi.fn(async () => ({ user: { id: 42 } })),
}));

const sqlMock = vi.fn();
vi.mock('../../../../../lib/db.js', () => ({ db: vi.fn(async () => sqlMock) }));
vi.mock('../../../../../lib/billing/rate-limit.js', () => ({ checkOpsRate: vi.fn(async () => ({ allowed: true })) }));
vi.mock('../../../../../lib/reconstruction-policy.js', () => ({ shouldReconstructForAction: vi.fn(() => true) }));
vi.mock('../../../../../lib/deferred-reconstruction.js', () => ({ reconstructSiteNode: vi.fn() }));

const { reconstructSiteNode } = await import('../../../../../lib/deferred-reconstruction.js');
const { POST } = await import('./route.js');

const params = { params: Promise.resolve({ id: 'node-1' }) };
const descriptor = {
  schemaVersion: 1,
  bundleId: '33333333-3333-4333-8333-333333333333',
  storageKey: 'native-bundles/v1/33333333-3333-4333-8333-333333333333',
  contentHash: `sha256:${'a'.repeat(64)}`,
  entryPath: 'index.html',
  assetIndex: [{ path: 'index.html', contentType: 'text/html', byteLength: 1, contentHash: `sha256:${'b'.repeat(64)}` }],
  runtimeFingerprint: `sha256:${'c'.repeat(64)}`,
  reconstructionCapabilities: { detectedEngines: ['gsap'], candidateControls: [] },
};

beforeEach(() => {
  sqlMock.mockReset();
  sqlMock.mockResolvedValue([{
    id: 'node-1', kind: 'site', meta: { animatedDetected: true }, board_id: 'board-1',
    origin_url: 'https://example.com', current_snapshot_id: 'snapshot-1',
    current_html: '<html>capture</html>', current_snapshot_source: 'capture',
  }]);
  reconstructSiteNode.mockReset();
});

describe('POST /api/nodes/[id]/reconstruct native result', () => {
  it('returns an explicit registered native bundle without pretending it is Iter9 HTML', async () => {
    reconstructSiteNode.mockResolvedValue({
      ok: true,
      kind: 'native',
      nodeId: 'node-1',
      bundleDescriptor: descriptor,
      credits: 200,
    });
    const request = new Request('http://test/api/nodes/node-1/reconstruct', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'reconstruct-1' },
    });
    const response = await POST(request, params);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toMatchObject({ kind: 'native', snapshotSource: 'native-bundle', bundleDescriptor: descriptor });
    expect(json).not.toHaveProperty('html');
    expect(reconstructSiteNode).toHaveBeenCalledWith(expect.objectContaining({ idemKey: 'reconstruct-1' }));
  });
});
