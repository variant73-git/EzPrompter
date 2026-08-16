import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('single chassis persistence contract', () => {
  it('keeps the base schema and additive migration aligned at one to three references', () => {
    const schema = readFileSync(resolve(process.cwd(), 'schema.sql'), 'utf8');
    const migration = readFileSync(resolve(process.cwd(), 'migrations/2026-08-07-single-chassis-plan.sql'), 'utf8');
    expect(schema).toContain('cardinality(selected_reference_ids) BETWEEN 1 AND 3');
    expect(migration).toContain('cardinality(selected_reference_ids) BETWEEN 1 AND 3');
    expect(migration).not.toMatch(/INSERT|UPDATE|DELETE/i);
  });
});
