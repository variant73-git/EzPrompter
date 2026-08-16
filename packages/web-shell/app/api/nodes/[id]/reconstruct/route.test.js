import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../../lib/auth.js', () => ({
  requireUser: vi.fn(async () => ({ user: { id: 42, plan: 'pro' } })),
}));

const sqlMock = vi.fn();
vi.mock('../../../../../lib/db.js', () => ({ db: vi.fn(async () => sqlMock) }));
vi.mock('../../../../../lib/billing/rate-limit.js', () => ({ checkOpsRate: vi.fn(async () => ({ allowed: true })) }));
vi.mock('../../../../../lib/reconstruction-policy.js', () => ({ shouldReconstructForAction: vi.fn(() => true) }));
// O mock devolve `true` por padrao — o que ESCONDIA o early-return engolindo o
// pedido nominal (achado da auditoria). Os testes do motor por nome o poem em `false`.
vi.mock('../../../../../lib/deferred-reconstruction.js', () => ({ reconstructSiteNode: vi.fn() }));

const { reconstructSiteNode } = await import('../../../../../lib/deferred-reconstruction.js');
const { requireUser } = await import('../../../../../lib/auth.js');
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
  requireUser.mockResolvedValue({ user: { id: 42, plan: 'pro' } });
  sqlMock.mockReset();
  sqlMock.mockResolvedValue([{
    id: 'node-1', kind: 'site', meta: { animatedDetected: true }, board_id: 'board-1',
    origin_url: 'https://example.com', current_snapshot_id: 'snapshot-1',
    current_html: '<html>capture</html>', current_snapshot_source: 'capture',
  }]);
  reconstructSiteNode.mockReset();
});

describe('POST /api/nodes/[id]/reconstruct native result', () => {
  it('fails closed before reconstruction for a free plan', async () => {
    requireUser.mockResolvedValueOnce({ user: { id: 42, plan: 'free' } });
    const response = await POST(new Request('http://test/api/nodes/node-1/reconstruct', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'reconstruct-free' },
    }), params);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: 'paid_plan_required',
      feature: 'clone_edit',
    });
    expect(sqlMock).not.toHaveBeenCalled();
    expect(reconstructSiteNode).not.toHaveBeenCalled();
  });

  it('requires one stable parent idempotency key before DB or billing work', async () => {
    const response = await POST(new Request('http://test/api/nodes/node-1/reconstruct', {
      method: 'POST',
    }), params);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'idempotency_key_required' });
    expect(sqlMock).not.toHaveBeenCalled();
    expect(reconstructSiteNode).not.toHaveBeenCalled();
  });

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
    expect(reconstructSiteNode).toHaveBeenCalledWith(expect.objectContaining({
      idemKey: 'reconstruct-1',
      op: 'clone.edit',
    }));
  });

  it('returns sanitized stable control-generation failures without provider details', async () => {
    reconstructSiteNode.mockRejectedValue(Object.assign(new Error('raw provider output must stay private'), {
      code: 'structured_output_invalid',
    }));
    const response = await POST(new Request('http://test/api/nodes/node-1/reconstruct', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'reconstruct-invalid-controls' },
    }), params);

    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body).toEqual({ error: 'control_generation_failed' });
    expect(JSON.stringify(body)).not.toContain('raw provider output');
  });
});

// Doutrina 2026-08-15: "clone" e' o animado; o iter9 entra POR NOME — inclusive
// quando ja existe snapshot utilizavel (e' o caso "converter para iter9"), que
// era exatamente onde o early-return de "ja esta pronto" engolia o pedido.
describe('POST /api/nodes/[id]/reconstruct — motor por nome', () => {
  function requestCom(corpo) {
    return new Request('http://localhost/api/nodes/node-1/reconstruct', {
      method: 'POST',
      headers: { 'idempotency-key': 'ticket-1', 'content-type': 'application/json' },
      body: corpo == null ? undefined : JSON.stringify(corpo),
    });
  }

  it('runs iter9 by name even when the snapshot is already usable', async () => {
    const { shouldReconstructForAction } = await import('../../../../../lib/reconstruction-policy.js');
    shouldReconstructForAction.mockReturnValue(false); // "ja esta pronto"
    reconstructSiteNode.mockResolvedValue({ kind: 'iter9', html: '<html>i9</html>', snapshotId: 's2', credits: 1 });
    const res = await POST(requestCom({ engine: 'iter9' }), params);
    expect(res.status).toBe(200);
    expect(reconstructSiteNode).toHaveBeenCalledTimes(1);
    expect(reconstructSiteNode.mock.calls[0][0].engine).toBe('iter9');
  });

  it('still skips the plain request when nothing needs doing', async () => {
    const { shouldReconstructForAction } = await import('../../../../../lib/reconstruction-policy.js');
    shouldReconstructForAction.mockReturnValue(false);
    const res = await POST(requestCom(null), params);
    const corpo = await res.json();
    expect(corpo.skipped).toBe(true);
    expect(reconstructSiteNode).not.toHaveBeenCalled();
  });

  it('refuses an unknown engine loudly, even when it would otherwise skip', async () => {
    const { shouldReconstructForAction } = await import('../../../../../lib/reconstruction-policy.js');
    shouldReconstructForAction.mockReturnValue(false);
    const res = await POST(requestCom({ engine: 'screenshot' }), params);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('unknown_clone_engine');
    expect(reconstructSiteNode).not.toHaveBeenCalled();
  });
});
