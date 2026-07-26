import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import {
  MOTION_EDITOR_PROTOCOL,
  MOTION_EDITOR_PROTOCOL_V2,
  SUPPORTED_MOTION_EDITOR_PROTOCOLS,
} from '../../lib/motion-editor/protocol.js';
import NativeMotionEditor, { MotionPanel, TimelinePanel } from './NativeMotionEditor.jsx';

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

function TimelineHarness({ onMove = vi.fn(), onDuplicate = vi.fn(), onDelete = vi.fn(), onEasing = vi.fn(), onSeek = vi.fn(), ...rest }) {
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
      onSeek={onSeek}
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

describe('native motion editor protocol v2 integration', () => {
  it('negotiates v2 and adds history only after the runtime commits the transaction', async () => {
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      disconnect() {}
    });
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
    });
    render(<NativeMotionEditor />);
    const iframe = screen.getByTitle('Native animated website runtime');
    const postMessage = vi.spyOn(iframe.contentWindow, 'postMessage');
    const origin = 'https://runtime.uncraft.test';
    const context = {
      sessionNonce: 'nonce-editor-123456',
      runtimeGeneration: 2,
      bundleId: 'bundle-editor',
      sessionId: 'session-editor',
    };
    const runtimeMessage = (type, payload, requestId) => ({
      protocol: MOTION_EDITOR_PROTOCOL_V2,
      protocolVersion: MOTION_EDITOR_PROTOCOL_V2,
      supportedProtocols: SUPPORTED_MOTION_EDITOR_PROTOCOLS,
      source: 'runtime',
      type,
      requestId,
      ...context,
      payload,
    });

    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', {
        source: iframe.contentWindow,
        origin,
        data: {
          protocol: MOTION_EDITOR_PROTOCOL,
          source: 'runtime',
          type: 'runtime-ready',
          payload: {
            title: 'Fixture',
            supportedProtocols: SUPPORTED_MOTION_EDITOR_PROTOCOLS,
            ...context,
          },
        },
      }));
    });
    const negotiation = postMessage.mock.calls.map(([message]) => message)
      .find((message) => message.type === 'negotiate-protocol');
    expect(negotiation).toMatchObject({ ...context, payload: { selectedProtocol: MOTION_EDITOR_PROTOCOL_V2 } });

    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', {
        source: iframe.contentWindow,
        origin,
        data: runtimeMessage('protocol-negotiated', { selectedProtocol: MOTION_EDITOR_PROTOCOL_V2 }, negotiation.requestId),
      }));
      window.dispatchEvent(new MessageEvent('message', {
        source: iframe.contentWindow,
        origin,
        data: runtimeMessage('selection-changed', {
          element: {
            id: 'el-a', label: 'Hero', tag: 'div', classes: [], text: '', canEditText: false,
            rect: {}, motion: [], warnings: [],
            styles: { opacity: '1', color: 'rgb(0, 0, 0)', colorHex: '#000000', backgroundColor: 'rgba(0, 0, 0, 0)', backgroundColorHex: '#000000' },
          },
        }, 'runtime-selection-1'),
      }));
    });

    const opacity = screen.getByLabelText('Opacity');
    fireEvent.change(opacity, { target: { value: '0.4' } });
    fireEvent.blur(opacity);
    const apply = postMessage.mock.calls.map(([message]) => message)
      .filter((message) => message.type === 'apply-transaction').pop();
    expect(apply).toBeTruthy();
    expect(screen.getByText('0 changes')).toBeTruthy();

    const acknowledged = {
      ...apply.payload.transaction,
      patches: apply.payload.transaction.patches.map((patch) => ({ ...patch, before: '1', value: '0.4' })),
    };
    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', {
        source: iframe.contentWindow,
        origin,
        data: runtimeMessage('transaction-committed', { transaction: acknowledged, operation: 'apply' }, apply.requestId),
      }));
    });
    expect(screen.getByText('1 change')).toBeTruthy();

    fireEvent.change(opacity, { target: { value: '0.2' } });
    fireEvent.blur(opacity);
    expect(postMessage.mock.calls.map(([message]) => message)
      .filter((message) => message.type === 'apply-transaction')).toHaveLength(2);
    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', {
        source: iframe.contentWindow,
        origin,
        data: {
          protocol: MOTION_EDITOR_PROTOCOL,
          source: 'runtime',
          type: 'runtime-ready',
          payload: {
            title: 'Fixture reloaded',
            supportedProtocols: SUPPORTED_MOTION_EDITOR_PROTOCOLS,
            ...context,
            runtimeGeneration: context.runtimeGeneration + 1,
          },
        },
      }));
    });
    expect(screen.getByText('1 change')).toBeTruthy();
    expect(screen.getByRole('alert')).toHaveTextContent('The website restarted before a change was confirmed. The previous value was restored.');
    vi.unstubAllGlobals();
  });
});

