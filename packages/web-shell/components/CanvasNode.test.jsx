import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { NODE_EDITOR_KIND } from '../lib/node-editor-kind.js';
import CanvasNode from './CanvasNode.jsx';

vi.mock('./editor/CanvasEditorCore.jsx', () => ({
  default: () => <div data-testid="legacy-editor" />,
}));
vi.mock('./motion-editor/NativeEditViewport.jsx', () => ({
  default: ({ nodeId, deviceId, onUnavailable }) => (
    <div data-testid="native-editor" data-node-id={nodeId} data-device-id={deviceId}>
      <button type="button" onClick={() => onUnavailable?.({ code: 'runtime_session_unavailable' })}>
        Simulate unavailable
      </button>
    </div>
  ),
}));
vi.mock('./NodeProgressRing.jsx', () => ({
  NodeProgressRing: ({ pct }) => <div data-testid="progress-ring" data-pct={pct} />,
  useGenerationProgress: () => 0,
}));
vi.mock('../lib/thumb-queue.js', () => ({
  fetchThumb: vi.fn(async () => null),
}));

const baseNode = {
  id: '11111111-1111-4111-8111-111111111111',
  board_id: 'board-1',
  kind: 'site',
  pos_x: 40,
  pos_y: 80,
  width: 1280,
  height: 800,
  meta: { name: 'Animated portfolio' },
  current_snapshot_id: '22222222-2222-4222-8222-222222222222',
  current_native_bundle_id: '33333333-3333-4333-8333-333333333333',
  current_motion_manifest_version: 2,
};

function renderNode(overrides = {}, props = {}) {
  const node = { ...baseNode, ...overrides, meta: { ...baseNode.meta, ...(overrides.meta || {}) } };
  return render(
    <CanvasNode
      node={node}
      selected
      editing
      editorKind={NODE_EDITOR_KIND.NATIVE}
      onEditingChange={vi.fn()}
      onSelect={vi.fn()}
      onMove={vi.fn()}
      onMoveStart={vi.fn()}
      onMoveEnd={vi.fn()}
      onResize={vi.fn()}
      onStartEdge={vi.fn()}
      {...props}
    />,
  );
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  });
});

afterEach(() => vi.unstubAllGlobals());

describe('CanvasNode native editor routing', () => {
  it('mounts the native fixed viewport instead of the same-origin legacy editor', () => {
    renderNode();
    expect(screen.getByTestId('native-editor').dataset.nodeId).toBe(baseNode.id);
    expect(screen.getByTestId('native-editor').dataset.deviceId).toBe('desktop');
    expect(screen.queryByTestId('legacy-editor')).toBeNull();
    expect(screen.queryByLabelText('Expand viewport to full content')).toBeNull();
    expect(screen.queryByLabelText('Resize node height')).toBeNull();
  });

  it('keeps a static HTML snapshot on the legacy srcDoc path', () => {
    const { container } = renderNode({
      current_native_bundle_id: null,
      current_motion_manifest_version: null,
      current_html: '<main>Static site</main>',
    }, {
      editorKind: NODE_EDITOR_KIND.LEGACY,
    });
    expect(screen.queryByTestId('native-editor')).toBeNull();
    expect(container.querySelector('iframe[srcdoc]').getAttribute('srcdoc')).toContain('Static site');
  });

  it('exits the node-scoped edit state when the native runtime cannot open', () => {
    const onEditingChange = vi.fn();
    renderNode({}, { onEditingChange });
    fireEvent.click(screen.getByRole('button', { name: 'Simulate unavailable' }));
    expect(onEditingChange).toHaveBeenCalledWith(false, {
      reason: 'runtime-unavailable',
      code: 'runtime_session_unavailable',
    });
  });

  it('preparando a cópia: node borrado, número e anel com a porcentagem real', () => {
    const { container } = renderNode({}, { editing: false, canonicalPrep: { status: 'running', pct: 42 } });
    expect(container.querySelector('.cnode.canonical-prep')).not.toBeNull();
    expect(screen.getByRole('progressbar', { name: 'Preparing editable copy' })).toHaveAttribute('aria-valuenow', '42');
    expect(screen.getByTestId('progress-ring')).toHaveAttribute('data-pct', '42');
  });

  it('falha da cópia: escolhas no node, sem anel', () => {
    const onCanonicalOpenLive = vi.fn();
    renderNode({}, { editing: false, canonicalPrep: { status: 'failed', pct: 57, errorCode: 'recording_failed' }, onCanonicalOpenLive });
    expect(screen.queryByTestId('progress-ring')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open live clone instead' }));
    expect(onCanonicalOpenLive).toHaveBeenCalledTimes(1);
  });
});

describe('inconsistent clone stays repairable (Sol final round)', () => {
  // The node whose lineage does not close has html=null AND no usable native
  // editor, so the plain eligibility hid the Edit affordance in EXACTLY the
  // state that needs repair — the user had no way out of it.
  const brokenLineage = {
    current_snapshot_source: 'native-edit',
    current_native_bundle_id: 'not-a-uuid',
    current_motion_manifest_version: 2,
    origin_url: 'https://example.com',
    current_html: null,
  };

  it('offers "Repair clone" with its cost and reports the deliberate repair intent', () => {
    const onEditingChange = vi.fn();
    renderNode(brokenLineage, {
      editing: false,
      editorKind: NODE_EDITOR_KIND.LEGACY,
      onEditingChange,
    });

    const button = screen.getByText('Repair clone');
    expect(button).toBeTruthy();
    fireEvent.click(button);
    expect(onEditingChange).toHaveBeenCalledWith(true, { repair: true });
  });
});
