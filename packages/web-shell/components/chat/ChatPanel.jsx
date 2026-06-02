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
          {/* Persisted tool_calls never render any more — the agent's own
              text bubble is the single source of truth for what happened.
              We keep the data in m.tool_calls (for analytics / future
              debug surfaces) but hide all routine status chips. */}
          {idx === currentTurnAssistantIdx && activeToolCalls.map((tc) => (
            // Only chips that REQUIRE the user's decision render — confirm
            // / choice prompts are the buttons that drive resolveConfirm /
            // resolveChoice. Routine running / done / error / skipped /
            // stale states are hidden; the agent will narrate them in its
            // own text bubble.
            tc.status === 'awaiting_confirm' || tc.status === 'awaiting_choice' ? (
              <ToolChip
                key={`a-${tc.id}`}
                toolName={tc.name}
                status={tc.status}
                args={tc.args}
                result={tc.result}
                error={tc.error}
                summary={tc.summary}
                choices={tc.choices}
                onConfirm={() => onConfirmTool?.(tc.id)}
                onSkip={() => onSkipTool?.(tc.id)}
                onChoose={(choiceId) => onChooseTool?.(tc.id, choiceId)}
              />
            ) : null
          ))}
        </ChatBubble>
      ))}
      {/* If this turn hasn't streamed an assistant bubble yet but tools are
          AWAITING a decision, render a fresh transient bubble for the
          actionable chip. Routine running tools no longer materialise their
          own bubble — wait for the agent's text. */}
      {currentTurnAssistantIdx === -1
        && activeToolCalls.some((tc) => tc.status === 'awaiting_confirm' || tc.status === 'awaiting_choice') && (
        <ChatBubble role="assistant" content="">
          {activeToolCalls.map((tc) => (
            tc.status === 'awaiting_confirm' || tc.status === 'awaiting_choice' ? (
              <ToolChip
                key={`a-${tc.id}`}
                toolName={tc.name}
                status={tc.status}
                args={tc.args}
                summary={tc.summary}
                choices={tc.choices}
                onConfirm={() => onConfirmTool?.(tc.id)}
                onSkip={() => onSkipTool?.(tc.id)}
                onChoose={(choiceId) => onChooseTool?.(tc.id, choiceId)}
              />
            ) : null
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
