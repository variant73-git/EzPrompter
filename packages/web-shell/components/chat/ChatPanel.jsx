'use client';

import { useEffect, useRef } from 'react';
import ChatBubble from './ChatBubble.jsx';
import ToolChip from './ToolChip.jsx';
import SoftPauseChip from './SoftPauseChip.jsx';
import './chat.css';

export default function ChatPanel({
  messages, activeToolCalls,
  streaming = false,
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
  }, [messages, activeToolCalls, streaming]);

  // Show the thinking dots whenever the agent is streaming but no
  // CURRENTLY-OPEN assistant bubble has content. After a tool call the
  // previous iter's bubble gets sealed (id flips to closed-asst-), so
  // between iters there's no transient bubble — dots reappear, telling
  // the user the agent is still working instead of leaving the panel
  // visually frozen on the last sentence.
  const showThinking = (() => {
    if (!streaming) return false;
    const lastMsg = messages[messages.length - 1];
    if (!lastMsg) return true;
    if (lastMsg.role === 'user') return true;
    // Assistant bubble. If it's still transient (in-progress) and has
    // content, the agent is mid-stream — no dots. Otherwise (sealed or
    // empty) dots show.
    const isTransient = lastMsg.id?.startsWith?.('tmp-asst-');
    if (isTransient && (lastMsg.content || '').trim().length > 0) return false;
    return true;
  })();

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
      {/* Legacy in-panel collapse chevron removed — the prompt-dock now
          renders its own collapse button at the dock's top-right (single
          source of truth). The onCollapse prop is still threaded for
          backwards compat and other potential consumers but no longer
          painted here. */}
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
      {showThinking && (
        <div className="chat-thinking" aria-label="Pensando…">
          <span className="chat-thinking-dot" />
          <span className="chat-thinking-dot" />
          <span className="chat-thinking-dot" />
        </div>
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
