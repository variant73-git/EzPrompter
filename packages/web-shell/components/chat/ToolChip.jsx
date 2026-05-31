'use client';

// Phase 1: only handles `pending | running | done | error` states for safe tools.
// `awaiting_confirm`, `awaiting_choice`, `skipped` will be added in Phase 2.
export default function ToolChip({ toolName, status, args, result, error }) {
  const isWorking = status === 'pending' || status === 'running';
  const icon = status === 'done' ? '✓' : status === 'error' ? '✕' : null;
  const cls = `tool-chip tool-chip-${status}`;

  // Render a short, human-friendly summary of result if present.
  const summary = result && summarizeResult(toolName, result);

  return (
    <div className={cls} data-tool={toolName} data-status={status}>
      <span className="tool-chip-icon">
        {icon || <span role="status" className="tool-chip-spinner" aria-label="working" />}
      </span>
      <span className="tool-chip-name">{toolName}</span>
      {summary && <span className="tool-chip-summary"> — {summary}</span>}
      {error && <span className="tool-chip-error"> — {error}</span>}
    </div>
  );
}

function summarizeResult(toolName, result) {
  if (!result) return null;
  switch (toolName) {
    case 'createNode': return result.id ? `created ${result.id.slice(0, 8)}` : 'created';
    case 'addEdge':    return result.id ? `edge ${result.id.slice(0, 8)}` : 'connected';
    case 'updateNode': return 'updated';
    case 'queryNodes': return `${Array.isArray(result) ? result.length : '?'} nodes`;
    case 'listAssets': return `${Array.isArray(result) ? result.length : '?'} assets`;
    case 'getNodeOutput': return result.truncated ? 'output (truncated)' : 'output';
    default: return null;
  }
}
