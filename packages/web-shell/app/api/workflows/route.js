import { NextResponse } from 'next/server';
import { db } from '../../../lib/db.js';
import { requireUser } from '../../../lib/auth.js';

const SAFE_META_KEYS = new Set([
  'name', 'subtype', 'runtime', 'language', 'mediaType', 'renderer',
  'workflowSlotLabel', 'workflowTemplateId',
]);

function safeMeta(meta) {
  if (!meta || typeof meta !== 'object') return {};
  const clean = {};
  for (const [key, value] of Object.entries(meta)) {
    if (!SAFE_META_KEYS.has(key)) continue;
    if (typeof value === 'string') clean[key] = value.slice(0, 160);
    else if (typeof value === 'number' || typeof value === 'boolean') clean[key] = value;
  }
  return clean;
}

export async function GET(request) {
  const { user, error } = await requireUser(request);
  if (error) return error;
  const sql = await db();
  const workflows = await sql`
    SELECT id, source_board_id, name, description, definition, is_public, created_at, updated_at
      FROM workflow_templates
     WHERE user_id = ${user.id}
     ORDER BY updated_at DESC
  `;
  return NextResponse.json({ workflows });
}

export async function POST(request) {
  const { user, error } = await requireUser(request);
  if (error) return error;
  const body = await request.json().catch(() => ({}));
  const boardId = body?.boardId;
  if (!boardId) return NextResponse.json({ error: 'boardId required' }, { status: 400 });

  const sql = await db();
  const [board] = await sql`
    SELECT id, name FROM boards WHERE id = ${boardId} AND user_id = ${user.id}
  `;
  if (!board) return NextResponse.json({ error: 'board not found' }, { status: 404 });

  const nodes = await sql`
    SELECT id, kind, pos_x, pos_y, width, height, is_main, meta
      FROM nodes
     WHERE board_id = ${boardId}
     ORDER BY created_at ASC
  `;
  if (!nodes.length) return NextResponse.json({ error: 'add at least one node before saving a workflow' }, { status: 400 });
  const edges = await sql`
    SELECT source_node_id, target_node_id, kind
      FROM edges
     WHERE board_id = ${boardId}
     ORDER BY created_at ASC
  `;

  const minX = Math.min(...nodes.map((node) => Number(node.pos_x) || 0));
  const minY = Math.min(...nodes.map((node) => Number(node.pos_y) || 0));
  const keyById = new Map(nodes.map((node, index) => [node.id, `node_${index + 1}`]));
  const definition = {
    version: 1,
    nodes: nodes.map((node, index) => ({
      key: keyById.get(node.id),
      kind: node.kind,
      label: node.meta?.name || node.meta?.workflowSlotLabel || `${node.kind} ${index + 1}`,
      posX: Math.round((Number(node.pos_x) || 0) - minX + 600),
      posY: Math.round((Number(node.pos_y) || 0) - minY + 700),
      width: Math.round(Number(node.width) || 560),
      height: Math.round(Number(node.height) || 560),
      isMain: Boolean(node.is_main),
      meta: safeMeta(node.meta),
    })),
    edges: edges
      .map((edge) => ({
        from: keyById.get(edge.source_node_id),
        to: keyById.get(edge.target_node_id),
        kind: edge.kind || 'generic',
      }))
      .filter((edge) => edge.from && edge.to),
  };

  const name = String(body?.name || board.name || 'Untitled workflow').slice(0, 120);
  const description = String(body?.description || 'Reusable node chain saved from a canvas.').slice(0, 360);
  const [workflow] = await sql`
    INSERT INTO workflow_templates (user_id, source_board_id, name, description, definition)
    VALUES (${user.id}, ${boardId}, ${name}, ${description}, ${definition}::jsonb)
    ON CONFLICT (user_id, source_board_id)
    DO UPDATE SET
      name = EXCLUDED.name,
      description = EXCLUDED.description,
      definition = EXCLUDED.definition,
      updated_at = NOW()
    RETURNING id, source_board_id, name, description, definition, created_at, updated_at
  `;

  return NextResponse.json({ workflow });
}
