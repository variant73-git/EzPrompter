import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { splitSqlStatements } from './sql-statements.js';

describe('splitSqlStatements', () => {
  it('splits plain statements and drops comments', () => {
    expect(splitSqlStatements(`
      -- cria a tabela
      CREATE TABLE a (id INT);
      CREATE INDEX i ON a(id);
    `)).toEqual(['CREATE TABLE a (id INT)', 'CREATE INDEX i ON a(id)']);
  });

  // O motivo de existir: as migracoes pendentes usam `DO $$ ... END $$` e o
  // corpo do bloco tem ponto e virgula. Dividir por ponto e virgula cru
  // entregaria pedacos invalidos ao banco.
  it('keeps a dollar-quoted block whole', () => {
    const comandos = splitSqlStatements(`
      ALTER TABLE t ADD COLUMN c INT;
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'x') THEN
          ALTER TABLE t ADD CONSTRAINT x CHECK (c > 0);
        END IF;
      END $$;
      CREATE INDEX i ON t(c);
    `);
    expect(comandos).toHaveLength(3);
    expect(comandos[1]).toMatch(/^DO \$\$[\s\S]+END \$\$$/);
    expect(comandos[1]).toContain('ADD CONSTRAINT x');
  });

  it('keeps a tagged dollar-quoted block whole', () => {
    const comandos = splitSqlStatements("DO $corpo$ BEGIN PERFORM 1; END $corpo$;\nSELECT 1;");
    expect(comandos).toHaveLength(2);
    expect(comandos[0]).toContain('PERFORM 1;');
  });

  it('does not split on a semicolon inside a string or an identifier', () => {
    expect(splitSqlStatements(`INSERT INTO t VALUES ('a;b', 'c''d;e');\nSELECT "col;name" FROM t;`))
      .toEqual([`INSERT INTO t VALUES ('a;b', 'c''d;e')`, `SELECT "col;name" FROM t`]);
  });

  it('ignores a semicolon inside comments', () => {
    expect(splitSqlStatements('SELECT 1 -- comentario; com ponto e virgula\n;\n/* outro; */ SELECT 2;'))
      .toEqual(['SELECT 1', 'SELECT 2']);
  });

  it('accepts a last statement without the final semicolon', () => {
    expect(splitSqlStatements('SELECT 1;\nSELECT 2')).toEqual(['SELECT 1', 'SELECT 2']);
  });

  // Rede de seguranca: o `schema.sql` de verdade roda a cada boot do produto.
  it('parses the real schema.sql into non-empty statements', () => {
    const schema = readFileSync(path.join(process.cwd(), 'schema.sql'), 'utf8');
    const comandos = splitSqlStatements(schema);
    expect(comandos.length).toBeGreaterThan(20);
    comandos.forEach((comando) => {
      expect(comando.trim()).not.toBe('');
      expect(comando).not.toMatch(/^\)/); // pedaco de statement partido ao meio
    });
    expect(comandos.filter((c) => /^CREATE TABLE/i.test(c)).length).toBeGreaterThan(5);
  });
});
