'use client';

import { useEffect, useRef } from 'react';
import ChatBubble from './ChatBubble.jsx';
import ToolChip from './ToolChip.jsx';
import './chat.css';

export default function ChatPanel({ messages, activeToolCalls, onCollapse }) {
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

  // Find the last assistant message (we attach live activeToolCalls under it).
  const lastAssistantIdx = (() => {
    for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === 'assistant') return i;
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
            <ToolChip
              key={tc.id}
              toolName={tc.name}
              status={tc.status || 'done'}
              args={tc.args}
              result={tc.result}
              error={tc.error}
            />
          ))}
          {idx === lastAssistantIdx && activeToolCalls.map((tc) => (
            <ToolChip
              key={tc.id}
              toolName={tc.name}
              status={tc.status || 'running'}
              args={tc.args}
              result={tc.result}
              error={tc.error}
            />
          ))}
        </ChatBubble>
      ))}
      {/* If there's no assistant message yet but tools are running, render a fresh bubble */}
      {lastAssistantIdx === -1 && activeToolCalls.length > 0 && (
        <ChatBubble role="assistant" content="">
          {activeToolCalls.map((tc) => (
            <ToolChip key={tc.id} toolName={tc.name} status={tc.status || 'running'} args={tc.args} />
          ))}
        </ChatBubble>
      )}
    </div>
  );
}
