import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../canvas-api.js';

const ok = (body) => Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }));

describe('chamadas da cópia editável no cliente', () => {
  beforeEach(() => { vi.stubGlobal('fetch', vi.fn(() => ok({ job: { id: 'j1', status: 'queued' } }))); });
  afterEach(() => vi.unstubAllGlobals());

  it('iniciar leva a etiqueta de idempotência para a rota do node', async () => {
    const out = await api.startCanonicalJob('n1');
    expect(out.job.id).toBe('j1');
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('/api/nodes/n1/canonical-job');
    expect(init.method).toBe('POST');
    const headers = new Headers(init.headers);
    expect(headers.get('idempotency-key')).toBeTruthy();
  });

  it('avançar é um POST para a tarefa', async () => {
    await api.advanceCanonicalJob('j1');
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('/api/canonical-jobs/j1/advance');
    expect(init.method).toBe('POST');
  });

  it('erro da rota vira exceção com o código', async () => {
    fetch.mockImplementationOnce(() => Promise.resolve(new Response(JSON.stringify({ error: 'canonical_not_applicable' }), { status: 409, headers: { 'content-type': 'application/json' } })));
    await expect(api.startCanonicalJob('n2')).rejects.toMatchObject({ code: 'canonical_not_applicable' });
  });
});
