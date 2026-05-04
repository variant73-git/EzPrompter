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
  const [emptyDropMenu, setEmptyDropMenu] = useState(null);  // {sourceNodeId, x, y, worldX, worldY}
  const [editingNodeId, setEditingNodeId] = useState(null);
  const transformRef = useRef(null);
  const fileInputRef = useRef(null);
  const fileInputAcceptRef = useRef('');
  const fileInputResolverRef = useRef(null);

  const updateNodeLocal = useCallback((id, patch) => {
    setNodes((prev) => prev.map((n) => (n.id === id ? { ...n, ...patch } : n)));
  }, []);

  const dragNodeServer = useRef(new Map());
  function persistNodePosition(id, posX, posY) {
    clearTimeout(dragNodeServer.current.get(id));
    const t = setTimeout(() => api.updateNode(id, { posX, posY }).catch(console.warn), 250);
    dragNodeServer.current.set(id, t);
  }

  function nextNodePosition(opts = {}) {
    if (opts.worldX != null && opts.worldY != null) return { posX: opts.worldX, posY: opts.worldY };
    // Cascade if no position given
    const offset = nodes.length * 40;
    return { posX: 200 + offset, posY: 200 + offset };
  }

  async function autoLinkNewNode(sourceNodeId, newNodeId) {
    if (!sourceNodeId || !newNodeId) return;
    try {
      const { edge } = await api.createEdge({
        boardId: board.id, sourceNodeId, targetNodeId: newNodeId,
        kind: 'transplant', payload: { sourceSelector: 'body', targetSelector: 'body' }
      });
      setEdges((prev) => [...prev, edge]);
    } catch (e) { console.warn('auto-link failed', e); }
  }

  async function handleAddUrl(url, opts = {}) {
    const id = `temp-${Date.now()}`;
    const { posX, posY } = nextNodePosition(opts);
    const width = 1280, height = 800;
    const placeholderNode = {
      id, kind: 'site', origin_url: url,
      pos_x: posX, pos_y: posY, width, height,
      is_main: nodes.length === 0,
      current_html: null, _loading: true
    };
    setNodes((prev) => [...prev, placeholderNode]);

    try {
      const cap = await api.captureUrl(url);
      const created = await api.createNode({
        boardId: board.id, kind: 'site', originUrl: url,
        posX, posY, width, height,
        isMain: nodes.length === 0,
        html: cap.html
      });
      setNodes((prev) => prev.map((n) => (n.id === id ? {
        ...created.node,
        current_html: cap.html,
        current_screenshot: cap.screenshotDataUrl,
        _loading: false
      } : n)));
      if (opts.linkFromNodeId) await autoLinkNewNode(opts.linkFromNodeId, created.node.id);
    } catch (e) {
      console.error(e);
      setNodes((prev) => prev.filter((n) => n.id !== id));
      alert(`Capture failed: ${e.message}`);
    }
  }

  async function handleUploadHtml(file, opts = {}) {
    const html = await file.text();
    if (!/^<!doctype|<html/i.test(html.trim())) {
      alert('File does not look like a complete HTML document.');
      return;
    }
    const { posX, posY } = nextNodePosition(opts);
    try {
      const created = await api.createNode({
        boardId: board.id, kind: 'site',
        posX, posY, width: 1280, height: 800,
        meta: { name: file.name, source: 'upload' },
        html
      });
      setNodes((prev) => [...prev, { ...created.node, current_html: html }]);
      if (opts.linkFromNodeId) await autoLinkNewNode(opts.linkFromNodeId, created.node.id);
    } catch (e) { alert(`Upload failed: ${e.message}`); }
  }

  async function handleUploadMd(file, opts = {}) {
    const text = await file.text();
    const { posX, posY } = nextNodePosition(opts);
    try {
      const created = await api.createNode({
        boardId: board.id, kind: 'designmd',
        posX, posY, width: 540, height: 720,
        meta: { name: file.name },
        html: `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{font-family:ui-monospace,monospace;padding:24px;line-height:1.6;color:#1f2937;background:#fafafa;white-space:pre-wrap;word-wrap:break-word;}</style></head><body>${escapeHtml(text)}</body></html>`,
        designMd: text
      });
      setNodes((prev) => [...prev, { ...created.node, current_html: created.node.current_html || '', current_design_md: text }]);
      if (opts.linkFromNodeId) await autoLinkNewNode(opts.linkFromNodeId, created.node.id);
    } catch (e) { alert(`Upload failed: ${e.message}`); }
  }

  function pickFile(accept) {
    return new Promise((resolve) => {
      fileInputAcceptRef.current = accept;
      fileInputResolverRef.current = resolve;
      if (fileInputRef.current) {
        fileInputRef.current.accept = accept;
        fileInputRef.current.value = '';
        fileInputRef.current.click();
      }
    });
  }

  function onFileInputChange(e) {
    const file = e.target.files?.[0];
    const r = fileInputResolverRef.current;
    fileInputResolverRef.current = null;
    if (r) r(file || null);
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

  async function handleGlobalMouseUp(e) {
    if (!draftEdge) return;
    const src = draftEdge.sourceNodeId;
    // Resolve target via DOM walk: was the mouseup over a .cnode?
    const cnode = e.target?.closest?.('.cnode');
    const targetId = cnode?.dataset?.nodeId || null;
    setDraftEdge(null);

    if (targetId && targetId !== src) {
      try {
        const { edge } = await api.createEdge({
          boardId: board.id, sourceNodeId: src, targetNodeId: targetId,
          kind: 'transplant', payload: { sourceSelector: 'body', targetSelector: 'body' }
        });
        setEdges((prev) => [...prev, edge]);
        setSelectedEdgeId(edge.id);
        setPopupPos({ x: e.clientX, y: e.clientY });
      } catch (err) { alert(`Edge create failed: ${err.message}`); }
      return;
    }

    if (!targetId) {
      // Empty drop → show creation menu near cursor.
      const w = clientToWorld(transformRef, e.clientX, e.clientY);
      setEmptyDropMenu({ sourceNodeId: src, x: e.clientX, y: e.clientY, worldX: w.x, worldY: w.y });
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

  function zoomToNode(node, animationTime = 350) {
    const t = transformRef.current;
    if (!t || !node) return;
    const PAD = 80;
    const vw = window.innerWidth;
    const vh = window.innerHeight - 48;
    const nodeW = node.width + PAD * 2;
    // Use stored height + topbar room (fall back to 800 if unknown).
    const nodeH = (node.height || 800) + PAD * 2 + 60;
    const scale = Math.min(vw / nodeW, vh / nodeH, 1.0);
    const centerX = node.pos_x + node.width / 2;
    const centerY = node.pos_y + (node.height || 800) / 2;
    const posX = vw / 2 - centerX * scale;
    const posY = (vh / 2 + 48) - centerY * scale;
    t.setTransform(posX, posY, scale, animationTime);
  }

  function handleEditingToggle(nodeId, willEdit) {
    if (willEdit) {
      setEditingNodeId(nodeId);
      const node = nodes.find((n) => n.id === nodeId);
      if (node) setTimeout(() => zoomToNode(node), 50);
    } else {
      setEditingNodeId(null);
    }
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

  // Block browser-level zoom (Cmd/Ctrl + wheel, trackpad pinch sends ctrlKey)
  // so it doesn't compete with the canvas's own pan/zoom.
  useEffect(() => {
    function onWheelCapture(e) {
      if (e.ctrlKey || e.metaKey) e.preventDefault();
    }
    function onKeyZoom(e) {
      if ((e.metaKey || e.ctrlKey) && (e.key === '=' || e.key === '+' || e.key === '-' || e.key === '_')) {
        e.preventDefault();
      }
    }
    document.addEventListener('wheel', onWheelCapture, { passive: false, capture: true });
    document.addEventListener('keydown', onKeyZoom);
    return () => {
      document.removeEventListener('wheel', onWheelCapture, { capture: true });
      document.removeEventListener('keydown', onKeyZoom);
    };
  }, []);

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
    <div className="canvas-shell" onMouseMove={moveDraftEdge} onMouseUp={handleGlobalMouseUp}>
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
              editing={editingNodeId === n.id}
              onEditingChange={(willEdit) => handleEditingToggle(n.id, willEdit)}
              onSelect={() => { setSelectedNodeId(n.id); setSelectedEdgeId(null); setPopupPos(null); }}
              onMove={(posX, posY) => {
                updateNodeLocal(n.id, { pos_x: posX, pos_y: posY });
                if (!String(n.id).startsWith('temp-')) persistNodePosition(n.id, posX, posY);
              }}
              onDelete={() => handleDeleteNode(n.id)}
              onStartEdge={(e) => startEdgeFromNode(n.id, e)}
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

      {emptyDropMenu && (
        <EmptyDropMenu
          x={emptyDropMenu.x}
          y={emptyDropMenu.y}
          onClose={() => setEmptyDropMenu(null)}
          onPickUrl={async (url) => {
            const m = emptyDropMenu;
            setEmptyDropMenu(null);
            await handleAddUrl(url, { worldX: m.worldX, worldY: m.worldY, linkFromNodeId: m.sourceNodeId });
          }}
          onPickHtml={async () => {
            const m = emptyDropMenu;
            const file = await pickFile('.html,.htm,text/html');
            setEmptyDropMenu(null);
            if (file) await handleUploadHtml(file, { worldX: m.worldX, worldY: m.worldY, linkFromNodeId: m.sourceNodeId });
          }}
          onPickMd={async () => {
            const m = emptyDropMenu;
            const file = await pickFile('.md,.markdown,text/markdown,text/plain');
            setEmptyDropMenu(null);
            if (file) await handleUploadMd(file, { worldX: m.worldX, worldY: m.worldY, linkFromNodeId: m.sourceNodeId });
          }}
        />
      )}

      <input ref={fileInputRef} type="file" onChange={onFileInputChange} style={{ display: 'none' }} />

      <Superwidget
        onAddUrl={handleAddUrl}
        onUploadMd={handleUploadMd}
        nodeCount={nodes.length}
      />
    </div>
  );
}

function EmptyDropMenu({ x, y, onClose, onPickUrl, onPickHtml, onPickMd }) {
  const [mode, setMode] = useState('choices');  // 'choices' | 'url'
  const [url, setUrl] = useState('');
  const left = Math.min(x + 8, window.innerWidth - 280);
  const top = Math.min(y + 8, window.innerHeight - 200);
  return (
    <div className="empty-drop-menu" style={{ left, top }} onMouseDown={(e) => e.stopPropagation()}>
      {mode === 'choices' ? (
        <>
          <div className="edm-title">Connect to…</div>
          <button onClick={() => setMode('url')}>🌐&nbsp; URL of a website</button>
          <button onClick={onPickHtml}>📄&nbsp; Upload an HTML file</button>
          <button onClick={onPickMd}>📝&nbsp; Upload a design.md</button>
          <button className="edm-cancel" onClick={onClose}>Cancel (Esc)</button>
        </>
      ) : (
        <>
          <div className="edm-title">URL of website</div>
          <input
            autoFocus type="url" placeholder="https://example.com"
            value={url} onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && url) onPickUrl(url);
              if (e.key === 'Escape') onClose();
            }}
          />
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => setMode('choices')} className="edm-cancel">← Back</button>
            <button onClick={() => onPickUrl(url)} disabled={!/^https?:\/\//i.test(url)} className="edm-primary">Capture →</button>
          </div>
        </>
      )}
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
