import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
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
