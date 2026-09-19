import { describe, expect, it } from 'vitest';
import { TERMINAL, acquireLease, createJob, getOwnedJob, transition } from './job-store.js';

function fakeSql(rowsByCall = []) {
  const calls = [];
  const sql = (strings, ...values) => {
    calls.push({ text: strings.join('?'), values });
    return Promise.resolve(rowsByCall.shift() ?? []);
  };
  sql._calls = calls;
  return sql;
}

describe('challenge job store', () => {
  it('createJob inserts with purpose, immutable target and generation 1', async () => {
    const sql = fakeSql([[{ id: 'j1', status: 'verifying', generation: 1 }]]);
    const row = await createJob({ sql, userId: 42, boardId: 'b', nodeId: 'n', purpose: 'edit', targetUrl: 'https://x.com/', idemKey: 'k' });
    expect(row.id).toBe('j1');
    expect(sql._calls[0].text).toMatch(/INSERT INTO challenge_jobs/);
    expect(sql._calls[0].values).toEqual(expect.arrayContaining([42, 'b', 'n', 'edit', 'https://x.com/', 'k']));
  });

  it('getOwnedJob filters by user_id (never by id alone)', async () => {
    const sql = fakeSql([[]]);
    expect(await getOwnedJob({ sql, userId: 42, jobId: 'j1' })).toBeNull();
    expect(sql._calls[0].text).toMatch(/WHERE id = \? AND user_id = \?/);
  });

  it('transition is fenced by status AND generation; a lost fence returns null', async () => {
    const sql = fakeSql([[{ id: 'j1', status: 'capturing', generation: 1 }], []]);
    const ok = await transition({ sql, jobId: 'j1', from: 'ready', to: 'capturing', generation: 1, patch: { lease_owner: 'w1' } });
    expect(ok.status).toBe('capturing');
    expect(sql._calls[0].text).toMatch(/WHERE id = \? AND status = \? AND generation = \?/);
    const lost = await transition({ sql, jobId: 'j1', from: 'ready', to: 'capturing', generation: 1 });
    expect(lost).toBeNull();
  });

  it('transition ignores patch keys outside the closed set', async () => {
    const sql = fakeSql([[{ id: 'j1', status: 'ready' }]]);
    await transition({ sql, jobId: 'j1', from: 'verifying', to: 'ready', generation: 1, patch: { status: 'succeeded', target_url: 'evil', bb_session_id: 's' } });
    // values carry bb_session_id but NOT the injected status/target_url
    expect(sql._calls[0].values).toContain('s');
    expect(sql._calls[0].values).not.toContain('evil');
  });

  it('acquireLease only wins when the previous lease is gone', async () => {
    const sql = fakeSql([[{ id: 'j1' }], []]);
    expect(await acquireLease({ sql, jobId: 'j1', owner: 'w1', ttlMs: 30000 })).toBe(true);
    expect(sql._calls[0].text).toMatch(/lease_until IS NULL OR lease_until < NOW\(\)/);
    expect(await acquireLease({ sql, jobId: 'j1', owner: 'w2', ttlMs: 30000 })).toBe(false);
  });

  it('names the terminal states', () => {
    expect([...TERMINAL].sort()).toEqual(['cancelled', 'expired', 'failed', 'succeeded', 'unsupported']);
  });
});
