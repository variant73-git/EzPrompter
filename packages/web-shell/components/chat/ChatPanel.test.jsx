import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ChatPanel from './ChatPanel.jsx';

const sampleMessages = [
  { id: 'm1', role: 'user', content: 'olá' },
  { id: 'm2', role: 'assistant', content: 'oi', tool_calls: null },
  { id: 'm3', role: 'assistant', content: '', tool_calls: [
    { id: 'tc1', name: 'createNode', status: 'done', args: {}, result: { id: 'node-aaa' } },
  ] },
];

describe('ChatPanel', () => {
  it('renders user and assistant bubbles in order', () => {
    render(<ChatPanel messages={sampleMessages} activeToolCalls={[]} />);
    const bubbles = document.querySelectorAll('.chat-bubble');
    expect(bubbles).toHaveLength(3);
    expect(bubbles[0]).toHaveClass('chat-bubble-user');
    expect(bubbles[1]).toHaveClass('chat-bubble-assistant');
  });

  it('renders tool chips inside the assistant bubble that has tool_calls', () => {
    render(<ChatPanel messages={sampleMessages} activeToolCalls={[]} />);
    expect(screen.getByText(/createNode/)).toBeInTheDocument();
    expect(screen.getByText(/node-aaa/)).toBeInTheDocument();
  });

  it('renders active (in-flight) tool calls in the most recent assistant bubble', () => {
    render(<ChatPanel
      messages={sampleMessages.slice(0, 2)}
      activeToolCalls={[{ id: 'tc-live', name: 'queryNodes', status: 'running', args: {} }]}
    />);
    expect(screen.getByText(/queryNodes/)).toBeInTheDocument();
  });

  it('shows empty state when no messages', () => {
    render(<ChatPanel messages={[]} activeToolCalls={[]} />);
    expect(screen.getByText(/start a conversation/i)).toBeInTheDocument();
  });
});

describe('ChatPanel — soft pause', () => {
  it('renders softPause prop as SoftPauseChip and fires through callbacks', async () => {
    const onContinue = vi.fn();
    const onStop = vi.fn();
    render(
      <ChatPanel
        messages={[{ id: 'm1', role: 'assistant', content: 'working' }]}
        activeToolCalls={[]}
        softPause={{ iterationsSoFar: 10, breakdown: { createNode: 10 } }}
        onSoftContinue={onContinue}
        onSoftStop={onStop}
      />
    );
    expect(screen.getByText(/10 actions/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /continue/i }));
    expect(onContinue).toHaveBeenCalled();
  });
});
