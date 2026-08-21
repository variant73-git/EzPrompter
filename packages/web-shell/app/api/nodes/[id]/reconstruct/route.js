import { NextResponse } from 'next/server';
import { harnessFromCookieHeader } from '../../../../../lib/harness.js';
import { db } from '../../../../../lib/db.js';
import { requireUser } from '../../../../../lib/auth.js';
import { InsufficientCreditsError, OperationInProgressError } from '../../../../../lib/billing/context.js';
import { checkOpsRate } from '../../../../../lib/billing/rate-limit.js';
import { CLONE_ENGINES } from '../../../../../lib/clone-router.js';
import { reconstructSiteNode } from '../../../../../lib/deferred-reconstruction.js';
import { shouldReconstructForAction } from '../../../../../lib/reconstruction-policy.js';
import { canUseCloneEdit } from '../../../../../lib/clone-edit-access.js';

export const runtime = 'nodejs';
export const maxDuration = 300;

// POST /api/nodes/:id/reconstruct
// Deferred, billed upgrade of an animated free capture. The client calls this
// when the user enters edit mode. Workflow execution uses the same service
// server-side when an editable runtime is a strict dependency.
export async function POST(request, { params }) {
  const { user, error } = await requireUser(request);
  if (error) return error;
  if (!canUseCloneEdit(user?.plan)) {
    return NextResponse.json(
      { error: 'paid_plan_required', feature: 'clone_edit' },
      { status: 403 },
    );
  }

  // The client (canvas-api.reconstructNode) sends an Idempotency-Key; read it so a
  // retry of a lost-response reconstruction dedups instead of charging twice
  // (Sol audit #2 — this route was silently dropping the ticket).
  const idemKey = request.headers.get('idempotency-key');
  if (typeof idemKey !== 'string' || !idemKey.trim()) {
    return NextResponse.json({ error: 'idempotency_key_required' }, { status: 400 });
  }
  const { id } = await params;
  const sql = await db();

  const [node] = await sql`
    SELECT n.id, n.kind, n.meta, n.board_id, n.origin_url,
           n.current_snapshot_id, s.html AS current_html,
           s.source AS current_snapshot_source
      FROM nodes n
      JOIN boards b ON b.id = n.board_id
      LEFT JOIN snapshots s ON s.id = n.current_snapshot_id
     WHERE n.id = ${id} AND b.user_id = ${user.id}
  `;
  if (!node) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!node.origin_url) {
    return NextResponse.json({ error: 'no_origin_url', detail: 'node has no source URL to reconstruct from' }, { status: 400 });
  }

  // Motor por NOME (doutrina em lib/clone-router.js): "clone" e' o animado;
  // `{"engine":"iter9"}` no corpo pede o estatico historico nominalmente.
  // Nome desconhecido e' 400 barulhento — nunca um default silencioso.
  let engine = null;
  try {
    const corpo = await request.json().catch(() => ({}));
    if (corpo?.engine != null) {
      if (!CLONE_ENGINES.includes(corpo.engine)) {
        return NextResponse.json({ error: 'unknown_clone_engine', engines: CLONE_ENGINES }, { status: 400 });
      }
      engine = corpo.engine;
    }
  } catch (_) { /* corpo vazio = default da doutrina */ }

  // ⚠️ O pulo de "ja esta pronto" so vale para o pedido SEM motor: um motor
  // pedido POR NOME tem que executar mesmo que exista snapshot utilizavel —
  // e' justamente o caso "converter este clone para iter9" (achado da
  // auditoria: o early-return engolia o pedido nominal e o 400 prometido).
  if (engine == null && !shouldReconstructForAction({ node, role: 'edit' })) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      node: { id: node.id },
      snapshotId: node.current_snapshot_id,
      snapshotSource: node.current_snapshot_source,
      html: node.current_html,
      meta: node.meta,
      credits: 0,
    });
  }

  const rate = await checkOpsRate({ sql, userId: user.id });
  if (!rate.allowed) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  try {
    const result = await reconstructSiteNode({
      sql,
      userId: user.id,
      node,
      reason: 'edit',
      engine,
      harness: harnessFromCookieHeader(request.headers.get('cookie')),
      idemKey: idemKey.trim(),
      op: 'clone.edit',
    });
    const snapshotSource = result.kind === 'native' ? 'native-bundle' : 'reconstruct';
    return NextResponse.json({ ...result, snapshotSource, node: { id: node.id } });
  } catch (e) {
    if (e instanceof InsufficientCreditsError) {
      return NextResponse.json({ error: 'insufficient_credits', estimate: e.estimate, balance: e.balance }, { status: 402 });
    }
    if (e instanceof OperationInProgressError) {
      return NextResponse.json({ error: 'in_progress' }, { status: 409 });
    }
    if (e?.code === 'no_output') return NextResponse.json({ error: 'no_output' }, { status: 502 });
    if (['control_conversion_timeout', 'provider_timeout'].includes(e?.code)) {
      return NextResponse.json({ error: 'conversion_timeout' }, { status: 504 });
    }
    if (['provider_unavailable', 'validator_unavailable'].includes(e?.code)) {
      return NextResponse.json({ error: 'conversion_temporarily_unavailable' }, { status: 503 });
    }
    if (e?.code === 'reconstruction_snapshot_changed') {
      return NextResponse.json({ error: 'snapshot_changed' }, { status: 409 });
    }
    if (['provider_cost_ceiling', 'structured_output_invalid', 'invalid_control_manifest'].includes(e?.code)) {
      return NextResponse.json({ error: 'control_generation_failed' }, { status: 502 });
    }
    console.error('reconstruct error', e);
    return NextResponse.json({ error: 'reconstruct_failed' }, { status: 502 });
  }
}
