import { describe, expect, it, vi } from 'vitest';
import { createControlManifest } from '../../../../../../lib/motion-editor/control-manifest.js';
import { createMotionControlsGenerateHandler } from './route.js';

const BUNDLE_ID = '11111111-1111-4111-8111-111111111111';
const RUNTIME_FINGERPRINT = `sha256:${'a'.repeat(64)}`;
const PARAMS = { params: Promise.resolve({ id: 'node-1' }) };

function sqlFixture(row = {}) {
  const calls = [];
  const sql = vi.fn((strings) => {
    const text = strings.join('?');
    calls.push(text);
    if (/SELECT n\.id AS node_id/i.test(text)) return Promise.resolve([{
      node_id: 'node-1', board_id: 'board-1', snapshot_id: 'snapshot-1', bundle_id: BUNDLE_ID,
      runtime_fingerprint: RUNTIME_FINGERPRINT, content_hash: `sha256:${'b'.repeat(64)}`,
      reconstruction_capabilities: { detectedEngines: ['gsap'], candidateControls: [] },
      session_id: 'session-1', session_revision: 0,
      ...row,
    }]);
    if (/WITH updated_session/i.test(text)) return Promise.resolve([{ session_id: 'session-1', revision: 1, snapshot_id: 'snapshot-1' }]);
    return Promise.resolve([]);
  });
  sql.callsText = calls;
  return sql;
}

function request(body = {}, headers = {}) {
  return new Request('http://test/api/nodes/node-1/motion-controls/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'Idempotency-Key': 'clone-1', ...headers },
    body: JSON.stringify({
      sessionId: 'session-1', expectedRevision: 0,
      bundleId: BUNDLE_ID, runtimeFingerprint: RUNTIME_FINGERPRINT,
      evidence: { engines: ['gsap'] },
      ...body,
    }),
  });
}

function handlerFixture({ plan = 'pro', sql = sqlFixture(), generateFn = null } = {}) {
  const generated = generateFn || vi.fn(async () => ({
    manifest: createControlManifest({ bundleId: BUNDLE_ID, runtimeFingerprint: RUNTIME_FINGERPRINT, controls: [] }),
    provider: { provider: 'openai', model: 'gpt-5.6-terra', repaired: false, costUsd: 0.01, usage: [] },
    diagnostics: [{ code: 'no_effect', stage: 'effect' }],
  }));
  return {
    sql,
    generateFn: generated,
    handler: createMotionControlsGenerateHandler({
      requireUserFn: vi.fn(async () => ({ user: { id: 42, plan } })),
      dbFn: vi.fn(async () => sql),
      generateFn: generated,
      validationTransportFactory: vi.fn(() => vi.fn()),
    }),
  };
}

describe('POST internal motion-control generation boundary', () => {
  it.each(['free', 'trial', 'unknown', null])('fails closed before DB work for plan %s', async (plan) => {
    const fixture = handlerFixture({ plan });
    const response = await fixture.handler(request(), PARAMS);
    expect(response.status).toBe(403);
    expect(fixture.sql).not.toHaveBeenCalled();
    expect(fixture.generateFn).not.toHaveBeenCalled();
  });

  it('requires the parent conversion idempotency key', async () => {
    const fixture = handlerFixture();
    const response = await fixture.handler(request({}, { 'Idempotency-Key': '' }), PARAMS);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: 'idempotency_key_required' });
  });

  it('rejects a bundle or runtime mismatch before provider work', async () => {
    const fixture = handlerFixture();
    const response = await fixture.handler(request({ bundleId: '22222222-2222-4222-8222-222222222222' }), PARAMS);
    expect(response.status).toBe(409);
    expect(fixture.generateFn).not.toHaveBeenCalled();
  });

  it('persists and returns only the accepted manifest with sanitized provider metadata', async () => {
    const fixture = handlerFixture();
    const response = await fixture.handler(request({
      evidence: { engines: ['gsap'], cookies: 'secret', pageText: 'private' },
    }), PARAMS);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      manifest: { bundleId: BUNDLE_ID, runtimeFingerprint: RUNTIME_FINGERPRINT, controls: [] },
      provider: { provider: 'openai', model: 'gpt-5.6-terra', repaired: false },
      session: { id: 'session-1', revision: 1 },
    });
    expect(body).not.toHaveProperty('rawResponse');
    expect(JSON.stringify(body)).not.toMatch(/secret|private/);
    expect(fixture.sql.callsText.some((text) => /updated_session[\s\S]+updated_snapshot/i.test(text))).toBe(true);
    const diagnosticWrite = fixture.sql.mock.calls.find(([strings]) => (
      /INSERT INTO motion_diagnostic_events/i.test(strings.join('?'))
    ));
    expect(diagnosticWrite).toBeTruthy();
    expect(JSON.stringify(diagnosticWrite)).toMatch(/no_effect/);
    expect(JSON.stringify(diagnosticWrite)).not.toMatch(/secret|private/);
  });

  it('surfaces a stable error and no manifest when persistence fails after model success', async () => {
    const sql = sqlFixture();
    sql.mockImplementation((strings) => {
      const text = strings.join('?');
      if (/SELECT n\.id AS node_id/i.test(text)) return Promise.resolve([{
        node_id: 'node-1', snapshot_id: 'snapshot-1', bundle_id: BUNDLE_ID,
        runtime_fingerprint: RUNTIME_FINGERPRINT,
        reconstruction_capabilities: { detectedEngines: [], candidateControls: [] },
      }]);
      return Promise.resolve([]);
    });
    const fixture = handlerFixture({ sql });
    const response = await fixture.handler(request(), PARAMS);
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ error: 'generation_failed' });
  });
});
