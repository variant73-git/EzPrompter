# Agent PromptDock — Phase 4c Implementation Plan (canvas Smart Edit entry point)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** Make Phase 4's Smart Edit dock actually reachable from the canvas. Today the plumbing exists (POST /api/chat with asset-scope, SSE consumer in editor.js, image render) but no UI affordance opens it. Phase 4c adds a "Smart Edit" button to canvas asset nodes that opens a React-native dock with the same backend flow.

**Architecture:** Skip editor-core for canvas asset nodes (no iframe to mount the editor against). Instead, a new `AssetSmartEditDock.jsx` React component lives next to PromptDock and ChatPanel — it owns its own SSE consumer + auto-confirm logic (mirroring the editor.js Phase 4 pattern but in React). CanvasNode.jsx renders a Smart Edit button overlay on asset nodes with `meta.assetId` populated. Clicking the button toggles dock visibility.

**Tech Stack:** Existing React + fetch SSE. No new deps.

**Out of scope:**
- Smart Edit for orphan asset nodes without `meta.assetId` — Phase 4b (auto-create assets row)
- Editor-core integration for asset nodes (deferred indefinitely; React component is the canvas path)
- Phase 4's editor.js canvas-mode code stays — still useful if/when extension-style flow gets unified

**Working directory:** `/Users/adilsonporto/Desktop/IA/Uncraft`. Branch: `feat/canvas`.

---

## Task 1.1: AssetSmartEditDock component

**Files:**
- Create: `packages/web-shell/components/canvas/AssetSmartEditDock.jsx`
- Create: `packages/web-shell/components/canvas/AssetSmartEditDock.test.jsx`
- Create: `packages/web-shell/components/canvas/asset-smart-edit-dock.css`

The dock is a floating panel with: textarea, send arrow, status indicator, inline image result, "Generate another" CTA. Anchored to the asset node it's editing (positioned by CanvasNode caller).

- [ ] **Step 1: Write failing test**

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AssetSmartEditDock from './AssetSmartEditDock.jsx';

beforeEach(() => {
  globalThis.fetch = vi.fn(async () => ({
    ok: true,
    body: {
      getReader: () => {
        const events = [
          'event: thread_id\ndata: {"threadId":"t1"}\n\n',
          'event: run_id\ndata: {"runId":"r1"}\n\n',
          'event: tool_call\ndata: {"id":"tc1","name":"createImage","args":{},"classification":"needs_choice"}\n\n',
          'event: tool_status\ndata: {"id":"tc1","status":"done","result":{"dataUrl":"data:image/png;base64,XYZ","assetId":"a1"}}\n\n',
          'event: run_status\ndata: {"status":"completed"}\n\n',
        ];
        let i = 0;
        return {
          read: () => Promise.resolve(
            i < events.length
              ? { value: new TextEncoder().encode(events[i++]), done: false }
              : { value: undefined, done: true }
          ),
        };
      },
    },
  }));
});

