/**
 * O DOCUMENTO DO CLONE ESTÁ EM DIA COM O RUNTIME?
 *
 * Um clone animado guarda duas autoridades: o BUNDLE (runtime, que o editor
 * edita por patches reaplicados) e o HTML (documento, que o grafo consome). O
 * documento é a fotocópia de ANTES das edições de movimento.
 *
 * Enquanto ninguém editou, as duas concordam. Depois da primeira transação, o
 * documento fica um passo atrás — e compor a partir dele produziria um
 * resultado derivado do estado PRÉ-EDIÇÃO que sobrescreveria o node. O usuário
 * veria o trabalho dele desaparecer sem uma palavra (achado do Sol).
 *
 * A regra da casa é que recusar não pode ser o mesmo que esquecer: aqui a
 * recusa é TIPADA e alta, em vez de uma composição silenciosamente errada.
 */

export const STALE_CLONE_DOCUMENT = 'stale_clone_document';

/** Quantas transações de movimento o snapshot já absorveu. */
export function motionTransactionCount(motionManifest) {
  const m = typeof motionManifest === 'string'
    ? (() => { try { return JSON.parse(motionManifest); } catch { return null; } })()
    : motionManifest;
  const t = m?.transactions;
  return Array.isArray(t) ? t.length : 0;
}

/**
 * @param snapshot { native_bundle_id, motion_manifest, html }
 * @returns {{ stale: boolean, edits: number }}
 */
export function cloneDocumentFreshness(snapshot) {
  // Sem bundle não há duas autoridades — é um node de documento comum.
  if (!snapshot?.native_bundle_id) return { stale: false, edits: 0 };
  const edits = motionTransactionCount(snapshot.motion_manifest);
  return { stale: edits > 0, edits };
}

export const MISSING_CLONE_DOCUMENT = 'missing_clone_document';

function recusa(code, message, extra = {}) {
  const erro = new Error(message);
  erro.code = code;
  Object.assign(erro, extra);
  return erro;
}

/**
 * ⚠️ A CONTAGEM DO SNAPSHOT NÃO É AUTORIDADE SOZINHA (achado do Sol).
 *
 * O autosave do editor grava em `native_motion_edit_sessions.draft_manifest`,
 * SEM tocar em `snapshots.motion_manifest`. Quem está editando agora tem zero
 * transações no snapshot — e passaria como "em dia" enquanto o trabalho vivo
 * some. Por isso o portão também pergunta ao banco se há sessão aberta com
 * rascunho, e vale para o ALVO e para toda FONTE que carregue bundle.
 *
 * @param nodes  [{ id, native_bundle_id, motion_manifest, html, papel }]
 */
export async function assertRunPreconditions({ sql, nodes }) {
  const comBundle = (nodes || []).filter((n) => n?.native_bundle_id);
  if (!comBundle.length) return;

  for (const n of comBundle) {
    // Documento ausente é pior que atrasado: a rota trocaria por página em
    // branco e comporia sem o site.
    if (!n.html) {
      throw recusa(MISSING_CLONE_DOCUMENT,
        `This clone (${n.papel || 'node'}) has no document yet, so running here would build from a blank page instead of the site.`,
        { nodeId: n.id, role: n.papel || null });
    }
    const edits = motionTransactionCount(n.motion_manifest);
    if (edits > 0) {
      throw recusa(STALE_CLONE_DOCUMENT,
        `This clone (${n.papel || 'node'}) has ${edits} motion edit${edits > 1 ? 's' : ''} that its document does not include yet. `
        + 'Running here would rebuild the page from the version before those edits.',
        { nodeId: n.id, edits, role: n.papel || null });
    }
  }

  // Rascunho vivo: o autosave não passa pelo snapshot.
  const ids = comBundle.map((n) => n.id);
  const abertas = await sql`
    SELECT node_id,
           jsonb_array_length(COALESCE(draft_manifest->'transactions', '[]'::jsonb)) AS edits
      FROM native_motion_edit_sessions
     WHERE node_id = ANY(${ids}::uuid[]) AND status = 'active'
  `;
  for (const linha of abertas) {
    const edits = Number(linha.edits) || 0;
    if (edits <= 0) continue;
    const n = comBundle.find((c) => c.id === linha.node_id);
    throw recusa(STALE_CLONE_DOCUMENT,
      `This clone (${n?.papel || 'node'}) has ${edits} motion edit${edits > 1 ? 's' : ''} open in the editor that its document does not include yet. `
      + 'Save or discard them before running.',
      { nodeId: linha.node_id, edits, role: n?.papel || null, open: true });
  }
}
