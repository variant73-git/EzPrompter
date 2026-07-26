import { describe, expect, it, vi } from 'vitest';
import { applyNativeCommitSnapshot, createNativeEditApi } from './native-edit-api.js';
import { createEmptyMotionManifest } from './manifest.js';

const NODE_ID = '11111111-1111-4111-8111-111111111111';
const SNAPSHOT_ID = '22222222-2222-4222-8222-222222222222';
const SESSION_ID = '33333333-3333-4333-8333-333333333333';
const BUNDLE_ID = '44444444-4444-4444-8444-444444444444';
const NEXT_SNAPSHOT_ID = '55555555-5555-4555-8555-555555555555';
const FINGERPRINT = `sha256:${'a'.repeat(64)}`;

function manifest(transactions = []) {
  return {
    ...createEmptyMotionManifest({ baseBundleId: BUNDLE_ID, runtimeFingerprint: FINGERPRINT }),
    transactions,
  };
}

function transaction(id, value = '0.5') {
  return {
    id,
    requestId: `request-${id}`,
    source: 'properties',
    createdAt: '2026-07-26T10:00:00.000Z',
    patches: [{
      id: `patch-${id}`,
      elementId: 'hero',
      kind: 'style',
      property: 'opacity',
      before: '1',
      value,
      createdAt: '2026-07-26T10:00:00.000Z',
    }],
    repairs: [],
  };
}

