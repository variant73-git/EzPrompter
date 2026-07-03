// lib/billing/rate-limit.test.js
import { describe, it, expect } from 'vitest';
import { checkChatRate, checkOpsRate } from './rate-limit.js';

const sqlReturning = (rows) => { let i = 0; return () => Promise.resolve(rows[i++] ?? []); };

describe('checkChatRate', () => {
  it('allows under both windows', async () => {
    const sql = sqlReturning([[{ n: 3 }], [{ n: 40 }]]);
    expect(await checkChatRate({ sql, userId: 'u1' })).toEqual({ allowed: true });
  });
  it('blocks past the per-minute burst', async () => {
    const sql = sqlReturning([[{ n: 10 }]]);
    const out = await checkChatRate({ sql, userId: 'u1' });
    expect(out.allowed).toBe(false);
    expect(out.reason).toBe('chat_per_minute');
  });
  it('blocks past the daily light-turn allowance', async () => {
    const sql = sqlReturning([[{ n: 1 }], [{ n: 150 }]]);
    const out = await checkChatRate({ sql, userId: 'u1' });
    expect(out.allowed).toBe(false);
    expect(out.reason).toBe('daily_light_turns');
  });
});

describe('checkOpsRate', () => {
  it('blocks a burst of billable operations', async () => {
    const sql = sqlReturning([[{ n: 6 }]]);
    expect((await checkOpsRate({ sql, userId: 'u1' })).allowed).toBe(false);
  });
});
