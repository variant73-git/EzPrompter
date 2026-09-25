import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import RuntimeMask from './RuntimeMask.jsx';

describe('RuntimeMask', () => {
  it('renders the friendly message and calls onReload', () => {
    const onReload = vi.fn();
    render(<RuntimeMask onReload={onReload} />);
    expect(screen.getByText(/lost its connection/i)).toBeTruthy();
    expect(screen.getByText(/your edits are safe/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /reload/i }));
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it('is an overlay dialog, not a page replacement', () => {
    render(<RuntimeMask onReload={() => {}} />);
    expect(screen.getByRole('alertdialog')).toBeTruthy();
  });

  it('disables the button while a reload is in flight', () => {
    const onReload = vi.fn();
    render(<RuntimeMask onReload={onReload} reloading />);
    const button = screen.getByRole('button', { name: /reloading/i });
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(onReload).not.toHaveBeenCalled();
  });
});
