import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import WorkingIndicator, { CODE_LINES, CHAR_MS, HOLD_TICKS, MAX_LEN } from './WorkingIndicator.jsx';

afterEach(() => { vi.useRealTimers(); });

const codeText = (container) => container.querySelector('.working-indicator-code').textContent;

describe('WorkingIndicator', () => {
  it('is ALWAYS exactly MAX_LEN characters wide (typing, holding, and at mount)', () => {
    vi.useFakeTimers();
    const { container } = render(<WorkingIndicator colors={['#38bdf8']} />);
    expect(codeText(container).length).toBe(MAX_LEN);
    act(() => { vi.advanceTimersByTime(CHAR_MS * 7); });          // mid-typing
    expect(codeText(container).length).toBe(MAX_LEN);
    act(() => { vi.advanceTimersByTime(CHAR_MS * (MAX_LEN + 2) ); }); // holding
    expect(codeText(container).length).toBe(MAX_LEN);
  });

  it('types the current line character by character', () => {
    vi.useFakeTimers();
    const { container } = render(<WorkingIndicator />);
    act(() => { vi.advanceTimersByTime(CHAR_MS * 5); });
    const typed = container.querySelector('.wi-new').textContent;
    expect(typed.length).toBe(5);
    expect(CODE_LINES[0].startsWith(typed)).toBe(true);
  });

  it('shows the full line during the hold (no write head)', () => {
    vi.useFakeTimers();
    const { container } = render(<WorkingIndicator />);
    act(() => { vi.advanceTimersByTime(CHAR_MS * (MAX_LEN + 1)); });
    expect(container.querySelector('.wi-new').textContent.trimEnd()).toBe(CODE_LINES[0]);
    expect(container.querySelector('.wi-head')).toBeNull();
    expect(container.querySelector('.wi-old')).toBeNull();
  });

  it('OVERWRITES the previous line: the untyped tail still shows line 0 while line 1 types', () => {
    vi.useFakeTimers();
    const { container } = render(<WorkingIndicator />);
    const k = 6;
    act(() => { vi.advanceTimersByTime(CHAR_MS * (MAX_LEN + HOLD_TICKS + 1 + k)); });
    const fresh = container.querySelector('.wi-new').textContent;
    const stale = container.querySelector('.wi-old').textContent;
    expect(CODE_LINES[1].startsWith(fresh)).toBe(true);
    expect(fresh.length).toBe(k);
    // The stale tail is the rest of line 0 (padded), starting past the head.
    expect(CODE_LINES[0].padEnd(MAX_LEN, ' ').endsWith(stale)).toBe(true);
  });

  it('colors the write head with the involved node category (accent fallback)', () => {
    const { container, rerender } = render(<WorkingIndicator colors={['#a78bfa']} />);
    expect(container.querySelector('.wi-head').style.background).toBe('rgb(167, 139, 250)');
    rerender(<WorkingIndicator colors={[]} />);
    expect(container.querySelector('.wi-head').style.background).toBe('var(--accent)');
  });

  it('uses only fake illustrative lines (defense: no obvious real-code markers)', () => {
    const all = CODE_LINES.join('\n');
    expect(all).not.toMatch(/process\.env|api[_-]?key|secret|http|\/Users\//i);
  });
});
