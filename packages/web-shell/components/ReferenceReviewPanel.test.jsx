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

  it('keeps curation focused on use, site type, and transfer guidance', () => {
    render(<ReferenceReviewPanel reference={biograph} />);
    expect(screen.getByRole('switch', { name: 'Use Biograph' })).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'landing-page' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Worth borrowing')).toBeInTheDocument();
    expect(screen.getByLabelText('Avoid')).toBeInTheDocument();
    expect(screen.queryByText('Taste score')).not.toBeInTheDocument();
    expect(screen.queryByText('Style · choose up to 2')).not.toBeInTheDocument();
    expect(screen.queryByText('Motion')).not.toBeInTheDocument();
    expect(screen.queryByText('Best role')).not.toBeInTheDocument();
  });

  it('replaces Save with definitive feedback until a parameter changes', async () => {
    const user = userEvent.setup();
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        preference: {
          decision: 'keep', rating: null, preferredRole: 'either',
          businessTags: ['landing-page', 'corporate-site'],
          visualTags: [], motionTags: [], dimensionRatings: {}, notes: '',
          worthBorrowing: '', avoid: '',
        },
      }),
    });
    render(<ReferenceReviewPanel reference={biograph} />);
    expect(screen.getByRole('button', { name: 'Save review' })).toBeDisabled();
    await user.click(screen.getByRole('switch', { name: 'Use Biograph' }));
    expect(screen.getByRole('button', { name: 'Save review' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Save review' }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body).toMatchObject({ decision: 'keep', rating: null, preferredRole: 'either' });
    const included = await screen.findByRole('button', { name: 'Included' });
    expect(included).toBeDisabled();
    expect(included).toHaveAttribute('data-state', 'keep');

    await user.type(screen.getByLabelText('Worth borrowing'), 'Strong editorial rhythm');
    expect(screen.getByRole('button', { name: 'Save review' })).toBeEnabled();
  });

  it('shows Excluded feedback for a saved off state', () => {
    render(<ReferenceReviewPanel reference={{
      ...biograph,
      preference: {
        decision: 'pass', rating: null, preferredRole: 'either', businessTags: [],
        visualTags: [], motionTags: [], dimensionRatings: {}, notes: '', worthBorrowing: '', avoid: '',
      },
    }} />);
    expect(screen.getByRole('button', { name: 'Excluded' })).toHaveAttribute('data-state', 'pass');
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
