'use client';

import { useLayoutEffect, useRef, useState } from 'react';

// A chip is a PILL only while its content fits on one line. The moment the
// text wraps (full prompts are never truncated), the 999px pill radius reads
// broken — so wrapped chips become rounded rectangles instead. Measured via
// ResizeObserver because CSS alone can't detect line wrapping.
const SINGLE_LINE_MAX_PX = 40;

function useMultiline() {
  const ref = useRef(null);
  const [multiline, setMultiline] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const check = () => setMultiline(el.offsetHeight > SINGLE_LINE_MAX_PX);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, multiline];
}

export default function ToolChip({
  toolName, status, args, result, error,
  summary, choices,
  onConfirm, onSkip, onChoose,
}) {
  const [chipRef, multiline] = useMultiline();
  const cls = `tool-chip tool-chip-${status}${multiline ? ' tool-chip-multiline' : ''}`;
  const icon = (
    status === 'done'             ? '✓'
    : status === 'error'          ? '✕'
    : status === 'skipped'        ? '⊘'
    : status === 'stale'          ? '·'
    : status === 'awaiting_confirm' || status === 'awaiting_choice' ? '⚠'
    : null
  );

  const summaryNode = (
    summary
      ? summary
      : result ? summarizeResult(toolName, result)
      : null
  );

  // When asking the user a question (confirm / choice), the chip is a plain
  // human sentence — no code-y tool name prefix, shown in FULL (wraps to as
  // many lines as needed, never clipped). Status chips (running / done /
  // error) keep the tool name as a label.
  const isPrompt = status === 'awaiting_confirm' || status === 'awaiting_choice';

  return (
    <div ref={chipRef} className={cls} data-tool={toolName} data-status={status}>
      <span className="tool-chip-icon">
        {icon || <span role="status" className="tool-chip-spinner" aria-label="working" />}
      </span>
      {isPrompt ? (
        summaryNode && <span className="tool-chip-prompt">{summaryNode}</span>
      ) : (
        <>
          <span className="tool-chip-name">{toolName}</span>
          {summaryNode && <span className="tool-chip-summary"><span className="tool-chip-sep"> — </span><span className="tool-chip-summary-text">{summaryNode}</span></span>}
          {error && <span className="tool-chip-error"><span className="tool-chip-sep"> — </span>{error}</span>}
          {status === 'skipped' && <span className="tool-chip-skipped-label"><span className="tool-chip-sep"> — </span>skipped</span>}
          {status === 'stale' && <span className="tool-chip-stale-label"><span className="tool-chip-sep"> — </span>interrupted</span>}
        </>
      )}

      {status === 'awaiting_confirm' && (
        <span className="tool-chip-actions">
          <button type="button" className="tool-chip-btn tool-chip-confirm" onClick={() => onConfirm?.()}>Confirm</button>
          <button type="button" className="tool-chip-btn tool-chip-skip" onClick={() => onSkip?.()}>Skip</button>
        </span>
      )}
      {status === 'awaiting_choice' && (
        <span className="tool-chip-actions">
          {(choices || []).map((c) => (
            <button
              key={c.id}
              type="button"
              className="tool-chip-btn tool-chip-choice"
              title={c.hint || ''}
              onClick={() => onChoose?.(c.id)}
            >
              {c.label}
            </button>
          ))}
          <button type="button" className="tool-chip-btn tool-chip-skip" onClick={() => onSkip?.()}>Skip</button>
        </span>
      )}
    </div>
  );
}

function summarizeResult(toolName, result) {
  if (!result) return null;
  switch (toolName) {
    case 'createNode':  return result.id ? `created ${result.id.slice(0, 8)}` : 'created';
    case 'addEdge':     return result.id ? `edge ${result.id.slice(0, 8)}` : 'connected';
    case 'updateNode':  return 'updated';
    case 'queryNodes':  return `${Array.isArray(result) ? result.length : '?'} nodes`;
    case 'listAssets':  return `${Array.isArray(result) ? result.length : '?'} assets`;
    case 'getNodeOutput': return result.truncated ? 'output (truncated)' : 'output';
    case 'deleteNode':  return result.deleted ? `deleted ${String(result.id || '').slice(0, 8)}` : null;
    case 'runFlow':     return result.ran ? `ran flow (${result.bytes || '?'} bytes)` : null;
    case 'editSite':    return result.edited ? `edited site` : null;
    default: return null;
  }
}
