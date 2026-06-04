'use client';

export default function ToolChip({
  toolName, status, args, result, error,
  summary, choices,
  onConfirm, onSkip, onChoose,
}) {
  const cls = `tool-chip tool-chip-${status}`;
  const icon = (
    status === 'done'             ? '✓'
    : status === 'error'          ? '✕'
    : status === 'skipped'        ? '⊘'
    : status === 'awaiting_confirm' || status === 'awaiting_choice' ? '⚠'
    : null
  );

  const summaryNode = (
    summary
      ? summary
      : result ? summarizeResult(toolName, result)
      : null
  );

  return (
    <div className={cls} data-tool={toolName} data-status={status}>
      <span className="tool-chip-icon">
        {icon || <span role="status" className="tool-chip-spinner" aria-label="working" />}
      </span>
      <span className="tool-chip-name">{toolName}</span>
      {summaryNode && <span className="tool-chip-summary"><span className="tool-chip-sep"> — </span><span className="tool-chip-summary-text">{summaryNode}</span></span>}
      {error && <span className="tool-chip-error"><span className="tool-chip-sep"> — </span>{error}</span>}
      {status === 'skipped' && <span className="tool-chip-skipped-label"><span className="tool-chip-sep"> — </span>skipped</span>}

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
