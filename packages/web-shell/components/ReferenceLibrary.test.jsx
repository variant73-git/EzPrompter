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

describe('ReferenceLibrary', () => {
  afterEach(() => vi.restoreAllMocks());

  it('renders a traceable external reference and editorial consensus', () => {
    render(<ReferenceLibrary initialPage={initialPage} />);
    expect(screen.getByRole('link', { name: 'Open Antinomy' })).toHaveAttribute('href', 'https://antinomy.studio');
    expect(screen.getByText('Found in 2 curated sources')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Codrops/ })).toHaveAttribute('aria-pressed', 'false');
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
});
