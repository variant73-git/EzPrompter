import { describe, expect, it, vi } from 'vitest';
import { createSteelClient } from './steel-client.js';
import { challengeVendorFromEnv, connectUrlForSession } from './vendor.js';

function fakeFetch(handler) {
  return vi.fn(async (url, init) => {
    const { status = 200, body = {} } = handler(String(url), init) || {};
    return { ok: status < 400, status, json: async () => body };
  });
}

describe('steel client', () => {
  it('creates a session with the spec settings and constructs the CDP url (not websocketUrl)', async () => {
    const calls = [];
    const client = createSteelClient({ apiKey: 'k', fetchImpl: fakeFetch((url, init) => { calls.push({ url, init }); return { body: { id: 'sess_1', websocketUrl: 'wss://DO-NOT-USE', debugUrl: 'https://app.steel.dev/v1/sessions/sess_1/debug' } }; }) });
    const s = await client.createSession({ targetUrl: 'https://www.example.com/', jobId: 'j1' });
    expect(calls[0].url).toBe('https://api.steel.dev/v1/sessions');
    expect(calls[0].init.headers['steel-api-key']).toBe('k');
    const body = JSON.parse(calls[0].init.body);
    // Campo real é `timeout` (ms); NÃO manda solveCaptcha/useProxy por padrão
    // (403 na conta grátis).
    expect(body).toMatchObject({ timeout: 600000, dimensions: { width: 1440, height: 900 } });
    expect(body.solveCaptcha).toBeUndefined();
    expect(body.useProxy).toBeUndefined();
    expect(s.id).toBe('sess_1');
    expect(s.connectUrl).toBe('wss://connect.steel.dev?apiKey=k&sessionId=sess_1');
    expect(s.connectUrl).not.toContain('DO-NOT-USE');
    expect(typeof s.expiresAt).toBe('string');
  });

  it('sends solveCaptcha only when enabled, useProxy only when asked', async () => {
    const calls = [];
    const client = createSteelClient({ apiKey: 'k', solveCaptcha: true, fetchImpl: fakeFetch((url, init) => { calls.push(init); return { body: { id: 's' } }; }) });
    await client.createSession({ targetUrl: 'https://a/', proxy: true });
    const body = JSON.parse(calls[0].body);
    expect(body.solveCaptcha).toBe(true);
    expect(body.useProxy).toBe(true);
  });

  it('maps the free-tier paid-balance 403 to a typed error', async () => {
    const client = createSteelClient({ apiKey: 'k', solveCaptcha: true, fetchImpl: fakeFetch(() => ({ status: 403, body: { message: 'Launch requires at least $10 in paid balance to use CAPTCHA solving or Steel proxies.' } })) });
    await expect(client.createSession({ targetUrl: 'https://a/' })).rejects.toMatchObject({ code: 'paid_feature_required', status: 403 });
  });

  it('liveUrls returns the interactive debug URL as a single page', async () => {
    const client = createSteelClient({ apiKey: 'k', fetchImpl: fakeFetch((url) => (url.endsWith('/v1/sessions/sess_1') ? { body: { id: 'sess_1', url: 'https://example.com/', debugUrl: 'https://app.steel.dev/v1/sessions/sess_1/debug' } } : { body: {} })) });
    expect(await client.liveUrls('sess_1')).toEqual({ pages: [{ id: 'sess_1', url: 'https://example.com/', debuggerFullscreenUrl: 'https://app.steel.dev/v1/sessions/sess_1/debug?interactive=true' }] });
  });

  it('releaseSession posts to /release', async () => {
    const calls = [];
    const client = createSteelClient({ apiKey: 'k', fetchImpl: fakeFetch((url, init) => { calls.push({ url, method: init.method }); return { body: {} }; }) });
    await client.releaseSession('sess_1');
    expect(calls.find((c) => c.url.endsWith('/v1/sessions/sess_1/release') && c.method === 'POST')).toBeTruthy();
  });

  it('maps vendor failures to typed errors', async () => {
    const c1 = createSteelClient({ apiKey: 'k', fetchImpl: fakeFetch(() => ({ status: 503 })) });
    await expect(c1.createSession({ targetUrl: 'https://x/' })).rejects.toMatchObject({ code: 'vendor_unavailable' });
    const c2 = createSteelClient({ apiKey: 'k', fetchImpl: fakeFetch(() => ({ status: 400 })) });
    await expect(c2.createSession({ targetUrl: 'https://x/' })).rejects.toMatchObject({ code: 'vendor_rejected' });
  });

  it('refuses to build without a key', () => {
    expect(() => createSteelClient({ apiKey: '' })).toThrow(/not_configured/);
  });
});

describe('vendor selector', () => {
  it('picks steel when UNCRAFT_CHALLENGE_VENDOR=steel and the key is set', () => {
    const v = challengeVendorFromEnv({ UNCRAFT_CHALLENGE_VENDOR: 'steel', STEEL_API_KEY: 'k' });
    expect(v).toBeTruthy();
    expect(v.connectUrl('s1')).toBe('wss://connect.steel.dev?apiKey=k&sessionId=s1');
    expect(connectUrlForSession('s1', { UNCRAFT_CHALLENGE_VENDOR: 'steel', STEEL_API_KEY: 'k' })).toContain('connect.steel.dev');
  });
  it('defaults to browserbase', () => {
    const v = challengeVendorFromEnv({ BROWSERBASE_API_KEY: 'k', BROWSERBASE_PROJECT_ID: 'p' });
    expect(v.connectUrl('s1')).toContain('connect.browserbase.com');
  });
  it('returns null when the chosen vendor has no key', () => {
    expect(challengeVendorFromEnv({ UNCRAFT_CHALLENGE_VENDOR: 'steel' })).toBeNull();
    expect(challengeVendorFromEnv({})).toBeNull();
  });
});
