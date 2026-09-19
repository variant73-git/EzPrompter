import { describe, expect, it, vi } from 'vitest';
import { allowedDomainsFor, createBrowserbaseClient } from './browserbase-client.js';

function fakeFetch(handler) {
  return vi.fn(async (url, init) => {
    const { status = 200, body = {} } = handler(String(url), init) || {};
    return { ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) };
  });
}

describe('browserbase client', () => {
  it('creates a session with the spec settings', async () => {
    const calls = [];
    const fetchImpl = fakeFetch((url, init) => {
      calls.push({ url, init });
      return { body: { id: 'sess_1', connectUrl: 'wss://connect.browserbase.com?apiKey=SECRET&sessionId=sess_1', expiresAt: '2026-09-08T10:00:00Z' } };
    });
    const client = createBrowserbaseClient({ apiKey: 'k', projectId: 'p', fetchImpl });
    const s = await client.createSession({ targetUrl: 'https://www.example.com/promo', jobId: 'j1' });
    expect(s).toEqual({ id: 'sess_1', connectUrl: expect.stringContaining('sess_1'), expiresAt: '2026-09-08T10:00:00Z' });
    const body = JSON.parse(calls[0].init.body);
    expect(calls[0].url).toBe('https://api.browserbase.com/v1/sessions');
    expect(calls[0].init.headers['x-bb-api-key']).toBe('k');
    expect(body).toMatchObject({
      projectId: 'p', keepAlive: true, timeout: 600,
      browserSettings: { solveCaptchas: true, recordSession: false, logSession: false, viewport: { width: 1440, height: 900 }, allowedDomains: ['example.com'] },
      userMetadata: { jobId: 'j1' },
    });
    expect(body.proxies).toBeUndefined();
  });

  it('sends proxies only when asked', async () => {
    const calls = [];
    const client = createBrowserbaseClient({ apiKey: 'k', projectId: 'p', fetchImpl: fakeFetch((url, init) => { calls.push(init); return { body: { id: 's', connectUrl: 'wss://x', expiresAt: 'e' } }; }) });
    await client.createSession({ targetUrl: 'https://a.b.c.example.org/', proxy: true });
    expect(JSON.parse(calls[0].body).proxies).toBe(true);
  });

  it('returns only page live URLs, and releases with REQUEST_RELEASE', async () => {
    const calls = [];
    const client = createBrowserbaseClient({ apiKey: 'k', projectId: 'p', fetchImpl: fakeFetch((url, init) => {
      calls.push({ url, init });
      if (url.endsWith('/debug')) return { body: { debuggerUrl: 'https://all', wsUrl: 'wss://cdp', pages: [{ id: 'pg', url: 'https://example.com/', debuggerFullscreenUrl: 'https://live/pg', debuggerUrl: 'https://live/pg?nav', title: 't' }] } };
      return { body: {} };
    }) });
    const live = await client.liveUrls('sess_1');
    expect(live).toEqual({ pages: [{ id: 'pg', url: 'https://example.com/', debuggerFullscreenUrl: 'https://live/pg' }] });
    await client.releaseSession('sess_1');
    const rel = calls.find((c) => c.url.endsWith('/sessions/sess_1') && c.init.method === 'POST');
    expect(JSON.parse(rel.init.body)).toEqual({ projectId: 'p', status: 'REQUEST_RELEASE' });
  });

  it('maps vendor failures to typed errors', async () => {
    const client = createBrowserbaseClient({ apiKey: 'k', projectId: 'p', fetchImpl: fakeFetch(() => ({ status: 503, body: { message: 'down' } })) });
    await expect(client.createSession({ targetUrl: 'https://example.com' })).rejects.toMatchObject({ code: 'vendor_unavailable' });
    const client2 = createBrowserbaseClient({ apiKey: 'k', projectId: 'p', fetchImpl: fakeFetch(() => ({ status: 400, body: { message: 'bad' } })) });
    await expect(client2.createSession({ targetUrl: 'https://example.com' })).rejects.toMatchObject({ code: 'vendor_rejected' });
    const client3 = createBrowserbaseClient({ apiKey: 'k', projectId: 'p', fetchImpl: vi.fn(async () => { throw new Error('ECONNRESET'); }) });
    await expect(client3.createSession({ targetUrl: 'https://example.com' })).rejects.toMatchObject({ code: 'vendor_unavailable' });
  });

  it('refuses to build without credentials', () => {
    expect(() => createBrowserbaseClient({ apiKey: '', projectId: 'p' })).toThrow(/not_configured/);
  });

  it('allowedDomainsFor uses the registrable domain', () => {
    expect(allowedDomainsFor('https://www.farmminerals.com/promo')).toEqual(['farmminerals.com']);
    expect(allowedDomainsFor('https://amigosecreto.curriculum.com.br/')).toEqual(['curriculum.com.br']);
    expect(allowedDomainsFor('https://shop.example.co.uk/x')).toEqual(['example.co.uk']);
  });
});
