import { describe, it, expect } from 'vitest';
import { buildNodesClipboardPayload, parseNodesClipboardText, payloadToPasteItems, NODES_CLIPBOARD_TYPE } from './node-clipboard.js';

const edge = (from, to, kind = 'generic') => ({ source_node_id: from, target_node_id: to, kind });

const chain = [
  { id: 'p', kind: 'prompt', pos_x: 0, pos_y: 0, width: 600, height: 200, meta: { prompt: 'brief' } },
  { id: 's', kind: 'site', pos_x: 900, pos_y: 0, width: 1280, height: 720, meta: { name: 'page' }, current_html: '<html>x</html>' },
];

describe('buildNodesClipboardPayload', () => {
  it('serializes nodes and the cords BETWEEN them as index pairs', () => {
    const p = buildNodesClipboardPayload(chain, [edge('p', 's'), edge('s', 'outsider')]);
    expect(p.type).toBe(NODES_CLIPBOARD_TYPE);
    expect(p.nodes).toHaveLength(2);
    expect(p.nodes[0].meta.prompt).toBe('brief');
    expect(p.nodes[1].current_html).toBe('<html>x</html>');
    // Only the internal cord survives; the one to a non-copied node is dropped.
    expect(p.links).toEqual([{ from: 0, to: 1, kind: 'generic' }]);
  });

  it('drops temp- nodes and returns null for an empty group', () => {
    expect(buildNodesClipboardPayload([{ id: 'temp-1', kind: 'site' }], [])).toBe(null);
    expect(buildNodesClipboardPayload([], [])).toBe(null);
  });

  it('preserves edge kind on internal cords', () => {
    const p = buildNodesClipboardPayload(chain, [edge('p', 's', 'transplant')]);
    expect(p.links[0].kind).toBe('transplant');
  });
});

describe('parseNodesClipboardText', () => {
  it('round-trips a built payload', () => {
    const p = buildNodesClipboardPayload(chain, [edge('p', 's')]);
    const parsed = parseNodesClipboardText(JSON.stringify(p));
    expect(parsed).toEqual(p);
  });

  it('rejects non-JSON, foreign JSON, and empty payloads', () => {
    expect(parseNodesClipboardText('https://stripe.com')).toBe(null);
    expect(parseNodesClipboardText('{"type":"other","nodes":[{}]}')).toBe(null);
    expect(parseNodesClipboardText(`{"type":"${NODES_CLIPBOARD_TYPE}","nodes":[]}`)).toBe(null);
    expect(parseNodesClipboardText('')).toBe(null);
  });
});

describe('payloadToPasteItems', () => {
  it('offsets one step on the first paste, further on repeats — group shape preserved', () => {
    const p = buildNodesClipboardPayload(chain, [edge('p', 's')]);
    const first = payloadToPasteItems(p, 1);
    expect(first.items[0]).toMatchObject({ x: 60, y: 60 });
    expect(first.items[1]).toMatchObject({ x: 960, y: 60 });
    // Relative geometry between the two nodes is intact.
    expect(first.items[1].x - first.items[0].x).toBe(900);
    const second = payloadToPasteItems(p, 2);
    expect(second.items[0]).toMatchObject({ x: 120, y: 120 });
    expect(second.links).toEqual([{ from: 0, to: 1, kind: 'generic' }]);
  });
});
