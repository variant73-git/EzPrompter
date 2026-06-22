/**
 * Compact board state for the agent's per-turn context hint.
 *
 * Why this exists: the BOARD_AGENT starts almost blind (see the "tools-first,
 * minimal hint" note in /api/chat/route.js). Its very first move on most
 * board-scope turns is a `listBoard` reconnaissance call just to learn what
 * already exists on the canvas — a whole wasted turn (~15k input tokens)
 * before any useful work. This injects a tiny (~10-15 tokens/node) overview
 * directly into the hint so the agent already knows the board's shape.
 *
 * It is the same pattern the workflow-terminal hint already uses ("avoids 2-3
 * tool calls for the most common flow"), generalized to the most common
 * reconnaissance call of all.
 *
 * Deliberately minimal: name, kind, whether the node has a result (snapshot),
 * and the IDs needed to ACT on it (nodeId always; assetId for asset nodes).
 * The IDs are the whole point — without them the agent knows a "Landing" site
 * exists but still has to call queryNodes just to learn its id before it can
 * editSite/updateNode, so the reconnaissance turn isn't actually saved. With
 * the ids in hand it can act directly.
 *
 * NEVER the meta blob — a single prompt/design-system node can carry KB of
 * text, which would defeat the whole point. The agent still has `viewNode` /
 * `getNodeOutput` on demand when it needs the actual CONTENT, and listBoard /
 * queryNodes for positions or the full list past the cap.
 */

// Cap the per-node name so one pathological meta.name can't bloat the hint.
const MAX_NAME = 40;
// Cap how many nodes we enumerate. Above this the agent should use listBoard
// (and we say so, rather than silently truncating).
const DEFAULT_LIMIT = 30;

/**
 * Build a one-paragraph board overview for the context hint.
 *
 * @param {object} args
 * @param {function} args.sql   - tagged-template SQL client (lib/db.js sql)
 * @param {string}   args.boardId
 * @param {number}   [args.limit=30]
 * @returns {Promise<string>} hint text (bracketed line), or '' when the board
 *   is empty / boardId missing / the query fails (best-effort — a failed
 *   summary must never take down a chat turn).
 */
export async function buildBoardSummary({ sql, boardId, limit = DEFAULT_LIMIT }) {
  if (!boardId || typeof sql !== 'function') return '';
  let rows;
  try {
    rows = await sql`
      SELECT id, kind, meta,
             (current_snapshot_id IS NOT NULL) AS has_snapshot
        FROM nodes
       WHERE board_id = ${boardId}
       ORDER BY created_at ASC
       LIMIT ${limit}
    `;
  } catch {
    return ''; // best-effort: never fail a turn over a context hint
  }
  if (!Array.isArray(rows) || rows.length === 0) return '';

  const items = rows.map((n) => {
    const kind = n.kind || 'node'; // kind is NOT NULL in prod; defensive fallback
    const rawName = (n.meta?.name ?? '').toString().trim();
    const name = rawName
      ? (rawName.length > MAX_NAME ? rawName.slice(0, MAX_NAME) + '…' : rawName)
      : kind;
    const tag = n.has_snapshot ? `${kind}, has result` : kind;
    const label = rawName ? `"${name}" (${tag})` : `(${tag})`;
    // The actionable IDs — without these the agent must call queryNodes just
    // to map a name to an id before it can act. nodeId for every node;
    // assetId too for asset nodes (it's what createImage takes).
    const assetId = kind === 'asset' ? (n.meta?.assetId || null) : null;
    const ids = assetId ? `id=${n.id} assetId=${assetId}` : `id=${n.id}`;
    return `${label} ${ids}`;
  });

  // When we hit the cap there may be more — say so instead of implying the
  // list is complete. The agent can listBoard for the remainder.
  const capped = rows.length === limit;
  const head = capped
    ? `Board has ${limit}+ nodes (first ${limit} shown; use listBoard for the rest)`
    : `Board has ${rows.length} node${rows.length === 1 ? '' : 's'}`;

  return `[${head}: ${items.join('; ')}.]`;
}