describe('motion panel — properties of the active animation', () => {
  it('renders no transport and no animations list: the timeline owns the list', () => {
    renderMotionPanel({ activeMotionId: 'char-1' });
    expect(screen.queryByTitle('Play this animation')).toBeNull();
    expect(screen.queryByTitle('Pause this animation')).toBeNull();
    expect(screen.queryByTitle('Restart this animation')).toBeNull();
    expect(screen.queryByText('Animations')).toBeNull();
    // The active clip's properties are all still here.
    expect(screen.getAllByText('Trigger').length).toBeGreaterThan(0);
    expect(screen.getByText('Timing')).toBeTruthy();
    expect(screen.getByText('Easing')).toBeTruthy();
  });

  it('shows the group context of a split-text clip without listing its members', () => {
    renderMotionPanel({ activeMotionId: 'char-1' });
    expect(screen.getByText(/CropTab · Text reveal · 3 animations/)).toBeTruthy();
    expect(screen.queryByText('char-2')).toBeNull();
  });

  it('re-spaces the whole group through the stagger control in Timing', () => {
    const onStagger = vi.fn();
    renderMotionPanel({ onStagger, activeMotionId: 'char-1' });
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
    renderMotionPanel({ onStagger, activeMotionId: 'char-1' });
    fireEvent.blur(screen.getByLabelText(/Stagger/));
    expect(onStagger).not.toHaveBeenCalled();
  });

  it('renders an empty stagger field for non-uniform groups and commits nothing on empty blur', () => {
    const onStagger = vi.fn();
    const group = { splitRootId: 'el-title', splitRootLabel: 'CropTab', parentId: 'el-title' };
    renderMotionPanel({
      onStagger,
      activeMotionId: 'char-1',
      motion: [
        gsapClip('char-1', { timing: { delay: 0 }, group }),
        gsapClip('char-2', { timing: { delay: 0 }, group }),
        gsapClip('char-3', { timing: { delay: 1000 }, group }),
      ],
    });
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
      activeMotionId: 'char-1',
      motion: [
        gsapClip('char-1', { timing: { delay: 0 }, group: timelineGroup }),
        gsapClip('char-2', { timing: { delay: 40 }, group: timelineGroup }),
        gsapClip('char-3', { timing: { delay: 80 }, group: timelineGroup }),
      ],
    });
    expect(screen.queryByLabelText(/Stagger/)).toBeNull();
  });
});

