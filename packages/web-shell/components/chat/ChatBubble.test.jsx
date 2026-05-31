import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import ChatBubble from './ChatBubble.jsx';

describe('ChatBubble', () => {
  it('renders user message right-aligned', () => {
    render(<ChatBubble role="user" content="hello" />);
    const el = screen.getByText('hello');
    expect(el.closest('.chat-bubble')).toHaveClass('chat-bubble-user');
  });

  it('renders assistant message left-aligned', () => {
    render(<ChatBubble role="assistant" content="hi" />);
    expect(screen.getByText('hi').closest('.chat-bubble')).toHaveClass('chat-bubble-assistant');
  });

  it('renders children alongside content (used for inline tool chips)', () => {
    render(
      <ChatBubble role="assistant" content="working...">
        <div data-testid="chip">[chip]</div>
      </ChatBubble>
    );
    expect(screen.getByText('working...')).toBeInTheDocument();
    expect(screen.getByTestId('chip')).toBeInTheDocument();
  });
});
