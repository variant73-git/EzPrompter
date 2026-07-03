import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import PlansModal from './PlansModal.jsx';

describe('PlansModal', () => {
  it('renders nothing when closed', () => {
    const { container } = render(<PlansModal open={false} onClose={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the three plans with prices and the current-plan badge', () => {
    render(<PlansModal open onClose={() => {}} />);
    expect(screen.getByText('Free')).toBeTruthy();
    expect(screen.getByText('Pro')).toBeTruthy();
    expect(screen.getByText('Ultimate')).toBeTruthy();
    expect(screen.getByText('$12')).toBeTruthy();
    expect(screen.getByText('$39')).toBeTruthy();
    expect(screen.getByText('Current plan')).toBeTruthy();
    expect(screen.getByText('1,500 credits every month')).toBeTruthy();
    expect(screen.getByText('6,000 credits every month')).toBeTruthy();
  });

  it('shows the waitlist toast when a CTA is clicked', () => {
    render(<PlansModal open onClose={() => {}} />);
    const ctas = screen.getAllByText('Coming soon');
    act(() => { ctas[0].click(); });
    expect(screen.getByText("You're on the list — plans are coming soon.")).toBeTruthy();
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(<PlansModal open onClose={onClose} />);
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(onClose).toHaveBeenCalled();
  });
});
