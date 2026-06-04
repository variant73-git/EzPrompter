import { sql } from '../../db.js';
import { placeStackDown } from '../../canvas-layout.js';

const MAX_BYTES = 10 * 1024 * 1024; // 10MB cap — keep base64 row size sane
const ALLOWED_MIME_PREFIXES = ['image/'];

function inferMimeFromExt(url) {
  const lower = url.toLowerCase().split('?')[0];
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  return null;
}

export const addAssetFromUrlTool = {
  name: 'addAssetFromUrl',
  description: `Fetch an external image URL (Pinterest, Unsplash, any direct image URL the user pastes) and bring it into the canvas as an asset node. Use this whenever the user mentions an image URL — don't just acknowledge the string, ingest the image so YOU can see it and the user can connect it to other nodes.

Returns {assetId, nodeId} — pass assetId to createImage's baseImageAssetId for image-to-image edits, or feed it into runFlow as a reference.

Safe (no charge), but does hit the network. If the URL isn't an image or the host blocks fetches, returns {error}.`,
  classification: 'safe',
  inputSchema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'Direct URL to an image file (https://...)' },
      name: { type: 'string', description: 'Optional display name; defaults to the URL filename' },
      attachToBoard: { type: 'boolean', description: 'When true (default), also create an asset node on the canvas at the next free spot' },
    },
    required: ['url'],
  },

  async execute(args, ctx) {
    const { url, name = null, attachToBoard = true } = args || {};
    if (!url || typeof url !== 'string') return { error: 'invalid_args', message: 'url required' };
    if (!/^https?:\/\//i.test(url)) return { error: 'invalid_args', message: 'url must be http(s)' };

    const owned = await sql`SELECT id FROM boards WHERE id = ${ctx.boardId} AND user_id = ${ctx.userId}`;
    if (!owned.length) return { error: 'forbidden', message: 'board not found or not owned' };

    let res;
    try {
      res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; UncraftAgent/1.0)' },
        redirect: 'follow',
      });
    } catch (e) {
      return { error: 'fetch_failed', message: String(e?.message || e) };
    }
    if (!res.ok) return { error: 'fetch_failed', message: `HTTP ${res.status}` };

    const contentLengthHeader = res.headers.get('content-length');
    if (contentLengthHeader && Number(contentLengthHeader) > MAX_BYTES) {
      return { error: 'too_large', message: `image exceeds ${MAX_BYTES} bytes` };
    }

    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > MAX_BYTES) return { error: 'too_large', message: `image exceeds ${MAX_BYTES} bytes` };

    let mimeType = res.headers.get('content-type')?.split(';')[0]?.trim() || inferMimeFromExt(url);
    if (!mimeType || !ALLOWED_MIME_PREFIXES.some((p) => mimeType.startsWith(p))) {
      return { error: 'not_image', message: `expected image/*, got ${mimeType || 'unknown'}` };
    }

    const base64 = buf.toString('base64');
    const dataUrl = `data:${mimeType};base64,${base64}`;

    const urlFilename = (() => {
      try {
        const u = new URL(url);
        const tail = u.pathname.split('/').filter(Boolean).pop() || u.hostname;
        return decodeURIComponent(tail);
      } catch { return 'remote-image'; }
    })();
    const effectiveName = name || urlFilename;

    const meta = {
      dataUrl,
      mimeType,
      sourceUrl: url,
      bytes: buf.byteLength,
      source: 'agent-ingested-url',
    };

    const [asset] = await sql`
      INSERT INTO assets (user_id, project_id, type, name, source_url, meta)
      VALUES (${ctx.userId}, ${ctx.boardId}, 'image', ${effectiveName}, ${url}, ${JSON.stringify(meta)}::jsonb)
      RETURNING id
    `;

    let nodeId = null;
    let placedX = 0;
    let placedY = 0;
    if (attachToBoard) {
      const pos = await placeStackDown(ctx.boardId, 512, 512, sql);
      placedX = pos.x;
      placedY = pos.y;

      const nodeMeta = { source: 'agent-ingested-url', assetId: asset.id, name: effectiveName, dataUrl, mimeType };
      const [node] = await sql`
        INSERT INTO nodes (board_id, kind, pos_x, pos_y, width, height, meta)
        VALUES (${ctx.boardId}, 'asset', ${placedX}, ${placedY}, 512, 512, ${JSON.stringify(nodeMeta)}::jsonb)
        RETURNING id
      `;
      nodeId = node.id;
    }

    return {
      ingested: true,
      assetId: asset.id,
      nodeId,
      name: effectiveName,
      mimeType,
      bytes: buf.byteLength,
      sourceUrl: url,
      posX: placedX,
      posY: placedY,
    };
  },
};
