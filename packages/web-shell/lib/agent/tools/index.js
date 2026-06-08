import { Registry } from '../registry.js';
import { createNodeTool }      from './create-node.js';
import { addEdgeTool }         from './add-edge.js';
import { updateNodeTool }      from './update-node.js';
import { queryNodesTool }      from './query-nodes.js';
import { getNodeOutputTool }   from './get-node-output.js';
import { listAssetsTool }      from './list-assets.js';
import { addAssetFromUrlTool } from './add-asset-from-url.js';
import { deleteNodeTool }      from './delete-node.js';
import { runFlowTool }         from './run-flow.js';
import { editSiteTool }        from './edit-site.js';
import { createImageTool }     from './create-image.js';
// Exploration tools — the agent's `ls / cat / grep` against the canvas.
import { viewNodeTool }        from './view-node.js';
import { listBoardTool }       from './list-board.js';
import { findNearestTool }     from './find-nearest.js';
import { getWorkflowTool }     from './get-workflow.js';
// Site + design pipeline tools — agent can drive snapshot capture and
// Demarcelizer restyling end-to-end without needing the user to do
// anything in the URL bar.
import { captureUrlTool }      from './capture-url.js';
import { extractDesignTool }   from './extract-design.js';
import { applyDesignTool }     from './apply-design.js';

/** Phase 1 safe tools only — kept for the smoke-test path and for asset-scoped chats. */
export function buildSafeRegistry() {
  const r = new Registry();
  r.register(createNodeTool);
  r.register(addEdgeTool);
  r.register(updateNodeTool);
  r.register(queryNodesTool);
  r.register(getNodeOutputTool);
  r.register(listAssetsTool);
  r.register(addAssetFromUrlTool);
  // Exploration — these are the agent's primary read tools post-refactor.
  r.register(viewNodeTool);
  r.register(listBoardTool);
  r.register(findNearestTool);
  r.register(getWorkflowTool);
  return r;
}

/** Phase 2 full board-agent surface — safe + destructive. */
export function buildFullRegistry() {
  const r = buildSafeRegistry();
  r.register(deleteNodeTool);
  r.register(runFlowTool);
  r.register(editSiteTool);
  r.register(createImageTool);
  // Site capture + design pipeline.
  r.register(captureUrlTool);
  r.register(extractDesignTool);
  r.register(applyDesignTool);
  return r;
}

/**
 * Phase 4 asset-scope chat surface — safe tools + createImage. Use when
 * threadScope === 'asset' so the Smart Edit chat dock has graph context
 * (queryNodes, listAssets, viewNode, listBoard) plus the ability to
 * regenerate the image (createImage), but NOT the ability to delete
 * graph nodes, run flows, capture sites, or edit sites from an image-
 * focused chat.
 */
export function buildAssetRegistry() {
  const r = buildSafeRegistry();
  r.register(createImageTool);
  return r;
}
