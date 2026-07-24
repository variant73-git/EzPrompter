import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import CanvasInspector from './CanvasInspector.jsx';

beforeEach(() => {
  vi.stubGlobal('localStorage', { getItem: vi.fn(() => null), setItem: vi.fn() });
});

afterEach(() => vi.unstubAllGlobals());

const site = {
  id: 'site-1', kind: 'site', pos_x: 10, pos_y: 20, width: 1280, height: 800,
  meta: { name: 'Portfolio result', source: 'blank', status: 'Prototype result' },
  current_html: '<main>Portfolio</main>',
  current_snapshot_id: 'snap-1',
};

describe('CanvasInspector', () => {
  it('returns the canvas space when there is no selection', () => {
    const { container } = render(<CanvasInspector node={null} onFrameChange={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('keeps website actions contextual while properties collapse and code remains inspectable', () => {
    const onEditSite = vi.fn();
    render(<CanvasInspector node={site} onFrameChange={vi.fn()} onEditSite={onEditSite} />);
    fireEvent.click(screen.getByRole('button', { name: 'Clone & Edit' }));
    expect(onEditSite).toHaveBeenCalledOnce();
    expect(screen.getByRole('link', { name: 'Open in Browser' }).getAttribute('href')).toBe('/preview/site-1');
    expect(screen.getByText('Prototype result')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Overview' }));
    expect(screen.queryByText('Prototype result')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Code' }));
    expect(screen.getByText(/<main>Portfolio<\/main>/)).toBeTruthy();
  });

  it('renders "Open in Browser" as a real link when the node is idle', () => {
    render(<CanvasInspector node={site} onFrameChange={vi.fn()} onEditSite={vi.fn()} />);
    const link = screen.getByRole('link', { name: 'Open in Browser' });
    expect(link.getAttribute('href')).toBe('/preview/site-1');
    expect(link.getAttribute('aria-disabled')).toBeNull();
  });

  it('disables "Open in Browser" while the node is still capturing/cloning (busy)', () => {
    render(<CanvasInspector node={site} onFrameChange={vi.fn()} onEditSite={vi.fn()} busy />);
    // No navigable link is exposed while busy — there is no viewable result yet.
    expect(screen.queryByRole('link', { name: 'Open in Browser' })).toBeNull();
    const disabled = screen.getByText('Open in Browser').closest('[aria-disabled="true"]');
    expect(disabled).toBeTruthy();
    expect(disabled.getAttribute('href')).toBeNull();
  });

  it('disables "Open in Browser" for a blank node with neither snapshot nor origin URL (would 404)', () => {
    const blank = { ...site, current_snapshot_id: null, origin_url: null, current_html: null };
    render(<CanvasInspector node={blank} onFrameChange={vi.fn()} onEditSite={vi.fn()} />);
    expect(screen.queryByRole('link', { name: 'Open in Browser' })).toBeNull();
    expect(screen.getByText('Open in Browser').closest('[aria-disabled="true"]')).toBeTruthy();
  });

  it('keeps "Open in Browser" enabled for a node with an origin URL even without a snapshot (preview redirects)', () => {
    const urlOnly = { ...site, current_snapshot_id: null, current_html: null, origin_url: 'https://example.com' };
    render(<CanvasInspector node={urlOnly} onFrameChange={vi.fn()} onEditSite={vi.fn()} />);
    expect(screen.getByRole('link', { name: 'Open in Browser' }).getAttribute('href')).toBe('/preview/site-1');
  });
});
