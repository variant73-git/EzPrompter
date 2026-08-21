// O smoke é o porteiro; este teste é o porteiro DELE.
// Não roda a cadeia (isso exige servidor + banco) — protege as duas coisas que
// fazem o smoke ser útil e que uma edição distraída quebraria em silêncio:
// a ORDEM dos passos (é ela que diz onde a cadeia rompeu) e o fato de que ele
// FALHA com código de erro.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const fonte = readFileSync(join(process.cwd(), 'scripts/smoke-clone.mjs'), 'utf8');
const passos = [...fonte.matchAll(/await passo\('(\d)\. ([^']+)'/g)].map((m) => ({ n: Number(m[1]), nome: m[2] }));

describe('smoke:clone — contrato do porteiro', () => {
  it('verifica a cadeia inteira, em ordem, do servidor até a mídia do node', () => {
    expect(passos.map((p) => p.n)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    // Os elos que importam, pelo que cada um prova:
    expect(passos[0].nome).toMatch(/servidor/i);      // o produto está de pé
    expect(passos[2].nome).toMatch(/bundle/i);        // o clone vira artefato
    expect(passos[4].nome).toMatch(/runtime-session/); // autenticação + sessão
    expect(passos[5].nome).toMatch(/SERVE/);          // o elo do "localhost is blocked"
  });

  it('para no primeiro elo quebrado em vez de mascarar com erros em cascata', () => {
    expect(fonte).toMatch(/if \(falhou\) \{ passos\.push\(\{ nome, estado: 'pulado' \}\); return null; \}/);
  });

  it('sai com código de ERRO quando a cadeia quebra — senão não barra nada', () => {
    expect(fonte).toMatch(/process\.exit\(1\)/);
  });

  it('apaga o que criou, a menos que --keep', () => {
    expect(fonte).toMatch(/DELETE FROM boards WHERE id/);
    expect(fonte).toMatch(/!MANTER/);
  });

  it('reprova 5xx no passo 1 — a versão anterior dizia "ok" para HTTP 500', () => {
    // Regressão do defeito que o PRIMEIRO uso real do smoke expôs: o passo 1
    // só conferia "não é 404", então um servidor quebrado passava como sadio.
    expect(fonte).toMatch(/res\.status >= 500/);
    expect(fonte).toMatch(/\[401, 403, 200\]\.includes\(res\.status\)/);
  });

  it('carrega .env.local sozinho — o Next carrega, node puro não', () => {
    expect(fonte).toMatch(/DATABASE_URL/);
    expect(fonte).toMatch(/\.env\.local/);
  });

  it('não sai para a internet nem chama modelo — smoke caro não é rodado', () => {
    expect(fonte).not.toMatch(/https?:\/\/(?!localhost)/);
    expect(fonte).not.toMatch(/openai|anthropic|gemini/i);
  });
});
