/**
 * OpenAI Moderation API client — free pre-filter for user-submitted text.
 *
 * Returns `{ flagged: bool, categories, scores }`. Routes call this BEFORE
 * sending text to any other provider (Anthropic / Gemini / image gen) so
 * banned content (CSAM, real-violence, etc.) never leaves our process.
 * Avoids account-level bans from providers when an abusive user tests
 * limits — every major provider has a TOS clause about this.
 *
 * Latency: ~80-200ms. Free, no rate limit at the volumes we'll hit
 * pre-product-market-fit. Uses the `omni-moderation-latest` endpoint
 * which handles both text and (when needed later) multimodal.
 *
 * Fails OPEN when OPENAI_API_KEY is unset (dev) or when the API itself
 * errors — we don't want a moderation outage to take down the chat. The
 * failure is logged once per process.
 */
const MODERATION_URL = 'https://api.openai.com/v1/moderations';
const MODEL = 'omni-moderation-latest';

let warned = false;
function warnOnce(reason) {
  if (warned) return;
  // eslint-disable-next-line no-console
  console.warn(`[moderation] ${reason} — failing open`);
  warned = true;
}

/**
 * @param {string} text  User-submitted text to moderate. Empty/null → skipped.
 * @returns {Promise<{ flagged: boolean, categories?: object, scores?: object, skipped?: boolean }>}
 */
export async function moderateText(text) {
  if (typeof text !== 'string' || !text.trim()) return { flagged: false, skipped: true };
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) { warnOnce('OPENAI_API_KEY not set'); return { flagged: false, skipped: true }; }

  try {
    const res = await fetch(MODERATION_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model: MODEL, input: text }),
    });
    if (!res.ok) { warnOnce(`HTTP ${res.status}`); return { flagged: false, skipped: true }; }
    const data = await res.json();
    const r = data?.results?.[0];
    if (!r) return { flagged: false, skipped: true };
    return {
      flagged: !!r.flagged,
      categories: r.categories,
      scores: r.category_scores,
    };
  } catch (e) {
    warnOnce(String(e?.message || e));
    return { flagged: false, skipped: true };
  }
}

/**
 * Convenience: returns the list of category names that crossed the
 * provider's threshold (so we can surface a specific reason to the user).
 */
export function flaggedCategories(result) {
  if (!result?.categories) return [];
  return Object.entries(result.categories)
    .filter(([, v]) => v === true)
    .map(([k]) => k);
}
