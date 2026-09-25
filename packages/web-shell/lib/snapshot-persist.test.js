import { describe, expect, it } from 'vitest';
import { persistReferenceSnapshot } from './snapshot-persist.js';

function fakeSql(rows = []) {
  const calls = [];
  const sql = (s, ...v) => { calls.push({ text: s.join('?'), values: v }); return Promise.resolve(rows.shift() ?? []); };
  sql._calls = calls;
  return sql;
}

describe('persistReferenceSnapshot', () => {
  it('owner miss → not_found, nothing written', async () => {
    const sql = fakeSql([[]]);
    expect(await persistReferenceSnapshot({ sql, userId: 1, nodeId: 'n', html: 'x' })).toEqual({ error: 'not_found' });
    expect(sql._calls).toHaveLength(1);
  });
  it('existing handoff snapshot → deduped, no insert', async () => {
    const sql = fakeSql([[{ id: 'n', current_snapshot_id: 's0' }], [{ id: 's0', source: 'handoff' }]]);
    expect(await persistReferenceSnapshot({ sql, userId: 1, nodeId: 'n', html: 'x' })).toEqual({ snapshotId: 's0', deduped: true });
    expect(sql._calls.some((c) => /INSERT INTO snapshots/.test(c.text))).toBe(false);
  });
  it('fresh → inserts source=handoff and repoints the node', async () => {
    const sql = fakeSql([[{ id: 'n', current_snapshot_id: null }], [{ id: 's1' }], []]);
    const r = await persistReferenceSnapshot({ sql, userId: 1, nodeId: 'n', html: 'x', title: 'T' });
    expect(r).toEqual({ snapshotId: 's1', title: 'T' });
    const ins = sql._calls.find((c) => /INSERT INTO snapshots/.test(c.text));
    expect(ins.text).toContain("'handoff'");
    expect(sql._calls.some((c) => /UPDATE nodes/.test(c.text))).toBe(true);
  });
});
