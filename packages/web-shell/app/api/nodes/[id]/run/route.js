import { NextResponse } from 'next/server';
import { db } from '../../../../../lib/db.js';
import { requireUser } from '../../../../../lib/auth.js';
import { runCompose } from '../../../../../lib/run-flow.js';
import { BLANK_SITE_HTML } from '../../../../../lib/blank-site-html.js';
import { runBilledOperation, InsufficientCreditsError, OperationInProgressError } from '../../../../../lib/billing/context.js';
import { checkOpsRate } from '../../../../../lib/billing/rate-limit.js';
import { reconstructSiteNode } from '../../../../../lib/deferred-reconstruction.js';
import { reconstructionReason } from '../../../../../lib/reconstruction-policy.js';
import { assertRunPreconditions, STALE_CLONE_DOCUMENT, MISSING_CLONE_DOCUMENT } from '../../../../../lib/clone-document-freshness.js';

export const runtime = 'nodejs';
export const maxDuration = 300;

// POST /api/nodes/:id/run
// Smart-compose all incoming edges of a target node into a new snapshot.
// Replaces the per-edge /apply route for the run-flow trigger (the
// PromptDock arrow button). One LLM call per target, all sources fed in.
export async function POST(request, { params }) {
  const { user, error } = await requireUser(request);
  if (error) return error;

  const { id } = await params;
  const sql = await db();
  const body = await request.json().catch(() => ({}));
  const { modelId } = body || {};
  // Idempotency ticket (money-safety; spec 2026-07-24). The compose op keys on it
  // directly; each reconstruction sub-op derives a scoped key so a route retry
  // dedups BOTH the compose and any reconstructions instead of re-billing.
  const idemKey = request.headers.get('idempotency-key') || null;

  const [target] = await sql`
    SELECT n.id, n.kind, n.meta, n.board_id, n.origin_url,
           s.html AS current_html,
           s.design_md AS current_design_md,
           s.source AS current_snapshot_source,
           s.native_bundle_id, s.motion_manifest,
           n.current_snapshot_id, n.edit_revision
      FROM nodes n
      JOIN boards b ON b.id = n.board_id
      LEFT JOIN snapshots s ON s.id = n.current_snapshot_id
     WHERE n.id = ${id} AND b.user_id = ${user.id}
  `;
  if (!target) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  // ⭐ Um clone animado tem DUAS autoridades: o bundle (runtime, editado por
  // patches) e o html (documento, que o grafo consome). O documento é de antes
  // das edições de movimento. Compor a partir dele produziria um resultado do
  // estado PRÉ-EDIÇÃO e sobrescreveria o node — o trabalho do usuário sumiria
  // sem uma palavra (achado do Sol). Recusa TIPADA, nunca composição errada.


  // Empty site targets (unpopulated .html node from the Connect-to flow)
  // run as blank compositions — same base the "Add blank website" node
  // uses, so the LLM builds the page from the connected sources instead
  // of the route failing on a missing snapshot.
  if (!target.current_html && target.kind === 'site') {
    target.current_html = BLANK_SITE_HTML;
  }

  const sources = await sql`
    SELECT e.id        AS edge_id,
           e.payload   AS edge_payload,
           n.id        AS id,
           n.id        AS source_node_id,
           n.kind      AS kind,
           n.meta      AS meta,
           n.board_id  AS board_id,
           n.origin_url AS origin_url,
           s.html      AS source_html,
           s.design_md AS source_design_md,
           s.source    AS current_snapshot_source,
           s.native_bundle_id, s.motion_manifest
      FROM edges e
      JOIN nodes n ON n.id = e.source_node_id
      LEFT JOIN snapshots s ON s.id = n.current_snapshot_id
     WHERE e.target_node_id = ${id}
  `;
  // ⭐ PORTÃO ÚNICO de operação estrutural, para o ALVO e para toda FONTE que
  // carregue bundle. Um clone animado tem duas autoridades — o runtime, editado
  // por patches, e o documento, que o grafo consome — e o documento é de antes
  // das edições. Rodar aqui reconstruiria a página do estado PRÉ-EDIÇÃO e
  // sobrescreveria o node: o trabalho sumiria sem uma palavra.
  //
  // A contagem do snapshot não basta: o autosave grava no rascunho da SESSÃO
  // sem tocar nele, então quem está editando agora passaria como "em dia"
  // (achado do Sol). O portão pergunta ao banco.
  try {
    await assertRunPreconditions({
      sql,
      nodes: [
        // O alvo traz o documento em `current_html` (a fonte, em `source_html`) —
        // normalizar aqui evita o portão recusar por um nome de campo.
        { ...target, html: target.current_html, papel: 'target' },
        ...sources.map((s2) => ({ ...s2, html: s2.source_html, papel: 'source' })),
      ],
    });
  } catch (e) {
    if (e?.code === STALE_CLONE_DOCUMENT || e?.code === MISSING_CLONE_DOCUMENT) {
      return NextResponse.json({ error: e.code, detail: e.message, edits: e.edits, role: e.role }, { status: 409 });
    }
    throw e;
  }

  if (sources.length === 0) {
    return NextResponse.json(
      { error: 'no_inputs', detail: 'Target has no incoming edges. Connect a source node and try again.' },
      { status: 400 }
    );
  }

  const rate = await checkOpsRate({ sql, userId: user.id });
  if (!rate.allowed) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  try {
    // Upgrade only the animated captures whose role in THIS action needs an
    // editable runtime. Visual/style/content references continue using the
    // free capture. Reconstructed nodes are returned so the canvas can update
    // them immediately without a reload.
    const reconstructionQueue = [];
    const queuedNodeIds = new Set();
    const enqueueReconstruction = (item) => {
      if (!item?.node?.id || queuedNodeIds.has(item.node.id)) return;
      queuedNodeIds.add(item.node.id);
      reconstructionQueue.push(item);
    };
    const targetReason = reconstructionReason({ node: target, role: 'target' });
    if (targetReason) enqueueReconstruction({ node: target, reason: targetReason, target });
    for (const source of sources) {
      const reason = reconstructionReason({ node: source, role: 'source', edgePayload: source.edge_payload });
      if (reason) enqueueReconstruction({ node: source, reason, source });
    }

    const reconstructions = [];
    let reconstructionCredits = 0;
    for (const item of reconstructionQueue) {
      const reconstructed = await reconstructSiteNode({
        sql,
        userId: user.id,
        node: item.node,
        reason: item.reason,
        idemKey: idemKey ? `${idemKey}:reconstruct:${item.node.id}` : null,
      });
      reconstructionCredits += Number(reconstructed.credits || 0);
      reconstructions.push({
        kind: reconstructed.kind || 'iter9',
        nodeId: reconstructed.nodeId,
        snapshotId: reconstructed.snapshotId,
        html: reconstructed.html,
        snapshotSource: reconstructed.kind === 'native' ? 'native-bundle' : 'reconstruct',
        bundleDescriptor: reconstructed.bundleDescriptor,
        motionManifest: reconstructed.motionManifest,
        meta: reconstructed.meta,
        reason: item.reason,
        credits: reconstructed.credits,
      });
      if (item.target) {
        target.current_html = reconstructed.html;
        target.current_snapshot_source = reconstructed.kind === 'native' ? 'native-bundle' : 'reconstruct';
        target.meta = { ...(target.meta || {}), ...(reconstructed.meta || {}) };
      }
      if (item.source) {
        for (const source of sources) {
          if (source.id !== reconstructed.nodeId) continue;
          source.source_html = reconstructed.html;
          source.current_snapshot_source = reconstructed.kind === 'native' ? 'native-bundle' : 'reconstruct';
          source.meta = { ...(source.meta || {}), ...(reconstructed.meta || {}) };
        }
      }
    }

    const { result, credits, balanceAfter } = await runBilledOperation(
      { sql, userId: user.id, op: 'compose', boardId: target.board_id, nodeId: target.id, idemKey },
      async () => {
        const composed = await runCompose({ target, sources, modelId });
        if (!composed?.html) {
          const err = new Error('no_output');
          err.code = 'no_output';
          throw err;
        }
        const transplantMeta = {
          lastTransplant: composed.transplant || { engine: 'demarcelizer-4' },
          ...(composed.transplant?.motionPreserved ? { animatedRuntime: true } : {}),
        };
        // ⭐ COMMIT ATÔMICO. O portão foi verificado antes de uma operação que
        // dura até 300s, e reverificar num comando à parte não fecha nada: uma
        // sessão pode abrir entre a verificação e a escrita, e abrir sessão não
        // muda `current_snapshot_id` (achado do Sol).
        //
        // Então as duas condições entram no MESMO comando que grava: o node
        // ainda no snapshot que o portão examinou, E nenhuma sessão aberta com
        // edição de movimento. Falhando qualquer uma, `permitido` fica vazia e
        // NADA é escrito — nem o snapshot, nem o ponteiro.
        //
        // ⚠️ Precisão que eu tinha exagerado (Sol): CTE modificadora no
        // Postgres não se desfaz sozinha. Se `inserido` gravar e `apontado`
        // devolver zero linhas, o snapshot FICA, órfão. Aqui isso exige o node
        // sumir no meio do comando — e o resultado é uma linha de histórico sem
        // ponteiro, não perda de trabalho. É a única sobra, e é essa.
        const [snap] = await sql`
          WITH permitido AS (
            SELECT n.id
              FROM nodes n
             WHERE n.id = ${id}
               AND n.current_snapshot_id IS NOT DISTINCT FROM ${target.current_snapshot_id || null}
               -- Condicao na linha TRAVADA: re-avaliada apos o lock, ao
               -- contrario da checagem de sessao abaixo, que olha outra tabela
               -- sob o snapshot anterior ao lock (Sol).
               AND n.edit_revision IS NOT DISTINCT FROM ${Number(target.edit_revision) || 0}
               AND NOT EXISTS (
                 SELECT 1 FROM native_motion_edit_sessions e
                  WHERE e.node_id = n.id AND e.status = 'active'
                    AND jsonb_array_length(COALESCE(e.draft_manifest->'transactions', '[]'::jsonb)) > 0
               )
               FOR UPDATE OF n
          ), inserido AS (
            INSERT INTO snapshots (node_id, html, source, parent_snapshot_id)
            SELECT ${id}, ${composed.html}, 'demarcelizer-4', ${target.current_snapshot_id || null}
              FROM permitido
            RETURNING id
          ), apontado AS (
            UPDATE nodes
               SET current_snapshot_id = inserido.id,
                   meta = meta || ${JSON.stringify(transplantMeta)}::jsonb
              FROM inserido
             WHERE nodes.id = ${id}
            RETURNING inserido.id
          )
          SELECT id FROM apontado
        `;
        if (!snap) {
          const mudou = new Error('The node changed while this run was in flight — nothing was overwritten.');
          mudou.code = 'snapshot_changed';
          throw mudou;
        }
        
        // Mark all incoming edges as applied so the UI can paint them
        // differently after a successful run.
        await sql`
          UPDATE edges
             SET status = 'applied', applied_at = NOW(), last_error = NULL
           WHERE target_node_id = ${id}
        `;
        return { ok: true, snapshotId: snap.id, html: composed.html, transplant: composed.transplant };
      },
    );
    return NextResponse.json({
      ...result,
      credits: Number(credits || 0) + reconstructionCredits,
      balanceAfter,
      reconstructions,
    });
  } catch (e) {
    if (e instanceof InsufficientCreditsError) {
      return NextResponse.json({ error: 'insufficient_credits', estimate: e.estimate, balance: e.balance }, { status: 402 });
    }
    if (e instanceof OperationInProgressError) {
      return NextResponse.json({ error: 'in_progress' }, { status: 409 });
    }
    // Mesmo contrato do /reconstruct: interstitial de bot-protection é 409
    // tipado, nunca `run_failed` com a mensagem crua (Claude review r1 #6).
    if (e?.code === 'challenge_required') {
      return NextResponse.json({ error: 'challenge_required', kind: e.kind || 'generic_challenge', url: e.url || null }, { status: 409 });
    }
    if (e?.code === 'no_output') return NextResponse.json({ error: 'no_output' }, { status: 502 });
    // A recusa do portão é resposta de PRODUTO, não falha: 409 com o motivo, e
    // as arestas NÃO são marcadas como falhas — nada foi tentado contra elas.
    if ([STALE_CLONE_DOCUMENT, MISSING_CLONE_DOCUMENT, 'snapshot_changed'].includes(e?.code)) {
      return NextResponse.json({ error: e.code, detail: e.message, edits: e.edits, role: e.role }, { status: 409 });
    }
    const msg = String(e?.message || e);
    console.error('run-flow error', msg);
    await sql`
      UPDATE edges
         SET status = 'failed', last_error = ${msg}
       WHERE target_node_id = ${id}
    `;
    return NextResponse.json({ error: 'run_failed', detail: msg }, { status: 502 });
  }
}
