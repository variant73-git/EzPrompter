import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../lib/auth.js', () => ({
  requireUser: vi.fn(async () => ({ user: { id: 42 } })),
}));
vi.mock('../../../lib/chat-persistence.js', () => ({
  getOrCreateActiveThread: vi.fn(async () => ({ id: 'thread-1', board_id: 'b1', scope: 'board' })),
  loadMessages: vi.fn(async () => [
    { id: 'm1', role: 'user', content: 'hi', created_at: '2026-01-01T00:00:00Z' },
  ]),
}));

const {
  GET, getAgentModel, isCloneRequest, resolveOperation, FAILOVER_POLICIES, resolveCloneModel,
} = await import('./route.js');

describe('isCloneRequest', () => {
  it('detects clone/capture/replicate requests (any language form)', () => {
    expect(isCloneRequest('clone https://stripe.com')).toBe(true);
    expect(isCloneRequest('clone the Stripe homepage')).toBe(true);
    expect(isCloneRequest('capture this site')).toBe(true);
    expect(isCloneRequest('capturar esse site pra mim')).toBe(true);
    expect(isCloneRequest('recreate netflix')).toBe(true);
    expect(isCloneRequest('replicate this landing page')).toBe(true);
  });
  it('does NOT fire on non-clone build requests', () => {
    expect(isCloneRequest('create a fintech site')).toBe(false);
    expect(isCloneRequest('make it darker')).toBe(false);
    expect(isCloneRequest('add a pricing section')).toBe(false);
    expect(isCloneRequest(null)).toBe(false);
  });
});

describe('getAgentModel (orchestrator ladder — picker never reaches it)', () => {
  beforeEach(() => { delete process.env.UNCRAFT_AGENT_MODEL; });

  it('follows the eval-backed tier ladder: Flash / Flash / Sonnet', () => {
    expect(getAgentModel({ plan: 'free' })).toBe('gemini-2.5-flash');
    expect(getAgentModel({ plan: 'pro' })).toBe('gemini-2.5-flash');
    expect(getAgentModel({ plan: 'enterprise' })).toBe('claude-sonnet-4-6');
    expect(getAgentModel(null)).toBe('gemini-2.5-flash');
  });

  it('lets UNCRAFT_AGENT_MODEL env win over the ladder', () => {
    process.env.UNCRAFT_AGENT_MODEL = 'gpt-4o-mini';
    expect(getAgentModel({ plan: 'enterprise' })).toBe('gpt-4o-mini');
  });
});

describe('per-operation failover policy (2026-07-22 audit)', () => {
  it('resolveOperation: clone beats plan tier; enterprise beats chat', () => {
    expect(resolveOperation({ message: 'clone https://stripe.com', hasText: true, user: { plan: 'free' } })).toBe('clone');
    expect(resolveOperation({ message: 'clone this', hasText: true, user: { plan: 'enterprise' } })).toBe('clone');
    expect(resolveOperation({ message: 'add a pricing section', hasText: true, user: { plan: 'enterprise' } })).toBe('enterprise');
    expect(resolveOperation({ message: 'add a pricing section', hasText: true, user: { plan: 'pro' } })).toBe('chat');
    expect(resolveOperation({ message: null, hasText: false, user: null })).toBe('chat');
  });

  it('clone chain NEVER contains Gemini/Flash — only the field-tested strong pair', () => {
    const labels = FAILOVER_POLICIES.clone.chain.map((e) => e.label);
    const models = FAILOVER_POLICIES.clone.chain.map((e) => e.model);
    expect(labels).not.toContain('gemini');
    expect(models.some((m) => /flash|mini|haiku/i.test(m))).toBe(false);
    expect(models).toContain('gpt-5.5');
    expect(models).toContain('claude-opus-4-7');
  });

  it('clone and enterprise fail CLOSED with product text; chat does not', () => {
    expect(FAILOVER_POLICIES.clone.unavailableMessage).toMatch(/temporarily unavailable/i);
    expect(FAILOVER_POLICIES.enterprise.unavailableMessage).toMatch(/temporarily unavailable/i);
    expect(FAILOVER_POLICIES.enterprise.chain).toHaveLength(0);
    expect(FAILOVER_POLICIES.chat.unavailableMessage).toBeNull();
  });

  it('chat chain keeps the cost-ascending ladder starting at Flash', () => {
    expect(FAILOVER_POLICIES.chat.chain[0].model).toBe('gemini-2.5-flash');
  });

  it('resolveCloneModel: env below the quality bar is rejected, honest overrides pass', () => {
    expect(resolveCloneModel(undefined)).toBe('claude-opus-4-7');
    expect(resolveCloneModel('gpt-5.5')).toBe('gpt-5.5');
    expect(resolveCloneModel('claude-opus-4-8')).toBe('claude-opus-4-8');
    expect(resolveCloneModel('gemini-2.5-flash')).toBe('claude-opus-4-7');
    expect(resolveCloneModel('gpt-4o-mini')).toBe('claude-opus-4-7');
    expect(resolveCloneModel('claude-haiku-4-5-20251001')).toBe('claude-opus-4-7');
  });
});

describe('GET /api/chat', () => {
  it('returns 400 when boardId missing', async () => {
    const req = new Request('http://test/api/chat');
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it('returns thread + messages when boardId present', async () => {
    const req = new Request('http://test/api/chat?boardId=b1');
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.thread.id).toBe('thread-1');
    expect(body.messages).toHaveLength(1);
  });
});
