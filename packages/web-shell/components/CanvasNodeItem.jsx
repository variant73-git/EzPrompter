'use client';

import { memo } from 'react';
import CanvasNode from './CanvasNode.jsx';

// Memoized per-node wrapper. CanvasClient re-renders on every canvas-wide
// state change (drag frames, chat stream ticks, selection, run status) and
// previously re-rendered ALL CanvasNode subtrees each time — the callback
// props were fresh inline arrows every render, so no memo could ever hit.
// This wrapper owns the per-node callback creation; CanvasClient passes
// only data props (updateNodeLocal preserves object identity for untouched
// nodes), so React.memo skips every node whose own data didn't change —
// during a drag, all but the dragged one.
//
// SAFETY MODEL — no stale closures: every callback resolves the CURRENT
// handler through handlersRef.current AT EVENT TIME. CanvasClient
// re-points handlersRef.current on every render, so handlers always see
// fresh state; the ref object identity itself never changes, so it never
// breaks memoization. Never pass a raw CanvasClient function directly.
function CanvasNodeItem({
  node, scale, debit, incomingEdges, hasOutgoingEdges, selected, livePreviewActive, placing,
  editing, runStatus, draftActive, removing, removingOutside, removeFromMenu,
  inSection, canRunFromHere, flowRunning, handlersRef,
}) {
  const h = () => handlersRef.current;
  return (
    <CanvasNode
      node={node}
      scale={scale}
      debit={debit}
      incomingEdges={incomingEdges}
      hasOutgoingEdges={hasOutgoingEdges}
      selected={selected}
      livePreviewActive={livePreviewActive}
      placing={placing}
      editing={editing}
      runStatus={runStatus}
      draftActive={draftActive}
      removing={removing}
      removingOutside={removingOutside}
      removeFromMenu={removeFromMenu}
      inSection={inSection}
      canRunFromHere={canRunFromHere}
      flowRunning={flowRunning}
      onRunFromHere={() => h().runFromNode(node.id)}
      onStopFlow={() => h().stopFlowForNode(node.id)}
      getRunFromHereEst={() => h().getRunFromHereEst(node.id)}
      onEditingChange={(willEdit) => h().handleEditingToggle(node.id, willEdit)}
      onSelect={(e) => h().handleNodeSelect(node, e)}
      onMove={(posX, posY) => h().handleNodeMove(node, posX, posY)}
      onMoveStart={() => h().handleNodeMoveStart(node)}
      onMoveEnd={(moved) => h().handleNodeMoveEnd(node, moved)}
      onAltDuplicateDrag={(e) => h().startAltDuplicateDrag(node, e)}
      onResize={(width, height, opts) => h().handleNodeResize(node, width, height, opts)}
      onDelete={() => h().handleNodeDeleteRequest(node)}
      onReset={() => h().handleResetNode(node.id)}
      onVersionRestore={(snapshotId) => h().handleRestoreVersion(node.id, snapshotId)}
      onSaveEdit={(html) => h().handleSaveNodeEdit(node.id, html)}
      onDiscardEdit={() => h().handleDiscardNodeEdit(node.id)}
      onDuplicate={() => h().handleDuplicateNode(node.id)}
      onDownload={() => h().handleDownloadNode(node.id)}
      onStartEdge={(e, side) => h().startEdgeFromNode(node.id, e, side)}
      onSlotMouseDown={(...args) => h().onSlotMouseDown(...args)}
      onPromptTextChange={(value) => h().handlePromptTextChange(node.id, value)}
      onMetaPatch={(metaPatch) => h().handleNodeMetaPatch(node.id, metaPatch)}
      onReplaceContent={(...args) => h().handleReplaceContent(...args)}
      onRequestUpload={() => h().handlePopulateNode(node)}
      onReferenceFallback={() => h().handleReferenceFallback(node.id)}
      onFrameZoom={() => h().zoomToNode(node, 350, 1)}
      onRemoveFromSection={() => h().armNodeRemoval(node)}
      onCancelRemove={(...args) => h().cancelNodeRemoval(...args)}
    />
  );
}

export default memo(CanvasNodeItem);