describe('AssetSmartEditDock', () => {
  it('renders textarea + send button in idle state', () => {
    render(<AssetSmartEditDock boardId="b1" assetId="a1" />);
    expect(screen.getByPlaceholderText(/tell the ai/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send/i })).toBeInTheDocument();
  });

  it('submits + shows spinner + renders result image when SSE completes', async () => {
    render(<AssetSmartEditDock boardId="b1" assetId="a1" />);
    const ta = screen.getByPlaceholderText(/tell the ai/i);
    await userEvent.type(ta, 'make it teal');
    await userEvent.click(screen.getByRole('button', { name: /send/i }));
    // After SSE completes, the rendered img with dataUrl appears
    await waitFor(() => {
      const img = screen.getByRole('img');
      expect(img.getAttribute('src')).toMatch(/^data:image\/png;base64,/);
    });
    expect(screen.getByRole('button', { name: /generate another/i })).toBeInTheDocument();
  });

  it('returns to idle when Generate another clicked', async () => {
    render(<AssetSmartEditDock boardId="b1" assetId="a1" />);
    const ta = screen.getByPlaceholderText(/tell the ai/i);
    await userEvent.type(ta, 'make it teal');
    await userEvent.click(screen.getByRole('button', { name: /send/i }));
    await waitFor(() => screen.getByRole('button', { name: /generate another/i }));
    await userEvent.click(screen.getByRole('button', { name: /generate another/i }));
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByPlaceholderText(/tell the ai/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run (FAIL)** — `cd /Users/adilsonporto/Desktop/IA/Uncraft/packages/web-shell && npm test -- components/canvas/AssetSmartEditDock.test.jsx`

- [ ] **Step 3: Implement AssetSmartEditDock.jsx**

```jsx
'use client';

import { useReducer, useRef, useCallback } from 'react';
import './asset-smart-edit-dock.css';

const initial = {
  phase: 'idle',        // idle | generating | done | error
  message: '',
  result: null,         // { dataUrl, assetId }
  err: null,
};

function reducer(state, action) {
  switch (action.type) {
    case 'SET_MESSAGE':   return { ...state, message: action.value };
    case 'SUBMIT':        return { ...state, phase: 'generating', message: '', result: null, err: null };
    case 'TOOL_DONE':     return { ...state, phase: 'done', result: action.result };
    case 'ERROR':         return { ...state, phase: 'error', err: action.err };
    case 'RESET_TO_IDLE': return { ...initial };
    default:              return state;
  }
}

async function postConfirm({ runId, toolCallId, action, choice }) {
  return fetch('/api/chat/confirm', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ runId, toolCallId, action, ...(choice ? { choice } : {}) }),
  });
}

export default function AssetSmartEditDock({ boardId, assetId, onResult, onClose }) {
  const [state, dispatch] = useReducer(reducer, initial);
  const runIdRef = useRef(null);
  const taRef = useRef(null);

  const submit = useCallback(async () => {
    const msg = state.message.trim();
    if (!msg || !boardId || !assetId) return;
    runIdRef.current = null;
    dispatch({ type: 'SUBMIT' });

    let res;
    try {
      res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          boardId,
          threadScope: 'asset',
          assetId,
          message: msg,
          tools: ['createImage', 'getNodeOutput'],
          systemPromptKey: 'EDIT_IMAGE_SYSTEM',
        }),
      });
    } catch (err) {
      dispatch({ type: 'ERROR', err: String(err?.message || err) });
      return;
    }
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      dispatch({ type: 'ERROR', err: `HTTP ${res.status}: ${t || 'request failed'}` });
      return;
    }

    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    let sawToolDone = false;

    while (true) {
      const r = await reader.read();
      if (r.done) break;
      buf += dec.decode(r.value);
      let idx;
      while ((idx = buf.indexOf('\n\n')) !== -1) {
        const block = buf.slice(0, idx); buf = buf.slice(idx + 2);
        const lines = block.split('\n');
        const ev = lines.find((l) => l.startsWith('event:'))?.slice(6).trim();
        const dt = lines.find((l) => l.startsWith('data:'))?.slice(5).trim();
        if (!ev || !dt) continue;
        let payload;
        try { payload = JSON.parse(dt); } catch (_) { continue; }

        if (ev === 'run_id') {
          runIdRef.current = payload.runId;
        } else if (ev === 'needs_choice') {
          // Single-choice → auto-confirm. Multi-choice (Claude+auto) →
          // pick first as Phase 4c MVP fallback. Phase 4d adds inline picker.
          if (Array.isArray(payload.choices) && payload.choices.length > 0 && runIdRef.current) {
            postConfirm({
              runId: runIdRef.current,
              toolCallId: payload.id,
              action: 'confirm',
              choice: payload.choices[0].id,
            });
          }
        } else if (ev === 'tool_status') {
          if (payload.status === 'done' && payload.result?.dataUrl) {
            sawToolDone = true;
            dispatch({ type: 'TOOL_DONE', result: payload.result });
            onResult?.(payload.result);
          } else if (payload.status === 'error') {
            dispatch({ type: 'ERROR', err: payload.error || 'tool error' });
          }
        } else if (ev === 'run_status') {
          if (payload.status === 'failed' || payload.status === 'hard_limited' ||
              payload.status === 'cancelled' || payload.status === 'cancelled_softpause') {
            dispatch({ type: 'ERROR', err: payload.err || `agent run ${payload.status}` });
          } else if (payload.status === 'completed' && !sawToolDone) {
            dispatch({ type: 'ERROR', err: 'Agent did not generate an image. Try a more specific instruction.' });
          }
        }
      }
    }
  }, [state.message, boardId, assetId, onResult]);

  const isGenerating = state.phase === 'generating';
  const showResult = state.phase === 'done' && state.result?.dataUrl;
  const showError = state.phase === 'error';

  return (
    <div className="asset-smart-edit-dock">
      <div className="asmd-header">
        <span className="asmd-title">Smart Edit</span>
        {onClose && (
          <button type="button" className="asmd-close" onClick={onClose} aria-label="Close">×</button>
        )}
      </div>

      {!showResult && (
        <>
          <textarea
            ref={taRef}
            className="asmd-textarea"
            placeholder="Tell the AI how to change this image…"
            value={state.message}
            onChange={(e) => dispatch({ type: 'SET_MESSAGE', value: e.target.value })}
            disabled={isGenerating}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            rows={2}
          />
          <div className="asmd-actions">
            <button
              type="button"
              className="asmd-send"
              onClick={submit}
              disabled={isGenerating || !state.message.trim()}
              aria-label="Send"
            >
              {isGenerating ? <span className="asmd-spinner" /> : '↑'}
            </button>
          </div>
        </>
      )}

      {showResult && (
        <div className="asmd-result">
          <img src={state.result.dataUrl} alt="Generated" className="asmd-result-img" />
          <button
            type="button"
            className="asmd-again"
            onClick={() => dispatch({ type: 'RESET_TO_IDLE' })}
          >
            Generate another
          </button>
        </div>
      )}

      {showError && (
        <div className="asmd-error">
          {state.err}
          <button
            type="button"
            className="asmd-again"
            onClick={() => dispatch({ type: 'RESET_TO_IDLE' })}
          >
            Try again
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Implement asset-smart-edit-dock.css**

```css
.asset-smart-edit-dock {
  background: var(--bg-frosted, rgba(10, 10, 10, 0.72));
  backdrop-filter: blur(28px) saturate(140%);
  -webkit-backdrop-filter: blur(28px) saturate(140%);
  border: 1px solid var(--border-frosted, rgba(255, 255, 255, 0.08));
  border-radius: var(--radius-md, 18px);
  box-shadow: var(--shadow-frost, 0 16px 60px rgba(0, 0, 0, 0.55));
  padding: 12px;
  width: 320px;
  color: var(--text-primary, #f5f5f5);
  font-family: var(--popup-font-sans, system-ui);
  font-size: 13px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.asmd-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.asmd-title {
  font-weight: 500;
  font-size: 12px;
  opacity: 0.85;
}
.asmd-close {
  background: none;
  border: none;
  color: var(--text-muted, rgba(245, 245, 245, 0.5));
  cursor: pointer;
  font-size: 18px;
  line-height: 1;
  padding: 2px 6px;
}
.asmd-close:hover { color: var(--text-primary, #f5f5f5); }
.asmd-textarea {
  width: 100%;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  padding: 8px 10px;
  color: inherit;
  font-family: inherit;
  font-size: 13px;
  resize: none;
}
.asmd-textarea:focus { outline: 1px solid rgba(186, 230, 253, 0.4); }
.asmd-actions {
  display: flex;
  justify-content: flex-end;
}
.asmd-send {
  background: rgba(56, 189, 248, 0.18);
  border: 1px solid rgba(56, 189, 248, 0.35);
  color: rgba(186, 230, 253, 0.95);
  border-radius: 999px;
  width: 28px;
  height: 28px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.asmd-send:disabled { opacity: 0.4; cursor: not-allowed; }
.asmd-send:hover:not(:disabled) { background: rgba(56, 189, 248, 0.28); }
.asmd-spinner {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 1.5px solid rgba(255, 255, 255, 0.2);
  border-top-color: rgba(186, 230, 253, 0.95);
  animation: asmd-spin 0.8s linear infinite;
}
@keyframes asmd-spin { to { transform: rotate(360deg); } }
.asmd-result {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.asmd-result-img {
  width: 100%;
  border-radius: 10px;
  display: block;
}
.asmd-again {
  font-family: inherit;
  font-size: 11px;
  padding: 4px 12px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  background: rgba(255, 255, 255, 0.05);
  color: inherit;
  cursor: pointer;
  align-self: flex-start;
}
.asmd-again:hover { background: rgba(255, 255, 255, 0.10); }
.asmd-error {
  color: rgba(252, 165, 165, 0.95);
  font-size: 12px;
  padding: 8px 10px;
  background: rgba(248, 113, 113, 0.10);
  border: 1px solid rgba(248, 113, 113, 0.20);
  border-radius: 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
```

- [ ] **Step 5: Run (PASS)** + **Step 6: Commit**

```bash
npm test -- components/canvas/AssetSmartEditDock.test.jsx
git add packages/web-shell/components/canvas/
git commit -m "feat(canvas): AssetSmartEditDock React component with SSE consumer"
```

---

## Task 2.1: CanvasNode Smart Edit button + dock toggle

**Files:**
- Modify: `packages/web-shell/components/CanvasNode.jsx`

- [ ] **Step 1: Add Smart Edit button overlay for asset nodes**

Find the `renderAssetBody` branch (`packages/web-shell/components/CanvasNode.jsx` ~line 875). It currently renders:

```jsx
) : renderAssetBody ? (
  <div className="cnode-body cnode-body-asset" ...>
    {node.meta?.dataUrl ? <AssetNodeImage ... /> : <div className="cnode-loading">...</div>}
  </div>
) : null}
```

Add:
1. A `useState` for `smartEditOpen` near the top of the component
2. A "Smart Edit" button overlay inside the asset body, visible only when `node.meta?.assetId` exists
3. Conditional render of `<AssetSmartEditDock>` positioned to the right of the node when open

Add at top of imports:
```jsx
import AssetSmartEditDock from './canvas/AssetSmartEditDock.jsx';
```

In the component body, add state:
```jsx
const [smartEditOpen, setSmartEditOpen] = useState(false);
```

Inside the asset body branch, modify to:

```jsx
) : renderAssetBody ? (
  <div className="cnode-body cnode-body-asset" onMouseDown={onBodyMouseDown} style={{ height: (node.height || 600) + 'px' }}>
    {node.meta?.dataUrl ? (
      <AssetNodeImage dataUrl={node.meta.dataUrl} name={node.meta?.name || 'asset'} />
    ) : (
      <div className="cnode-loading"><span>No image data</span></div>
    )}
    {node.meta?.assetId && (
      <button
        type="button"
        className="cnode-smart-edit-btn"
        onMouseDown={(e) => { e.stopPropagation(); }}
        onClick={(e) => { e.stopPropagation(); setSmartEditOpen((v) => !v); }}
        title="Smart Edit"
        aria-label="Smart Edit"
      >
        <svg viewBox="0 0 37 40" width="14" height="14" aria-hidden="true">
          <path fill="currentColor" d="M16,29.7c0,.8-.6,1.4-1.3,1.5-1,0-2.7.5-3.2,1.1-.6.6-1,2.3-1.1,3.2,0,.8-.7,1.3-1.5,1.3s-1.4-.6-1.5-1.3c0-1-.5-2.7-1.1-3.2-.6-.6-2.3-1-3.2-1.1-.8,0-1.3-.7-1.3-1.5s.6-1.4,1.3-1.5c1,0,2.7-.5,3.2-1.1.6-.6,1-2.3,1.1-3.2,0-.8.7-1.3,1.5-1.3s1.4.6,1.5,1.3c0,1,.5,2.7,1.1,3.2.6.6,2.3,1,3.2,1.1.8,0,1.3.7,1.3,1.5ZM33.3,16.7c-1.5-.2-5.8-1-7.5-2.7-1.7-1.7-2.5-6-2.7-7.5,0-.8-.7-1.3-1.5-1.3s-1.4.6-1.5,1.3c-.2,1.5-1,5.8-2.7,7.5s-6,2.5-7.5,2.7c-.8,0-1.3.7-1.3,1.5s.6,1.4,1.3,1.5c1.5.2,5.8,1,7.5,2.7s2.5,6,2.7,7.5c0,.8.7,1.3,1.5,1.3s1.4-.6,1.5-1.3c.2-1.5,1-5.8,2.7-7.5,1.7-1.7,6-2.5,7.5-2.7.8,0,1.3-.7,1.3-1.5s-.6-1.4-1.3-1.5Z"/>
        </svg>
      </button>
    )}
  </div>
) : null}
```

After the entire cnode div (or just before the closing `</div>` of `.cnode`), add the dock conditionally — positioned absolute to the right of the node:

```jsx
{smartEditOpen && node.meta?.assetId && (
  <div
    className="cnode-smart-edit-dock-wrap"
    style={{
      position: 'absolute',
      left: (node.width || 512) + 12,
      top: 0,
      zIndex: 50,
    }}
  >
    <AssetSmartEditDock
      boardId={node.board_id}
      assetId={node.meta.assetId}
      onClose={() => setSmartEditOpen(false)}
      onResult={() => {
        // Result already rendered inside the dock. Future: write back to
        // node.meta.dataUrl on the canvas so the user sees the edit
        // reflected in the node body. For Phase 4c just leave the original
        // node visible — user can drag the result into a new asset node.
      }}
    />
  </div>
)}
```

- [ ] **Step 2: Append CSS for the Smart Edit button**

Add to `packages/web-shell/components/canvas/canvas.css` (or wherever the `.cnode-body-asset` styles live — search to find):

```css
.cnode-smart-edit-btn {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 28px;
  height: 28px;
  border-radius: 999px;
  background: rgba(10, 10, 10, 0.6);
  backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 255, 255, 0.12);
  color: rgba(245, 245, 245, 0.9);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity 120ms ease;
  z-index: 10;
}
.cnode-body-asset:hover .cnode-smart-edit-btn,
.cnode.selected .cnode-smart-edit-btn {
  opacity: 1;
}
.cnode-smart-edit-btn:hover {
  background: rgba(10, 10, 10, 0.8);
  border-color: rgba(255, 255, 255, 0.20);
}
.cnode-body-asset { position: relative; }
```

(If `.cnode-body-asset` doesn't already have `position: relative`, the absolute-positioned button won't anchor correctly. Add it if missing.)

- [ ] **Step 3: Run suite**

```bash
cd /Users/adilsonporto/Desktop/IA/Uncraft/packages/web-shell && npm test
```

Expected: 149/149 (146 prior + 3 from Task 1.1).

- [ ] **Step 4: Commit**

```bash
git add packages/web-shell/components/CanvasNode.jsx packages/web-shell/components/canvas/canvas.css
git commit -m "feat(canvas): Smart Edit button + dock on asset nodes with meta.assetId"
```

---

## Task 3.1: Docs

**Files:**
- Modify: `CLAUDE.md` — append item 132
- Create: `~/.claude/projects/-Users-adilsonporto-Desktop-IA-Uncraft/memory/checkpoint_2026-05-31_050.md`
- Modify: `~/.claude/projects/-Users-adilsonporto-Desktop-IA-Uncraft/memory/MEMORY.md`

- [ ] **Step 1: Append item 132 to CLAUDE.md**

```markdown
132. ✅ **Agent PromptDock chat — Phase 4c** (sessão 2026-05-31 continuação, branch `feat/canvas`). Canvas Smart Edit entry point — fecha o E2E que Phase 4 deixou inerte. **AssetSmartEditDock.jsx** (~200 linhas): React component próprio com useReducer state machine (idle/generating/done/error), SSE consumer inline (mesmo padrão que editor.js Phase 4 mas em React), auto-confirm needs_choice via fetch /api/chat/confirm com runIdRef, render inline da generated image + "Generate another" CTA. **CanvasNode.jsx**: Smart Edit button overlay (sparkle icon) aparece em hover OU selected nos asset nodes COM `meta.assetId` populado. Click toggle smartEditOpen state. Dock renderiza positioned-absolute à direita do node quando open. **CSS**: button frosted-glass, fade in via opacity transition, dock 320px wide com mesmo design language do PromptDock (rgba(10,10,10,0.72) + backdrop-blur 28px + frosted hairline border). **Skip editor-core**: asset nodes não têm iframe, então CanvasEditorCore mount não se aplica — React-native component é o canvas path. Editor.js Phase 4 canvas-mode code fica como fallback futuro. **Constraint Phase 4c MVP**: ainda exige meta.assetId (Phase 4b backfills orphans). needs_choice Claude+auto auto-picks first (Phase 4d adds inline picker). Memo: [[checkpoint_2026-05-31_050]]. Plan: `docs/superpowers/plans/2026-06-01-agent-promptdock-phase4c.md`.
```

- [ ] **Step 2: Create checkpoint + update MEMORY.md**

`checkpoint_2026-05-31_050.md`:

```markdown
---
name: checkpoint-2026-05-31-050
description: Phase 4c — canvas Smart Edit entry point. AssetSmartEditDock React + button overlay on asset nodes. Closes Phase 4 E2E.
metadata:
  type: project
---

Phase 4c shipped. The Phase 4 plumbing (asset-scope chat backend + editor.js canvas SSE) is now actually reachable from the canvas via a new React component.

**Architecture decision**: skip editor-core for canvas asset nodes. React-native AssetSmartEditDock is the canvas path. Editor.js Phase 4 code stays as fallback (extension still uses chrome.runtime; future unification can pick either path).

**Why React instead of reusing editor.js**: asset nodes don't have iframes, so CanvasEditorCore (which mounts editor against an iframe) doesn't apply. The React component is cleaner state management + integrates naturally with the rest of CanvasNode.jsx.

**MVP constraints carried forward**: meta.assetId required (Phase 4b backfills), needs_choice multi-option auto-picks first (Phase 4d adds picker).

**Smoke tests pending**:
1. Generate image via PromptDock with attachToBoard → hover on asset node → Smart Edit button appears
2. Click Smart Edit → dock opens to the right of node
3. Type "make it red" + Enter → spinner → image regenerates inline
4. Click "Generate another" → returns to textarea
5. Click X → dock closes

Related: [[checkpoint_2026-05-31_049]] (Phase 4 plumbing). Plan: `docs/superpowers/plans/2026-06-01-agent-promptdock-phase4c.md`.
```

MEMORY.md top entry:

```markdown
- [checkpoint_2026-05-31_050.md](./checkpoint_2026-05-31_050.md) — ACTIVE: Agent PromptDock Phase 4c — canvas Smart Edit entry point. AssetSmartEditDock.jsx React component + CanvasNode Smart Edit button overlay. Closes Phase 4 E2E (was inert before). meta.assetId required (4b backfills).
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "$(cat <<'EOF'
docs: Phase 4c — canvas Smart Edit entry point shipped

AssetSmartEditDock + CanvasNode button overlay. Closes E2E gap
flagged in Phase 4 final review.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Execution handoff

Plan saved to `docs/superpowers/plans/2026-06-01-agent-promptdock-phase4c.md`. Execute via subagent-driven-development continuing on branch `feat/canvas`.

Expected: ~3 commits, ~3 new tests, total suite 146 → 149.
