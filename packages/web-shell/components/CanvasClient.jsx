'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import { api } from '../lib/canvas-api.js';
import CanvasNode from './CanvasNode.jsx';
import EdgeLayer, { DraftEdgeLayer } from './EdgeLayer.jsx';
import EdgePopup from './EdgePopup.jsx';
import Superwidget from './Superwidget.jsx';

const WORLD_WIDTH = 8000;
const WORLD_HEIGHT = 6000;

export default function CanvasClient({ board, initialNodes, initialEdges }) {
  const [nodes, setNodes] = useState(initialNodes || []);
  const [edges, setEdges] = useState(initialEdges || []);
  const [boardName, setBoardName] = useState(board.name || 'Untitled');
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState(null);
  const [draftEdge, setDraftEdge] = useState(null);  // {sourceNodeId, mouseX, mouseY}
  const [popupPos, setPopupPos] = useState(null);
  const transformRef = useRef(null);

  const updateNodeLocal = useCallback((id, patch) => {
    setNodes((prev) => prev.map((n) => (n.id === id ? { ...n, ...patch } : n)));
  }, []);

  const dragNodeServer = useRef(new Map());
  function persistNodePosition(id, posX, posY) {
    clearTimeout(dragNodeServer.current.get(id));
    const t = setTimeout(() => api.updateNode(id, { posX, posY }).catch(console.warn), 250);
    dragNodeServer.current.set(id, t);
  }

  async function handleAddUrl(url) {
    const id = `temp-${Date.now()}`;
    const placeholderNode = {
      id, kind: 'site', origin_url: url,
      pos_x: 200, pos_y: 200, width: 1280, height: 800,
      is_main: nodes.length === 0,
      current_html: null, _loading: true
    };
    setNodes((prev) => [...prev, placeholderNode]);

    try {
      const cap = await api.captureUrl(url);
      const created = await api.createNode({
        boardId: board.id, kind: 'site', originUrl: url,
        posX: 200, posY: 200, width: 1280, height: 800,
        isMain: nodes.length === 0,
        html: cap.html
      });
      setNodes((prev) => prev.map((n) => (n.id === id ? {
        ...created.node,
        current_html: cap.html,
        current_screenshot: cap.screenshotDataUrl,
        _loading: false
      } : n)));
    } catch (e) {
      console.error(e);
      setNodes((prev) => prev.filter((n) => n.id !== id));
      alert(`Capture failed: ${e.message}`);
    }
  }

  async function handleUploadMd(file) {
    const text = await file.text();
    try {
      const created = await api.createNode({
        boardId: board.id, kind: 'designmd',
        posX: 200, posY: 200, width: 540, height: 720,
        meta: { name: file.name },
        html: `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{font-family:ui-monospace,monospace;padding:24px;line-height:1.6;color:#1f2937;background:#fafafa;white-space:pre-wrap;word-wrap:break-word;}</style></head><body>${escapeHtml(text)}</body></html>`,
        designMd: text
      });
      setNodes((prev) => [...prev, { ...created.node, current_html: created.node.current_html || '', current_design_md: text }]);
    } catch (e) {
      alert(`Upload failed: ${e.message}`);
    }
  }

  async function handleDeleteNode(id) {
    setNodes((prev) => prev.filter((n) => n.id !== id));
    setEdges((prev) => prev.filter((e) => e.source_node_id !== id && e.target_node_id !== id));
    if (id.startsWith?.('temp-')) return;
    await api.deleteNode(id).catch(console.warn);
  }

  function startEdgeFromNode(nodeId, mouseEvent) {
    setDraftEdge({ sourceNodeId: nodeId, mouseX: mouseEvent.clientX, mouseY: mouseEvent.clientY });
  }

  function moveDraftEdge(e) {
    if (draftEdge) setDraftEdge({ ...draftEdge, mouseX: e.clientX, mouseY: e.clientY });
  }

  async function dropDraftEdge(e, hoverNodeId) {
    if (!draftEdge) return;
    const target = hoverNodeId;
    const src = draftEdge.sourceNodeId;
    setDraftEdge(null);
    if (!target || target === src) return;
    try {
      const { edge } = await api.createEdge({
        boardId: board.id, sourceNodeId: src, targetNodeId: target,
        kind: 'transplant', payload: { sourceSelector: 'body', targetSelector: 'body' }
      });
      setEdges((prev) => [...prev, edge]);
      setSelectedEdgeId(edge.id);
      setPopupPos({ x: e.clientX, y: e.clientY });
    } catch (err) {
      alert(`Edge create failed: ${err.message}`);
    }
  }

  async function handleApplyEdge(edge) {
    try {
      const { snapshotId, targetNodeId } = await api.applyEdge(edge.id);
      // Refetch board for latest target node HTML
      const fresh = await api.getBoard(board.id);
      setNodes(fresh.nodes);
      setEdges(fresh.edges);
      setSelectedEdgeId(null);
      setPopupPos(null);
    } catch (e) {
      alert(`Apply failed: ${e.message}`);
    }
  }

  async function handleUpdateEdge(edge, payload) {
    try {
      await api.updateEdge(edge.id, { payload });
      setEdges((prev) => prev.map((x) => (x.id === edge.id ? { ...x, payload } : x)));
    } catch (e) {
      alert(e.message);
    }
  }

  async function handleDeleteEdge(edge) {
    setEdges((prev) => prev.filter((x) => x.id !== edge.id));
    setSelectedEdgeId(null);
    setPopupPos(null);
    await api.deleteEdge(edge.id).catch(console.warn);
  }

  async function persistBoardName(name) {
    if (name === board.name) return;
    await api.renameBoard(board.id, name).catch(console.warn);
  }

  function logout() {
    api.logout().catch(() => {});
    localStorage.removeItem('token');
    window.location.href = '/';
  }

  function fitToContent(animationTime = 350) {
    const t = transformRef.current;
    if (!t || nodes.length === 0) return;
    // Compute bounding box across all nodes (in world coords).
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of nodes) {
      minX = Math.min(minX, n.pos_x);
      minY = Math.min(minY, n.pos_y);
      maxX = Math.max(maxX, n.pos_x + n.width);
      maxY = Math.max(maxY, n.pos_y + n.height);
    }
    const PADDING = 80;
    const bboxW = (maxX - minX) + PADDING * 2;
    const bboxH = (maxY - minY) + PADDING * 2;
    const vw = window.innerWidth;
    const vh = window.innerHeight - 48; // header offset
    const scale = Math.min(vw / bboxW, vh / bboxH, 1.5);
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    // setTransform expects positionX/Y of the TransformComponent content.
    const posX = vw / 2 - centerX * scale;
    const posY = (vh / 2 + 48) - centerY * scale;
    t.setTransform(posX, posY, scale, animationTime);
  }

  // Auto-fit when initial nodes are present (e.g. revisiting a board).
  useEffect(() => {
    if (initialNodes && initialNodes.length > 0) {
      const t = setTimeout(() => fitToContent(0), 50);
      return () => clearTimeout(t);
    }
  }, []); // intentional: only on first mount

  // Keyboard shortcuts: Esc clears selection. F fits all nodes. 0 resets to 1:1 center.
  useEffect(() => {
    function onKey(e) {
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'Escape') {
        setSelectedNodeId(null);
        setSelectedEdgeId(null);
        setPopupPos(null);
        setDraftEdge(null);
      } else if (e.key === 'f' || e.key === 'F') {
        fitToContent();
      } else if (e.key === '0') {
        const t = transformRef.current;
        if (t) t.setTransform(window.innerWidth / 2 - WORLD_WIDTH / 2, window.innerHeight / 2 - WORLD_HEIGHT / 2, 1, 250);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [nodes]);

  return (
    <div className="canvas-shell" onMouseMove={moveDraftEdge}>
      <div className="canvas-bg" />

      <header className="canvas-header">
        <a href="/canvas">← Boards</a>
        <input
          className="canvas-board-name"
          value={boardName}
          onChange={(e) => setBoardName(e.target.value)}
          onBlur={(e) => persistBoardName(e.target.value)}
          spellCheck={false}
        />
        <button
          onClick={() => fitToContent()}
          disabled={nodes.length === 0}
          title="Fit all nodes to viewport (F)"
          style={{ color: nodes.length ? '#a78bfa' : '#475569', fontSize: '0.75rem', cursor: nodes.length ? 'pointer' : 'default' }}
        >
          {nodes.length} nodes · {edges.length} edges {nodes.length > 0 && '⤢'}
        </button>
        <button onClick={logout}>Sign out</button>
      </header>

      <TransformWrapper
        ref={transformRef}
        minScale={0.1}
        maxScale={2.5}
        initialScale={0.6}
        initialPositionX={-WORLD_WIDTH * 0.25}
        initialPositionY={-WORLD_HEIGHT * 0.25}
        limitToBounds={false}
        wheel={{ step: 0.08, excluded: ['cnode-iframe', 'cnode-handle', 'edge-popup', 'superwidget', 'canvas-header'] }}
        panning={{ excluded: ['cnode-iframe', 'cnode-handle', 'edge-line', 'edge-popup', 'superwidget', 'canvas-header'] }}
        doubleClick={{ disabled: true }}
        onPanningStart={() => { setSelectedNodeId(null); setSelectedEdgeId(null); setPopupPos(null); }}
        onTransformed={(_ref, state) => {
          // Expose current scale so node chrome (handle/buttons/edges) can stay
          // viewport-readable via inverse-scale in CSS.
          document.documentElement.style.setProperty('--canvas-scale', String(state.scale || 1));
        }}
      >
        <TransformComponent wrapperStyle={{ width: '100vw', height: '100vh' }} contentStyle={{ width: WORLD_WIDTH, height: WORLD_HEIGHT }}>
          <EdgeLayer
            nodes={nodes} edges={edges}
            selectedEdgeId={selectedEdgeId}
            onSelectEdge={(edge, evt) => {
              setSelectedEdgeId(edge.id);
              setPopupPos({ x: evt.clientX, y: evt.clientY });
              setSelectedNodeId(null);
            }}
          />
          {nodes.map((n) => (
            <CanvasNode
              key={n.id} node={n}
              selected={selectedNodeId === n.id}
              onSelect={() => { setSelectedNodeId(n.id); setSelectedEdgeId(null); setPopupPos(null); }}
              onMove={(posX, posY) => {
                updateNodeLocal(n.id, { pos_x: posX, pos_y: posY });
                if (!String(n.id).startsWith('temp-')) persistNodePosition(n.id, posX, posY);
              }}
              onDelete={() => handleDeleteNode(n.id)}
              onStartEdge={(e) => startEdgeFromNode(n.id, e)}
              onMouseUpAsEdgeTarget={(e) => dropDraftEdge(e, n.id)}
              draftActive={!!draftEdge && draftEdge.sourceNodeId !== n.id}
            />
          ))}
          <DraftEdgeLayer
            nodes={nodes}
            draftEdge={draftEdge && {
              sourceNodeId: draftEdge.sourceNodeId,
              x2: clientToWorld(transformRef, draftEdge.mouseX, draftEdge.mouseY).x,
              y2: clientToWorld(transformRef, draftEdge.mouseX, draftEdge.mouseY).y
            }}
          />
        </TransformComponent>
      </TransformWrapper>

      {nodes.length === 0 && (
        <div className="canvas-empty">
          Empty canvas. Add a URL or upload a design.md from the dock below to start.
        </div>
      )}

      {selectedEdgeId && popupPos && (
        <EdgePopup
          edge={edges.find((e) => e.id === selectedEdgeId)}
          nodes={nodes}
          position={popupPos}
          onUpdate={handleUpdateEdge}
          onApply={handleApplyEdge}
          onDelete={handleDeleteEdge}
          onClose={() => { setSelectedEdgeId(null); setPopupPos(null); }}
        />
      )}

      <Superwidget
        onAddUrl={handleAddUrl}
        onUploadMd={handleUploadMd}
        nodeCount={nodes.length}
      />
    </div>
  );
}

function clientToWorld(transformRef, clientX, clientY) {
  const state = transformRef.current?.instance?.transformState;
  if (!state) return { x: clientX, y: clientY };
  const { positionX, positionY, scale } = state;
  return {
    x: (clientX - positionX) / scale,
    y: (clientY - positionY) / scale
  };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
