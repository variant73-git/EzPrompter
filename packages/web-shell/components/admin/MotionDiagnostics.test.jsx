import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import MotionDiagnostics from './MotionDiagnostics.jsx';

afterEach(() => vi.unstubAllGlobals());

const payload = {
  view: 'coverage',
  filters: { from: '2026-07-20T00:00:00.000Z', to: '2026-07-27T00:00:00.000Z' },
  summary: { total: 12, recovered: 8, disabled: 1, failed: 3 },
  groups: [{
    key: 'speed', label: 'Speed', count: 8,
    supported: 0, recovered: 7, disabled: 1, failed: 0,
  }],
  events: [{
    id: 'event-1', occurredAt: '2026-07-27T10:00:00.000Z', source: 'recovery',
    failureCode: 'target_missing', finalOutcome: 'recovered', device: 'mobile',
    controlId: 'speed', canOpenAffectedNode: true,
    affectedNodeHref: '/canvas/board-own?focusNode=node-own',
  }],
};

describe('MotionDiagnostics', () => {
  it('shows the approved views, filters, evidence, and safe node navigation', async () => {
    const fetcher = vi.fn(async () => ({ ok: true, json: async () => payload }));
    vi.stubGlobal('fetch', fetcher);
    render(<MotionDiagnostics />);

    expect(screen.getByRole('tab', { name: 'Coverage' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Failures' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Smoke tests' })).toBeTruthy();
    expect(screen.getByLabelText('Time period')).toBeTruthy();
    expect(screen.getByLabelText('Device')).toBeTruthy();

    await waitFor(() => expect(screen.getByText('target_missing')).toBeTruthy());
    expect(screen.getByText('Auto-repaired')).toBeTruthy();
    expect(screen.getByText('88%')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open affected node' }).getAttribute('href'))
      .toBe('/canvas/board-own?focusNode=node-own');

    fireEvent.click(screen.getByRole('tab', { name: 'Failures' }));
    await waitFor(() => expect(fetcher.mock.calls.at(-1)[0]).toMatch(/view=failures/));
  });

  it('keeps the private surface useful when ingestion has no events yet', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ ...payload, summary: { total: 0, recovered: 0, disabled: 0, failed: 0 }, groups: [], events: [] }),
    })));
    render(<MotionDiagnostics />);

    await waitFor(() => expect(screen.getByText('No diagnostics in this period')).toBeTruthy());
    expect(screen.getByText(/Events will appear automatically/i)).toBeTruthy();
  });
});
