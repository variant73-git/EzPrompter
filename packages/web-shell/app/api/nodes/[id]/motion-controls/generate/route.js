import { NextResponse } from 'next/server';
import { requireUser } from '../../../../../../lib/auth.js';
import { canUseCloneEdit } from '../../../../../../lib/clone-edit-access.js';
import { db } from '../../../../../../lib/db.js';
import { recordUsage } from '../../../../../../lib/billing/context.js';
import {
  ControlGenerationError,
  createRemoteControlValidationTransport,
  generateControlsForReconstruction,
} from '../../../../../../lib/motion-editor/control-generation.js';
import { parseControlManifest } from '../../../../../../lib/motion-editor/control-manifest.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

const MAX_REQUEST_BYTES = 64 * 1024;
const ROUTE_DEADLINE_MS = 90_000;

function noStore(body, init = {}) {
  const headers = new Headers(init.headers);
  headers.set('Cache-Control', 'no-store');
  return NextResponse.json(body, { ...init, headers });
}

async function strictBody(request) {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_REQUEST_BYTES) return null;
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_REQUEST_BYTES) return null;
  try {
    const body = JSON.parse(raw || '{}');
    return body && typeof body === 'object' && !Array.isArray(body) ? body : null;
  } catch {
    return null;
  }
}

function sanitizedProvider(provider) {
  if (!provider) return null;
  return {
    provider: provider.provider,
    model: provider.model,
    repaired: provider.repaired === true,
    costUsd: Number(provider.costUsd || 0),
    usage: (provider.usage || []).map((usage) => ({
      inputTokens: Number(usage.inputTokens || 0),
      outputTokens: Number(usage.outputTokens || 0),
      cachedInputTokens: Number(usage.cachedInputTokens || 0),
      cacheWriteTokens: Number(usage.cacheWriteTokens || 0),
      costUsd: Number(usage.costUsd || 0),
    })),
  };
}

function generationError(error) {
  const code = error?.code || 'generation_failed';
  if (code === 'provider_timeout' || code === 'control_generation_timeout') {
    return noStore({ error: 'generation_timeout' }, { status: 504 });
  }
  if (code === 'provider_cost_ceiling') return noStore({ error: code }, { status: 422 });
  if (code === 'zdr_required') return noStore({ error: code }, { status: 409 });
  if (['provider_unavailable', 'validator_unavailable'].includes(code)) {
    return noStore({ error: 'temporarily_unavailable' }, { status: 503 });
  }
  if (error instanceof TypeError || code === 'structured_output_invalid') {
    return noStore({ error: 'invalid_generation_result' }, { status: 422 });
  }
  return noStore({ error: 'generation_failed' }, { status: 502 });
}

function defaultValidationTransport() {
  return createRemoteControlValidationTransport({
    url: process.env.UNCRAFT_MOTION_CONTROL_VALIDATOR_URL,
    secret: process.env.UNCRAFT_MOTION_CONTROL_VALIDATOR_SECRET,
  });
}

