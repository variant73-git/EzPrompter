import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ReferenceLibrary, { ReferenceGridCard } from './ReferenceLibrary.jsx';

const reference = {
  id: 'ref_one',
  title: 'Antinomy',
  host: 'antinomy.studio',
  url: 'https://antinomy.studio',
  thumbnailUrl: 'https://images.example/antinomy.jpg',
  categories: ['Studio'],
  sourceIds: ['codrops', 'siteinspire'],
  sourceNames: ['Codrops Webzibition', 'SiteInspire'],
  editorialConsensus: 2,
};

const initialPage = {
  items: [reference],
  total: 1,
  hasMore: false,
  facets: {
    all: { count: 1, decided: 0 },
    sources: [{ value: 'codrops', count: 1, decided: 0 }, { value: 'siteinspire', count: 1, decided: 0 }],
    categories: [{ value: 'Studio', count: 1 }],
  },
};

const sixSourcePage = {
  ...initialPage,
  total: 1919,
  facets: {
    ...initialPage.facets,
    all: { count: 1919, decided: 0 },
    sources: [
      { value: 'codrops', count: 847, decided: 21 },
      { value: 'pafolios', count: 763, decided: 17 },
      { value: 'landbook', count: 152, decided: 4 },
      { value: 'minimalgallery', count: 92, decided: 2 },
      { value: 'siteofsites', count: 71, decided: 1 },
      { value: 'siteinspire', count: 40, decided: 0 },
    ],
  },
};

describe('ReferenceLibrary', () => {
  afterEach(() => vi.restoreAllMocks());

  it('renders a traceable external reference and editorial consensus', () => {
    render(<ReferenceLibrary initialPage={initialPage} />);
    expect(screen.getByRole('link', { name: 'Open Antinomy' })).toHaveAttribute('href', 'https://antinomy.studio');
    expect(screen.getByRole('link', { name: 'Visit Antinomy' })).toHaveAttribute('target', '_blank');
    expect(screen.getByText('Found in 2 curated sources')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Codrops/ })).toHaveAttribute('aria-pressed', 'false');
  });

  it('renders humanized labels for the complete source filter row', () => {
    render(<ReferenceLibrary initialPage={sixSourcePage} />);
    expect(screen.getByRole('button', { name: /All sources/ })).toHaveTextContent('1919/0');
    expect(screen.getByRole('button', { name: /Codrops/ })).toHaveTextContent('847/21');
    expect(screen.getByRole('button', { name: /Pafolios/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Landbook/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Minimal Gallery/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Site of Sites/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /SiteInspire/ })).toBeInTheDocument();
  });

  it('opens review details from the full card and exposes Visit plus a Use switch', async () => {
    const user = userEvent.setup();
    const onReview = vi.fn();
    const onQuickDecision = vi.fn();
    const { container, rerender } = render(<ReferenceGridCard
      reference={reference}
      reviewMode
      selected
      onReview={onReview}
      onQuickDecision={onQuickDecision}
    />);

    await user.click(screen.getByRole('button', { name: 'Review Antinomy' }));
    expect(onReview).toHaveBeenCalledWith(reference);
    expect(container.querySelector('.ref-card')).toHaveClass('is-selected');
    expect(screen.getByRole('link', { name: 'Visit Antinomy' })).toHaveAttribute('target', '_blank');
    const useSwitch = screen.getByRole('switch', { name: 'Use Antinomy' });
    expect(useSwitch).not.toBeChecked();
    await user.click(useSwitch);
    expect(onQuickDecision).toHaveBeenCalledWith(reference, 'keep');

    const keptReference = { ...reference, preference: { decision: 'keep' } };
    rerender(<ReferenceGridCard
      reference={keptReference}
      reviewMode
      selected
      onReview={onReview}
      onQuickDecision={onQuickDecision}
    />);
    const enabledSwitch = screen.getByRole('switch', { name: 'Use Antinomy' });
    expect(enabledSwitch).toBeChecked();
    await user.click(enabledSwitch);
    expect(onQuickDecision).toHaveBeenLastCalledWith(keptReference, 'pass');
  });

  it('requests a filtered page when a source changes', async () => {
    const user = userEvent.setup();
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ ...initialPage, items: [], total: 0 }),
    });
    render(<ReferenceLibrary initialPage={initialPage} />);
    await user.click(screen.getByRole('button', { name: /Codrops/ }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(global.fetch.mock.calls[0][0]).toContain('source=codrops');
  });

  it('identifies private references in the internal review surface', () => {
    render(<ReferenceLibrary initialPage={{
      ...initialPage,
      canManagePrivateReferences: true,
      items: [{ ...reference, isPrivate: true }],
    }} />);
    expect(screen.getByText('Private')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Curate' })).toBeInTheDocument();
  });

  it('loads the complete internal catalog when a curator opens Curate', async () => {
    const user = userEvent.setup();
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        ...initialPage,
        canManagePrivateReferences: true,
        items: [{ ...reference, id: 'agentflow', title: 'AgentFlow', host: 'agentflow.framer.ai', isPrivate: true }],
      }),
    });
    render(<ReferenceLibrary initialPage={{ ...initialPage, canManagePrivateReferences: true }} />);
    await user.click(screen.getByRole('button', { name: 'Curate' }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(global.fetch.mock.calls[0][0]).toContain('view=curate');
    expect((await screen.findAllByText('AgentFlow')).length).toBeGreaterThanOrEqual(1);
  });
});
