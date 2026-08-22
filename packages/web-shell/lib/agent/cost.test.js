import { describe, it, expect } from 'vitest';
import { computeCost, getCostPerImage, MODEL_PRICES, computeCostMicrocents, imageCostMicrocents } from './cost.js';

describe('cost — chat models', () => {
  it('returns 0 cents for unknown model', () => {
    expect(computeCost({ model: 'unknown-xyz', tokensIn: 1000, tokensOut: 500 })).toBe(0);
  });

  it('computes Sonnet 4.6 cost correctly', () => {
    // Sonnet 4.6: $3 in / $15 out per 1M tokens
    // 1000 in + 500 out = 0.003 + 0.0075 = 0.0105 USD = 1.05 cents → rounded to 1
    const cents = computeCost({ model: 'claude-sonnet-4-6', tokensIn: 1000, tokensOut: 500 });
    expect(cents).toBeGreaterThan(0);
    expect(cents).toBeLessThan(5);
  });

  it('computes Gemini 2.5 Flash much cheaper than Sonnet', () => {
    const sonnet = computeCost({ model: 'claude-sonnet-4-6', tokensIn: 10000, tokensOut: 2000 });
    const flash  = computeCost({ model: 'gemini-2.5-flash',  tokensIn: 10000, tokensOut: 2000 });
    expect(flash).toBeLessThan(sonnet / 10);
  });

  it('handles zero tokens', () => {
    expect(computeCost({ model: 'claude-sonnet-4-6', tokensIn: 0, tokensOut: 0 })).toBe(0);
  });

  it('MODEL_PRICES contains entries for the major models', () => {
    expect(MODEL_PRICES['claude-sonnet-4-6']).toBeDefined();
    expect(MODEL_PRICES['claude-opus-4-7']).toBeDefined();
    expect(MODEL_PRICES['gemini-2.5-flash']).toBeDefined();
    expect(MODEL_PRICES['gemini-3.1-pro-preview']).toBeDefined();
    expect(MODEL_PRICES['gpt-5.5']).toBeDefined();
    expect(MODEL_PRICES['gpt-4o-mini']).toBeDefined();
  });
});

describe('cost — prompt caching', () => {
  it('Anthropic cache READ is 10% of fresh input rate', () => {
    // 10k all-cached vs 10k all-fresh — should be exactly 10%
    const fresh  = computeCost({ model: 'claude-sonnet-4-6', tokensIn: 10000, tokensOut: 0 });
    const cached = computeCost({ model: 'claude-sonnet-4-6', tokensIn: 10000, tokensOut: 0, cachedInTokens: 10000 });
    expect(cached).toBe(Math.round(fresh * 0.10));
  });

  it('Anthropic cache WRITE is 125% of fresh input rate (the +25% surcharge)', () => {
    const fresh = computeCost({ model: 'claude-sonnet-4-6', tokensIn: 10000, tokensOut: 0 });
    const withWrite = computeCost({
      model: 'claude-sonnet-4-6', tokensIn: 10000, tokensOut: 0,
      cacheWriteTokens: 10000,
    });
    // fresh covers the 10k in + write_rate * 10k separately
    expect(withWrite).toBeGreaterThan(fresh * 2);
  });

  it('OpenAI gpt-4o-mini cache READ is 50% of fresh input rate', () => {
    const fresh  = computeCost({ model: 'gpt-4o-mini', tokensIn: 100000, tokensOut: 0 });
    const cached = computeCost({ model: 'gpt-4o-mini', tokensIn: 100000, tokensOut: 0, cachedInTokens: 100000 });
    expect(cached).toBe(Math.round(fresh * 0.50));
  });

  it('Gemini 2.5 Flash cache READ is 25% of fresh input rate', () => {
    const fresh  = computeCost({ model: 'gemini-2.5-flash', tokensIn: 100000, tokensOut: 0 });
    const cached = computeCost({ model: 'gemini-2.5-flash', tokensIn: 100000, tokensOut: 0, cachedInTokens: 100000 });
    expect(cached).toBe(Math.round(fresh * 0.25));
  });

  it('partial cache hits split between fresh and discounted rates', () => {
    // Use 1M tokens so the cents values are large enough that integer
    // rounding doesn't collapse the three cases to 0.
    // 1M @ $0.15 = 15 cents fresh; @ $0.075 = 7.5 → 8 cents cached.
    const allFresh  = computeCost({ model: 'gpt-4o-mini', tokensIn: 1_000_000, tokensOut: 0 });
    const allCached = computeCost({ model: 'gpt-4o-mini', tokensIn: 1_000_000, tokensOut: 0, cachedInTokens: 1_000_000 });
    const partial   = computeCost({ model: 'gpt-4o-mini', tokensIn: 1_000_000, tokensOut: 0, cachedInTokens: 600_000 });
    expect(partial).toBeGreaterThan(allCached);
    expect(partial).toBeLessThan(allFresh);
  });
});

