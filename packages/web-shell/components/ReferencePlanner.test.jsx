import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ReferencePlanner from './ReferencePlanner.jsx';

const shadowRecord = {
  id: 'plan_one',
  status: 'shadow',
  plan: {
    rule: 'One dominant chassis and bounded donors. No competing page spines.',
    selectedReferences: [
      {
        id: 'ref_one',
        title: 'Bureau Rouge',
        url: 'https://bureau-rouge.com',
        role: 'chassis',
        owns: 'section order and primary motion system',
        reasons: ['explicitly kept during review'],
      },
      {
        id: 'ref_two',
        title: 'The Red',
        url: 'https://333southwabash.com',
        role: 'donor',
        owns: 'typography and component language',
        reasons: ['taste score 4/5'],
      },
    ],
    composition: {
      preserve: ['chassis scroll model'],
      adapt: ['The Red: typography and component language'],
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

    expect(await screen.findByText('Bureau Rouge')).toBeInTheDocument();
    expect(screen.getByText('The Red')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Approve recipe' }));
    await waitFor(() => expect(screen.getByText('approved')).toBeInTheDocument());

    expect(global.fetch).toHaveBeenNthCalledWith(1, '/api/references/plan', expect.objectContaining({ method: 'POST' }));
    expect(global.fetch).toHaveBeenNthCalledWith(2, '/api/references/plan/plan_one', expect.objectContaining({ method: 'PATCH' }));
  });
});
