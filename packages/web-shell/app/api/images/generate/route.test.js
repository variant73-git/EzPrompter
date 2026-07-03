import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../lib/auth.js', () => ({
  requireUser: vi.fn(async () => ({ user: { id: 42 } })),
}));
vi.mock('../../../../lib/image-gen/gemini-imagen.js', () => ({
  generateGeminiImage: vi.fn(async () => ({
    base64: 'GEMBASE64', mimeType: 'image/png', dataUrl: 'data:image/png;base64,GEMBASE64',
    prompt: 'cat', model: 'imagen-3.0-fast-generate-001',
  })),
}));
vi.mock('../../../../lib/image-gen/openai-image.js', () => ({
  generateOpenAIImage: vi.fn(async () => ({
    base64: 'OPENAIB64', mimeType: 'image/png', dataUrl: 'data:image/png;base64,OPENAIB64',
    prompt: 'cat', model: 'gpt-image-1',
  })),
}));
// Billing wiring (Task 13): the route opens a db handle + billed operation.
vi.mock('../../../../lib/db.js', () => ({ db: async () => (() => Promise.resolve([])) }));
vi.mock('../../../../lib/billing/ledger.js', () => ({
  holdCredits: vi.fn(async () => ({ held: true, balance: 500 })),
  refundHold: vi.fn(async () => ({ balance: 500 })),
  settleOperation: vi.fn(async ({ chargeCredits }) => ({ balanceAfter: 500 - chargeCredits })),
  grantCredits: vi.fn(async () => ({ balanceAfter: 500 })),
  getBalance: vi.fn(async () => 500),
  recentLedger: vi.fn(async () => []),
}));
vi.mock('../../../../lib/billing/rate-limit.js', () => ({
  checkOpsRate: vi.fn(async () => ({ allowed: true })),
  checkChatRate: vi.fn(async () => ({ allowed: true })),
}));

beforeEach(() => {
  process.env.GEMINI_API_KEY = 'gem';
  process.env.OPENAI_API_KEY = 'oai';
});

const { POST } = await import('./route.js');

describe('POST /api/images/generate', () => {
  it('returns 400 on missing prompt', async () => {
    const req = new Request('http://test/api/images/generate', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect((await POST(req)).status).toBe(400);
  });

  it('routes to gemini when provider=gemini', async () => {
    const req = new Request('http://test/api/images/generate', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'cat', provider: 'gemini' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.base64).toBe('GEMBASE64');
    expect(body.provider).toBe('gemini');
  });

  it('routes to openai when provider=openai', async () => {
    const req = new Request('http://test/api/images/generate', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'cat', provider: 'openai' }),
    });
    const body = await (await POST(req)).json();
    expect(body.base64).toBe('OPENAIB64');
    expect(body.provider).toBe('openai');
  });

  it('errors when provider=claude', async () => {
    const req = new Request('http://test/api/images/generate', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'cat', provider: 'claude' }),
    });
    expect((await POST(req)).status).toBe(400);
  });

  it('errors on invalid provider', async () => {
    const req = new Request('http://test/api/images/generate', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'cat', provider: 'midjourney' }),
    });
    expect((await POST(req)).status).toBe(400);
  });

  it('defaults provider=auto to gemini', async () => {
    const req = new Request('http://test/api/images/generate', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'cat', provider: 'auto' }),
    });
    const body = await (await POST(req)).json();
    expect(body.provider).toBe('gemini');
  });
});