describe('cost — image generation', () => {
  it('returns cost for Imagen', () => {
    expect(getCostPerImage('gemini')).toBeGreaterThan(0);
  });

  it('returns cost for gpt-image-1', () => {
    expect(getCostPerImage('openai')).toBeGreaterThan(0);
  });

  it('returns 0 for unknown provider', () => {
    expect(getCostPerImage('unknown')).toBe(0);
  });
});

describe('computeCostMicrocents', () => {
  it('keeps sub-cent costs exact (the 0.02¢ Flash call)', () => {
    // gemini-2.5-flash: in $0.10/M, out $0.40/M → 12k in + 800 out
    // = $0.0012 + $0.00032 = $0.00152 = 0.152¢ = 1520 µ¢
    expect(computeCostMicrocents({ model: 'gemini-2.5-flash', tokensIn: 12000, tokensOut: 800 })).toBe(1520);
  });
  it('returns 0 for unknown models (conservative)', () => {
    expect(computeCostMicrocents({ model: 'nope', tokensIn: 1e6, tokensOut: 1e6 })).toBe(0);
  });
  it('computeCost derives from µ¢ (integer cents, unchanged behaviour)', () => {
    // gpt-5.5: 100k in + 10k out = $0.50 + $0.30 = 80¢
    // (era 65¢ enquanto a tabela dizia $15 de saida; o preco publico e' $30 —
    // conferido em 2026-08-22, e o valor antigo COBRAVA METADE do devido)
    expect(computeCost({ model: 'gpt-5.5', tokensIn: 100000, tokensOut: 10000 })).toBe(80);
  });
});

describe('imageCostMicrocents', () => {
  it('prices gpt-image-1 by quality', () => {
    expect(imageCostMicrocents({ provider: 'openai', quality: 'high' })).toBe(250000);   // $0.25
    expect(imageCostMicrocents({ provider: 'openai', quality: 'medium' })).toBe(60000);  // $0.06
  });
  it('prices Imagen fast flat and unknown providers at 0', () => {
    expect(imageCostMicrocents({ provider: 'gemini' })).toBe(40000);                     // $0.04
    expect(imageCostMicrocents({ provider: 'other' })).toBe(0);
  });
});

