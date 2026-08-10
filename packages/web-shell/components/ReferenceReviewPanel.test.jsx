import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ReferenceReviewPanel from './ReferenceReviewPanel.jsx';

const biograph = {
  id: 'biograph',
  title: 'Biograph',
  host: 'www.biograph.com',
  url: 'https://www.biograph.com',
};

describe('ReferenceReviewPanel', () => {
  afterEach(() => vi.restoreAllMocks());

  it('prefills product and style calibration without assigning a fixed role', () => {
    render(<ReferenceReviewPanel reference={biograph} />);
    expect(screen.getByRole('button', { name: 'landing-page' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'soft-tech' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'corporate' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByText('Best role')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'fancy' })).toBeDisabled();
  });

  it('saves a verdict without requiring a numeric score', async () => {
    const user = userEvent.setup();
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        preference: {
          decision: 'maybe', rating: null, preferredRole: 'either',
          businessTags: ['landing-page', 'corporate-site'],
          visualTags: ['soft-tech', 'corporate'], motionTags: [], dimensionRatings: {}, notes: '',
        },
      }),
    });
    render(<ReferenceReviewPanel reference={biograph} />);
    await user.click(screen.getByRole('button', { name: 'Save review' }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body).toMatchObject({ decision: 'maybe', rating: null, preferredRole: 'either' });
    expect(screen.getByText('Review saved')).toBeInTheDocument();
  });

  it('lets an internal curator change whether a reference is customer-visible', async () => {
    const user = userEvent.setup();
    const onPrivacyChanged = vi.fn();
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        privacy: {
          referenceId: 'agentflow',
          isPrivate: false,
          privacyReason: null,
          templatePlatform: 'framer',
        },
      }),
    });
    render(<ReferenceReviewPanel
      reference={{
        id: 'agentflow', title: 'AgentFlow', host: 'agentflow.framer.ai',
        url: 'https://agentflow.framer.ai', isPrivate: true, templatePlatform: 'framer',
      }}
      canManagePrivateReferences
      onPrivacyChanged={onPrivacyChanged}
    />);

    const privacySwitch = screen.getByRole('switch', { name: 'Private reference' });
    expect(privacySwitch).toBeChecked();
    expect(screen.getByText('framer template')).toBeInTheDocument();
    await user.click(privacySwitch);

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
      '/api/references/agentflow/privacy',
      expect.objectContaining({ method: 'PUT' }),
    ));
    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual({ isPrivate: false });
    expect(onPrivacyChanged).toHaveBeenCalledWith('agentflow', expect.objectContaining({ isPrivate: false }));
  });
});
