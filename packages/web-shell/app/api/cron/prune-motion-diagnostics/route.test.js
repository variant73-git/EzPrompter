import { beforeEach, describe, expect, it, vi } from 'vitest';

const pruneMock = vi.fn(async () => undefined);
vi.mock('../../../../lib/db.js', () => ({ db: async () => ({}) }));
vi.mock('../../../../lib/motion-editor/diagnostics.js', () => ({
  pruneExpiredMotionDiagnostics: (...args) => pruneMock(...args),
}));

const { GET } = await import('./route.js');
const request = (authorization) => ({
  headers: { get: (name) => name === 'authorization' ? authorization : null },
});

beforeEach(() => {
  pruneMock.mockClear();
  delete process.env.CRON_SECRET;
});

describe('GET /api/cron/prune-motion-diagnostics', () => {
  it('runs the diagnostic-only retention sweep in development', async () => {
    const response = await GET(request(null));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(pruneMock).toHaveBeenCalledOnce();
  });

  it('requires the configured cron bearer secret', async () => {
    process.env.CRON_SECRET = 'cron-secret';
    const response = await GET(request('Bearer wrong'));
    expect(response.status).toBe(401);
    expect(pruneMock).not.toHaveBeenCalled();
  });
});