// ⚠️ DINHEIRO. `MODEL_PRICES` desemboca em `computeCostMicrocents` →
// `billing/context.js` → os µ¢ do ledger: preço errado aqui cobra errado, nos
// dois sentidos. Conferido contra as páginas oficiais em 2026-08-22
// (developers.openai.com/api/docs/pricing e platform.kimi.ai/docs/pricing/chat-k26).
describe('tabela de preços × páginas oficiais (2026-08-22)', () => {
  const oficial = {
    'gpt-5.6-terra': { inPerM: 2.00, cachedInPerM: 0.20, outPerM: 12.00 },
    'gpt-5.5':       { inPerM: 5.00, cachedInPerM: 0.50, outPerM: 30.00 },
    'gpt-4o-mini':   { inPerM: 0.15, cachedInPerM: 0.075, outPerM: 0.60 },
    'kimi-k2.6':     { inPerM: 0.95, cachedInPerM: 0.16, outPerM: 4.00 },
  };

  for (const [modelo, precos] of Object.entries(oficial)) {
    it(`${modelo} bate com o preço público`, () => {
      expect(MODEL_PRICES[modelo]).toBeDefined();
      expect(MODEL_PRICES[modelo].inPerM).toBe(precos.inPerM);
      expect(MODEL_PRICES[modelo].outPerM).toBe(precos.outPerM);
      expect(MODEL_PRICES[modelo].cachedInPerM).toBe(precos.cachedInPerM);
    });
  }

  // Todo modelo do seletor precisa de preço: sem entrada, `computeCost` devolve
  // 0 e a execução é metrada de GRAÇA (era o caso do kimi-k2.6).
  //
  // ⚠️ Atravessa os APELIDOS. Os ids do seletor não são os nomes de provedor:
  // `gemini-3.1-pro` vira `gemini-3.1-pro-preview`, `claude-4.6-opus` vira
  // `claude-opus-4-6`. Comparar direto acusava dois faltando que não faltam —
  // falso positivo do meu primeiro teste.
  it('nenhum modelo do seletor fica sem preço, depois de resolver o apelido', async () => {
    const { readFileSync } = await import('node:fs');
    // caminho a partir da raiz do pacote: em jsdom o `import.meta.url` nao e' file:
    const dock = readFileSync('components/PromptDock.jsx', 'utf8');
    const runFlow = readFileSync('lib/run-flow.js', 'utf8');
    const ids = [...dock.matchAll(/\{\s*id:\s*'([^']+)'\s*,\s*name:/g)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThan(3);
    const bloco = runFlow.slice(runFlow.indexOf('const MODEL_ALIAS'), runFlow.indexOf('function resolveModel'));
    const alias = Object.fromEntries([...bloco.matchAll(/'([^']+)':\s*'([^']+)'/g)].map((m) => [m[1], m[2]]));
    expect(Object.keys(alias).length).toBeGreaterThan(2);
    const semPreco = ids.filter((id) => !MODEL_PRICES[alias[id] || id]);
    expect(semPreco).toEqual([]);
  });

  // ⚠️ EU ERREI AQUI e o Sol pegou: tinha REMOVIDO a sobretaxa de escrita do
  // terra argumentando que "nenhum caminho OpenAI reporta esse token" — mas a
  // ausência do campo da ANTHROPIC (`cache_creation_input_tokens`) não prova
  // ausência do evento na OpenAI, que expõe `cache_write_tokens` e documenta
  // 1.25× o input. Remover transformava sobretaxa errada em SUBcobrança.
  it('a escrita de cache do terra é 1.25× o input, como a página documenta', () => {
    expect(MODEL_PRICES['gpt-5.6-terra'].cacheWritePerM).toBe(2.50);
    expect(MODEL_PRICES['gpt-5.6-terra'].cacheWritePerM)
      .toBe(MODEL_PRICES['gpt-5.6-terra'].inPerM * 1.25);
  });

  // Faixa de contexto longo (>272K de ENTRADA): a requisição INTEIRA passa a
  // 2× input e 1.5× output. Sem isso, operação longa é subcobrada — pode
  // chegar a 2× no componente de entrada (achado do Sol; conferido nas páginas
  // do gpt-5.5 e do gpt-5.6-terra em 2026-08-22).
  it('cobra a faixa de contexto longo acima de 272K de entrada', () => {
    const abaixo = computeCostMicrocents({ model: 'gpt-5.5', tokensIn: 272_000, tokensOut: 1000 });
    const acima  = computeCostMicrocents({ model: 'gpt-5.5', tokensIn: 272_001, tokensOut: 1000 });
    // 272_000 exatos ainda é faixa normal — o gatilho é ">272K"
    expect(abaixo).toBe(Math.round(((272_000 / 1e6) * 5 + (1000 / 1e6) * 30) * 1e6));
    // acima: entrada dobra, saída ×1.5, na requisição inteira
    expect(acima).toBe(Math.round(((272_001 / 1e6) * 10 + (1000 / 1e6) * 45) * 1e6));
    expect(acima).toBeGreaterThan(abaixo * 1.9);
  });

  it('a faixa longa não atinge modelo que não a tem', () => {
    const semFaixa = computeCostMicrocents({ model: 'gpt-4o-mini', tokensIn: 400_000, tokensOut: 1000 });
    expect(semFaixa).toBe(Math.round(((400_000 / 1e6) * 0.15 + (1000 / 1e6) * 0.60) * 1e6));
  });
});