// count: 2 → the rows carry a chevron. Single-animation rows render a spacer
// instead (a chevron that expands nothing is noise) and open implicitly when
// selected — covered by its own test below.
const viewportRows = [
  { elementId: 'el-a', label: 'Hero headline', kind: 'text', top: 0, count: 2, engines: ['ScrollTrigger'], driver: 'scroll', delayMs: 0, durationMs: 1000, marks: [0, 1] },
  { elementId: 'el-b', label: 'Card image', kind: 'image', top: 100, count: 2, engines: ['CSS'], driver: 'time', delayMs: 0, durationMs: 500, marks: [] },
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
    const strip = container.querySelector('[data-element-row="el-a"] [data-layer-strip]');
    expect(parseFloat(strip.style.left)).toBeCloseTo((400 / 4200) * 100, 1);
    expect(parseFloat(strip.style.width)).toBeCloseTo((500 / 4200) * 100, 1);
    // Time-driven strip is placed at the scroll point where it triggers.
    const timeStrip = container.querySelector('[data-element-row="el-b"] [data-layer-strip]');
    expect(parseFloat(timeStrip.style.left)).toBeCloseTo((2100 / 4200) * 100, 1);

    // The ruler reads in page pixels, not seconds.
    expect(screen.getByText('4200px')).toBeTruthy();

    // Scrubbing = pointer-dragging anywhere on empty track area: the playhead
    // moves and the SITE scrolls, while strips stay exactly where they were.
    const surface = container.querySelector('[data-timeline-surface]');
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 872, bottom: 166, width: 872, height: 166, toJSON: () => ({}),
    });
    // labels column (152) + 5px inset + half of the 715px lane = pct 0.5 → scrollY 2100.
    fireEvent.pointerDown(surface, { pointerId: 5, button: 0, clientX: 152 + 5 + 357.5 });
    expect(onScrollTo).toHaveBeenCalledWith(2100);
    rect.mockRestore();
    expect(parseFloat(container.querySelector('[data-element-row="el-a"] [data-layer-strip]').style.left)).toBeCloseTo((400 / 4200) * 100, 1);
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

  it('keeps the page-scroll scrub alive in stretches with nothing animated on screen', () => {
    const onScrollTo = vi.fn();
    const page = { scrollY: 2000, viewportHeight: 800, scrollHeight: 5000, maxScroll: 4200 };
    const { container } = render(<TimelineHarness rows={[]} selectedElementId={null} onSelectElement={vi.fn()} page={page} onScrollTo={onScrollTo} />);
    const surface = container.querySelector('[data-timeline-surface]');
    expect(surface).toBeTruthy();
    expect(container.querySelector('[data-timeline-playhead]')).toBeTruthy();
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 872, bottom: 166, width: 872, height: 166, toJSON: () => ({}),
    });
    fireEvent.pointerDown(surface, { pointerId: 6, button: 0, clientX: 152 + 720 });
    expect(onScrollTo).toHaveBeenCalledWith(4200);
    rect.mockRestore();
    // The playhead CAP lives inside the sticky ruler row, so it stays visible
    // when the row list scrolls vertically.
    const cap = container.querySelector('[data-playhead-cap]');
    expect(cap).toBeTruthy();
    expect(cap.closest('[data-row-kind="ruler"]')).toBeTruthy();
  });

  it('a controlled expandedLayers set can COLLAPSE the selected layer (chevron works both ways)', () => {
    // Selection auto-expands by adding to the set — but the set is the single
    // truth, so removing the id must fold the property rows back in.
    const { rerender, container } = render(
      <TimelineHarness rows={viewportRows} selectedElementId="el-a" onSelectElement={vi.fn()} expandedLayers={new Set(['el-a'])} />,
    );
    expect(container.querySelector('[data-track-row="opacity"]')).toBeTruthy();
    rerender(
      <TimelineHarness rows={viewportRows} selectedElementId="el-a" onSelectElement={vi.fn()} expandedLayers={new Set()} />,
    );
    expect(container.querySelector('[data-track-row="opacity"]')).toBeNull();
  });

  it('the layer strip is a button that selects its element on the site', () => {
    const onSelectElement = vi.fn();
    render(<TimelineHarness rows={viewportRows} selectedElementId={null} onSelectElement={onSelectElement} />);
    fireEvent.click(screen.getByRole('button', { name: 'Select Hero headline' }));
    expect(onSelectElement).toHaveBeenCalledWith('el-a');
  });

  it('renders no dots on strip ends', () => {
    const { container } = render(
      <TimelineHarness rows={viewportRows} selectedElementId={null} onSelectElement={vi.fn()} />,
    );
    expect(container.querySelector('[data-element-row] i')).toBeNull();
  });

  it('dragging a time strip’s right edge stretches its duration (longer = slower)', () => {
    const onStripEdit = vi.fn();
    const page = { scrollY: 0, viewportHeight: 800, scrollHeight: 5000, maxScroll: 4200 };
    const timeRows = [{ ...viewportRows[1], scrollStart: 2100, scrollEnd: null }];
    const timeMotion = { ...motion, driver: { type: 'time' }, capabilities: { keyframes: true, timing: true } };
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 200, width: 1000, height: 200,
      toJSON: () => ({}),
    });
    render(
      <TimelineHarness
        rows={timeRows}
        selectedElementId="el-b"
        onSelectElement={vi.fn()}
        page={page}
        motion={timeMotion}
        onStripEdit={onStripEdit}
      />,
    );
    // DELTA-based: the strip's drawn width is the row envelope (with a visual
    // minimum), so only the drag DISTANCE maps to ms. +90px at 0.06px/ms adds
    // 1500ms to the active clip's own 1000ms.
    const handle = screen.getByRole('button', { name: 'Adjust duration' });
    fireEvent.pointerDown(handle, { pointerId: 8, button: 0, clientX: 300 });
    fireEvent.pointerMove(handle, { pointerId: 8, clientX: 390 });
    fireEvent.pointerUp(handle, { pointerId: 8, clientX: 390 });
    expect(onStripEdit).toHaveBeenCalledOnce();
    const [row, next] = onStripEdit.mock.calls[0];
    expect(row.elementId).toBe('el-b');
    expect(next.durationMs).toBe(2500);
    rect.mockRestore();
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

