'use client';

import { useReducer, useRef, useCallback } from 'react';
import './asset-smart-edit-dock.css';

const initial = {
  phase: 'idle',
  message: '',
  result: null,
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
