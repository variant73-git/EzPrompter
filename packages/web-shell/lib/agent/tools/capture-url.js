import { sql } from '../../db.js';
import { captureSnapshot, ChallengeRequiredError } from '../../snapshot.js';
import { placeStackDown } from '../../canvas-layout.js';

/**
 * Capture a live URL into a site node on the current board. Runs the
 * same pipeline the user gets when they paste a URL into the input bar
 * (snapshot.js → static or reconstructPage path). Cloudflare/captcha
 * walls return a structured `challenge_required` error; the agent then
 * tells the user to paste the URL into the input bar themselves so the
 * extension handoff can pick it up. Animated-builder sites (Webflow
 * IX3, Framer Motion, GSAP) get routed through reconstructPage —
 * 2-3min run time, same as the user-driven path.
 */
export const captureUrlTool = {
  name: 'captureUrl',
  description: 'Capture a live website URL into a site node on the canvas. Runs the same snapshot pipeline as the user pasting the URL into the input bar — static capture for plain sites, full reconstruction for animated builders. Costs no AI tokens for static paths but reconstructPage runs vision calls. Returns the new nodeId on success. On Cloudflare/captcha/login walls, returns a `challenge_required` error so you can tell the user to paste the URL themselves (the extension handoff bypasses the wall).',
  classification: 'destructive',
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

    let cap;
    try {
      cap = await captureSnapshot(url);
    } catch (e) {
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

    const width = 1280;
    const height = Math.round(width * 9 / 16);
    const { x: posX, y: posY } = await placeStackDown(ctx.boardId, width, height, sql);
    const displayName = name || cap.title || new URL(url).hostname;
    const meta = { name: displayName, source: 'agent-captured' };

    const [node] = await sql`
      INSERT INTO nodes (board_id, kind, origin_url, pos_x, pos_y, width, height, meta)
      VALUES (${ctx.boardId}, 'site', ${url}, ${posX}, ${posY}, ${width}, ${height}, ${JSON.stringify(meta)}::jsonb)
      RETURNING id
    `;
    const [snap] = await sql`
      INSERT INTO snapshots (node_id, html, source)
      VALUES (${node.id}, ${cap.html}, 'capture')
      RETURNING id
    `;
    await sql`UPDATE nodes SET current_snapshot_id = ${snap.id} WHERE id = ${node.id}`;

    if (ctx?.emit) {
      try { ctx.emit('graph_mutated', { reason: 'captureUrl:done' }); } catch (_) {}
    }
    return {
      captured: true,
      nodeId: node.id,
      url,
      name: displayName,
      posX,
      posY,
      width,
      height,
    };
  },
};
