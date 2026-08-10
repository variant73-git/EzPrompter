import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ReferenceLibrary from './ReferenceLibrary.jsx';

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
    sources: [{ value: 'codrops', count: 1 }, { value: 'siteinspire', count: 1 }],
    categories: [{ value: 'Studio', count: 1 }],
  },
};

const sixSourcePage = {
  ...initialPage,
  total: 1919,
  facets: {
    ...initialPage.facets,
    sources: [
      { value: 'codrops', count: 847 },
      { value: 'pafolios', count: 763 },
      { value: 'landbook', count: 152 },
      { value: 'minimalgallery', count: 92 },
      { value: 'siteofsites', count: 71 },
      { value: 'siteinspire', count: 40 },
    ],
  },
};

describe('ReferenceLibrary', () => {
  afterEach(() => vi.restoreAllMocks());

  it('renders a traceable external reference and editorial consensus', () => {
    render(<ReferenceLibrary initialPage={initialPage} />);
    expect(screen.getByRole('link', { name: 'Open Antinomy' })).toHaveAttribute('href', 'https://antinomy.studio');
    expect(screen.getByText('Found in 2 curated sources')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Codrops/ })).toHaveAttribute('aria-pressed', 'false');
  });

  it('renders humanized labels for the complete source filter row', () => {
    render(<ReferenceLibrary initialPage={sixSourcePage} />);
    expect(screen.getByRole('button', { name: /All sources/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Codrops/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Pafolios/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Landbook/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Minimal Gallery/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Site of Sites/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /SiteInspire/ })).toBeInTheDocument();
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
