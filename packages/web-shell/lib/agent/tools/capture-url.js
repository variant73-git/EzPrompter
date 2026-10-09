import { sql } from '../../db.js';
import { captureSnapshot, ChallengeRequiredError } from '../../snapshot.js';
import { placeStackDown } from '../../canvas-layout.js';

/**
 * Capture a live URL into a site node on the current board. Runs the
 * same pipeline the user gets when they paste a URL into the input bar
 * (snapshot.js free capture path). Cloudflare/captcha
 * walls return a structured `challenge_required` error; the agent then
 * tells the user to paste the URL into the input bar themselves so the
 * extension handoff can pick it up. Animated-builder sites are flagged for
 * deferred reconstruction when Edit or a strict workflow dependency needs it.
 */
export const captureUrlTool = {
  name: 'captureUrl',
  description: 'Capture a live website URL into a site node on the canvas. Runs the same free snapshot pipeline as the user pasting the URL into the input bar. Animated builders are detected and stored without an immediate AI reconstruction; the node is upgraded later only when Edit or a strict workflow dependency requires editable motion. Returns the new nodeId on success. On Cloudflare/captcha/login walls, returns a `challenge_required` error so you can tell the user to paste the URL themselves (the extension handoff bypasses the wall).',
  // Confirm chips are reserved for deletes (2026-06-12). Capture only
  // creates a node. Capture can still be slow on large or protected pages.
  classification: 'safe',
  timeoutMs: 5 * 60 * 1000,
  inputSchema: {
    type: 'object',
    properties: {
      url:  { type: 'string', description: 'https:// URL of the site to capture.' },
      name: { type: 'string', description: 'Optional display name for the node. Defaults to the page title.' },
    },
    required: ['url'],
  },

  async execute(args, ctx) {
    const { url, name = null } = args || {};
    if (!url || typeof url !== 'string') return { error: 'invalid_args', message: 'url required' };
    if (!/^https?:\/\//i.test(url)) return { error: 'invalid_args', message: 'url must be http(s)' };

    const [board] = await sql`SELECT id FROM boards WHERE id = ${ctx.boardId} AND user_id = ${ctx.userId}`;
    if (!board) return { error: 'forbidden', message: 'board not found or not owned' };

    const width = 1280;
    const height = Math.round(width * 9 / 16);
    const { x: posX, y: posY } = await placeStackDown(ctx.boardId, width, height, sql);
    const displayName = name || new URL(url).hostname;

    // Create a LOADING placeholder node up front so the canvas shows the
    // generating ring + % during the (2-3 min) capture — instead of nothing
    // until it finishes. meta.status='generating' is what the ring keys on.
    const placeholderMeta = { name: displayName, source: 'agent-captured', status: 'generating' };
    const [node] = await sql`
      INSERT INTO nodes (board_id, kind, origin_url, pos_x, pos_y, width, height, meta)
      VALUES (${ctx.boardId}, 'site', ${url}, ${posX}, ${posY}, ${width}, ${height}, ${JSON.stringify(placeholderMeta)}::jsonb)
      RETURNING id
    `;
    if (ctx?.emit) { try { ctx.emit('graph_mutated', { reason: 'captureUrl:start' }); } catch (_) {} }

    let cap;
    try {
      cap = await captureSnapshot(url);
    } catch (e) {
      // Capture failed — drop the placeholder so a broken loading node isn't
      // left behind, then re-emit so the canvas removes it.
      try { await sql`DELETE FROM nodes WHERE id = ${node.id}`; } catch (_) {}
      if (ctx?.emit) { try { ctx.emit('graph_mutated', { reason: 'captureUrl:failed' }); } catch (_) {} }
      if (e instanceof ChallengeRequiredError) {
        return {
          error: 'challenge_required',
          message: `The site at ${url} is behind ${e.kind} verification. Ask the user to paste the URL into the input bar so the extension can complete the verification handoff for them.`,
          kind: e.kind,
          url,
        };
      }
      return { error: 'capture_failed', message: String(e?.message || e) };
    }

    const finalName = name || cap.title || displayName;
    const [snap] = await sql`
      INSERT INTO snapshots (node_id, html, source)
      VALUES (${node.id}, ${cap.html}, 'capture')
      RETURNING id
    `;
    // Populate: point at the snapshot and clear the generating status (so the
    // ring disappears and the captured content renders).
    const finalMeta = {
      name: finalName,
      source: 'agent-captured',
      ...(cap.animatedDetected ? { animatedDetected: true } : {}),
    };
    await sql`
      UPDATE nodes SET current_snapshot_id = ${snap.id}, meta = ${JSON.stringify(finalMeta)}::jsonb
      WHERE id = ${node.id}
    `;

    if (ctx?.emit) {
      try { ctx.emit('graph_mutated', { reason: 'captureUrl:done' }); } catch (_) {}
    }
    return {
      captured: true,
      nodeId: node.id,
      url,
      name: finalName,
      posX,
      posY,
      width,
      height,
    };
  },
};
