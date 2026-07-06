'use client';

import { useEffect, useRef, useState } from 'react';
import { readCanvasScale, chromeScale } from '../../lib/canvas-scale.js';

// Prompt node body — move-first interaction (2026-07-03, user spec):
// the WHOLE node area drags the node (grab hand, same as every other
// node); DOUBLE-CLICK enters edit mode to type the prompt. While hovering
// in move mode, a small tag follows the cursor: "Double-click to edit".
// Edit mode exits on blur (click anywhere outside the field).
export default function PromptBody({ node, onChange }) {
  const initial = node.meta?.prompt || '';
  const [text, setText] = useState(initial);
  const [editing, setEditing] = useState(false);
  const taRef = useRef(null);
  const hintRef = useRef(null);
  const flushTimer = useRef(null);

  // Persist after a short debounce so typing isn't blocked by the API.
  useEffect(() => {
    if (text === initial) return;
    clearTimeout(flushTimer.current);
    flushTimer.current = setTimeout(() => {
      onChange?.(text);
    }, 400);
    return () => clearTimeout(flushTimer.current);
  }, [text, initial, onChange]);

  // Stop drag/select propagation so typing doesn't move the node.
  function stop(e) { e.stopPropagation(); }

  function enterEdit(e) {
    e.stopPropagation();
    setEditing(true);
    // Focus after the re-render enables pointer events on the textarea.
    requestAnimationFrame(() => taRef.current?.focus());
  }

  // Cursor-follow hint — direct DOM writes (mousemove fires at 60+Hz;
  // setState here would re-render the node every frame for nothing).
  // lastClientRef remembers the cursor so the zoom listener below can
  // re-sync the tag when the scale changes WITHOUT a mousemove.
  const lastClientRef = useRef(null);
  function applyHint(clientX, clientY) {
    const el = hintRef.current;
    if (!el || !el.parentElement) return;
    const r = el.parentElement.getBoundingClientRect();
    // Client px → node-local world px (the node is scaled by the canvas).
    // readCanvasScale reads the LIVE transform (no reflow, not the
    // quantized CSS var). The COUNTER-SCALE divisor comes from
    // chromeScale (0.4-floored, or 1 under world-lock) to match the CSS.
    const live = readCanvasScale();
    const x = (clientX - r.left) / live;
    const y = (clientY - r.top) / live;
    const scale = chromeScale(live);
    // Screen-constant size via transform: the tag is styled at its natural
    // px size and counter-scaled here (composite-only, no layout steps —
    // the old CSS padding/font ÷ scale re-laid it out on every quantized
    // scale write). The cursor gap stays screen-constant for the same
    // reason (a fixed world gap would tuck the tag under the pointer at
    // low zoom).
    el.style.transform = `translate(${x + 14 / scale}px, ${y + 16 / scale}px) scale(${1 / scale})`;
  }
  function moveHint(e) {
    lastClientRef.current = { x: e.clientX, y: e.clientY };
    applyHint(e.clientX, e.clientY);
  }
  // Zoom without mousemove: re-sync the tag on the quantized scale steps
  // (same event the edge layer follows) so it never rides the world scale.
  useEffect(() => {
    function onScale() {
      const p = lastClientRef.current;
      if (p) applyHint(p.x, p.y);
    }
    window.addEventListener('uncraft:canvas-scale', onScale);
    return () => window.removeEventListener('uncraft:canvas-scale', onScale);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className={`cnode-prompt-body${editing ? ' editing' : ''}`}
      onMouseDown={editing ? stop : undefined}
      onDoubleClick={editing ? undefined : enterEdit}
      onMouseMove={editing ? undefined : moveHint}
    >
      <textarea
        ref={taRef}
        className="cnode-prompt-textarea"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onMouseDown={stop}
        onKeyDown={stop}
        onBlur={() => setEditing(false)}
        placeholder="Type a prompt…"
        spellCheck={false}
        readOnly={!editing}
        tabIndex={editing ? 0 : -1}
      />
      {!editing && (
        <span ref={hintRef} className="cnode-prompt-hint" aria-hidden="true">
          Double-click to edit
        </span>
      )}
    </div>
  );
}
