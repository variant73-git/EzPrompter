import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { splitSqlStatements } from '../sql-statements.js';

const raiz = path.resolve(__dirname, '../..');
const ler = (rel) => readFileSync(path.join(raiz, rel), 'utf8');
const bloco = (texto) => {
  const i = texto.indexOf('CREATE TABLE IF NOT EXISTS canonical_jobs');
  const fim = texto.indexOf('idx_canonical_jobs_overdue');
  return i >= 0 && fim > i ? texto.slice(i, texto.indexOf(';', fim) + 1) : null;
};

describe('canonical_jobs', () => {
  it('schema.sql e a migração têm o MESMO bloco', () => {
    const doSchema = bloco(ler('schema.sql'));
    expect(doSchema).not.toBeNull();
    expect(bloco(ler('migrations/2026-10-09-canonical-jobs.sql'))).toBe(doSchema);
  });

  it('uma tarefa ativa por node e cerca por geração', () => {
    const b = bloco(ler('schema.sql'));
    expect(b).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS idx_canonical_jobs_one_active ON canonical_jobs\(node_id\)\s+WHERE status IN \('queued','provisioning','recording','packaging'\)/);
    expect(b).toMatch(/generation INTEGER NOT NULL DEFAULT 1/);
    expect(b).toMatch(/UNIQUE \(user_id, idem_key\)/);
    expect(b).toMatch(/cleanup_done BOOLEAN NOT NULL DEFAULT false/);
  });

  it('o divisor de instruções entende o bloco', () => {
    expect(splitSqlStatements(bloco(ler('schema.sql'))).length).toBe(4);
  });

  it('migrate.mjs conhece a migração', () => {
    expect(ler('scripts/migrate.mjs')).toContain("arquivo: 'migrations/2026-10-09-canonical-jobs.sql'");
  });
});
