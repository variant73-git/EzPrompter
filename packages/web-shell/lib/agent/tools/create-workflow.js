import { sql } from '../../db.js';
import { NODE_TYPES, computeNodeSize, insertTypedNode } from './create-node.js';
import { planChainLayout, placeChainOnBoard, placeChainAtAnchor, deoverlapSectionForEdge } from '../../canvas-layout.js';

const MAX_NODES = 12;
const TYPE_LIST = Object.keys(NODE_TYPES);
const ANCHOR_KEY = 'anchor'; // reserved edge key naming the anchorNodeId node

export const createWorkflowTool = {
  name: 'createWorkflow',
  description: `Create a whole node chain (workflow) in ONE call: all the nodes plus the edges wiring them. ALWAYS use this instead of repeated createNode/addEdge calls when a request implies 2+ connected nodes.

Why it exists: the full chain's area is measured BEFORE anything touches the board and a free spot is reserved for it — so the resulting section can NEVER overlap another section. Layout is automatic and horizontal: each dependency step (edge from → to) advances one column to the right; nodes at the same step (variants of the same thing) stack vertically. Do NOT pass positions. Nodes appear on the canvas one by one, in real time.

Placement is automatic and immediate. Never ask the user to position any
member and never create placement ghosts. After the turn, the canvas camera
fits and centers the complete chain as one composition.

Anchoring to an EXISTING node: pass anchorNodeId when the chain grows OUT OF a node already on the board (the user's selection, a named source). The chain is placed right next to that node and JOINS its section instead of landing as a detached island. Wire the anchor with edges using the reserved key "anchor" (e.g. { from: "anchor", to: "crop-1" }). Whenever the user's selected node is the origin of the new work, USE the anchor — never build a disconnected copy of it.

Node types and content semantics are identical to createNode: ${TYPE_LIST.join(' / ')} (prompt content → meta.prompt brief; design-system content → design.md snapshot; blank-website content → the node's initial HTML, for derived/split pages; omit content for a blank slot).`,
  classification: 'safe',
  inputSchema: {
    type: 'object',
    properties: {
      nodes: {
        type: 'array',
        description: `All nodes of the chain (max ${MAX_NODES}).`,
        items: {
          type: 'object',
          properties: {
            key:     { type: 'string', description: 'Your local handle for wiring edges (e.g. "brief", "site", "variant-a")' },
            type:    { type: 'string', enum: TYPE_LIST },
            name:    { type: 'string', description: 'Optional display name shown on the node' },
            content: { type: 'string', description: 'Same as createNode content. Omit for a blank slot.' },
          },
          required: ['key', 'type'],
        },
      },
      edges: {
        type: 'array',
        description: 'Directed wiring between the keys above (from → to = dependency; the target reads from the source). With anchorNodeId set, the reserved key "anchor" refers to the existing anchor node.',
        items: {
          type: 'object',
          properties: {
            from: { type: 'string' },
            to:   { type: 'string' },
          },
          required: ['from', 'to'],
        },
      },
      anchorNodeId: {
        type: 'string',
        description: 'Optional id of an EXISTING node the chain grows from. The chain is placed next to it and joins its section; reference it in edges as "anchor".',
      },
    },
    required: ['nodes'],
  },

  async execute(args, ctx) {
    const nodesSpec = Array.isArray(args?.nodes) ? args.nodes : [];
    const edgesSpec = Array.isArray(args?.edges) ? args.edges : [];
    const anchorNodeId = typeof args?.anchorNodeId === 'string' && args.anchorNodeId ? args.anchorNodeId : null;
    if (!nodesSpec.length) return { error: 'invalid_args', message: 'nodes required' };
    if (nodesSpec.length > MAX_NODES) return { error: 'invalid_args', message: `too many nodes (max ${MAX_NODES})` };

    const seen = new Set();
    for (const n of nodesSpec) {
      if (!n?.key || typeof n.key !== 'string') return { error: 'invalid_args', message: 'every node needs a string key' };
      if (n.key === ANCHOR_KEY) return { error: 'invalid_args', message: `"${ANCHOR_KEY}" is a reserved key (it names the anchorNodeId node)` };
      if (seen.has(n.key)) return { error: 'invalid_args', message: `duplicate node key "${n.key}"` };
      seen.add(n.key);
      if (!NODE_TYPES[n.type]) return { error: 'invalid_args', message: `unknown type "${n.type}" — must be one of: ${TYPE_LIST.join(', ')}` };
    }
    const knownKey = (k) => seen.has(k) || (anchorNodeId && k === ANCHOR_KEY);
    for (const e of edgesSpec) {
      if (!knownKey(e?.from) || !knownKey(e?.to)) {
        return { error: 'invalid_args', message: `edge references unknown key (${e?.from} → ${e?.to})${!anchorNodeId && (e?.from === ANCHOR_KEY || e?.to === ANCHOR_KEY) ? ' — "anchor" requires anchorNodeId' : ''}` };
      }
      if (e.from === e.to) return { error: 'invalid_args', message: 'self-edges not allowed' };
    }

    const owned = await sql`SELECT id FROM boards WHERE id = ${ctx.boardId} AND user_id = ${ctx.userId}`;
    if (!owned.length) return { error: 'forbidden', message: 'board not found or not owned' };

    // Anchor must be a real node on THIS board (ownership already proven above).
    if (anchorNodeId) {
      const anchorRows = await sql`SELECT id FROM nodes WHERE id = ${anchorNodeId} AND board_id = ${ctx.boardId}`;
      if (!anchorRows.length) return { error: 'anchor_not_found', message: 'anchorNodeId does not exist on this board' };
    }

    // 1. Measure the WHOLE chain before touching the board: sizes per node,
    // then the horizontal dependency layout (sequence → columns right,
    // variants → stacked in a column, gentle zigzag).
    const specs = nodesSpec.map((n) => {
      const mapping = NODE_TYPES[n.type];
      const { w, h } = computeNodeSize(mapping, n.content || null);
      return {
        key: n.key, width: w, height: h,
        mapping, type: n.type, name: n.name || null, content: n.content || null,
      };
    });
    const plan = planChainLayout(specs, edgesSpec);

    // 2. Reserve a spot that FITS the whole area. Unanchored: an island of
    // its own, clear of every section (future frame included). Anchored:
    // right next to the anchor node, joining ITS section — the section-level
    // de-overlap backstop below keeps the grown section clear of neighbours.
    const origin = anchorNodeId
      ? await placeChainAtAnchor(ctx.boardId, anchorNodeId, plan.width, plan.height, sql)
      : await placeChainOnBoard(ctx.boardId, plan.width, plan.height, sql);

    // 3. Insert node by node, emitting graph_mutated after EACH insert so
    // the user watches the chain assemble in real time.
    const idByKey = {};
    const created = [];
    for (const s of specs) {
      const p = plan.positions[s.key];
      const node = await insertTypedNode({
        boardId: ctx.boardId, mapping: s.mapping, name: s.name, content: s.content,
        x: origin.x + p.x, y: origin.y + p.y, w: s.width, h: s.height,
      });
      idByKey[s.key] = node.id;
      created.push({ key: s.key, id: node.id, type: s.type, posX: node.pos_x, posY: node.pos_y });
      if (ctx?.emit) { try { ctx.emit('graph_mutated', { reason: 'createWorkflow:node', nodeIds: [node.id] }); } catch (_) {} }
    }

    // 4. Wire the edges (dup inserts swallowed — unique constraint). The
    // reserved "anchor" key resolves to the existing anchor node's id.
    if (anchorNodeId) idByKey[ANCHOR_KEY] = anchorNodeId;
    let wired = 0;
    for (const e of edgesSpec) {
      try {
        await sql`
          INSERT INTO edges (board_id, source_node_id, target_node_id, kind)
          VALUES (${ctx.boardId}, ${idByKey[e.from]}, ${idByKey[e.to]}, 'generic')
        `;
        wired++;
      } catch (_) { /* dup edge — ignore */ }
    }

    // Backstop only: the spot was chosen clear, but if the board changed
    // mid-run this shoves the fresh section out of any overlap. For anchored
    // chains the ANCHOR's (now grown) section is the one to keep clear.
    if (wired > 0) {
      try { await deoverlapSectionForEdge(ctx.boardId, sql, anchorNodeId || idByKey[specs[0].key]); } catch (_) {}
    }
    if (ctx?.emit) { try { ctx.emit('graph_mutated', { reason: 'createWorkflow:edges', nodeIds: created.map((node) => node.id), focus: 'chain' }); } catch (_) {} }

    return { created, edges: wired, anchored: Boolean(anchorNodeId), originX: origin.x, originY: origin.y, width: plan.width, height: plan.height };
  },
};
