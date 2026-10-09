import { describe, expect, it } from 'vitest';
import { publishCanonical } from './publish.js';

function fakeSql(rows) {
  const calls = [];
  const sql = (strings, ...values) => { calls.push({ text: strings.join('?'), values }); return Promise.resolve(rows); };
  sql._calls = calls;
  return sql;
}
const job = { id: 'j1', node_id: 'n1', source_snapshot_id: 's1', generation: 4 };
const descriptor = { bundleId: '11111111-1111-5111-8111-111111111111', runtimeFingerprint: `sha256:${'b'.repeat(64)}` };

describe('publicação da cópia', () => {
  it('snapshot canonical + node + tarefa numa instrução só, cercada', async () => {
    const sql = fakeSql([{ snapshot_id: 's2', job_id: 'j1' }]);
    const out = await publishCanonical({ sql, job, owner: 'w', descriptor, html: '<html>' });
    expect(out.snapshotId).toBe('s2');
    expect(out.motionManifest.baseBundleId).toBe(descriptor.bundleId);
    const { text } = sql._calls[0];
    expect(sql._calls).toHaveLength(1);
    expect(text).toMatch(/'canonical'/);
    expect(text).toMatch(/j\.status = 'packaging' AND j\.generation = \? AND j\.lease_owner = \?/);
    expect(text).toMatch(/nodes\.current_snapshot_id = \?/);
    expect(text).toMatch(/SET status = 'ready'/);
  });

  it('node que mudou no meio: publish_conflict, nada publicado', async () => {
    await expect(publishCanonical({ sql: fakeSql([{ snapshot_id: null, job_id: null }]), job, owner: 'w', descriptor, html: '<html>' }))
      .rejects.toMatchObject({ code: 'publish_conflict' });
  });
});