export function createMotionControlsGenerateHandler({
  requireUserFn = requireUser,
  canUseCloneEditFn = canUseCloneEdit,
  dbFn = db,
  generateFn = generateControlsForReconstruction,
  validationTransportFactory = defaultValidationTransport,
} = {}) {
  return async function motionControlsGenerate(request, { params }) {
    const { user, error } = await requireUserFn(request);
    if (error) return error;
    if (!canUseCloneEditFn(user?.plan)) {
      return noStore({ error: 'paid_plan_required', feature: 'clone_edit' }, { status: 403 });
    }
    const idemKey = request.headers.get('idempotency-key');
    if (typeof idemKey !== 'string' || !idemKey.trim()) {
      return noStore({ error: 'idempotency_key_required' }, { status: 400 });
    }
    const body = await strictBody(request);
    if (!body
      || typeof body.sessionId !== 'string'
      || typeof body.bundleId !== 'string'
      || typeof body.runtimeFingerprint !== 'string'
      || !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0
      || (body.idempotencyKey != null && body.idempotencyKey !== idemKey)) {
      return noStore({ error: 'invalid_request' }, { status: 400 });
    }

    const { id } = await params;
    let sql;
    let row;
    try {
      sql = await dbFn();
      [row] = await sql`
        SELECT n.id AS node_id, n.current_snapshot_id AS snapshot_id,
               s.native_bundle_id::text AS bundle_id, nb.runtime_fingerprint,
               nb.reconstruction_capabilities, s.motion_manifest,
               e.id AS session_id, e.revision AS session_revision
          FROM nodes n
          JOIN boards b ON b.id = n.board_id
          JOIN snapshots s ON s.id = n.current_snapshot_id AND s.node_id = n.id
          JOIN native_bundles nb ON nb.bundle_id = s.native_bundle_id
          JOIN native_motion_edit_sessions e
            ON e.node_id = n.id AND e.base_snapshot_id = s.id AND e.status = 'active'
         WHERE n.id = ${id}
           AND b.user_id = ${user.id}
           AND e.user_id = ${user.id}
           AND e.id = ${body.sessionId}
           AND e.revision = ${body.expectedRevision}
           AND EXISTS (
             SELECT 1 FROM operations o
              WHERE o.user_id = ${user.id}
                AND o.idem_key = ${idemKey.trim()}
                AND o.op = 'clone.edit'
                AND o.status = 'in_flight'
           )
      `;
    } catch {
      return noStore({ error: 'temporarily_unavailable' }, { status: 503 });
    }
    if (!row) return noStore({ error: 'not_found' }, { status: 404 });
    if (row.bundle_id !== body.bundleId || row.runtime_fingerprint !== body.runtimeFingerprint) {
      return noStore({ error: 'runtime_mismatch' }, { status: 409 });
    }

    const deadline = new AbortController();
    const deadlineError = Object.assign(new Error('control_generation_timeout'), { code: 'control_generation_timeout' });
    const aborted = new Promise((_, reject) => deadline.signal.addEventListener('abort', () => reject(deadline.signal.reason), { once: true }));
    const timer = setTimeout(() => deadline.abort(deadlineError), ROUTE_DEADLINE_MS);
    try {
      const descriptor = {
        bundleId: row.bundle_id,
        runtimeFingerprint: row.runtime_fingerprint,
        reconstructionCapabilities: typeof row.reconstruction_capabilities === 'string'
          ? JSON.parse(row.reconstruction_capabilities)
          : row.reconstruction_capabilities,
      };
      const generated = await Promise.race([generateFn({
        descriptor,
        reconstructionOutput: {
          motionEvidence: body.evidence || {},
          privateCapture: body.privateCapture === true,
          authenticatedCapture: body.authenticatedCapture === true,
        },
        validationTransport: validationTransportFactory({ row, body, signal: deadline.signal }),
        signal: deadline.signal,
        onUsage: (usage) => recordUsage({
          provider: usage.provider,
          model: usage.model,
          tokensIn: usage.inputTokens,
          tokensOut: usage.outputTokens,
          cachedIn: usage.cachedInputTokens,
          cacheWrite: usage.cacheWriteTokens,
          meta: { stage: 'motion-control-generation' },
        }),
      }), aborted]);
      const manifest = parseControlManifest(generated.manifest, {
        expectedBundleId: row.bundle_id,
        expectedRuntimeFingerprint: row.runtime_fingerprint,
      });
      const persistence = await sql`
        WITH updated_session AS (
          UPDATE native_motion_edit_sessions
             SET draft_manifest = jsonb_set(draft_manifest, '{controlManifest}', ${JSON.stringify(manifest)}::jsonb, true),
                 revision = revision + 1,
                 updated_at = now()
           WHERE id = ${body.sessionId}
             AND node_id = ${id}
             AND user_id = ${user.id}
             AND status = 'active'
             AND revision = ${body.expectedRevision}
          RETURNING id, revision
        ), updated_snapshot AS (
          UPDATE snapshots
             SET motion_manifest = jsonb_set(motion_manifest, '{controlManifest}', ${JSON.stringify(manifest)}::jsonb, true)
           WHERE id = ${row.snapshot_id}
             AND node_id = ${id}
             AND native_bundle_id::text = ${row.bundle_id}
             AND EXISTS (SELECT 1 FROM updated_session)
          RETURNING id
        )
        SELECT updated_session.id AS session_id, updated_session.revision,
               updated_snapshot.id AS snapshot_id
          FROM updated_session CROSS JOIN updated_snapshot
      `;
      if (!persistence[0]?.snapshot_id) throw new ControlGenerationError('persistence_failed');
      return noStore({
        ok: true,
        manifest,
        provider: sanitizedProvider(generated.provider),
        diagnostics: generated.diagnostics || [],
        session: { id: persistence[0].session_id, revision: Number(persistence[0].revision) },
      });
    } catch (routeError) {
      return generationError(routeError);
    } finally {
      clearTimeout(timer);
    }
  };
}

export const POST = createMotionControlsGenerateHandler();
