'use client';

export default function ChatBubble({ role, content, children }) {
  const cls = role === 'user' ? 'chat-bubble chat-bubble-user' : 'chat-bubble chat-bubble-assistant';
  return (
    <div className={cls}>
      {content && <div className="chat-bubble-content">{content}</div>}
      {children && <div className="chat-bubble-children">{children}</div>}
    </div>
  );
}
