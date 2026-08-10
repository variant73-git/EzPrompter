import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ReferencePlanner from './ReferencePlanner.jsx';

const shadowRecord = {
  id: 'plan_one',
  status: 'shadow',
  plan: {
    rule: 'No fixed roles per site. One contextual scale owner; optional references contribute bounded section structures.',
    selectedReferences: [
      {
        id: 'ref_one',
        title: 'Fancy',
        url: 'https://fancy.design',
        influence: 'scale-owner',
        score: 88.48,
        scoreBreakdown: { briefHints: 83, manualQuality: 95, structuralPortability: 100, visualQuality: 91, motion: 73, sourceConfidence: 64 },
        owns: 'page-wide type and media scale, spacing cadence, and responsive consistency',
        reasons: ['explicitly kept during review'],
      },
      {
        id: 'ref_two',
        title: 'Neverhack',
        url: 'https://neverhack.com',
        influence: 'section-source',
        owns: 'one compatible section structure',
        reasons: ['optional taste calibration 4/5'],
      },
    ],
    composition: {
      preserve: ['alignment and anchoring logic'],
      adapt: ['Neverhack: one compatible section structure'],
      replace: ['brand identity'],
    },
  },
};

describe('ReferencePlanner', () => {
  afterEach(() => vi.restoreAllMocks());

  it('creates and approves a zero-generation shadow recipe', async () => {
    const user = userEvent.setup();
    vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce({ ok: true, json: async () => shadowRecord })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ plan: { id: 'plan_one', status: 'approved' } }) });

    render(<ReferencePlanner reviewStats={{ keep: 2, maybe: 0 }} />);
    expect(screen.getByText('The planner ranks only references you reviewed. It does not generate a site or consume credits.')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Website brief'), 'An animated industrial technology landing page for operations leaders.');
    await user.selectOptions(screen.getByLabelText('References in the recipe'), '2');
    await user.click(screen.getByRole('button', { name: 'Build shadow plan' }));

    expect(await screen.findByText('Fancy')).toBeInTheDocument();
    expect(screen.getByLabelText('Score breakdown for Fancy')).toBeInTheDocument();
    expect(screen.getByText('Neverhack')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Approve recipe' }));
    await waitFor(() => expect(screen.getByText('approved')).toBeInTheDocument());

    expect(global.fetch).toHaveBeenNthCalledWith(1, '/api/references/plan', expect.objectContaining({ method: 'POST' }));
    expect(global.fetch).toHaveBeenNthCalledWith(2, '/api/references/plan/plan_one', expect.objectContaining({ method: 'PATCH' }));
  });
});
