import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SoftPauseChip from './SoftPauseChip.jsx';

describe('SoftPauseChip', () => {
  it('renders iteration count + breakdown text', () => {
    render(
      <SoftPauseChip
        iterationsSoFar={10}
        breakdown={{ createNode: 8, addEdge: 2 }}
        onContinue={() => {}}
        onStop={() => {}}
      />
    );
    expect(screen.getByText(/10 actions/i)).toBeInTheDocument();
    expect(screen.getByText(/createNode × 8/)).toBeInTheDocument();
    expect(screen.getByText(/addEdge × 2/)).toBeInTheDocument();
  });

  it('fires onContinue / onStop on click', async () => {
    const onContinue = vi.fn();
    const onStop = vi.fn();
    render(<SoftPauseChip iterationsSoFar={10} breakdown={{}} onContinue={onContinue} onStop={onStop} />);
    await userEvent.click(screen.getByRole('button', { name: /continue/i }));
    expect(onContinue).toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: /stop/i }));
    expect(onStop).toHaveBeenCalled();
  });
});
