import { Registry } from '../registry.js';
import { createNodeTool }    from './create-node.js';
import { addEdgeTool }       from './add-edge.js';
import { updateNodeTool }    from './update-node.js';
import { queryNodesTool }    from './query-nodes.js';
import { getNodeOutputTool } from './get-node-output.js';
import { listAssetsTool }    from './list-assets.js';
import { deleteNodeTool }    from './delete-node.js';
import { runFlowTool }       from './run-flow.js';
import { editSiteTool }      from './edit-site.js';

/** Phase 1 safe tools only — kept for the smoke-test path and for asset-scoped chats. */
export function buildSafeRegistry() {
  const r = new Registry();
  r.register(createNodeTool);
  r.register(addEdgeTool);
  r.register(updateNodeTool);
  r.register(queryNodesTool);
  r.register(getNodeOutputTool);
  r.register(listAssetsTool);
  return r;
}

/** Phase 2 full board-agent surface — safe + destructive. */
export function buildFullRegistry() {
  const r = buildSafeRegistry();
  r.register(deleteNodeTool);
  r.register(runFlowTool);
  r.register(editSiteTool);
  return r;
}
