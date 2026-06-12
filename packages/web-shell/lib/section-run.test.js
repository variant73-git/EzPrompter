import { describe, it, expect } from 'vitest';
import { findSectionTerminal, sectionRerunWouldOverwrite } from './section-run.js';
import { BLANK_SITE_HTML } from './blank-site-html.js';

const edge = (from, to) => ({ source_node_id: from, target_node_id: to });

function setup({ nodes, edges }) {
  const section = { memberIds: nodes.map((n) => n.id) };
  return { section, nodes, edges };
}

describe('findSectionTerminal', () => {
  it('finds an asset terminal (style-transfer shape: base + ref → result)', () => {
    const { section, nodes, edges } = setup({
      nodes: [
        { id: 'base', kind: 'asset', meta: {} },
        { id: 'ref', kind: 'asset', meta: {} },
        { id: 'result', kind: 'asset', meta: { dataUrl: 'data:image/png;base64,x' } },
      ],
      edges: [edge('base', 'result'), edge('ref', 'result')],
    });
    const r = findSectionTerminal(section, nodes, edges);
    expect(r.terminalId).toBe('result');
    expect(r.terminal.kind).toBe('asset');
    expect(r.count).toBe(1);
  });

  it('finds a site terminal (prompt + md → site compose)', () => {
    const { section, nodes, edges } = setup({
      nodes: [
        { id: 'p', kind: 'prompt' },
        { id: 'md', kind: 'designmd' },
        { id: 'site', kind: 'site', current_html: '<html>built</html>' },
      ],
      edges: [edge('p', 'site'), edge('md', 'site')],
    });
    const r = findSectionTerminal(section, nodes, edges);
    expect(r.terminalId).toBe('site');
    expect(r.terminal.kind).toBe('site');
  });

  it('reports an unsupported terminal kind instead of "not found"', () => {
    const { section, nodes, edges } = setup({
      nodes: [
        { id: 'site', kind: 'site', current_html: '<html></html>' },
        { id: 'md', kind: 'designmd' },
      ],
      edges: [edge('site', 'md')],
    });
    const r = findSectionTerminal(section, nodes, edges);
    expect(r.terminalId).toBe(null);
    expect(r.count).toBe(0);
    expect(r.unsupportedKind).toBe('designmd');
  });

  it('returns null + count for ambiguous multi-terminal chains', () => {
    const { section, nodes, edges } = setup({
      nodes: [
        { id: 'src', kind: 'prompt' },
        { id: 'a', kind: 'asset', meta: {} },
        { id: 'b', kind: 'site', current_html: '' },
      ],
      edges: [edge('src', 'a'), edge('src', 'b')],
    });
    const r = findSectionTerminal(section, nodes, edges);
    expect(r.terminalId).toBe(null);
    expect(r.count).toBe(2);
    expect(r.unsupportedKind).toBe(null);
  });

  it('returns nothing for edge-less member groups', () => {
    const { section, nodes, edges } = setup({
      nodes: [{ id: 'a', kind: 'asset' }, { id: 'b', kind: 'asset' }],
      edges: [],
    });
    const r = findSectionTerminal(section, nodes, edges);
    expect(r.terminalId).toBe(null);
    expect(r.count).toBe(0);
    expect(r.unsupportedKind).toBe(null);
  });

  it('ignores edges from outside the section when picking the terminal', () => {
    const { section, nodes, edges } = setup({
      nodes: [
        { id: 'src', kind: 'prompt' },
        { id: 'site', kind: 'site', current_html: '' },
      ],
      edges: [edge('src', 'site'), edge('site', 'outsider')],
    });
    // outgoing edge to a non-member must not disqualify the terminal
    const r = findSectionTerminal(section, nodes, edges);
    expect(r.terminalId).toBe('site');
  });

  it('skips temp- ids (local-only nodes the server cannot run)', () => {
    const { section, nodes, edges } = setup({
      nodes: [
        { id: 'src', kind: 'prompt' },
        { id: 'temp-123', kind: 'site', current_html: '' },
      ],
      edges: [edge('src', 'temp-123')],
    });
    const r = findSectionTerminal(section, nodes, edges);
    expect(r.terminalId).toBe(null);
    expect(r.count).toBe(0);
  });
});

describe('sectionRerunWouldOverwrite', () => {
  function chainTo(terminal) {
    const nodes = [{ id: 'src', kind: 'prompt' }, terminal];
    const edges = [edge('src', terminal.id)];
    return { section: { memberIds: ['src', terminal.id] }, nodes, edges };
  }

  it('asset terminal: true only when a dataUrl result exists', () => {
    const empty = chainTo({ id: 't', kind: 'asset', meta: {} });
    expect(sectionRerunWouldOverwrite(empty.section, empty.nodes, empty.edges)).toBe(false);

    const full = chainTo({ id: 't', kind: 'asset', meta: { dataUrl: 'data:image/png;base64,x' } });
    expect(sectionRerunWouldOverwrite(full.section, full.nodes, full.edges)).toBe(true);
  });

  it('site terminal: blank scaffold and empty html are NOT an overwrite', () => {
    const blank = chainTo({ id: 't', kind: 'site', current_html: BLANK_SITE_HTML });
    expect(sectionRerunWouldOverwrite(blank.section, blank.nodes, blank.edges)).toBe(false);

    const empty = chainTo({ id: 't', kind: 'site', current_html: '' });
    expect(sectionRerunWouldOverwrite(empty.section, empty.nodes, empty.edges)).toBe(false);
  });

  it('site terminal: real generated html IS an overwrite', () => {
    const built = chainTo({ id: 't', kind: 'site', current_html: '<html><body>real page</body></html>' });
    expect(sectionRerunWouldOverwrite(built.section, built.nodes, built.edges)).toBe(true);
  });

  it('no terminal → never asks', () => {
    const { section, nodes, edges } = {
      section: { memberIds: ['a'] },
      nodes: [{ id: 'a', kind: 'asset' }],
      edges: [],
    };
    expect(sectionRerunWouldOverwrite(section, nodes, edges)).toBe(false);
  });
});
