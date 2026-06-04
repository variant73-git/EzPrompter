import { Registry } from '../registry.js';
import { createNodeTool }    from './create-node.js';
import { addEdgeTool }       from './add-edge.js';
import { updateNodeTool }    from './update-node.js';
import { queryNodesTool }    from './query-nodes.js';
import { getNodeOutputTool } from './get-node-output.js';
import { listAssetsTool }    from './list-assets.js';

/**
 * Build a Registry pre-populated with the 6 safe tools available in Phase 1.
 * Phase 2 adds: deleteNode, runFlow, editSite, createImage.
 */
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
