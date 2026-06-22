import { describe, it, expect } from 'vitest';
import { buildBoardSummary } from './board-summary.js';

// `sql` is a tagged template that resolves to rows. A fake that ignores the
// template literal and returns a fixed row set is enough (same pattern as
// canvas-layout.test.js).
const fakeSql = (rows) => () => Promise.resolve(rows);

describe('buildBoardSummary', () => {
  it('returns "" for an empty board', async () => {
    expect(await buildBoardSummary({ sql: fakeSql([]), boardId: 'b' })).toBe('');
  });

  it('returns "" when boardId is missing', async () => {
    expect(await buildBoardSummary({ sql: fakeSql([{ kind: 'site', meta: {} }]), boardId: '' })).toBe('');
  });

  it('returns "" when sql is not a function', async () => {
    expect(await buildBoardSummary({ sql: null, boardId: 'b' })).toBe('');
  });

  it('lists nodes with name + kind', async () => {
    const out = await buildBoardSummary({
      sql: fakeSql([
        { id: '1', kind: 'site', meta: { name: 'Landing' }, has_snapshot: true },
        { id: '2', kind: 'prompt', meta: { name: 'Brief' }, has_snapshot: false },
      ]),
      boardId: 'b',
    });
    expect(out).toContain('Board has 2 nodes');
    expect(out).toContain('"Landing" (site, has result)');
    expect(out).toContain('"Brief" (prompt)');
  });

  it('includes the nodeId so the agent can act without a lookup', async () => {
    const out = await buildBoardSummary({
      sql: fakeSql([{ id: 'node-abc', kind: 'site', meta: { name: 'Landing' }, has_snapshot: true }]),
      boardId: 'b',
    });
    expect(out).toContain('id=node-abc');
  });

  it('includes assetId for asset nodes (for createImage)', async () => {
    const out = await buildBoardSummary({
      sql: fakeSql([{ id: 'node-x', kind: 'asset', meta: { name: 'Logo', assetId: 'asset-99' }, has_snapshot: false }]),
      boardId: 'b',
    });
    expect(out).toContain('id=node-x');
    expect(out).toContain('assetId=asset-99');
  });

  it('omits assetId for non-asset nodes', async () => {
    const out = await buildBoardSummary({
      sql: fakeSql([{ id: 'node-y', kind: 'site', meta: { name: 'Home', assetId: 'should-not-appear' }, has_snapshot: false }]),
      boardId: 'b',
    });
    expect(out).not.toContain('assetId');
  });

  it('singular "node" for one node', async () => {
    const out = await buildBoardSummary({
      sql: fakeSql([{ id: '1', kind: 'asset', meta: { name: 'Logo' }, has_snapshot: false }]),
      boardId: 'b',
    });
    expect(out).toContain('Board has 1 node:');
  });

  it('falls back to kind when name is absent', async () => {
    const out = await buildBoardSummary({
      sql: fakeSql([{ id: '1', kind: 'designmd', meta: {}, has_snapshot: false }]),
      boardId: 'b',
    });
    expect(out).toContain('(designmd)');
    expect(out).not.toContain('""');
  });

  it('truncates an over-long name', async () => {
    const longName = 'x'.repeat(80);
    const out = await buildBoardSummary({
      sql: fakeSql([{ id: '1', kind: 'site', meta: { name: longName }, has_snapshot: false }]),
      boardId: 'b',
    });
    expect(out).toContain('…');
    expect(out).not.toContain(longName);
  });

  it('flags truncation at the cap instead of implying completeness', async () => {
    const rows = Array.from({ length: 3 }, (_, i) => ({
      id: String(i), kind: 'site', meta: { name: `n${i}` }, has_snapshot: false,
    }));
    const out = await buildBoardSummary({ sql: fakeSql(rows), boardId: 'b', limit: 3 });
    expect(out).toContain('3+ nodes');
    expect(out).toContain('use listBoard');
  });

  it('returns "" (best-effort) when the query throws', async () => {
    const throwingSql = () => Promise.reject(new Error('db down'));
    expect(await buildBoardSummary({ sql: throwingSql, boardId: 'b' })).toBe('');
  });
});

// historyToLLMMessages lives in the chat route; unit-test it directly.
import { historyToLLMMessages } from '../../app/api/chat/route.js';

describe('historyToLLMMessages', () => {
  it('keeps user + assistant text turns in order', () => {
    const out = historyToLLMMessages([
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
    ]);
    expect(out).toEqual([{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }]);
  });
  it('skips empty, tool, and system rows', () => {
    const out = historyToLLMMessages([
      { role: 'assistant', content: '' },
      { role: 'tool', content: 'result' },
      { role: 'system', content: 'x' },
      { role: 'user', content: 'keep' },
    ]);
    expect(out).toEqual([{ role: 'user', content: 'keep' }]);
  });
  it('caps long content', () => {
    const out = historyToLLMMessages([{ role: 'user', content: 'x'.repeat(5000) }]);
    expect(out[0].content.length).toBeLessThan(5000);
    expect(out[0].content.endsWith('…')).toBe(true);
  });
  it('returns [] for non-array', () => {
    expect(historyToLLMMessages(null)).toEqual([]);
  });
});
