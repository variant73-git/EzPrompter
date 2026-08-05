'use client';

export default function ChatBubble({ role, content, children, wide = false }) {
  const cls = `${role === 'user' ? 'chat-bubble chat-bubble-user' : 'chat-bubble chat-bubble-assistant'}${wide ? ' chat-bubble-wide' : ''}`;
  return (
    <div className={cls}>
      {content && <div className="chat-bubble-content">{content}</div>}
      {children && <div className="chat-bubble-children">{children}</div>}
    </div>
  );
}
