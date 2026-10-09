import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { anotarProgresso } from './normalizar-clone.mjs';

describe('anotarProgresso', () => {
  it('acrescenta uma linha JSON por chamada', () => {
    const arq = path.join(mkdtempSync(path.join(tmpdir(), 'prog-')), 'progresso.jsonl');
    anotarProgresso(arq, { fase: 'gravando', feitas: 1, total: 40 });
    anotarProgresso(arq, { fase: 'montando' });
    const linhas = readFileSync(arq, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(linhas).toEqual([{ fase: 'gravando', feitas: 1, total: 40 }, { fase: 'montando' }]);
  });

  it('sem arquivo não faz nada', () => {
    expect(() => anotarProgresso(null, { fase: 'gravando' })).not.toThrow();
  });

  it('nunca derruba a gravação quando o arquivo não pode ser escrito', () => {
    expect(() => anotarProgresso('/caminho/que/nao/existe/p.jsonl', { fase: 'gravando' })).not.toThrow();
  });
});
