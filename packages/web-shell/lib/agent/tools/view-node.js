import { sql } from '../../db.js';
import { decodeImageDimsFromDataUrl } from '../../image-dims.js';

/**
 * Read the full record of a single node — meta, position, dims, and
 * (for asset nodes) the linked asset's meta including assetId, prompt,
 * source, mimeType and decoded pixel dimensions. The dataUrl itself is
 * NOT returned (kept out of the LLM history to avoid blowing the
 * context window with base64); for VISUAL inspection the user can
 * select the node so its image arrives multimodally in the next turn.
 *
 * This is the agent's equivalent of `Read(file)` against the canvas:
 * when it needs the contents of a node it doesn't already know about,
 * call viewNode(id).
 */
export const viewNodeTool = {
  name: 'viewNode',
  description: 'Return the full record of a single node on the current board: kind, name, position, size, and — for asset nodes — the linked assetId, prompt/mode/refs from the asset meta, and the source image\'s decoded pixel dimensions. Use this when you need to know what a node IS before deciding what to do with it. Does NOT return the dataUrl bytes (those would blow the LLM history); for visual inspection, ask the user to select the node so the next turn arrives with its image.',
  classification: 'safe',
  inputSchema: {
    type: 'object',
    properties: {
      nodeId: { type: 'string', description: 'Id of the node to inspect.' },
    },
    required: ['nodeId'],
  },

  async execute(args, ctx) {
    const { nodeId } = args || {};
    if (!nodeId) return { error: 'invalid_args', message: 'nodeId required' };

    const rows = await sql`
      SELECT n.id, n.kind, n.meta, n.pos_x, n.pos_y, n.width, n.height, n.current_snapshot_id, n.created_at
      FROM nodes n
      JOIN boards b ON b.id = n.board_id
      WHERE n.id = ${nodeId} AND b.id = ${ctx.boardId} AND b.user_id = ${ctx.userId}
    `;
    if (!rows.length) return { error: 'target_not_found', message: 'node not found or not owned' };
    const n = rows[0];
    const meta = n.meta || {};
    const result = {
      id: n.id,
      kind: n.kind,
      name: meta.name || n.kind,
      posX: n.pos_x,
      posY: n.pos_y,
      width: n.width,
      height: n.height,
      hasSnapshot: !!n.current_snapshot_id,
      createdAt: n.created_at,
    };

    if (n.kind === 'asset' && meta.assetId) {
      result.assetId = meta.assetId;
      const aRows = await sql`SELECT meta FROM assets WHERE id = ${meta.assetId} AND user_id = ${ctx.userId}`;
      if (aRows.length) {
        const am = aRows[0].meta || {};
        result.asset = {
          mimeType: am.mimeType || meta.mimeType || null,
          source: am.source || meta.source || null,
          mode: am.mode || null,
          prompt: am.prompt || null,
          baseImageAssetId: am.baseImageAssetId || null,
          styleReferenceAssetIds: Array.isArray(am.styleReferenceAssetIds) ? am.styleReferenceAssetIds : [],
          status: am.status || null,
        };
        const dataUrl = am.dataUrl || meta.dataUrl;
        if (typeof dataUrl === 'string') {
          const dims = decodeImageDimsFromDataUrl(dataUrl);
          if (dims) result.asset.naturalDims = dims;
        }
      }
    }
    return result;
  },
};
