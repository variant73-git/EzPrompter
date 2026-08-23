import { sql } from '../../db.js';
import { runCompose } from '../../run-flow.js';
import { runBilledOperation, InsufficientCreditsError } from '../../billing/context.js';
import { deriveIdemKey } from '../../billing/idem-derive.js';
import { assertRunPreconditions, STALE_CLONE_DOCUMENT, MISSING_CLONE_DOCUMENT } from '../../clone-document-freshness.js';

export const runFlowTool = {
  name: 'runFlow',
  description: `Run the compose pipeline on a target node, pulling content from its incoming sources (edges) and writing a new snapshot.

Use after you've created and connected the right nodes — don't call runFlow before any edges exist (the result will be empty). The previous snapshot is preserved in history, so the operation is recoverable. Specify modelId to override the user's picker for this specific run.`,
  // 2026-06-12 user decision: confirm chips are reserved for DELETES only.
  // runFlow overwrites the target's snapshot, but history (parent_snapshot_id
  // + saved versions + reset) makes it recoverable — not chip-worthy.
  classification: 'safe',
  inputSchema: {
    type: 'object',
    properties: {
      nodeId:  { type: 'string', description: 'UUID of the target node to run the flow on' },
      modelId: { type: 'string', description: 'Optional model override (e.g. "claude-sonnet-4-6", "gpt-5.5", "gemini-3.1-pro")' },
    },
    required: ['nodeId'],
  },
  async execute(args, ctx) {
    const { nodeId, modelId = null } = args || {};
    if (!nodeId) return { error: 'invalid_args', message: 'nodeId required' };

    const [target] = await sql`
      SELECT n.id, n.kind, n.meta, n.board_id, n.current_snapshot_id, n.edit_revision,
             s.html AS current_html,
             s.design_md AS current_design_md,
             s.native_bundle_id, s.motion_manifest
        FROM nodes n
        JOIN boards b ON b.id = n.board_id
        LEFT JOIN snapshots s ON s.id = n.current_snapshot_id
       WHERE n.id = ${nodeId} AND b.user_id = ${ctx.userId} AND b.id = ${ctx.boardId}
    `;
    if (!target) return { error: 'forbidden', message: 'node not found on this board' };

    const incoming = await sql`
      SELECT e.id        AS edge_id,
             e.payload   AS edge_payload,
             n.id        AS source_node_id,
             n.kind      AS kind,
             n.meta      AS meta,
             s.html      AS source_html,
             s.design_md AS source_design_md,
             s.native_bundle_id, s.motion_manifest
        FROM edges e
        JOIN nodes n ON n.id = e.source_node_id
        LEFT JOIN snapshots s ON s.id = n.current_snapshot_id
       WHERE e.target_node_id = ${nodeId}
    `;
    if (!incoming.length) {
      return { error: 'no_sources', message: 'target has no incoming edges — connect sources before running' };
    }

    const sources = incoming;

    // ⭐ MESMO PORTAO da rota /run. O agente tem entrada propria e passava por
    // fora: um flow disparado pelo chat podia compor sobre um clone com edicoes
    // de movimento abertas e sobrescrever o trabalho vivo, em silencio.
    try {
      await assertRunPreconditions({
        sql,
        nodes: [
          { ...target, html: target.current_html, papel: 'target' },
          ...sources.map((s2) => ({ ...s2, id: s2.source_node_id, html: s2.source_html, papel: 'source' })),
        ],
      });
    } catch (e) {
      if (e?.code === STALE_CLONE_DOCUMENT || e?.code === MISSING_CLONE_DOCUMENT) {
        // TERMINAL: sem isso o agente chama de novo com os mesmos argumentos
        // ate' esgotar as iteracoes, e a recusa vira laco (Sol). A condicao só
        // muda por acao do USUARIO — salvar, descartar, ou clonar de novo.
        return {
          error: e.code, message: e.message, edits: e.edits, role: e.role,
          retryable: false,
          nextStep: 'Tell the user what is blocking and let them decide — do not call runFlow again for this node.',
        };
      }
      throw e;
    }

    try {
      // The tool bills as its OWN compose operation — the surrounding chat
      // context stays free (innermost context wins).
      const { result: payload, credits, balanceAfter } = await runBilledOperation(
        // Capture the EFFECTIVE model (picker fallback) so the key forms even when
        // modelId is omitted (the common case) — a null key there dropped dedup and
        // re-charged a false-timeout re-call (Sol audit #2).
        { sql, userId: ctx.userId, op: 'compose', boardId: ctx.boardId, nodeId, idemKey: deriveIdemKey([ctx.runId, 'compose', nodeId, modelId || ctx?.pickerModel || 'default']) },
        async () => {
          // Model priority: explicit tool arg > the user's dock picker >
          // runCompose's default. The picker is the user's standing choice —
          // an agent-initiated run must honor it (same rule as createImage).
          const result = await runCompose({ target, sources, modelId: modelId || ctx?.pickerModel || null });
          // Insercao e ponteiro no MESMO comando, sob as duas condicoes: o node
          // ainda no snapshot que o portao examinou, e nenhuma sessao aberta com
          // edicao. Dois comandos nao fechavam a corrida — abrir sessao nao muda
          // `current_snapshot_id`, e a trava solta no fim do primeiro.
          const [newSnap] = await sql`
            WITH permitido AS (
              SELECT n.id
                FROM nodes n
               WHERE n.id = ${nodeId}
                 AND n.current_snapshot_id IS NOT DISTINCT FROM ${target.current_snapshot_id || null}
                 -- Condicao na linha TRAVADA: o Postgres a re-avalia depois do
                 -- lock. Uma edicao salva enquanto este comando esperava muda o
                 -- token e derruba a escrita (Sol); a checagem de sessao abaixo
                 -- sozinha nao daria isso, porque olha outra tabela sob o
                 -- snapshot anterior ao lock.
                 AND n.edit_revision IS NOT DISTINCT FROM ${Number(target.edit_revision) || 0}
                 AND NOT EXISTS (
                   SELECT 1 FROM native_motion_edit_sessions e
                    WHERE e.node_id = n.id AND e.status = 'active'
                      AND jsonb_array_length(COALESCE(e.draft_manifest->'transactions', '[]'::jsonb)) > 0
                 )
                 FOR UPDATE OF n
            ), inserido AS (
              INSERT INTO snapshots (node_id, html, source, parent_snapshot_id)
              SELECT ${nodeId}, ${result.html}, 'agent-run', ${target.current_snapshot_id || null}
                FROM permitido
              RETURNING id
            ), apontado AS (
              UPDATE nodes SET current_snapshot_id = inserido.id
                FROM inserido
               WHERE nodes.id = ${nodeId}
              RETURNING inserido.id
            )
            SELECT id FROM apontado
          `;
          if (!newSnap) {
            const mudou = new Error('The node changed while this run was in flight — nothing was overwritten.');
            mudou.code = 'snapshot_changed';
            throw mudou;
          }
          return {
            ran: true,
            nodeId,
            snapshotId: newSnap.id,
            bytes: result.html?.length || 0,
          };
        },
      );
      return { ...payload, credits, balanceAfter };
    } catch (e) {
      if (e instanceof InsufficientCreditsError) {
        return { error: 'insufficient_credits', estimate: e.estimate, balance: e.balance };
      }
      if (e?.code === 'snapshot_changed') {
        return {
          error: e.code, message: e.message, retryable: false,
          nextStep: 'The node moved under this run. Read it again before deciding anything.',
        };
      }
      return { error: 'run_failed', message: String(e?.message || e) };
    }
  },
};
