import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ReferenceReviewPanel from './ReferenceReviewPanel.jsx';

const reference = { id: 'ref_one', title: 'Antinomy', host: 'antinomy.studio', url: 'https://antinomy.studio', curationRank: 1 };

describe('ReferenceReviewPanel', () => {
  afterEach(() => vi.restoreAllMocks());

  it('saves a private structured review', async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ referenceId: 'ref_one', preference: { decision: 'keep', rating: 5, preferredRole: 'chassis', businessTags: [], visualTags: ['immersive'], motionTags: [], notes: '' } }),
    });
    render(<ReferenceReviewPanel reference={reference} onSaved={onSaved} />);
    await user.click(screen.getByRole('button', { name: 'keep' }));
    await user.click(screen.getByRole('button', { name: 'Taste score: 5' }));
    expect(screen.getByText('Strength profile')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Visual craft: 5' }));
    await user.click(screen.getByRole('button', { name: 'chassis' }));
    await user.click(screen.getByRole('button', { name: 'immersive' }));
    await user.click(screen.getByRole('button', { name: 'Save review' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(global.fetch).toHaveBeenCalledWith('/api/references/ref_one/preference', expect.objectContaining({ method: 'PUT' }));
    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toMatchObject({ rating: 5, dimensionRatings: { visualQuality: 5 } });
  });

  it('keeps deep weighting progressive and requires the general score', async () => {
    const user = userEvent.setup();
    render(<ReferenceReviewPanel reference={reference} />);
    expect(screen.getByRole('button', { name: 'Save review' })).toBeDisabled();
    expect(screen.queryByText('Strength profile')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Taste score: 3' }));
    expect(screen.getByRole('button', { name: 'Save review' })).toBeEnabled();
    expect(screen.queryByText('Strength profile')).not.toBeInTheDocument();
  });
});
