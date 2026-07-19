import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MotionPanel, TimelinePanel } from './NativeMotionEditor.jsx';

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

function TimelineHarness({ onMove = vi.fn(), onDuplicate = vi.fn(), onDelete = vi.fn(), onEasing = vi.fn(), ...rest }) {
  const [selected, setSelected] = useState(null);
  return (
    <TimelinePanel
      open
      motion={motion}
      state={{ currentTime: 0, duration: 1000, playState: 'paused' }}
      {...rest}
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

function gsapClip(id, overrides = {}) {
  return {
    id,
    engine: 'GSAP',
    name: id,
    editability: 'adapter',
    driver: { type: 'time' },
    trigger: { type: 'runtime' },
    capabilities: { timing: true, easing: true, keyframes: true },
    timing: { delay: 0, duration: 600, endDelay: 0, iterations: 1, direction: 'normal', easing: 'power2.out', yoyo: false, repeatDelay: 0, ...(overrides.timing || {}) },
    tracks: overrides.tracks || [{ property: 'opacity', keyframes: [] }],
    scroll: null,
    group: {
      targetId: null, parentId: null, splitRootId: null, splitRootLabel: null,
      timelineId: null, timelineLabel: null, timelineScroll: false, targetCount: 1,
      ...(overrides.group || {}),
    },
  };
}

function splitClips() {
  const group = { splitRootId: 'el-title', splitRootLabel: 'CropTab', parentId: 'el-title' };
  return [
    gsapClip('char-1', { timing: { delay: 0 }, group }),
    gsapClip('char-2', { timing: { delay: 40 }, group }),
    gsapClip('char-3', { timing: { delay: 80 }, group }),
    gsapClip('solo'),
  ];
}

function renderMotionPanel(props = {}) {
  return render(
    <MotionPanel
      selected={{ id: 'el-title', warnings: [] }}
      motion={splitClips()}
      activeMotionId={null}
      onActiveMotion={vi.fn()}
      speed={1}
      onPlayback={vi.fn()}
      onSpeed={vi.fn()}
      onMotion={vi.fn()}
      onStagger={vi.fn()}
      {...props}
    />,
  );
}

describe('motion panel grouped list', () => {
  it('collapses split-text characters into one text-reveal row', () => {
    renderMotionPanel();
    expect(screen.getByText('CropTab')).toBeTruthy();
    expect(screen.getByText(/3 animations/)).toBeTruthy();
    expect(screen.queryByText('char-2')).toBeNull();
    expect(screen.getByText('solo')).toBeTruthy();
  });

  it('activates the representative clip when the group row is clicked', () => {
    const onActiveMotion = vi.fn();
    renderMotionPanel({ onActiveMotion });
    fireEvent.click(screen.getByText('CropTab'));
    expect(onActiveMotion).toHaveBeenCalledWith('char-1');
  });

  it('expands the group to reveal and select individual members', () => {
    const onActiveMotion = vi.fn();
    renderMotionPanel({ onActiveMotion });
    fireEvent.click(screen.getByRole('button', { name: 'Show 3 grouped animations' }));
    fireEvent.click(screen.getByText('char-2'));
    expect(onActiveMotion).toHaveBeenCalledWith('char-2');
  });

  it('re-spaces the whole group through the stagger control', () => {
    const onStagger = vi.fn();
    renderMotionPanel({ onStagger });
    fireEvent.click(screen.getByRole('button', { name: 'Show 3 grouped animations' }));
    const field = screen.getByLabelText(/Stagger/);
    fireEvent.change(field, { target: { value: '60' } });
    fireEvent.blur(field);
    expect(onStagger).toHaveBeenCalledOnce();
    const [members, value] = onStagger.mock.calls[0];
    expect(members.map((member) => member.id)).toEqual(['char-1', 'char-2', 'char-3']);
    expect(value).toBe(60);
  });

  it('does not re-space the group when the stagger field blurs untouched', () => {
    // The displayed value is a MEDIAN of the real deltas — committing it blindly
    // on blur would silently "regularize" non-uniform delays with zero user intent.
    const onStagger = vi.fn();
    renderMotionPanel({ onStagger });
    fireEvent.click(screen.getByRole('button', { name: 'Show 3 grouped animations' }));
    const field = screen.getByLabelText(/Stagger/);
    fireEvent.blur(field);
    expect(onStagger).not.toHaveBeenCalled();
  });

  it('renders an empty stagger field for non-uniform groups and commits nothing on empty blur', () => {
    const onStagger = vi.fn();
    const group = { splitRootId: 'el-title', splitRootLabel: 'CropTab', parentId: 'el-title' };
    renderMotionPanel({
      onStagger,
      motion: [
        gsapClip('char-1', { timing: { delay: 0 }, group }),
        gsapClip('char-2', { timing: { delay: 0 }, group }),
        gsapClip('char-3', { timing: { delay: 1000 }, group }),
      ],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Show 3 grouped animations' }));
    const field = screen.getByLabelText(/Stagger/);
    expect(field.value).toBe('');
    fireEvent.blur(field);
    expect(onStagger).not.toHaveBeenCalled();
    fireEvent.change(field, { target: { value: '60' } });
    fireEvent.blur(field);
    expect(onStagger).toHaveBeenCalledOnce();
  });

  it('hides the stagger control when members live inside a GSAP timeline or ride scroll', () => {
    // Verified on real GSAP 3.15 (probe-gsap-timeline-delay.mjs): delay() on a
    // timeline child updates the reported value but never moves startTime — the
    // write would be a silent no-op presented as success. Scroll-scrubbed clips
    // have no meaningful delay either.
    const timelineGroup = { splitRootId: 'el-title', splitRootLabel: 'CropTab', parentId: 'el-title', timelineId: 'timeline-1' };
    const onStagger = vi.fn();
    renderMotionPanel({
      onStagger,
      motion: [
        gsapClip('char-1', { timing: { delay: 0 }, group: timelineGroup }),
        gsapClip('char-2', { timing: { delay: 40 }, group: timelineGroup }),
        gsapClip('char-3', { timing: { delay: 80 }, group: timelineGroup }),
      ],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Show 3 grouped animations' }));
    expect(screen.queryByLabelText(/Stagger/)).toBeNull();
  });
});

const viewportRows = [
  { elementId: 'el-a', label: 'Hero headline', kind: 'text', top: 0, count: 1, engines: ['ScrollTrigger'], driver: 'scroll', delayMs: 0, durationMs: 1000, marks: [0, 1] },
  { elementId: 'el-b', label: 'Card image', kind: 'image', top: 100, count: 1, engines: ['CSS'], driver: 'time', delayMs: 0, durationMs: 500, marks: [] },
];

describe('timeline canvas layout', () => {
  it('nests the active element property tracks directly under its strip, mirroring the labels', () => {
    const { container } = render(
      <TimelineHarness rows={viewportRows} selectedElementId="el-a" onSelectElement={vi.fn()} />,
    );
    const sequence = Array.from(container.querySelectorAll('[data-element-row],[data-track-row]'))
      .map((node) => node.dataset.elementRow || `track:${node.dataset.trackRow}`);
    expect(sequence).toEqual(['el-a', 'track:opacity', 'el-b']);
  });

  it('keeps rendering the active motion tracks when no viewport rows exist', () => {
    render(<TimelineHarness rows={[]} />);
    expect(screen.getByRole('button', { name: 'opacity keyframe at 0 percent' })).toBeTruthy();
  });

  it('uses ONE page-scroll ruler: strips sit at their scroll pixels and the scrubber scrolls the site', () => {
    const onScrollTo = vi.fn();
    const page = { scrollY: 1000, viewportHeight: 800, scrollHeight: 5000, maxScroll: 4200 };
    const scrollRows = [
      { ...viewportRows[0], scrollStart: 400, scrollEnd: 900 },
      { ...viewportRows[1], scrollStart: 2100, scrollEnd: null },
    ];
    const { container } = render(
      <TimelineHarness rows={scrollRows} selectedElementId={null} onSelectElement={vi.fn()} page={page} onScrollTo={onScrollTo} />,
    );

    // Scroll-driven strip is drawn exactly at its trigger's pixels on the page axis.
    const strip = container.querySelector('[data-element-row="el-a"] i');
    expect(parseFloat(strip.style.left)).toBeCloseTo((400 / 4200) * 100, 1);
    expect(parseFloat(strip.style.width)).toBeCloseTo((500 / 4200) * 100, 1);
    // Time-driven strip is placed at the scroll point where it triggers.
    const timeStrip = container.querySelector('[data-element-row="el-b"] i');
    expect(parseFloat(timeStrip.style.left)).toBeCloseTo((2100 / 4200) * 100, 1);

    // The ruler reads in page pixels, not seconds.
    expect(screen.getByText('4200px')).toBeTruthy();

    // The scrubber IS the page scroll: range 0..maxScroll, dragging scrolls the site.
    const scrubber = screen.getByLabelText('Page scroll position');
    expect(scrubber.max).toBe('4200');
    expect(Number(scrubber.value)).toBe(1000);
    fireEvent.change(scrubber, { target: { value: '2100' } });
    expect(onScrollTo).toHaveBeenCalledWith(2100);
  });

  it('never plots time-math keyframes on the scroll axis when the selected element is offscreen', () => {
    // Selected element scrolled out of view: its row is gone but rows remain.
    // Rendering its tracks with time percentages on a page-pixel ruler would put
    // keyframes at meaningless positions with no matching labels.
    const page = { scrollY: 0, viewportHeight: 800, scrollHeight: 5000, maxScroll: 4200 };
    render(
      <TimelineHarness rows={[{ ...viewportRows[0], scrollStart: 400, scrollEnd: 900 }]} selectedElementId="el-gone" onSelectElement={vi.fn()} page={page} />,
    );
    expect(screen.queryByRole('button', { name: 'opacity keyframe at 0 percent' })).toBeNull();
  });

  it('keeps the page-scroll scrubber alive in stretches with nothing animated on screen', () => {
    const page = { scrollY: 2000, viewportHeight: 800, scrollHeight: 5000, maxScroll: 4200 };
    render(<TimelineHarness rows={[]} selectedElementId={null} onSelectElement={vi.fn()} page={page} />);
    expect(screen.getByLabelText('Page scroll position')).toBeTruthy();
  });

  it('drags the active scroll strip edge to retarget its scroll range', () => {
    // §3b: the strip IS the control — dragging its edge is the primary edit.
    const onStripEdit = vi.fn();
    const page = { scrollY: 0, viewportHeight: 800, scrollHeight: 5000, maxScroll: 4200 };
    const scrollRows = [{ ...viewportRows[0], scrollStart: 400, scrollEnd: 900 }];
    const scrollMotion = { ...motion, driver: { type: 'scroll' }, scroll: { start: '400', end: '900', scrub: true } };
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 200, width: 1000, height: 200,
      toJSON: () => ({}),
    });
    render(
      <TimelineHarness
        rows={scrollRows}
        selectedElementId="el-a"
        onSelectElement={vi.fn()}
        page={page}
        motion={scrollMotion}
        onStripEdit={onStripEdit}
      />,
    );

    // End edge sits at 900/4200 of the 1000px canvas (~214px). Drag +100px = +420 scroll px.
    const endHandle = screen.getByRole('button', { name: 'Adjust scroll end' });
    fireEvent.pointerDown(endHandle, { pointerId: 7, button: 0, clientX: 214 });
    fireEvent.pointerMove(endHandle, { pointerId: 7, clientX: 314 });
    fireEvent.pointerUp(endHandle, { pointerId: 7, clientX: 314 });

    expect(onStripEdit).toHaveBeenCalledOnce();
    const [row, next] = onStripEdit.mock.calls[0];
    expect(row.elementId).toBe('el-a');
    expect(next.end).toBeGreaterThan(1290);
    expect(next.end).toBeLessThan(1350);
    expect(next.start).toBeUndefined();
    rect.mockRestore();
  });
});

describe('adapter (GSAP) keyframes on the timeline', () => {
  const adapterMotion = {
    id: 'gsap-slide',
    name: 'Slide',
    engine: 'GSAP',
    editability: 'adapter',
    driver: { type: 'time' },
    capabilities: { keyframes: true, timing: true, easing: true },
    timing: { delay: 0, duration: 1000, endDelay: 0, iterations: 1, direction: 'normal', easing: 'power2.out' },
    tracks: [{
      property: 'x',
      keyframes: [
        { offset: 0, value: '0', easing: 'power2.out' },
        { offset: 1, value: '100', easing: null },
      ],
    }],
  };

  it('lets the user select an adapter keyframe and edit its value from the header', () => {
    const onValue = vi.fn();
    render(<TimelineHarness motion={adapterMotion} onChangeKeyframeValue={onValue} />);
    const keyframe = screen.getByRole('button', { name: 'x keyframe at 100 percent' });
    expect(keyframe.disabled).toBe(false);
    fireEvent.click(keyframe);
    const valueField = screen.getByLabelText(/Keyframe value/);
    fireEvent.change(valueField, { target: { value: '160' } });
    fireEvent.blur(valueField);
    expect(onValue).toHaveBeenCalledWith(
      { motionId: 'gsap-slide', property: 'x', offset: 1 },
      '160',
    );
  });

  it('blocks duplicate, delete and segment-curve for adapter keyframes — values are edited, never removed', () => {
    // Deleting a GSAP start/end has no well-defined runtime meaning (removing
    // startAt re-records the same value right back) — offering it would record
    // phantom history for a visual no-op.
    render(<TimelineHarness motion={adapterMotion} />);
    fireEvent.click(screen.getByRole('button', { name: 'x keyframe at 100 percent' }));
    expect(screen.getByRole('button', { name: 'Duplicate keyframe (⌘D)' }).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Delete keyframe' }).disabled).toBe(true);
    expect(screen.getByTitle(/Easing section/).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'x keyframe at 0 percent' }));
    expect(screen.getByRole('button', { name: 'Delete keyframe' }).disabled).toBe(true);
  });
});

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
