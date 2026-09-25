/**
 * Cost computation for agent runs + image generation.
 *
 * Prices in USD per 1M tokens. Image gen in USD per image.
 * Values from public provider pricing pages, normalized to cents in compute.
 *
 * Cache pricing rules per provider:
 *   - Anthropic: cache READ = 10% of fresh input, WRITE = 125% of fresh input
 *                (5min ephemeral). Break-even at 2 reads.
 *   - OpenAI:    no write surcharge. Cache READ varia por familia: 50% na 4o,
 *                10% nas 5.5/5.6 (conferido 2026-08-22). Automatico; passamos
 *                prompt_cache_key para roteamento de replica.
 *   - Moonshot:  cache READ ~17% do input fresco (0.16 vs 0.95).
 *   - Gemini:    cache READ = 25% of fresh input (implicit cache on 2.5
 *                Flash and Pro), no write surcharge.
 *
 * When `cachedInPerM` is unset, computeCost falls back to `inPerM` (i.e.,
 * pretends there was no discount — conservative). When `cacheWritePerM` is
 * unset, write tokens are billed at `inPerM`.
 *
 * Update this table when providers change pricing. Out-of-date entries
 * produce conservative under-estimates (never negative; unknown models = 0).
 */
/**
 * Faixa de contexto longo da familia 5.x da OpenAI: acima de 272K tokens de
 * ENTRADA, a requisicao INTEIRA passa a 2x input e 1.5x output (documentado nas
 * paginas do gpt-5.5 e do gpt-5.6-terra, conferido em 2026-08-22). Sem isso,
 * operacao longa e' SUBcobrada — ate' 2x no componente de entrada.
 *
 * O multiplicador de entrada vale para o input inteiro (fresco, cacheado e
 * escrita de cache): a pagina diz "2x input ... for the full request", sem
 * separar as parcelas.
 */
const LONG_CONTEXT_5X = { threshold: 272_000, inMult: 2, outMult: 1.5 };

export const MODEL_PRICES = {
  // Anthropic Claude — 10% / 125% cache economics
  'claude-opus-4-7':           { inPerM: 15.00, outPerM: 75.00, cachedInPerM: 1.50,  cacheWritePerM: 18.75 },
  'claude-opus-4-6':           { inPerM: 15.00, outPerM: 75.00, cachedInPerM: 1.50,  cacheWritePerM: 18.75 },
  'claude-sonnet-4-6':         { inPerM:  3.00, outPerM: 15.00, cachedInPerM: 0.30,  cacheWritePerM:  3.75 },
  'claude-haiku-4-5-20251001': { inPerM:  1.00, outPerM:  5.00, cachedInPerM: 0.10,  cacheWritePerM:  1.25 },
  // OpenAI — cache de LEITURA a 10% nos modelos 5.5/5.6 (nao 50%, como a familia
  // 4o), e SEM sobretaxa de escrita: nenhum caminho OpenAI daqui sequer reporta
  // esse token (`cache_creation_input_tokens` e' campo da Anthropic).
  // Conferido nas paginas oficiais em 2026-08-22.
  // ⚠️ cacheWritePerM do 5.5 e' INFERIDO da regra da familia (o terra documenta
  // 1.25x; a pagina do 5.5 nao traz a linha). Hoje e' inerte — nenhum caminho
  // OpenAI daqui reporta token de escrita de cache —, mas se alguem fiar esse
  // relato, CONFERIR antes de confiar no numero.
  'gpt-5.5':                   { inPerM:  5.00, outPerM: 30.00, cachedInPerM: 0.50, cacheWritePerM: 6.25, longContext: LONG_CONTEXT_5X },
  'gpt-5.6-terra':             { inPerM:  2.00, outPerM: 12.00, cachedInPerM: 0.20, cacheWritePerM: 2.50, longContext: LONG_CONTEXT_5X },
  'gpt-4o-mini':               { inPerM:  0.15, outPerM:  0.60, cachedInPerM: 0.075 },
  // Moonshot Kimi — estava no seletor de modelos e FALTAVA aqui, entao toda
  // execucao nele era metrada como GRATUITA (modelo desconhecido = 0).
  'kimi-k2.6':                 { inPerM:  0.95, outPerM:  4.00, cachedInPerM: 0.16 },
  // Google Gemini — 25% cached (implicit caching on 2.5 family), no write surcharge
  'gemini-3.1-pro-preview':    { inPerM:  1.25, outPerM:  5.00, cachedInPerM: 0.3125 },
  'gemini-2.5-flash':          { inPerM:  0.10, outPerM:  0.40, cachedInPerM: 0.025 },
  // DeepSeek (kept for reference; not currently used — see getAgentModel)
  'deepseek-chat':             { inPerM:  0.27, outPerM:  1.10 },
};

/**
 * Exact cost in MICRO-CENTS (1¢ = 10,000 µ¢), integer. This is the metering
 * unit — computeCost (integer cents) derives from it. Sub-cent calls (a
 * 0.02¢ Flash turn) stay exact instead of rounding to 0.
 *
 * `tokensIn` from provider usage ALREADY INCLUDES `cachedInTokens` — they're
 * not additive. We subtract to find the fresh-rate portion, then bill the
 * cached portion at the discounted rate. `cacheWriteTokens` are additional
 * (Anthropic only — the +25% surcharge for writing to ephemeral cache).
 *
 * Returns 0 for unknown models (defensive default).
 */
export function computeCostMicrocents({ model, tokensIn = 0, tokensOut = 0, cachedInTokens = 0, cacheWriteTokens = 0 }) {
  const price = MODEL_PRICES[model];
  if (!price) return 0;
  const freshIn = Math.max(0, tokensIn - cachedInTokens);
  const cachedInRate   = price.cachedInPerM   != null ? price.cachedInPerM   : price.inPerM;
  const cacheWriteRate = price.cacheWritePerM != null ? price.cacheWritePerM : price.inPerM;
  // Faixa de contexto longo: o gatilho e' a ENTRADA da requisicao, e o
  // multiplicador vale para a requisicao inteira, nao so' para o excedente.
  const longa = price.longContext && tokensIn > price.longContext.threshold
    ? price.longContext
    : { inMult: 1, outMult: 1 };
  const usd = (freshIn          / 1_000_000) * price.inPerM        * longa.inMult
            + (cachedInTokens   / 1_000_000) * cachedInRate        * longa.inMult
            + (cacheWriteTokens / 1_000_000) * cacheWriteRate      * longa.inMult
            + (tokensOut        / 1_000_000) * price.outPerM       * longa.outMult;
  return Math.round(usd * 1_000_000); // $ → µ¢ (100¢ × 10,000)
}

export function computeCost(args) {
  return Math.round(computeCostMicrocents(args) / 10_000);
}

// Per-image µ¢ by provider + quality. gpt-image-1's old flat 6¢ was the
// MEDIUM price while the adapter runs HIGH (~25¢) — quality is now explicit.
const IMAGE_PRICES_MICRO = {
  openai: { high: 250_000, medium: 60_000, low: 20_000 },
  gemini: { default: 40_000 }, // Imagen 3.0 fast
};

export function imageCostMicrocents({ provider, quality } = {}) {
  const p = IMAGE_PRICES_MICRO[provider];
  if (!p) return 0;
  return p[quality] ?? p.high ?? p.default ?? 0;
}

export function getCostPerImage(provider) {
  return Math.round(imageCostMicrocents({ provider }) / 10_000);
}
