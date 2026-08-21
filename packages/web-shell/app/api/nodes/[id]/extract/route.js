import { NextResponse } from 'next/server';
import { harnessFromCookieHeader } from '../../../../../lib/harness.js';
import { db } from '../../../../../lib/db.js';
import { requireUser } from '../../../../../lib/auth.js';
import { runExtract } from '../../../../../lib/extract.js';
import { placeStackDown, resolvePlacement } from '../../../../../lib/canvas-layout.js';
import { runBilledOperation, InsufficientCreditsError, OperationInProgressError } from '../../../../../lib/billing/context.js';
import { checkOpsRate } from '../../../../../lib/billing/rate-limit.js';
import { withDeadline } from '../../../../../lib/llm-deadline.js';

export const runtime = 'nodejs';
// Bound the WHOLE extract server-side, BELOW the client's fetch timeout
// (canvas-api.js EXTRACT_TIMEOUT_MS = 200s). The per-call seam deadline (150s)
// does NOT bound a multi-call target: clone/styleclone run two sequential LLM
// calls, so total time can exceed a naive client timeout while each call stays
// under 150s. The client then aborts, but the route keeps running, charges, and
// persists a node → double charge + duplicate on retry. This deadline is
// measured ABSOLUTELY from handler entry (auth/lookup/hold pre-work counts
// against it) and trips INSIDE runBilledOperation, which refunds the hold and
// rethrows — so no node is created and the client gets a clean, refunded error
// first. Clamped [1s, 170s] so a mis-set env can never invert the ordering, and
// so client(200s) − route(≤170s) leaves ~30s for billing settle + persistence
// (which run AFTER the deadline) before the client would abort. Raise this and
// the client EXTRACT_TIMEOUT_MS together if needed.
// ⚠️ MITIGACAO EXPERIMENTAL, NAO CAUSA CORRIGIDA (a auditoria foi explicita, e
// tem razao). O que esta MEDIDO: a chamada de visao sozinha levou 80,7s numa
// pagina simples, e o incidente real bateu 148,5s no total. O que NAO esta
// medido: o recorte, o acerto de cobranca, a persistencia, a distribuicao entre
// screenshots, e quanto o caso que falhou precisaria para terminar. Logo, 240s
// e' outro teto por extrapolacao — melhor que 150s, mas nao demonstrado.
// O `[extract.clone]` em lib/extract.js agora registra visao e recorte separados:
// a proxima falha traz o dado que falta para dimensionar por percentil, e ai' sim
// isto vira correcao.
//
// POR QUE O CLONE FALHAVA. MEDIDO 2026-08-14: um clone a partir de screenshot
// bateu em 148,5s e foi abortado a 1,5s do teto. A causa nao era travamento —
// era o ORCAMENTO. Probe isolando as etapas: a chamada de VISAO sozinha levou
// **80,7s** para uma pagina SIMPLES (saida de 6 KB). A duracao cresce com o
// tamanho do HTML que ela escreve, e o teto de saida e' 16k tokens; um
// screenshot denso escreve varias vezes mais. Somado ao recorte dos pixels
// reais, 150s ficava abaixo do caso comum, nao acima.
//
// Os TRES tetos sobem JUNTOS, que e' o que o desenho exige — subir so um
// inverte a ordem e devolve o estado incerto que o prazo existe para evitar:
//   rota 240s  +  ~30s de acerto/persistencia  =  270s
//   cliente 290s  (corta DEPOIS disso)
//   maxDuration 300s  (o mesmo que /run e /reconstruct ja usam)
// O clamp acompanha o padrao para que uma variavel de ambiente nao possa,
// sozinha, reintroduzir a inversao.
const EXTRACT_ROUTE_DEADLINE_MS = Math.min(240_000, Math.max(1_000,
  Number(process.env.UNCRAFT_EXTRACT_ROUTE_DEADLINE_MS) || 240_000));
export const maxDuration = 300;

