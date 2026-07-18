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
};

describe('CanvasInspector', () => {
  it('returns the canvas space when there is no selection', () => {
    const { container } = render(<CanvasInspector node={null} onFrameChange={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('keeps website actions contextual while properties collapse and code remains inspectable', () => {
    const onEditSite = vi.fn();
    render(<CanvasInspector node={site} onFrameChange={vi.fn()} onEditSite={onEditSite} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit website' }));
    expect(onEditSite).toHaveBeenCalledOnce();
    expect(screen.getByRole('link', { name: 'Open in Browser' }).getAttribute('href')).toBe('/preview/site-1');
    expect(screen.getByText('Prototype result')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Overview' }));
    expect(screen.queryByText('Prototype result')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Code' }));
    expect(screen.getByText(/<main>Portfolio<\/main>/)).toBeTruthy();
  });
});
