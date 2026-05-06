'use client';

import { useEffect, useRef, useState } from 'react';

export default function PromptBody({ node, onChange }) {
  const initial = node.meta?.prompt || '';
  const [text, setText] = useState(initial);
  const taRef = useRef(null);
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

  return (
    <div className="cnode-prompt-body" onMouseDown={stop}>
      <textarea
        ref={taRef}
        className="cnode-prompt-textarea"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onMouseDown={stop}
        onKeyDown={stop}
        placeholder="Type a prompt…"
        spellCheck={false}
      />
    </div>
  );
}
