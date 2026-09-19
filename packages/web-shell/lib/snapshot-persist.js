// Grava um snapshot de REFERÊNCIA vindo de uma página verificada (handoff da
// extensão, ou — spec 2026-09-08 — a captura no navegador remoto). Extraído
// VERBATIM de app/api/snapshot/handoff/route.js para o job de challenge poder
// reusar o MESMO caminho de escrita. `source='handoff'` (a régua de linhagem
// nativa não o reconhece — referência é estática, de propósito).
export async function persistReferenceSnapshot({ sql, userId, nodeId, html, screenshotDataUrl = null, title = null }) {
  // Dono re-checado na escrita (defesa em profundidade).
  const [node] = await sql`
    SELECT n.id, n.board_id, n.current_snapshot_id, n.meta
      FROM nodes n
      JOIN boards b ON b.id = n.board_id
     WHERE n.id = ${nodeId} AND b.user_id = ${userId}
  `;
  if (!node) return { error: 'not_found' };

  // Idempotência: snapshot de handoff já presente = curto-circuito.
  if (node.current_snapshot_id) {
    const [existing] = await sql`SELECT id, source FROM snapshots WHERE id = ${node.current_snapshot_id}`;
    if (existing?.source === 'handoff') return { snapshotId: existing.id, deduped: true };
  }

  const [snap] = await sql`
    INSERT INTO snapshots (node_id, html, screenshot_url, source)
    VALUES (${node.id}, ${html}, ${screenshotDataUrl || null}, 'handoff')
    RETURNING id, created_at
  `;
  await sql`
    UPDATE nodes
       SET current_snapshot_id = ${snap.id},
           meta = COALESCE(meta, '{}'::jsonb) - 'awaiting_handoff' - 'handoff_started_at'
     WHERE id = ${node.id}
  `;
  return { snapshotId: snap.id, title: title || null };
}