// POST /api/nodes/[id]/extract { to }
// Creates a NEW node derived from node [id]. Mirrors extractDesign's persist
// shape: insert node + snapshot + a 'generic' edge from source → new node.
export async function POST(request, { params }) {
  const startedAt = Date.now();
  const { user, error } = await requireUser(request);
  if (error) return error;

  const { id } = await params;
  const sql = await db();
  const body = await request.json().catch(() => ({}));
  const to = body?.to;
  if (!to) return NextResponse.json({ error: 'to required' }, { status: 400 });
  // Requested drop position (world coords from where the user released the
  // cord). When present, the derived node lands THERE (collision-avoided)
  // instead of being stacked at the bottom of the board — so it stays put
  // where the user asked, matching its loading placeholder.
  const reqX = Number.isFinite(body?.posX) ? Math.round(body.posX) : null;
  const reqY = Number.isFinite(body?.posY) ? Math.round(body.posY) : null;
  // Idempotency ticket from the client (money-safety; spec 2026-07-24). With it,
  // a retry of the SAME extract replays the stored node instead of billing +
  // creating a second one.
  const idemKey = request.headers.get('idempotency-key') || null;

  const rows = await sql`
    SELECT n.id, n.board_id, n.kind, n.meta, s.html, s.design_md
      FROM nodes n
      LEFT JOIN snapshots s ON s.id = n.current_snapshot_id
      JOIN boards b ON b.id = n.board_id
     WHERE n.id = ${id} AND b.user_id = ${user.id}
  `;
  if (!rows.length) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const src = rows[0];

  const rate = await checkOpsRate({ sql, userId: user.id });
  if (!rate.allowed) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  const DIMS = { designmd: { width: 600, height: 600 }, asset: { width: 600, height: 600 }, prompt: { width: 600, height: 200 }, site: { width: 1280, height: 720 } };

  const harness = harnessFromCookieHeader(request.headers.get('cookie'));
  let billed;
  try {
    billed = await runBilledOperation(
      { sql, userId: user.id, op: `extract.${to}`, boardId: src.board_id, nodeId: src.id, idemKey },
      // The whole side-effecting unit — extract + node/snapshot/edge creation —
      // lives INSIDE the billed op so a dedup hit replays the stored response
      // (the created node) and never bills or creates a second one.
      async () => {
        const out = await withDeadline(
          // Thread the deadline's signal so a mid-run abort stops LAUNCHING
          // further paid stages (styleclone's 2nd LLM call, image cropping).
          (signal) => runExtract({ to, node: { id: src.id, kind: src.kind, html: src.html, meta: src.meta }, signal,
            ...((to === 'clone' || to === 'styleclone') ? { model: harness.cloneVision } : {}) }),
          // Absolute budget from handler entry — pre-work (auth, lookup, hold)
          // counts against it. Floor 0 (not 1s) so if pre-work already consumed
          // the deadline the race times out immediately — a true absolute bound.
          { ms: Math.max(0, EXTRACT_ROUTE_DEADLINE_MS - (Date.now() - startedAt)), label: `extract.${to}` },
        );
        if (out?.error) {
          // Structured extract errors must not charge — throw so the hold
          // refunds, then map the payload back to its response below.
          const err = new Error(out.error);
          err.extractError = out;
          throw err;
        }
        const { width, height } = DIMS[out.kind] || DIMS.designmd;
        const { x: posX, y: posY } =
          reqX != null && reqY != null
            // Exclude the SOURCE's own section: the derived node belongs to it, so
            // its frame must not push the node out (was landing far below). It still
            // avoids overlapping individual nodes + other sections.
            ? await resolvePlacement(src.board_id, reqX, reqY, width, height, sql, src.id)
            : await placeStackDown(src.board_id, width, height, sql);
        const meta = { ...out.meta };
        const [node] = await sql`
          INSERT INTO nodes (board_id, kind, pos_x, pos_y, width, height, meta)
          VALUES (${src.board_id}, ${out.kind}, ${posX}, ${posY}, ${width}, ${height}, ${JSON.stringify(meta)}::jsonb)
          RETURNING id, board_id, kind, pos_x, pos_y, width, height, meta, created_at
        `;
        // Only create a snapshot when there's snapshot-worthy content. prompt nodes
        // carry their text in meta.prompt and asset (screenshot) nodes carry the
        // image in meta.dataUrl — neither needs a snapshot row (mirrors createNode /
        // createImage). Inserting one with html+design_md both null is useless and
        // would dangle current_snapshot_id at an empty row.
        if (out.html != null || out.designMd != null) {
          const [snap] = await sql`
            INSERT INTO snapshots (node_id, html, design_md, source)
            VALUES (${node.id}, ${out.html}, ${out.designMd}, 'extract')
            RETURNING id
          `;
          await sql`UPDATE nodes SET current_snapshot_id = ${snap.id} WHERE id = ${node.id}`;
        }
        if (out.dataUrl) {
          await sql`UPDATE nodes SET meta = meta || ${JSON.stringify({ dataUrl: out.dataUrl })}::jsonb WHERE id = ${node.id}`;
          node.meta = { ...node.meta, dataUrl: out.dataUrl };
        }
        try {
          await sql`INSERT INTO edges (board_id, source_node_id, target_node_id, kind)
                    VALUES (${src.board_id}, ${src.id}, ${node.id}, 'generic')`;
        } catch (_) { /* dup edge — ignore */ }
        return { node, truncated: out.truncated };
      },
    );
  } catch (e) {
    if (e instanceof InsufficientCreditsError) {
      return NextResponse.json({ error: 'insufficient_credits', estimate: e.estimate, balance: e.balance }, { status: 402 });
    }
    if (e instanceof OperationInProgressError) {
      // Same ticket still running — the client should wait/retry, not re-bill.
      return NextResponse.json({ error: 'in_progress' }, { status: 409 });
    }
    if (e?.extractError) {
      const payload = e.extractError;
      const status = payload.error === 'unsupported_combo' || payload.error === 'invalid_to' ? 400 : 409;
      return NextResponse.json(payload, { status });
    }
    // O prazo da rota dispara DENTRO do runBilledOperation, que devolve o hold e
    // relanca: nesse caminho da' para afirmar que nao houve cobranca. Sai
    // TIPADO, porque so o servidor sabe disso — o cliente lendo texto ("timed
    // out") classificava errado uma desistencia do proprio navegador e prometia
    // estorno sem base (achado da auditoria).
    const foiPrazoDaRota = /deadline exceeded|extract\.route/i.test(String(e?.message || ''))
      || e?.name === 'AbortError' && e?.deadlineLabel === 'extract.route';
    if (foiPrazoDaRota) {
      return NextResponse.json({
        error: 'extract_timeout',
        refunded: true,
        message: 'The clone took longer than the time limit and was cancelled.',
      }, { status: 504 });
    }
    return NextResponse.json({ error: 'extract_failed', message: String(e?.message || e) }, { status: 502 });
  }

  // 💰⏱️ Telemetria do clone estático (pedido do Adilson, 2026-08-20): custo real
  // de API + credits gravados no meta do node criado, DEPOIS do settle (só aqui
  // µ¢ e credits existem). Complementa meta.timings/similarity que o
  // lib/extract.js já grava. Replay de dedup não regrava (não é clone novo).
  // Fail-open: telemetria nunca derruba um extract que deu certo.
  if (!billed.deduped && billed.result?.node?.id && (to === 'clone' || to === 'styleclone')) {
    const cloneCost = {
      harness: harness.id,
      credits: billed.credits,
      usageMicrocents: billed.usageMicrocents ?? null,
      costUsd: Number.isFinite(Number(billed.usageMicrocents)) ? Number((Number(billed.usageMicrocents) / 1_000_000).toFixed(4)) : null,
      at: new Date().toISOString(),
    };
    await sql`UPDATE nodes SET meta = meta || ${JSON.stringify({ cloneCost })}::jsonb WHERE id = ${billed.result.node.id}`
      .catch((e) => console.warn(`[clone-telemetry] cloneCost falhou (node=${billed.result.node.id}): ${String(e?.message || e).slice(0, 120)}`));
    billed.result.node.meta = { ...billed.result.node.meta, cloneCost };
  }

  // billed.result is the fresh response, OR the stored response on a dedup hit.
  return NextResponse.json({ ...billed.result, credits: billed.credits, balanceAfter: billed.balanceAfter });
}
