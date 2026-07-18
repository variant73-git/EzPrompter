import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { TimelinePanel } from './NativeMotionEditor.jsx';

const motion = {
  id: 'waapi-fade',
  name: 'Fade',
  engine: 'WAAPI',
  editability: 'direct',
  capabilities: { keyframes: true },
  timing: { delay: 0, duration: 1000, endDelay: 0, iterations: 1, direction: 'normal' },
  tracks: [{
    property: 'opacity',
    keyframes: [
      { offset: 0, value: '0', easing: 'ease-out' },
      { offset: 1, value: '1', easing: null },
    ],
  }],
};

function TimelineHarness({ onMove = vi.fn(), onDuplicate = vi.fn(), onDelete = vi.fn(), onEasing = vi.fn() }) {
  const [selected, setSelected] = useState(null);
  return (
    <TimelinePanel
      open
      motion={motion}
      state={{ currentTime: 0, duration: 1000, playState: 'paused' }}
      speed={1}
      zoom={1}
      autoKeyframe={false}
      selectedKeyframe={selected}
      onToggle={vi.fn()}
      onPlayback={vi.fn()}
      onSpeed={vi.fn()}
      onSeek={vi.fn()}
      onZoom={vi.fn()}
      onPlaybackMode={vi.fn()}
      onAutoKeyframe={vi.fn()}
      onSelectKeyframe={setSelected}
      onMoveKeyframe={onMove}
      onDuplicateKeyframe={onDuplicate}
      onDeleteKeyframe={onDelete}
      onChangeKeyframeEasing={onEasing}
    />
  );
}

describe('motion timeline keyframes', () => {
  it('selects, duplicates and deletes a keyframe with familiar controls', () => {
    const onDuplicate = vi.fn();
    const onDelete = vi.fn();
    render(<TimelineHarness onDuplicate={onDuplicate} onDelete={onDelete} />);

    fireEvent.click(screen.getByRole('button', { name: 'opacity keyframe at 0 percent' }));
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate keyframe (⌘D)' }));
    expect(onDuplicate).toHaveBeenCalledWith({ motionId: 'waapi-fade', property: 'opacity', offset: 0 });

    fireEvent.keyDown(window, { key: 'Delete' });
    expect(onDelete).toHaveBeenCalledWith({ motionId: 'waapi-fade', property: 'opacity', offset: 0 });
  });

  it('moves a keyframe by dragging it across the clip', () => {
    const onMove = vi.fn();
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 180, width: 1000, height: 180,
      toJSON: () => ({}),
    });
    render(<TimelineHarness onMove={onMove} />);
    const keyframe = screen.getByRole('button', { name: 'opacity keyframe at 0 percent' });

    fireEvent.pointerDown(keyframe, { pointerId: 1, button: 0, clientX: 0 });
    fireEvent.pointerMove(keyframe, { pointerId: 1, clientX: 500 });
    fireEvent.pointerUp(keyframe, { pointerId: 1, clientX: 500 });

    expect(onMove).toHaveBeenCalledOnce();
    expect(onMove.mock.calls[0][0]).toEqual({ motionId: 'waapi-fade', property: 'opacity', offset: 0 });
    expect(onMove.mock.calls[0][1]).toBeCloseTo(0.5, 2);
    rect.mockRestore();
  });

  it('duplicates a keyframe when Option is held during drag', () => {
    const onDuplicate = vi.fn();
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 180, width: 1000, height: 180,
      toJSON: () => ({}),
    });
    render(<TimelineHarness onDuplicate={onDuplicate} />);
    const keyframe = screen.getByRole('button', { name: 'opacity keyframe at 0 percent' });

    fireEvent.pointerDown(keyframe, { pointerId: 2, button: 0, clientX: 0, altKey: true });
    fireEvent.pointerMove(keyframe, { pointerId: 2, clientX: 400 });
    fireEvent.pointerUp(keyframe, { pointerId: 2, clientX: 400 });

    expect(onDuplicate).toHaveBeenCalledOnce();
    expect(onDuplicate.mock.calls[0][0]).toEqual({ motionId: 'waapi-fade', property: 'opacity', offset: 0 });
    expect(onDuplicate.mock.calls[0][1]).toBeCloseTo(0.4, 2);
    rect.mockRestore();
  });

  it('opens and edits the easing curve between two frames', () => {
    const onEasing = vi.fn();
    render(<TimelineHarness onEasing={onEasing} />);

    fireEvent.click(screen.getByRole('button', { name: 'opacity keyframe at 0 percent' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit curve to next keyframe' }));
    expect(screen.getByRole('dialog', { name: 'Segment easing editor' })).toBeTruthy();

    fireEvent.change(screen.getByRole('combobox', { name: 'Easing preset' }), { target: { value: 'ease-in-out' } });
    expect(onEasing).toHaveBeenCalledWith(
      { motionId: 'waapi-fade', property: 'opacity', offset: 0 },
      'ease-in-out',
    );
  });
});
