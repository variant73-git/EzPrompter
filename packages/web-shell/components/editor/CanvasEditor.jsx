'use client';

import { useState, useEffect, useCallback } from 'react';
import EditorOverlay from './EditorOverlay.jsx';
import EditorLayers from './EditorLayers.jsx';
import EditorInspector from './EditorInspector.jsx';
import { api } from '../../lib/canvas-api.js';

/**
 * CanvasEditor — controller mounted by CanvasNode (or the canvas) when a
 * node enters edit mode. Owns selection state. Renders panels (Layers,
 * Inspector) in the parent document, NOT inside the iframe.
 *
 * Direct DOM access is OK because all node iframes are same-origin
 * (srcDoc + sandbox=allow-same-origin allow-scripts).
 */
export default function CanvasEditor({ iframe, node, onExit, onSnapshotSaved }) {
  const [selectedEl, setSelectedEl] = useState(null);
  const [hoverEl, setHoverEl] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  // Hook: capture clicks/hovers inside iframe, set selection.
  useEffect(() => {
    if (!iframe?.contentDocument) return;
    const doc = iframe.contentDocument;

    function onClick(e) {
      e.preventDefault();
      e.stopPropagation();
      setSelectedEl(e.target);
    }
    function onOver(e) { setHoverEl(e.target); }
    function onOut() { setHoverEl(null); }
    function onMouseDown(e) {
      // Block native click default (links, form submits) inside the captured page.
      e.preventDefault();
    }

    doc.addEventListener('click', onClick, true);
    doc.addEventListener('mouseover', onOver, true);
    doc.addEventListener('mouseout', onOut, true);
    doc.addEventListener('mousedown', onMouseDown, true);
    doc.addEventListener('submit', (e) => e.preventDefault(), true);

    // Disable cursor: pointer link feel
    const style = doc.createElement('style');
    style.setAttribute('data-uncraft-edit', '');
    style.textContent = `* { cursor: default !important; } a { pointer-events: auto; }`;
    doc.head.appendChild(style);

    return () => {
      doc.removeEventListener('click', onClick, true);
      doc.removeEventListener('mouseover', onOver, true);
      doc.removeEventListener('mouseout', onOut, true);
      doc.removeEventListener('mousedown', onMouseDown, true);
      style.remove();
    };
  }, [iframe]);

  // Esc to exit edit (unless typing in a panel).
  useEffect(() => {
    function onKey(e) {
      const t = e.target?.tagName;
      if (t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT') return;
      if (e.key === 'Escape') { onExit?.(); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onExit]);

  const markDirty = useCallback(() => setDirty(true), []);

  async function save() {
    if (!iframe?.contentDocument) return;
    setSaving(true);
    try {
      const html = '<!DOCTYPE html>' + iframe.contentDocument.documentElement.outerHTML;
      const res = await api.saveNodeEdit(node.id, html);
      setDirty(false);
      onSnapshotSaved?.(res);
    } catch (e) {
      alert(`Save failed: ${e.message}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <EditorOverlay iframe={iframe} selectedEl={selectedEl} hoverEl={hoverEl} />
      <EditorLayers
        iframe={iframe}
        selectedEl={selectedEl}
        onSelect={setSelectedEl}
        onHover={setHoverEl}
      />
      <EditorInspector
        iframe={iframe}
        selectedEl={selectedEl}
        onChange={markDirty}
      />
      <div className="editor-toolbar">
        <span className="editor-tag">{dirty ? 'Unsaved' : 'No changes'}</span>
        <button className="editor-btn" onClick={save} disabled={!dirty || saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button className="editor-btn editor-btn-exit" onClick={onExit}>
          {dirty ? 'Discard & exit' : 'Exit edit'}
        </button>
      </div>
    </>
  );
}
