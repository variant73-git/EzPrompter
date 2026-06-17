import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { NodeProgressRing, useGenerationProgress, buildPerimeterPath } from './NodeProgressRing.jsx';

afterEach(() => {
  vi.useRealTimers();
});

describe('buildPerimeterPath', () => {
  it('starts at top-center (width/2, 0)', () => {
    expect(buildPerimeterPath(320, 180, 10).startsWith('M160,0')).toBe(true);
  });
  it('closes the loop', () => {
    expect(buildPerimeterPath(320, 180, 10).trim().endsWith('Z')).toBe(true);
  });
  it('uses arc commands for the rounded corners', () => {
    expect(buildPerimeterPath(320, 180, 10)).toContain('A');
  });
});

describe('NodeProgressRing', () => {
  it('renders the percentage with a % sign', () => {
    render(<NodeProgressRing pct={47} width={320} height={180} />);
    expect(screen.getByText('47%')).toBeInTheDocument();
  });

  it('sets strokeDashoffset to 100 - pct on the arc', () => {
    const { container } = render(<NodeProgressRing pct={47} width={320} height={180} />);
    const arc = container.querySelector('.cnode-progress-arc');
    expect(arc).toBeTruthy();
    expect(arc.getAttribute('stroke-dashoffset')).toBe('53');
  });

  it('renders a full-perimeter track behind the arc', () => {
    const { container } = render(<NodeProgressRing pct={10} width={320} height={180} />);
    expect(container.querySelector('.cnode-progress-track')).toBeTruthy();
  });

  it('sets the viewBox to the node dimensions', () => {
    const { container } = render(<NodeProgressRing pct={10} width={320} height={180} />);
    expect(container.querySelector('.cnode-progress-svg').getAttribute('viewBox')).toBe('0 0 320 180');
  });
});

describe('useGenerationProgress', () => {
  function Probe({ active, durationMs }) {
    const pct = useGenerationProgress(active, durationMs);
    return <span data-testid="pct">{pct}</span>;
  }

  it('starts at 0 and climbs while active', () => {
    vi.useFakeTimers();
    render(<Probe active={true} durationMs={45000} />);
    expect(screen.getByTestId('pct').textContent).toBe('0');
    act(() => { vi.advanceTimersByTime(5000); });
    expect(Number(screen.getByTestId('pct').textContent)).toBeGreaterThan(0);
  });

  it('never exceeds 95 no matter how long it runs', () => {
    vi.useFakeTimers();
    render(<Probe active={true} durationMs={25000} />);
    act(() => { vi.advanceTimersByTime(600000); });
    expect(Number(screen.getByTestId('pct').textContent)).toBeLessThanOrEqual(95);
  });

  it('stays at 0 when inactive', () => {
    vi.useFakeTimers();
    render(<Probe active={false} durationMs={45000} />);
    act(() => { vi.advanceTimersByTime(30000); });
    expect(screen.getByTestId('pct').textContent).toBe('0');
  });

  it('resets to 0 when active flips back to false (ring disappears)', () => {
    vi.useFakeTimers();
    const { rerender } = render(<Probe active={true} durationMs={45000} />);
    act(() => { vi.advanceTimersByTime(5000); });
    expect(Number(screen.getByTestId('pct').textContent)).toBeGreaterThan(0);
    rerender(<Probe active={false} durationMs={45000} />);
    expect(screen.getByTestId('pct').textContent).toBe('0');
  });

  it('does not restart the clock when only durationMs changes mid-run', () => {
    vi.useFakeTimers();
    const { rerender } = render(<Probe active={true} durationMs={45000} />);
    act(() => { vi.advanceTimersByTime(5000); });
    const before = Number(screen.getByTestId('pct').textContent);
    rerender(<Probe active={true} durationMs={25000} />);
    act(() => { vi.advanceTimersByTime(120); });
    const after = Number(screen.getByTestId('pct').textContent);
    expect(after).toBeGreaterThanOrEqual(before); // climbed, did NOT reset to 0
  });
});
