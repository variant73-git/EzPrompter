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
    await user.click(screen.getByRole('button', { name: '5' }));
    await user.click(screen.getByRole('button', { name: 'chassis' }));
    await user.click(screen.getByRole('button', { name: 'immersive' }));
    await user.click(screen.getByRole('button', { name: 'Save review' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(global.fetch).toHaveBeenCalledWith('/api/references/ref_one/preference', expect.objectContaining({ method: 'PUT' }));
  });
});