describe('figma-style timeline rows', () => {
  it('keeps labels and strips in ONE scroller so vertical scroll can never desynchronize them', () => {
    const { container } = render(
      <TimelineHarness rows={viewportRows} selectedElementId="el-a" onSelectElement={vi.fn()} />,
    );
    const surface = container.querySelector('[data-timeline-surface]');
    // Label cell and strip cell live inside the SAME scrollable surface.
    expect(surface.querySelector('[data-cell="layer"]')).toBeTruthy();
    expect(surface.querySelector('[data-element-row="el-a"]')).toBeTruthy();
  });

  it('expands a layer through its chevron', () => {
    const onToggleLayer = vi.fn();
    render(
      <TimelineHarness rows={viewportRows} selectedElementId={null} onSelectElement={vi.fn()} onToggleLayer={onToggleLayer} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Expand Card image' }));
    expect(onToggleLayer).toHaveBeenCalledWith('el-b');
  });

  it('lists an expanded layer’s animations as named strips and activates one on click', () => {
    const onActiveMotion = vi.fn();
    render(
      <TimelineHarness
        rows={viewportRows}
        selectedElementId="el-b"
        onSelectElement={vi.fn()}
        onActiveMotion={onActiveMotion}
        activeMotionId="slide-in"
        expandedLayers={new Set(['el-b'])}
        detailByRow={{ 'el-b': [gsapClip('slide-in'), gsapClip('fade-out')] }}
      />,
    );
    // Both the left label and the strip carry the affordance — either activates.
    const affordances = screen.getAllByTitle('Edit fade-out');
    expect(affordances.length).toBe(2);
    fireEvent.click(affordances[0]);
    expect(onActiveMotion).toHaveBeenCalledWith('fade-out');
  });

  it('clicking an animation strip of a NON-selected layer selects that layer first', () => {
    const onSelectElement = vi.fn();
    render(
      <TimelineHarness
        rows={viewportRows}
        selectedElementId="el-a"
        onSelectElement={onSelectElement}
        expandedLayers={new Set(['el-b'])}
        detailByRow={{ 'el-b': [gsapClip('slide-in'), gsapClip('fade-out')] }}
      />,
    );
    fireEvent.click(screen.getAllByTitle('Select Card image')[0]);
    expect(onSelectElement).toHaveBeenCalledWith('el-b');
  });

  it('navigates keyframes through the property-row steppers', () => {
    const onSeek = vi.fn();
    render(<TimelineHarness rows={viewportRows} selectedElementId="el-a" onSelectElement={vi.fn()} onSeek={onSeek} />);
    // Playhead at 0: the previous stepper has nowhere to go, the next one seeks
    // to the 100% keyframe (delay 0 + 1 × 1000ms clip).
    expect(screen.getByRole('button', { name: 'Previous opacity keyframe' }).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Next opacity keyframe' }));
    expect(onSeek).toHaveBeenCalledWith(1000);
  });

  it('adds a keyframe at the playhead through the ◇ stepper', () => {
    const onDuplicate = vi.fn();
    render(
      <TimelineHarness
        onDuplicate={onDuplicate}
        rows={viewportRows}
        selectedElementId="el-a"
        onSelectElement={vi.fn()}
        state={{ currentTime: 500, duration: 1000, playState: 'paused' }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add opacity keyframe' }));
    expect(onDuplicate).toHaveBeenCalledOnce();
    expect(onDuplicate.mock.calls[0][0]).toEqual({ motionId: 'waapi-fade', property: 'opacity', offset: 0 });
    expect(onDuplicate.mock.calls[0][1]).toBeCloseTo(0.5, 2);
  });

  it('clamps the timeline height handle between 1× and 2×', () => {
    const onBodyHeight = vi.fn();
    render(<TimelineHarness rows={[]} onBodyHeight={onBodyHeight} bodyHeight={166} />);
    const handle = screen.getByRole('separator', { name: 'Resize the timeline' });
    fireEvent.pointerDown(handle, { pointerId: 3, button: 0, clientY: 500 });
    fireEvent.pointerMove(handle, { pointerId: 3, clientY: 100 });
    expect(onBodyHeight).toHaveBeenLastCalledWith(332);
    fireEvent.pointerMove(handle, { pointerId: 3, clientY: 900 });
    expect(onBodyHeight).toHaveBeenLastCalledWith(166);
  });

  it('clamps the labels column resize between its min and max widths', () => {
    const onLabelsWidth = vi.fn();
    render(<TimelineHarness rows={[]} onLabelsWidth={onLabelsWidth} labelsWidth={152} />);
    const handle = screen.getByRole('separator', { name: 'Resize the labels column' });
    fireEvent.pointerDown(handle, { pointerId: 4, button: 0, clientX: 152 });
    fireEvent.pointerMove(handle, { pointerId: 4, clientX: 900 });
    expect(onLabelsWidth).toHaveBeenLastCalledWith(340);
    fireEvent.pointerMove(handle, { pointerId: 4, clientX: -400 });
    expect(onLabelsWidth).toHaveBeenLastCalledWith(110);
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

  it('lets the user select an adapter keyframe and edit its value in the property label', () => {
    // The value lives in ONE place: the property row's label field. Selecting a
    // keyframe points the field at it; typing writes the keyframe back.
    const onValue = vi.fn();
    render(<TimelineHarness motion={adapterMotion} onChangeKeyframeValue={onValue} />);
    const keyframe = screen.getByRole('button', { name: 'x keyframe at 100 percent' });
    expect(keyframe.disabled).toBe(false);
    fireEvent.click(keyframe);
    const valueField = screen.getByLabelText('x keyframe value');
    expect(valueField.value).toBe('100');
    fireEvent.change(valueField, { target: { value: '160' } });
    fireEvent.blur(valueField);
    expect(onValue).toHaveBeenCalledWith(
      { motionId: 'gsap-slide', property: 'x', offset: 1 },
      '160',
    );
  });

  it('single-animation rows carry no chevron; selecting them still reveals their tracks', () => {
    const soloRows = [{ elementId: 'el-solo', label: 'Solo', kind: 'text', top: 0, count: 1, engines: ['WAAPI'], driver: 'time', delayMs: 0, durationMs: 1000, marks: [] }];
    const { container, rerender } = render(
      <TimelineHarness rows={soloRows} selectedElementId={null} onSelectElement={vi.fn()} />,
    );
    expect(screen.queryByRole('button', { name: /Expand Solo/ })).toBeNull();
    rerender(<TimelineHarness rows={soloRows} selectedElementId="el-solo" onSelectElement={vi.fn()} />);
    expect(container.querySelector('[data-track-row="opacity"]')).toBeTruthy();
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
