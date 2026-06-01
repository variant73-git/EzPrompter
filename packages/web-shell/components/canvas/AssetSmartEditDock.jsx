'use client';

import { useReducer, useRef, useCallback, useEffect } from 'react';
import './asset-smart-edit-dock.css';

const initial = {
  phase: 'idle',
  message: '',
  result: null,
  err: null,
  pendingChoice: null, // { toolCallId, choices } when awaiting pick
};

function reducer(state, action) {
  switch (action.type) {
    case 'SET_MESSAGE':   return { ...state, message: action.value };
    case 'SUBMIT':        return { ...state, phase: 'generating', message: '', result: null, err: null, pendingChoice: null };
    case 'TOOL_DONE':     return { ...state, phase: 'done', result: action.result };
    case 'ERROR':         return { ...state, phase: 'error', err: action.err };
    case 'RESET_TO_IDLE': return { ...initial };
    case 'NEEDS_CHOICE':  return { ...state, phase: 'awaiting_choice', pendingChoice: { toolCallId: action.toolCallId, choices: action.choices } };
    case 'CHOICE_PICKED': return { ...state, phase: 'generating', pendingChoice: null };
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
  const abortRef = useRef(null);

  // Abort in-flight stream on unmount
  useEffect(() => {
    return () => {
      if (abortRef.current) abortRef.current.abort();
    };
  }, []);

  const submit = useCallback(async () => {
    const msg = state.message.trim();
    if (!msg || !boardId || !assetId) return;
    // Abort any previous in-flight stream
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    runIdRef.current = null;
    dispatch({ type: 'SUBMIT' });

    let res;
    try {
      res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        signal: controller.signal,
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
      if (err?.name === 'AbortError') return;
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
      if (controller.signal.aborted) break;
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
          if (Array.isArray(payload.choices) && payload.choices.length === 1 && runIdRef.current) {
            // Single choice — auto-confirm
            postConfirm({
              runId: runIdRef.current,
              toolCallId: payload.id,
              action: 'confirm',
              choice: payload.choices[0].id,
            });
          } else if (Array.isArray(payload.choices) && payload.choices.length > 1) {
            // Multi-choice — surface picker to user
            dispatch({ type: 'NEEDS_CHOICE', toolCallId: payload.id, choices: payload.choices });
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
          if (
            payload.status === 'failed' ||
            payload.status === 'hard_limited' ||
            payload.status === 'cancelled' ||
            payload.status === 'cancelled_softpause'
          ) {
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
  const showChoice = state.phase === 'awaiting_choice' && state.pendingChoice;

  return (
    <div className="asset-smart-edit-dock">
      <div className="asmd-header">
        <span className="asmd-title">Smart Edit</span>
        {onClose && (
          <button type="button" className="asmd-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        )}
      </div>

      {!showResult && !showChoice && (
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

      {showChoice && (
        <div className="asmd-choices">
          <div className="asmd-choices-hint">Claude can&apos;t generate images — pick a provider:</div>
          {state.pendingChoice.choices.map((c) => (
            <button
              key={c.id}
              type="button"
              className="asmd-choice-btn"
              onClick={() => {
                if (!runIdRef.current) return;
                dispatch({ type: 'CHOICE_PICKED' });
                postConfirm({
                  runId: runIdRef.current,
                  toolCallId: state.pendingChoice.toolCallId,
                  action: 'confirm',
                  choice: c.id,
                });
              }}
            >
              <span className="asmd-choice-label">{c.label}</span>
              {c.hint && <span className="asmd-choice-hint">{c.hint}</span>}
            </button>
          ))}
          <button
            type="button"
            className="asmd-choice-cancel"
            onClick={() => {
              if (runIdRef.current && state.pendingChoice?.toolCallId) {
                postConfirm({
                  runId: runIdRef.current,
                  toolCallId: state.pendingChoice.toolCallId,
                  action: 'skip',
                });
              }
              dispatch({ type: 'RESET_TO_IDLE' });
            }}
          >
            Cancel
          </button>
        </div>
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
