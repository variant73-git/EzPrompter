import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import NativeMotionTimelineDock from './NativeMotionTimelineDock.jsx';

function controllerFixture(overrides = {}) {
  return {
    status: 'ready',
    selectedRowId: null,
    viewportRows: [],
    viewportPage: { scrollY: 0, viewportHeight: 800, scrollHeight: 800, maxScroll: 0 },
    motionDetail: {},
    activeMotionId: null,
    activeMotion: null,
    timelineState: { currentTime: 0, duration: 1000, playState: 'paused' },
    speed: 1,
    autoKeyframe: false,
    selectedKeyframe: null,
    commands: {
      describeElement: vi.fn(),
      selectMotion: vi.fn(),
      focusElement: vi.fn(),
      scrollTo: vi.fn(),
      scrubIntro: vi.fn(),
      unlinkMotion: vi.fn(),
      applyStripEdit: vi.fn(),
      playback: vi.fn(),
      changeSpeed: vi.fn(),
      seekMotion: vi.fn(),
      changePlaybackMode: vi.fn(),
      toggleAutoKeyframe: vi.fn(),
      selectKeyframe: vi.fn(),
      moveKeyframe: vi.fn(),
      duplicateKeyframe: vi.fn(),
      deleteKeyframe: vi.fn(),
      changeKeyframeEasing: vi.fn(),
      changeKeyframeValue: vi.fn(),
    },
    ...overrides,
  };
}

describe('NativeMotionTimelineDock', () => {
  it('does not occupy the canvas when neither the selection nor the page has motion', () => {
    const { container } = render(<NativeMotionTimelineDock controller={controllerFixture()} />);
    expect(container.firstChild).toBeNull();
  });

  it('docks page motion below the viewport and synchronizes a row through the bridge', () => {
    const controller = controllerFixture({
      viewportRows: [{
        elementId: 'hero-title',
        label: 'Hero title',
        kind: 'text',
        count: 1,
        engines: ['WAAPI'],
        driver: 'time',
        delayMs: 0,
        durationMs: 600,
        marks: [],
        inViewport: true,
      }],
    });
    render(<NativeMotionTimelineDock controller={controller} />);

    const dock = screen.getByRole('region', { name: 'Motion timeline' });
    expect(dock.dataset.dock).toBe('bottom');
    expect(dock.dataset.reservesSidePanels).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'Hero title' }));
    expect(controller.commands.focusElement).toHaveBeenCalledWith('hero-title');
  });
});
