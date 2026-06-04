'use client';

import ChatBubble from './ChatBubble.jsx';
import ToolChip from './ToolChip.jsx';
import './chat.css';

export default function ChatPanel({ messages, activeToolCalls }) {
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
    <div className="chat-panel">
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
