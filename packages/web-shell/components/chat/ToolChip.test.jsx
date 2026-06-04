import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ToolChip from './ToolChip.jsx';

describe('ToolChip', () => {
  it('renders pending state with spinner', () => {
    render(<ToolChip toolName="createNode" status="pending" args={{ kind: 'site' }} />);
    expect(screen.getByText('createNode')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument(); // spinner has role=status
  });

  it('renders done state with check and short result', () => {
    render(<ToolChip toolName="createNode" status="done" args={{}} result={{ id: 'node-1' }} />);
    expect(screen.getByText(/createNode/)).toBeInTheDocument();
    expect(screen.getByText(/✓/)).toBeInTheDocument();
    expect(screen.getByText(/node-1/)).toBeInTheDocument();
  });

  it('renders error state with ✕ and message', () => {
    render(<ToolChip toolName="createNode" status="error" args={{}} error="invalid kind" />);
    expect(screen.getByText(/✕/)).toBeInTheDocument();
    expect(screen.getByText(/invalid kind/)).toBeInTheDocument();
  });

  it('omits confirm UI for safe tools (Phase 1 has no destructive)', () => {
    render(<ToolChip toolName="createNode" status="pending" args={{}} />);
    expect(screen.queryByRole('button', { name: /confirm/i })).toBeNull();
  });
});

describe('ToolChip — awaiting_confirm', () => {
  it('renders summary + Confirm + Skip buttons', () => {
    const onConfirm = vi.fn();
    const onSkip = vi.fn();
    render(
      <ToolChip
        toolName="deleteNode"
        status="awaiting_confirm"
        args={{ id: 'n1' }}
        summary="Delete node n1"
        onConfirm={onConfirm}
        onSkip={onSkip}
      />
    );
    expect(screen.getByText('Delete node n1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /confirm/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /skip/i })).toBeInTheDocument();
  });

  it('fires onConfirm when Confirm clicked', async () => {
    const onConfirm = vi.fn();
    render(<ToolChip toolName="deleteNode" status="awaiting_confirm" args={{}} summary="x" onConfirm={onConfirm} onSkip={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: /confirm/i }));
    expect(onConfirm).toHaveBeenCalled();
  });
});

describe('ToolChip — awaiting_choice', () => {
  it('renders choice buttons and fires onChoose with picked id', async () => {
    const onChoose = vi.fn();
    render(
      <ToolChip
        toolName="createImage"
        status="awaiting_choice"
        args={{ prompt: 'cat' }}
        summary="Generate image"
        choices={[{ id: 'gemini', label: 'Gemini (auto)' }, { id: 'openai', label: 'GPT-5.5' }]}
        onChoose={onChoose}
        onSkip={() => {}}
      />
    );
    expect(screen.getByText('Generate image')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /gemini/i }));
    expect(onChoose).toHaveBeenCalledWith('gemini');
  });
});

describe('ToolChip — skipped', () => {
  it('renders skipped indicator', () => {
    render(<ToolChip toolName="deleteNode" status="skipped" args={{}} />);
    expect(screen.getByText(/skipped/i)).toBeInTheDocument();
  });
});
