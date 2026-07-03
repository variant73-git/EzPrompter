'use client';

import { useEffect, useRef, useState } from 'react';

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
  function moveHint(e) {
    const el = hintRef.current;
    if (!el) return;
    const r = e.currentTarget.getBoundingClientRect();
    // Client px → node-local world px (the node is scaled by the canvas).
    const scale = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--canvas-scale')) || 1;
    const x = (e.clientX - r.left) / scale;
    const y = (e.clientY - r.top) / scale;
    // The gap from the cursor is screen-constant too (the tag itself
    // inflates 1/scale in CSS — a fixed world gap would tuck the inflated
    // tag under the pointer at low zoom).
    el.style.transform = `translate(${x + 14 / scale}px, ${y + 16 / scale}px)`;
  }

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
