import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import NativeEditSidebar from './NativeEditSidebar.jsx';

function controllerFixture() {
  return {
    runtime: {
      assets: [{
        elementId: 'hero-image',
        kind: 'image',
        label: 'Hero image',
        source: '/hero.jpg',
        width: 1200,
        height: 800,
      }],
    },
    selectedRowId: 'hero-title',
    viewportRows: [
      { elementId: 'hero-title', label: 'Hero title', kind: 'text', count: 1, inViewport: true },
      { elementId: 'feature-card', label: 'Feature card', kind: 'container', count: 2, inViewport: false },
    ],
    commands: {
      focusElement: vi.fn(),
      selectElement: vi.fn(),
      replaceAsset: vi.fn(),
    },
  };
}

describe('NativeEditSidebar', () => {
  it('keeps Layers, Sections, and Assets in the left editing surface', () => {
    const controller = controllerFixture();
    render(<NativeEditSidebar controller={controller} />);

    expect(screen.getByRole('tablist', { name: 'Website structure' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Layers' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Sections' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Assets' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Hero title/ }));
    expect(controller.commands.focusElement).toHaveBeenCalledWith('hero-title');

    fireEvent.click(screen.getByRole('tab', { name: 'Assets' }));
    expect(screen.getByPlaceholderText('Search assets')).toBeTruthy();
    expect(screen.getByText('Hero image')).toBeTruthy();
  });

  it('selects a section through its stable runtime element id', () => {
    const controller = controllerFixture();
    render(<NativeEditSidebar controller={controller} initialTab="sections" />);

    fireEvent.click(screen.getByRole('button', { name: /Feature card/ }));
    expect(controller.commands.focusElement).toHaveBeenCalledWith('feature-card');
  });
});
