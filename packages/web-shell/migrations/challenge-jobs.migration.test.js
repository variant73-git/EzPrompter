import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(join(process.cwd(), 'migrations', '2026-09-08-challenge-jobs.sql'), 'utf8');
const schema = readFileSync(join(process.cwd(), 'schema.sql'), 'utf8');

describe('challenge_jobs migration', () => {
  it('creates the table with every column and status the spec names', () => {
    for (const col of ['user_id', 'board_id', 'node_id', 'purpose', 'target_url', 'generation', 'status',
      'bb_session_id', 'bb_page_id', 'idem_key', 'human_deadline_at', 'session_expires_at',
      'lease_until', 'lease_owner', 'error_code']) {
      expect(sql, col).toContain(col);
    }
    for (const st of ['verifying', 'needs_human', 'ready', 'capturing', 'committing', 'succeeded',
      'failed', 'expired', 'cancelled', 'unsupported']) {
      expect(sql, st).toContain(`'${st}'`);
    }
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS challenge_jobs/);
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS .*challenge_jobs.*user_id/);
  });

  it('schema.sql (runs on every boot) carries the same table', () => {
    expect(schema).toMatch(/CREATE TABLE IF NOT EXISTS challenge_jobs/);
  });
});
