/**
 * Cost computation for agent runs + image generation.
 *
 * Prices in USD per 1M tokens (input/output). Image gen in USD per image.
 * Values from public provider pricing pages, normalized to cents in compute.
 *
 * Update this table when providers change pricing. Out-of-date entries
 * produce conservative under-estimates (never negative; unknown models = 0).
 */
export const MODEL_PRICES = {
  // Anthropic Claude
  'claude-opus-4-7':           { inPerM: 15.00, outPerM: 75.00 },
  'claude-opus-4-6':           { inPerM: 15.00, outPerM: 75.00 },
  'claude-sonnet-4-6':         { inPerM:  3.00, outPerM: 15.00 },
  'claude-haiku-4-5-20251001': { inPerM:  1.00, outPerM:  5.00 },
  // OpenAI
  'gpt-5.5':                   { inPerM:  5.00, outPerM: 15.00 },
  // Google Gemini
  'gemini-3.1-pro-preview':    { inPerM:  1.25, outPerM:  5.00 },
  'gemini-2.5-flash':          { inPerM:  0.10, outPerM:  0.40 },
  // DeepSeek (future Pro tier)
  'deepseek-chat':             { inPerM:  0.27, outPerM:  1.10 },
};

const IMAGE_PRICES = {
  gemini: 4,   // Imagen 3.0 fast ~$0.04/image → 4 cents
  openai: 6,   // gpt-image-1 medium quality ~$0.06/image → 6 cents
};

/**
 * Compute total cost in CENTS (integer) for a chat run.
 * Returns 0 for unknown models (defensive default).
 */
export function computeCost({ model, tokensIn = 0, tokensOut = 0 }) {
  const price = MODEL_PRICES[model];
  if (!price) return 0;
  const usd = (tokensIn / 1_000_000) * price.inPerM
            + (tokensOut / 1_000_000) * price.outPerM;
  return Math.round(usd * 100);
}

/**
 * Per-image cost in cents for a given provider id.
 * Returns 0 for unknown providers.
 */
export function getCostPerImage(provider) {
  return IMAGE_PRICES[provider] || 0;
}
