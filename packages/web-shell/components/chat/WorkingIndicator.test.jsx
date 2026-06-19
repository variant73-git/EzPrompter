import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import WorkingIndicator, { WORKING_PHRASES, colorStyle } from './WorkingIndicator.jsx';

afterEach(() => { vi.useRealTimers(); });

describe('colorStyle', () => {
  it('uses the accent fallback when no colors', () => {
    expect(colorStyle([]).color).toBe('var(--accent)');
  });
  it('uses a solid color for one category', () => {
    expect(colorStyle(['#38bdf8']).color).toBe('#38bdf8');
  });
  it('builds a gradient for multiple distinct categories', () => {
    const s = colorStyle(['#38bdf8', '#a78bfa']);
    expect(s.backgroundImage).toContain('#38bdf8');
    expect(s.backgroundImage).toContain('#a78bfa');
    expect(s.color).toBe('transparent');
  });
  it('dedups identical colors (no spurious gradient)', () => {
    expect(colorStyle(['#38bdf8', '#38bdf8']).color).toBe('#38bdf8');
  });
});

describe('WorkingIndicator', () => {
  it('renders the first phrase and cycles language every 1.5s', () => {
    vi.useFakeTimers();
    render(<WorkingIndicator colors={['#38bdf8']} />);
    expect(screen.getByText(WORKING_PHRASES[0])).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(1500); });
    expect(screen.getByText(WORKING_PHRASES[1])).toBeInTheDocument();
  });
  it('renders the dots suffix when dots=true', () => {
    render(<WorkingIndicator colors={['#38bdf8']} dots />);
    expect(screen.getByText('…')).toBeInTheDocument();
  });
});
