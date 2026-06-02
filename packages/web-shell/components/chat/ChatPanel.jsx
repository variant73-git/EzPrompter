'use client';

import { useEffect, useRef } from 'react';
import ChatBubble from './ChatBubble.jsx';
import ToolChip from './ToolChip.jsx';
import SoftPauseChip from './SoftPauseChip.jsx';
import './chat.css';

export default function ChatPanel({
  messages, activeToolCalls,
  softPause, onSoftContinue, onSoftStop,
  onConfirmTool, onSkipTool, onChooseTool,
  onCollapse,
}) {
  const scrollRef = useRef(null);

  // Always scroll to the bottom when content changes — new user message,
  // new assistant token streaming, new tool chip. Uses the panel's own
  // scroll container so the parent dock layout stays stable.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, activeToolCalls]);

  if (!messages.length && !activeToolCalls.length) {
    return (
      <div className="chat-panel chat-panel-empty">
        <p className="chat-empty-hint">Start a conversation with the agent below.</p>
      </div>
    );
  }

  // Where do we anchor in-flight activeToolCalls? Only under the CURRENT
  // turn's assistant bubble — i.e. an assistant message that comes AFTER
  // the latest user message. Otherwise we'd render new chips under a prior
  // turn's bubble, which (a) makes them look like they belong to that older
  // exchange and (b) collides ids with already-rendered chips in that
  // bubble's persisted tool_calls.
  const lastUserIdx = (() => {
    for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === 'user') return i;
    return -1;
  })();
  const currentTurnAssistantIdx = (() => {
    for (let i = messages.length - 1; i > lastUserIdx; i--) {
      if (messages[i].role === 'assistant') return i;
    }
    return -1;
  })();

  return (
    <div className="chat-panel" ref={scrollRef}>
      {onCollapse && (
        <button
          type="button"
          className="chat-panel-collapse"
          onClick={onCollapse}
          title="Collapse chat"
          aria-label="Collapse chat panel"
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </button>
      )}
      {messages.map((m, idx) => (
        <ChatBubble key={m.id} role={m.role} content={m.content}>
          {m.tool_calls?.map((tc) => (
            // Namespaced key prevents collisions when an active chip and a
            // persisted chip happen to share an id (e.g. Gemini's per-call
            // counter wrapping back to 1 across turns).
            <ToolChip
              key={`m-${tc.id}`}
              toolName={tc.name}
              status={tc.status || 'done'}
              args={tc.args}
              result={tc.result}
              error={tc.error}
            />
          ))}
          {idx === currentTurnAssistantIdx && activeToolCalls.map((tc) => (
            <ToolChip
              key={`a-${tc.id}`}
              toolName={tc.name}
              status={tc.status || 'running'}
              args={tc.args}
              result={tc.result}
              error={tc.error}
              summary={tc.summary}
              choices={tc.choices}
              onConfirm={() => onConfirmTool?.(tc.id)}
              onSkip={() => onSkipTool?.(tc.id)}
              onChoose={(choiceId) => onChooseTool?.(tc.id, choiceId)}
            />
          ))}
        </ChatBubble>
      ))}
      {/* If this turn hasn't streamed an assistant bubble yet but tools are
          running, render a fresh transient bubble for them. */}
      {currentTurnAssistantIdx === -1 && activeToolCalls.length > 0 && (
        <ChatBubble role="assistant" content="">
          {activeToolCalls.map((tc) => (
            <ToolChip key={`a-${tc.id}`} toolName={tc.name} status={tc.status || 'running'} args={tc.args} />
          ))}
        </ChatBubble>
      )}
      {softPause && (
        <SoftPauseChip
          iterationsSoFar={softPause.iterationsSoFar}
          breakdown={softPause.breakdown}
          onContinue={onSoftContinue}
          onStop={onSoftStop}
        />
      )}
    </div>
  );
}