function response(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function openedSession(overrides = {}) {
  return {
    session: {
      id: SESSION_ID,
      nodeId: NODE_ID,
      baseSnapshotId: SNAPSHOT_ID,
      baseBundleId: BUNDLE_ID,
      revision: 0,
      status: 'active',
      draftManifest: manifest(),
      ...overrides,
    },
  };
}

function scheduler() {
  const queued = [];
  return {
    queued,
    schedule: vi.fn((callback, delay) => {
      const token = { callback, delay, cancelled: false };
      queued.push(token);
      return token;
    }),
    clearSchedule: vi.fn((token) => { token.cancelled = true; }),
  };
}

describe('native edit API adapter', () => {
  it('updates canvas snapshot metadata without replacing node geometry', () => {
    const node = { id: NODE_ID, pos_x: 40, pos_y: 80, width: 1280, height: 800, _resetTick: 2 };
    expect(applyNativeCommitSnapshot(node, {
      snapshot: { id: NEXT_SNAPSHOT_ID, nativeBundleId: BUNDLE_ID, motionManifestVersion: 2 },
    })).toMatchObject({
      id: NODE_ID,
      pos_x: 40,
      pos_y: 80,
      width: 1280,
      height: 800,
      current_snapshot_id: NEXT_SNAPSHOT_ID,
      current_native_bundle_id: BUNDLE_ID,
      current_motion_manifest_version: 2,
      current_snapshot_source: 'native-edit',
      _resetTick: 3,
    });
  });

  it('opens or resumes the owned server draft and exposes its acknowledged transactions', async () => {
    const saved = transaction('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    const fetcher = vi.fn(async () => response(openedSession({
      revision: 4,
      draftManifest: manifest([{ ...saved, automaticRepairs: [] }]),
    })));
    const adapter = createNativeEditApi({ nodeId: NODE_ID, fetcher });

    const loaded = await adapter.load();

    expect(loaded.transactions).toHaveLength(1);
    expect(loaded.transactions[0].id).toBe(saved.id);
    expect(fetcher).toHaveBeenCalledWith(
      `/api/nodes/${NODE_ID}/motion-session`,
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    );
    expect(adapter.getState()).toMatchObject({ revision: 4, pending: false, status: 'idle' });
  });

  it('coalesces a burst to the latest manifest and advances revisions monotonically', async () => {
    const clock = scheduler();
    const first = transaction('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    const second = transaction('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '0.25');
    const fetcher = vi.fn(async (url, options) => {
      if (options.method === 'POST') return response(openedSession());
      const body = JSON.parse(options.body);
      expect(body.expectedRevision).toBe(0);
      expect(body.draftManifest.transactions.map((item) => item.id)).toEqual([first.id, second.id]);
      return response({ session: { ...openedSession().session, revision: 1, draftManifest: body.draftManifest } });
    });
    const adapter = createNativeEditApi({
      nodeId: NODE_ID,
      fetcher,
      schedule: clock.schedule,
      clearSchedule: clock.clearSchedule,
      debounceMs: 80,
    });
    await adapter.load();

    await adapter.save({ transactions: [first] });
    await adapter.save({ transactions: [first, second] });

    expect(clock.schedule).toHaveBeenCalledTimes(1);
    expect(clock.queued[0].delay).toBe(80);
    await adapter.flush();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(adapter.getState()).toMatchObject({ revision: 1, pending: false, status: 'saved' });
  });

  it('persists the responsive manifest beside acknowledged transactions', async () => {
    const saved = transaction('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    const responsiveManifest = {
      schemaVersion: 1,
      properties: {
        'hero:opacity': {
          mode: 'per-device',
          sharedValue: '1',
          overrides: { desktop: '0.6' },
          provenance: 'inferred',
          binding: { elementId: 'hero', kind: 'style', property: 'opacity' },
        },
      },
    };
    const fetcher = vi.fn(async (_url, options) => {
      if (options.method === 'POST') return response(openedSession());
      const body = JSON.parse(options.body);
      expect(body.draftManifest.responsiveManifest).toEqual(responsiveManifest);
      return response({ session: { ...openedSession().session, revision: 1, draftManifest: body.draftManifest } });
    });
    const adapter = createNativeEditApi({ nodeId: NODE_ID, fetcher });
    await adapter.load();

    await adapter.save({ transactions: [saved], responsiveManifest });
    await adapter.flush();

    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('serializes writes made during an in-flight autosave so stale responses cannot win', async () => {
    const first = transaction('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    const second = transaction('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '0.25');
    let resolveFirstWrite;
    const firstWrite = new Promise((resolve) => { resolveFirstWrite = resolve; });
    const patchBodies = [];
    const fetcher = vi.fn(async (_url, options) => {
      if (options.method === 'POST') return response(openedSession());
      const body = JSON.parse(options.body);
      patchBodies.push(body);
      if (patchBodies.length === 1) return firstWrite;
      return response({ session: { ...openedSession().session, revision: 2, draftManifest: body.draftManifest } });
    });
    const adapter = createNativeEditApi({ nodeId: NODE_ID, fetcher });
    await adapter.load();
    await adapter.save({ transactions: [first] });
    const flushing = adapter.flush();
    await Promise.resolve();
    await adapter.save({ transactions: [first, second] });
    resolveFirstWrite(response({
      session: { ...openedSession().session, revision: 1, draftManifest: manifest([{ ...first, automaticRepairs: [] }]) },
    }));
    await flushing;

    expect(patchBodies).toHaveLength(2);
    expect(patchBodies[0].expectedRevision).toBe(0);
    expect(patchBodies[1].expectedRevision).toBe(1);
    expect(patchBodies[1].draftManifest.transactions).toHaveLength(2);
    expect(adapter.getState()).toMatchObject({ revision: 2, pending: false });
  });

  it('keeps a failed local draft and schedules a bounded automatic retry', async () => {
    const clock = scheduler();
    const saved = transaction('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    let writeAttempts = 0;
    const fetcher = vi.fn(async (_url, options) => {
      if (options.method === 'POST') return response(openedSession());
      writeAttempts += 1;
      if (writeAttempts === 1) return response({ error: 'temporarily_unavailable' }, 503);
      const body = JSON.parse(options.body);
      return response({ session: { ...openedSession().session, revision: 1, draftManifest: body.draftManifest } });
    });
    const adapter = createNativeEditApi({
      nodeId: NODE_ID,
      fetcher,
      schedule: clock.schedule,
      clearSchedule: clock.clearSchedule,
      debounceMs: 20,
      retryBaseMs: 100,
      retryMaxMs: 400,
    });
    await adapter.load();
    await adapter.save({ transactions: [saved] });

    await expect(adapter.flush()).rejects.toMatchObject({ status: 503 });
    expect(adapter.getState()).toMatchObject({ pending: true, status: 'error', retryAttempt: 1 });
    expect(clock.queued.at(-1).delay).toBe(100);

    await clock.queued.at(-1).callback();
    expect(adapter.getState()).toMatchObject({ pending: false, status: 'saved', retryAttempt: 0, revision: 1 });
  });

  it('flushes the newest draft before commit and keeps the session active for Save version', async () => {
    const saved = transaction('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    const requests = [];
    const fetcher = vi.fn(async (url, options) => {
      requests.push({ url, body: options.body ? JSON.parse(options.body) : null });
      if (url.endsWith('/commit')) {
        return response({
          reason: 'save-version',
          snapshot: { id: NEXT_SNAPSHOT_ID, nativeBundleId: BUNDLE_ID, motionManifestVersion: 2 },
          session: { ...openedSession().session, baseSnapshotId: NEXT_SNAPSHOT_ID, revision: 2, status: 'active' },
        });
      }
      if (options.method === 'PATCH') {
        const body = JSON.parse(options.body);
        return response({ session: { ...openedSession().session, revision: 1, draftManifest: body.draftManifest } });
      }
      return response(openedSession());
    });
    const adapter = createNativeEditApi({ nodeId: NODE_ID, fetcher });
    await adapter.load();
    await adapter.save({ transactions: [saved] });

    const committed = await adapter.commit({ reason: 'save-version' });

    expect(requests.map((item) => item.url)).toEqual([
      `/api/nodes/${NODE_ID}/motion-session`,
      `/api/nodes/${NODE_ID}/motion-session`,
      `/api/nodes/${NODE_ID}/motion-session/commit`,
    ]);
    expect(requests.at(-1).body).toMatchObject({ sessionId: SESSION_ID, expectedRevision: 1, reason: 'save-version' });
    expect(committed.session.status).toBe('active');
    expect(adapter.getState()).toMatchObject({ revision: 2, baseSnapshotId: NEXT_SNAPSHOT_ID, closed: false });
  });

  it('discards without persisting the unsent local draft', async () => {
    const saved = transaction('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    const fetcher = vi.fn(async (url, options) => {
      if (url.endsWith('/discard')) return response({ session: { ...openedSession().session, status: 'discarded' } });
      return response(openedSession());
    });
    const adapter = createNativeEditApi({ nodeId: NODE_ID, fetcher });
    await adapter.load();
    await adapter.save({ transactions: [saved] });

    await adapter.discard();

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1][0]).toBe(`/api/nodes/${NODE_ID}/motion-session/discard`);
    expect(adapter.getState()).toMatchObject({ closed: true, pending: false, status: 'idle' });
  });
});
