/**
 * Cost computation for agent runs + image generation.
 *
 * Prices in USD per 1M tokens. Image gen in USD per image.
 * Values from public provider pricing pages, normalized to cents in compute.
 *
 * Cache pricing rules per provider:
 *   - Anthropic: cache READ = 10% of fresh input, WRITE = 125% of fresh input
 *                (5min ephemeral). Break-even at 2 reads.
 *   - OpenAI:    cache READ = 50% of fresh input, no write surcharge.
 *                Automatic; we pass prompt_cache_key for replica routing.
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
export const MODEL_PRICES = {
  // Anthropic Claude — 10% / 125% cache economics
  'claude-opus-4-7':           { inPerM: 15.00, outPerM: 75.00, cachedInPerM: 1.50,  cacheWritePerM: 18.75 },
  'claude-opus-4-6':           { inPerM: 15.00, outPerM: 75.00, cachedInPerM: 1.50,  cacheWritePerM: 18.75 },
  'claude-sonnet-4-6':         { inPerM:  3.00, outPerM: 15.00, cachedInPerM: 0.30,  cacheWritePerM:  3.75 },
  'claude-haiku-4-5-20251001': { inPerM:  1.00, outPerM:  5.00, cachedInPerM: 0.10,  cacheWritePerM:  1.25 },
  // OpenAI — 50% cached, no write surcharge
  'gpt-5.5':                   { inPerM:  5.00, outPerM: 15.00, cachedInPerM: 2.50 },
  'gpt-4o-mini':               { inPerM:  0.15, outPerM:  0.60, cachedInPerM: 0.075 },
  // Google Gemini — 25% cached (implicit caching on 2.5 family), no write surcharge
  'gemini-3.1-pro-preview':    { inPerM:  1.25, outPerM:  5.00, cachedInPerM: 0.3125 },
  'gemini-2.5-flash':          { inPerM:  0.10, outPerM:  0.40, cachedInPerM: 0.025 },
  // DeepSeek (kept for reference; not currently used — see getAgentModel)
  'deepseek-chat':             { inPerM:  0.27, outPerM:  1.10 },
};

const IMAGE_PRICES = {
  gemini: 4,   // Imagen 3.0 fast ~$0.04/image → 4 cents
  openai: 6,   // gpt-image-1 medium quality ~$0.06/image → 6 cents
};

/**
 * Compute total cost in CENTS (integer) for a chat run.
 *
 * `tokensIn` from provider usage ALREADY INCLUDES `cachedInTokens` — they're
 * not additive. We subtract to find the fresh-rate portion, then bill the
 * cached portion at the discounted rate. `cacheWriteTokens` are additional
 * (Anthropic only — the +25% surcharge for writing to ephemeral cache).
 *
 * Returns 0 for unknown models (defensive default).
 */
export function computeCost({ model, tokensIn = 0, tokensOut = 0, cachedInTokens = 0, cacheWriteTokens = 0 }) {
  const price = MODEL_PRICES[model];
  if (!price) return 0;
  const freshIn = Math.max(0, tokensIn - cachedInTokens);
  const cachedInRate    = price.cachedInPerM    != null ? price.cachedInPerM    : price.inPerM;
  const cacheWriteRate  = price.cacheWritePerM  != null ? price.cacheWritePerM  : price.inPerM;
  const usd = (freshIn          / 1_000_000) * price.inPerM
            + (cachedInTokens   / 1_000_000) * cachedInRate
            + (cacheWriteTokens / 1_000_000) * cacheWriteRate
            + (tokensOut        / 1_000_000) * price.outPerM;
  return Math.round(usd * 100);
}

/**
 * Per-image cost in cents for a given provider id.
 * Returns 0 for unknown providers.
 */
export function getCostPerImage(provider) {
  return IMAGE_PRICES[provider] || 0;
}
