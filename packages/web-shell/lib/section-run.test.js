import { describe, it, expect } from 'vitest';
import { findSectionTerminal, findSectionTerminals, planSectionRun, planIncrementalRun, planRunFromNode, nodeInputSignature, nodeHasResult, sectionRerunWouldOverwrite, chainSignature, sectionOps } from './section-run.js';
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

describe('findSectionTerminals (fan-out chains — anchored derivations)', () => {
  it('returns ALL runnable terminals of a fan-out (source → N derived)', () => {
    const { section, nodes, edges } = setup({
      nodes: [
        { id: 'clone', kind: 'site', current_html: '<html>both mockups</html>' },
        { id: 'mock1', kind: 'site', current_html: '<html>mockup 1</html>' },
        { id: 'mock2', kind: 'site', current_html: '<html>mockup 2</html>' },
      ],
      edges: [edge('clone', 'mock1'), edge('clone', 'mock2')],
    });
    const r = findSectionTerminals(section, nodes, edges);
    expect(r.count).toBe(2);
    expect(r.terminals.map((t) => t.id).sort()).toEqual(['mock1', 'mock2']);
    expect(r.unsupportedKind).toBe(null);
  });

  it('mixed-kind fan-out keeps every runnable terminal (asset + site)', () => {
    const { section, nodes, edges } = setup({
      nodes: [
        { id: 'src', kind: 'prompt' },
        { id: 'a', kind: 'asset', meta: {} },
        { id: 'b', kind: 'site', current_html: '' },
      ],
      edges: [edge('src', 'a'), edge('src', 'b')],
    });
    const r = findSectionTerminals(section, nodes, edges);
    expect(r.terminals.map((t) => t.id).sort()).toEqual(['a', 'b']);
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

describe('chainSignature (re-run gating)', () => {
  const siteChain = (siteHtml, promptText = 'make a hero') => setup({
    nodes: [
      { id: 'p', kind: 'prompt', name: 'brief', pos_x: 0, pos_y: 0, meta: { prompt: promptText } },
      { id: 'site', kind: 'site', name: 'page', pos_x: 100, pos_y: 0, current_html: siteHtml },
    ],
    edges: [edge('p', 'site')],
  });

  it('is stable across identical content', () => {
    const a = siteChain('<html>built</html>');
    const b = siteChain('<html>built</html>');
    expect(chainSignature(a.section, a.nodes, a.edges))
      .toBe(chainSignature(b.section, b.nodes, b.edges));
  });

  it('IGNORES canvas position/size moves (a move must not re-enable the run)', () => {
    const base = siteChain('<html>built</html>');
    const moved = setup({
      nodes: [
        { id: 'p', kind: 'prompt', name: 'brief', pos_x: 999, pos_y: 480, width: 400, height: 300, meta: { prompt: 'make a hero' } },
        { id: 'site', kind: 'site', name: 'page', pos_x: -50, pos_y: 700, width: 1280, height: 720, current_html: '<html>built</html>' },
      ],
      edges: [edge('p', 'site')],
    });
    expect(chainSignature(moved.section, moved.nodes, moved.edges))
      .toBe(chainSignature(base.section, base.nodes, base.edges));
  });

  it('CHANGES when a prompt source is edited', () => {
    const before = siteChain('<html>built</html>', 'make a hero');
    const after = siteChain('<html>built</html>', 'make a totally different hero');
    expect(chainSignature(after.section, after.nodes, after.edges))
      .not.toBe(chainSignature(before.section, before.nodes, before.edges));
  });

  it('CHANGES when the generated output (terminal html) changes', () => {
    const before = siteChain('<html>v1</html>');
    const after = siteChain('<html>v2 — a meaningfully different page body</html>');
    expect(chainSignature(after.section, after.nodes, after.edges))
      .not.toBe(chainSignature(before.section, before.nodes, before.edges));
  });

  it('CHANGES when an image terminal gets a new dataUrl', () => {
    const before = setup({
      nodes: [
        { id: 'ref', kind: 'asset', meta: { dataUrl: 'data:image/png;base64,AAAA' } },
        { id: 'out', kind: 'asset', meta: { dataUrl: 'data:image/png;base64,BBBB' } },
      ],
      edges: [edge('ref', 'out')],
    });
    const after = setup({
      nodes: [
        { id: 'ref', kind: 'asset', meta: { dataUrl: 'data:image/png;base64,AAAA' } },
        { id: 'out', kind: 'asset', meta: { dataUrl: 'data:image/png;base64,CCCCdifferent' } },
      ],
      edges: [edge('ref', 'out')],
    });
    expect(chainSignature(after.section, after.nodes, after.edges))
      .not.toBe(chainSignature(before.section, before.nodes, before.edges));
  });

  it('CHANGES when internal wiring (an edge between members) changes', () => {
    const before = siteChain('<html>built</html>');
    const rewired = setup({
      nodes: before.nodes,
      edges: [edge('site', 'p')], // reversed
    });
    expect(chainSignature(rewired.section, rewired.nodes, rewired.edges))
      .not.toBe(chainSignature(before.section, before.nodes, before.edges));
  });

  it('is order-independent in member listing', () => {
    const a = siteChain('<html>built</html>');
    const b = setup({ nodes: [...a.nodes].reverse(), edges: a.edges });
    expect(chainSignature(b.section, b.nodes, b.edges))
      .toBe(chainSignature(a.section, a.nodes, a.edges));
  });
});

describe('sectionOps (billing estimates — Task 18)', () => {
  const edge2 = (from, to) => ({ source_node_id: from, target_node_id: to });
  it('site terminal maps to a compose op', () => {
    const nodes = [
      { id: 'p', kind: 'prompt' },
      { id: 'site', kind: 'site', current_html: '<html>x</html>' },
    ];
    const section = { memberIds: ['p', 'site'] };
    expect(sectionOps(section, nodes, [edge2('p', 'site')])).toEqual(['compose']);
  });
  it('asset terminal maps to an image.generate op', () => {
    const nodes = [
      { id: 'ref', kind: 'asset', meta: {} },
      { id: 'out', kind: 'asset', meta: {} },
    ];
    const section = { memberIds: ['ref', 'out'] };
    expect(sectionOps(section, nodes, [edge2('ref', 'out')])).toEqual(['image.generate']);
  });
  it('no runnable terminal → empty ops', () => {
    const nodes = [{ id: 'a', kind: 'prompt' }, { id: 'b', kind: 'designmd' }];
    const section = { memberIds: ['a', 'b'] };
    expect(sectionOps(section, nodes, [edge2('a', 'b')])).toEqual([]);
  });
  it('fan-out → one op per terminal (estimate sums the whole run)', () => {
    const nodes = [
      { id: 'src', kind: 'site', current_html: '<html>x</html>' },
      { id: 'm1', kind: 'site', current_html: '' },
      { id: 'm2', kind: 'asset', meta: {} },
    ];
    const section = { memberIds: ['src', 'm1', 'm2'] };
    const edges = [edge2('src', 'm1'), edge2('src', 'm2')];
    expect(sectionOps(section, nodes, edges).sort()).toEqual(['compose', 'image.generate']);
  });
});

describe('planSectionRun (cascade executor — whole-graph, any shape)', () => {
  const ids = (stages) => stages.map((st) => st.map((n) => n.id).sort());

  it('single chain (prompt → site) = one stage, same as before', () => {
    const nodes = [
      { id: 'p', kind: 'prompt' },
      { id: 'site', kind: 'site', current_html: '' },
    ];
    const r = planSectionRun({ memberIds: ['p', 'site'] }, nodes, [edge('p', 'site')]);
    expect(ids(r.stages)).toEqual([['site']]);
  });

  it('multi-stage chain cascades: prompt → A → B produces A before B', () => {
    const nodes = [
      { id: 'p', kind: 'prompt' },
      { id: 'a', kind: 'site', current_html: '<html>a</html>' },
      { id: 'b', kind: 'site', current_html: '<html>b</html>' },
    ];
    const r = planSectionRun({ memberIds: ['p', 'a', 'b'] }, nodes, [edge('p', 'a'), edge('a', 'b')]);
    expect(ids(r.stages)).toEqual([['a'], ['b']]);
  });

  it('fan-out runs in one parallel stage', () => {
    const nodes = [
      { id: 'src', kind: 'site', current_html: '<html>x</html>' },
      { id: 'm1', kind: 'site', current_html: '' },
      { id: 'm2', kind: 'site', current_html: '' },
    ];
    const r = planSectionRun({ memberIds: ['src', 'm1', 'm2'] }, nodes, [edge('src', 'm1'), edge('src', 'm2')]);
    expect(ids(r.stages)).toEqual([['m1', 'm2']]);
  });

  it('diamond: parallel middle stage, then the join', () => {
    const nodes = [
      { id: 'src', kind: 'prompt' },
      { id: 'a', kind: 'site', current_html: '' },
      { id: 'b', kind: 'site', current_html: '' },
      { id: 'c', kind: 'site', current_html: '' },
    ];
    const r = planSectionRun(
      { memberIds: ['src', 'a', 'b', 'c'] },
      nodes,
      [edge('src', 'a'), edge('src', 'b'), edge('a', 'c'), edge('b', 'c')],
    );
    expect(ids(r.stages)).toEqual([['a', 'b'], ['c']]);
  });

  it('non-runnable intermediates are skipped but downstream still stages', () => {
    // site → md → site2: the md can't be produced by the section run, but
    // site2 (fed by the md's CURRENT content) still runs, in a later stage.
    const nodes = [
      { id: 's1', kind: 'site', current_html: '<html>x</html>' },
      { id: 'md', kind: 'designmd' },
      { id: 's2', kind: 'site', current_html: '' },
    ];
    const r = planSectionRun({ memberIds: ['s1', 'md', 's2'] }, nodes, [edge('s1', 'md'), edge('md', 's2')]);
    expect(ids(r.stages)).toEqual([['s2']]);
  });

  it('all-unsupported graph reports unsupportedKind', () => {
    const nodes = [{ id: 'a', kind: 'site', current_html: '<html>x</html>' }, { id: 'b', kind: 'designmd' }];
    const r = planSectionRun({ memberIds: ['a', 'b'] }, nodes, [edge('a', 'b')]);
    expect(r.stages).toEqual([]);
    expect(r.unsupportedKind).toBe('designmd');
  });

  it('cycles never stage (no infinite loop, nothing runs)', () => {
    const nodes = [
      { id: 'a', kind: 'site', current_html: '<html>a</html>' },
      { id: 'b', kind: 'site', current_html: '<html>b</html>' },
    ];
    const r = planSectionRun({ memberIds: ['a', 'b'] }, nodes, [edge('a', 'b'), edge('b', 'a')]);
    expect(r.stages).toEqual([]);
  });

  it('temp- nodes never stage', () => {
    const nodes = [
      { id: 'p', kind: 'prompt' },
      { id: 'temp-9', kind: 'site', current_html: '' },
    ];
    const r = planSectionRun({ memberIds: ['p', 'temp-9'] }, nodes, [edge('p', 'temp-9')]);
    expect(r.stages).toEqual([]);
  });

  it('multi-stage estimate counts every produced node (sectionOps)', () => {
    const nodes = [
      { id: 'p', kind: 'prompt' },
      { id: 'a', kind: 'site', current_html: '' },
      { id: 'b', kind: 'site', current_html: '' },
    ];
    const section = { memberIds: ['p', 'a', 'b'] };
    const edges = [edge('p', 'a'), edge('a', 'b')];
    expect(sectionOps(section, nodes, edges)).toEqual(['compose', 'compose']);
  });
});

describe('planIncrementalRun (skip-unchanged cascade)', () => {
  // Serial chain: prompt → A → B, both sites already produced.
  function serialChain(promptText = 'brief v1') {
    const nodes = [
      { id: 'p', kind: 'prompt', meta: { prompt: promptText } },
      { id: 'a', kind: 'site', current_html: '<html>site a</html>' },
      { id: 'b', kind: 'site', current_html: '<html>site b</html>' },
    ];
    const edges = [edge('p', 'a'), edge('a', 'b')];
    const section = { memberIds: ['p', 'a', 'b'] };
    return { section, nodes, edges };
  }
  // Stored sigs captured against the CURRENT content (i.e. last run = now).
  function sigsFor(nodes, edges, ids) {
    const out = {};
    for (const id of ids) out[id] = nodeInputSignature(id, nodes, edges);
    return out;
  }

  it('nothing changed → everything skipped, no stages', () => {
    const { section, nodes, edges } = serialChain();
    const sigs = sigsFor(nodes, edges, ['a', 'b']);
    const r = planIncrementalRun(section, nodes, edges, sigs);
    expect(r.stages).toEqual([]);
    expect(r.skipped.map((n) => n.id).sort()).toEqual(['a', 'b']);
  });

  it('mid-chain edit cascades down only: edited prompt → A and B run', () => {
    const before = serialChain('brief v1');
    const sigs = sigsFor(before.nodes, before.edges, ['a', 'b']);
    const after = serialChain('brief v2 — totally new direction');
    const r = planIncrementalRun(after.section, after.nodes, after.edges, sigs);
    expect(r.stages.map((st) => st.map((n) => n.id))).toEqual([['a'], ['b']]);
    expect(r.skipped).toEqual([]);
  });

  it('downstream-only edit: A unchanged is skipped, B runs', () => {
    const { section, nodes, edges } = serialChain();
    const sigs = sigsFor(nodes, edges, ['a', 'b']);
    // B's own content changed (user edited the result) — its INPUT (A) is
    // unchanged, but the user also rewired... simulate input change by
    // invalidating only B's stored signature.
    sigs.b = 'stale-signature';
    const r = planIncrementalRun(section, nodes, edges, sigs);
    expect(r.stages.map((st) => st.map((n) => n.id))).toEqual([['b']]);
    expect(r.skipped.map((n) => n.id)).toEqual(['a']);
  });

  it('new empty branch runs while the original chain is reused (the fork case)', () => {
    const nodes = [
      { id: 'src', kind: 'site', current_html: '<html>source</html>' },
      { id: 'old', kind: 'site', current_html: '<html>old result</html>' },
      { id: 'branch', kind: 'site', current_html: '' }, // fresh fork, no result
    ];
    const edges = [edge('src', 'old'), edge('src', 'branch')];
    const section = { memberIds: ['src', 'old', 'branch'] };
    const sigs = { old: nodeInputSignature('old', nodes, edges) };
    const r = planIncrementalRun(section, nodes, edges, sigs);
    expect(r.stages.map((st) => st.map((n) => n.id))).toEqual([['branch']]);
    expect(r.skipped.map((n) => n.id)).toEqual(['old']);
  });

  it('force mode (null sigs) runs the full plan — the Reroll semantics', () => {
    const { section, nodes, edges } = serialChain();
    const r = planIncrementalRun(section, nodes, edges, null);
    expect(r.stages.map((st) => st.map((n) => n.id))).toEqual([['a'], ['b']]);
    expect(r.skipped).toEqual([]);
  });

  it('sectionOps with sigs estimates only what will run', () => {
    const { section, nodes, edges } = serialChain();
    const sigs = sigsFor(nodes, edges, ['a', 'b']);
    expect(sectionOps(section, nodes, edges, sigs)).toEqual([]);
    sigs.b = 'stale';
    expect(sectionOps(section, nodes, edges, sigs)).toEqual(['compose']);
    expect(sectionOps(section, nodes, edges, null)).toEqual(['compose', 'compose']);
  });

  it('sectionRerunWouldOverwrite with sigs: reused results do not trigger the confirm', () => {
    const nodes = [
      { id: 'src', kind: 'site', current_html: '<html>source</html>' },
      { id: 'old', kind: 'site', current_html: '<html>old result</html>' },
      { id: 'branch', kind: 'site', current_html: '' },
    ];
    const edges = [edge('src', 'old'), edge('src', 'branch')];
    const section = { memberIds: ['src', 'old', 'branch'] };
    const sigs = { old: nodeInputSignature('old', nodes, edges) };
    // Only the empty branch runs → nothing with a result is overwritten.
    expect(sectionRerunWouldOverwrite(section, nodes, edges, sigs)).toBe(false);
    // Force (Reroll) would overwrite the old result.
    expect(sectionRerunWouldOverwrite(section, nodes, edges, null)).toBe(true);
  });
});

describe('planRunFromNode (surgical downstream run)', () => {
  // Fork board: prompt → A → {B, C}; separate branch prompt → D.
  const nodes = [
    { id: 'p', kind: 'prompt' },
    { id: 'a', kind: 'site', current_html: '<html>a</html>' },
    { id: 'b', kind: 'site', current_html: '<html>b</html>' },
    { id: 'c', kind: 'site', current_html: '<html>c</html>' },
    { id: 'd', kind: 'site', current_html: '<html>d</html>' },
  ];
  const edges = [edge('p', 'a'), edge('a', 'b'), edge('a', 'c'), edge('p', 'd')];
  const section = { memberIds: ['p', 'a', 'b', 'c', 'd'] };

  it('from a mid node: the node runs plus its descendants, in stages — siblings untouched', () => {
    const r = planRunFromNode('a', section, nodes, edges);
    expect(r.stages.map((st) => st.map((n) => n.id).sort())).toEqual([['a'], ['b', 'c']]);
    // The sibling branch (d) is NOT in the plan.
    expect(r.runnable.some((n) => n.id === 'd')).toBe(false);
  });

  it('from a source (prompt): only the descendants run (the source itself is not producible)', () => {
    const r = planRunFromNode('p', section, nodes, edges);
    const ids = r.runnable.map((n) => n.id).sort();
    expect(ids).toEqual(['a', 'b', 'c', 'd']);
    expect(ids).not.toContain('p');
  });

  it('from a terminal: just that node', () => {
    const r = planRunFromNode('b', section, nodes, edges);
    expect(r.stages.map((st) => st.map((n) => n.id))).toEqual([['b']]);
  });
});

describe('nodeHasResult', () => {
  it('asset: dataUrl presence', () => {
    expect(nodeHasResult({ kind: 'asset', meta: {} })).toBe(false);
    expect(nodeHasResult({ kind: 'asset', meta: { dataUrl: 'data:image/png;base64,x' } })).toBe(true);
  });
  it('site: real html only (blank scaffold does not count)', () => {
    expect(nodeHasResult({ kind: 'site', current_html: '' })).toBe(false);
    expect(nodeHasResult({ kind: 'site', current_html: BLANK_SITE_HTML })).toBe(false);
    expect(nodeHasResult({ kind: 'site', current_html: '<html>real</html>' })).toBe(true);
  });
});

describe('sectionRerunWouldOverwrite (fan-out)', () => {
  it('true when ANY terminal has a real result', () => {
    const nodes = [
      { id: 'src', kind: 'prompt' },
      { id: 'm1', kind: 'site', current_html: '' },                        // empty
      { id: 'm2', kind: 'site', current_html: '<html>real page</html>' }, // built
    ];
    const section = { memberIds: ['src', 'm1', 'm2'] };
    const edges = [edge('src', 'm1'), edge('src', 'm2')];
    expect(sectionRerunWouldOverwrite(section, nodes, edges)).toBe(true);
  });
  it('false when all terminals are still empty', () => {
    const nodes = [
      { id: 'src', kind: 'prompt' },
      { id: 'm1', kind: 'site', current_html: '' },
      { id: 'm2', kind: 'asset', meta: {} },
    ];
    const section = { memberIds: ['src', 'm1', 'm2'] };
    const edges = [edge('src', 'm1'), edge('src', 'm2')];
    expect(sectionRerunWouldOverwrite(section, nodes, edges)).toBe(false);
  });
});
