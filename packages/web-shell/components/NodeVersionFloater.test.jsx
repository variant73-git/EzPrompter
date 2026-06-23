import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';

vi.mock('../lib/canvas-api.js', () => ({
  api: { getSnapshot: vi.fn(async () => ({ snapshot: { html: '<p>v</p>', screenshot_url: null } })) },
}));

import NodeVersionFloater from './NodeVersionFloater.jsx';

const mk = (n) => Array.from({ length: n }, (_, i) => ({
  id: `s${i}`, created_at: '2026-06-23T00:00:00Z', hasScreenshot: false,
}));

describe('NodeVersionFloater', () => {
  it('renders nothing with no versions', () => {
    const { container } = render(<NodeVersionFloater nodeId="n1" versions={[]} onPreview={() => {}} />);
    expect(container.querySelector('.cnode-version-row')).toBeNull();
  });

  it('shows the loading placeholder while loading', () => {
    const { container, getByText } = render(<NodeVersionFloater nodeId="n1" versions={[]} onPreview={() => {}} loading />);
    expect(container.querySelector('.cnode-version-loading')).not.toBeNull();
    expect(getByText('loading history')).toBeTruthy();
  });

  it('marks the active (shown) version and skips preview when re-clicked', () => {
    const onPreview = vi.fn();
    const { container } = render(<NodeVersionFloater nodeId="n1" versions={mk(3)} activeId="s0" onPreview={onPreview} />);
    const thumbs = container.querySelectorAll('.cnode-version-row > .cnode-version-thumb');
    expect(thumbs[0].className).toContain('is-active');
    fireEvent.click(thumbs[0]);            // clicking the shown one is a no-op
    expect(onPreview).not.toHaveBeenCalled();
    fireEvent.click(thumbs[1]);            // a different one previews
    expect(onPreview).toHaveBeenCalledWith('s1');
  });

  it('renders up to 3 thumbnails and no history button when ≤3', () => {
    const { container } = render(<NodeVersionFloater nodeId="n1" versions={mk(3)} onPreview={() => {}} />);
    expect(container.querySelectorAll('.cnode-version-row > .cnode-version-thumb')).toHaveLength(3);
    expect(container.querySelector('.cnode-version-history-btn')).toBeNull();
  });

  it('shows the history button when >3 and opens the full menu', () => {
    const { container } = render(<NodeVersionFloater nodeId="n1" versions={mk(5)} onPreview={() => {}} />);
    expect(container.querySelectorAll('.cnode-version-row > .cnode-version-thumb')).toHaveLength(3);
    const btn = container.querySelector('.cnode-version-history-btn');
    expect(btn).not.toBeNull();
    fireEvent.click(btn);
    expect(container.querySelector('.cnode-version-menu')).not.toBeNull();
    expect(container.querySelectorAll('.cnode-version-menu-row')).toHaveLength(5);
  });

  it('calls onPreview with the version id on thumbnail click', () => {
    const onPreview = vi.fn();
    const { container } = render(<NodeVersionFloater nodeId="n1" versions={mk(2)} onPreview={onPreview} />);
    fireEvent.click(container.querySelector('.cnode-version-row > .cnode-version-thumb'));
    expect(onPreview).toHaveBeenCalledWith('s0');
  });
});
