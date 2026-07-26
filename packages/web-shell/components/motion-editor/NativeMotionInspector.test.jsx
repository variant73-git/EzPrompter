import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import NativeMotionInspector from './NativeMotionInspector.jsx';

const selected = {
  id: 'hero-title',
  label: 'Hero title',
  tag: 'h1',
  classes: ['hero-title'],
  styles: {},
  rect: {},
  warnings: [],
  motion: [],
};

function controllerFixture(overrides = {}) {
  return {
    runtime: { title: 'Fixture', profile: { colors: [], fonts: [] } },
    selected,
    activeMotion: null,
    activeMotionId: null,
    timelineOffset: 0,
    motion: [],
    commands: {
      applyStyle: vi.fn(),
      applyText: vi.fn(),
      applyAttribute: vi.fn(),
      applyMotion: vi.fn(),
      applyStagger: vi.fn(),
    },
    ...overrides,
  };
}

describe('NativeMotionInspector', () => {
  it('offers Properties, Motion, and Code without putting Assets on the right', () => {
    render(<NativeMotionInspector controller={controllerFixture()} />);

    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Properties', 'Motion', 'Code']);
    expect(screen.queryByRole('tab', { name: 'Assets' })).toBeNull();
    expect(screen.getByRole('tabpanel', { name: 'Properties' })).toBeTruthy();
    expect(screen.getByText('Hero title')).toBeTruthy();
  });

  it('keeps tab and tabpanel semantics while switching controller-bound views', () => {
    render(<NativeMotionInspector controller={controllerFixture()} />);

    fireEvent.click(screen.getByRole('tab', { name: 'Motion' }));
    expect(screen.getByRole('tabpanel', { name: 'Motion' })).toBeTruthy();
    expect(screen.getByText(/No animation is attached directly/)).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: 'Code' }));
    expect(screen.getByRole('tabpanel', { name: 'Code' })).toBeTruthy();
    expect(screen.getByText('[data-uncraft-id="hero-title"]')).toBeTruthy();
  });

  it('shows Loop in the selected Motion header without placing it over the viewport', () => {
    render(<NativeMotionInspector
      controller={controllerFixture({
        activeMotion: { id: 'marquee', timing: { iterations: Infinity } },
        selectionSettlement: { status: 'settled', elementId: 'hero-title', loop: true },
      })}
      activeTab="motion"
    />);

    expect(screen.getByText('Loop')).toHaveAttribute('data-motion-loop', 'true');
  });

  it('shows a Properties-side multiple-motion indicator and opens the focused Motion choice', () => {
    const focusOwnership = vi.fn();
    const base = controllerFixture();
    const controller = controllerFixture({
      selected: {
        ...selected,
        styles: { opacity: '0.8', transform: 'none', transformOrigin: '50% 50%' },
      },
      propertyOwnership: {
        opacity: {
          status: 'ambiguous',
          property: 'opacity',
          candidates: [
            { channelId: 'entrance:opacity', motionId: 'entrance', label: 'Entrance', engine: 'GSAP' },
            { channelId: 'hover:opacity', motionId: 'hover', label: 'Hover', engine: 'WAAPI' },
          ],
        },
      },
      commands: {
        ...base.commands,
        focusOwnership,
        chooseOwnership: vi.fn(),
      },
    });
    render(<NativeMotionInspector controller={controller} />);

    fireEvent.click(screen.getByRole('button', { name: 'Choose controlling motion for Opacity' }));
    expect(focusOwnership).toHaveBeenCalledWith('opacity');
    expect(screen.getByRole('tab', { name: 'Motion' })).toHaveAttribute('aria-selected', 'true');
  });

  it('renders only the contributing Motion channels and forwards the explicit choice', () => {
    const chooseOwnership = vi.fn();
    const base = controllerFixture();
    render(<NativeMotionInspector
      controller={controllerFixture({
        ownershipConflict: {
          requestId: 'ownership-1',
          status: 'ambiguous',
          property: 'opacity',
          label: 'Opacity',
          candidates: [
            { channelId: 'entrance:opacity', motionId: 'entrance', label: 'Entrance', engine: 'GSAP' },
            { channelId: 'hover:opacity', motionId: 'hover', label: 'Hover', engine: 'WAAPI' },
          ],
        },
        commands: {
          ...base.commands,
          chooseOwnership,
        },
      })}
    />);

    expect(screen.getByRole('tab', { name: 'Motion' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Multiple motions control Opacity')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Edit Hover' }));
    expect(chooseOwnership).toHaveBeenCalledWith('hover:opacity');
  });
});
