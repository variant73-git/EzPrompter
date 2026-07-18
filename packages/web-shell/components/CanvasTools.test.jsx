import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import CanvasTools from './CanvasTools.jsx';

describe('CanvasTools', () => {
  it('keeps Cursor active while the canvas is resting', () => {
    render(<CanvasTools />);

    expect(screen.getAllByRole('button')).toHaveLength(6);
    expect(screen.getByRole('button', { name: 'Cursor' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Pan (hold Space)' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('reflects the temporary Space-to-pan state', () => {
    render(<CanvasTools panActive />);

    expect(screen.getByRole('button', { name: 'Cursor' }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('button', { name: 'Pan (hold Space)' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('keeps unfinished collaboration tools honestly disabled', () => {
    render(<CanvasTools />);

    expect(screen.getByRole('button', { name: 'Notes (coming soon)' }).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Feedback mode (coming soon)' }).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Pan (hold Space)' }).getAttribute('aria-disabled')).toBe('true');
  });

  it('exposes Undo after the divider and keeps Redo honest', () => {
    const onUndo = vi.fn();
    render(<CanvasTools canUndo onUndo={onUndo} />);

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(onUndo).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Redo' }).disabled).toBe(true);
    expect(document.querySelector('.canvas-tools-sep')).not.toBeNull();
  });
});
