import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import CreditsPill, { ledgerLabel } from './CreditsPill.jsx';

beforeEach(() => {
  global.fetch = vi.fn(async () => ({
    ok: true,
    json: async () => ({
      credits: 425,
      ledger: [
        { delta_credits: -215, reason: 'charge', meta: { op: 'extract.clone' }, created_at: '2026-07-03' },
        { delta_credits: 500, reason: 'welcome', meta: {}, created_at: '2026-07-01' },
      ],
    }),
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ledgerLabel', () => {
  it('labels charges by op and grants by reason', () => {
    expect(ledgerLabel({ reason: 'charge', meta: { op: 'extract.clone' } })).toBe('Clone');
    expect(ledgerLabel({ reason: 'charge', meta: { op: 'image.generate.gemini' } })).toBe('Image');
    expect(ledgerLabel({ reason: 'welcome' })).toBe('Welcome');
  });
});

describe('CreditsPill', () => {
  it('renders the fetched balance', async () => {
    render(<CreditsPill />);
    await waitFor(() => expect(screen.getByText('425', { selector: '.credits-pill-value' })).toBeTruthy());
    expect(screen.queryByText('Local')).toBeNull();
  });

  it('updates instantly on the uncraft:balance event', async () => {
    render(<CreditsPill />);
    await waitFor(() => expect(screen.getByText('425', { selector: '.credits-pill-value' })).toBeTruthy());
    act(() => {
      window.dispatchEvent(new CustomEvent('uncraft:balance', { detail: { balance: 210 } }));
    });
    expect(screen.getByText('210', { selector: '.credits-pill-value' })).toBeTruthy();
  });

  it('opens the ledger dropdown on click', async () => {
    render(<CreditsPill />);
    await waitFor(() => expect(screen.getByText('425', { selector: '.credits-pill-value' })).toBeTruthy());
    act(() => {
      screen.getByRole('button', { name: /credits balance/i }).click();
    });
    await waitFor(() => expect(screen.getByText('Clone')).toBeTruthy());
    expect(screen.getByText('-215')).toBeTruthy();
    expect(screen.getByText('Welcome')).toBeTruthy();
    expect(screen.getByText('+500')).toBeTruthy();
  });
});
