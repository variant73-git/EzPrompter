/**
 * LLM Guard client — prompt injection / abuse scanning.
 *
 * LLM Guard (Protect AI, MIT) is a Python-only library, so the deploy
 * shape is: run it in a sidecar container exposing an HTTP endpoint, and
 * have us call it before passing user text to the agent. Reference deploy
 * (production-ready) ships in https://github.com/protectai/llm-guard
 * under `examples/api`.
 *
 * Configure with:
 *   LLM_GUARD_URL  — base URL of the sidecar (e.g. http://llm-guard:8000)
 *   LLM_GUARD_TIMEOUT_MS  — request timeout (default 1500ms)
 *   LLM_GUARD_SCANNERS  — comma-separated list (default: PromptInjection,Anonymize,TokenLimit)
 *
 * Failure mode: fails OPEN. If the sidecar isn't reachable or times out,
 * we let the request through — security gate that itself takes down the
 * chat would be worse than no gate. The miss is logged once.
 */
const DEFAULT_TIMEOUT_MS = 1500;
const DEFAULT_SCANNERS = 'PromptInjection,Anonymize,TokenLimit';

let warned = false;
function warnOnce(reason) {
  if (warned) return;
  // eslint-disable-next-line no-console
  console.warn(`[llm-guard] ${reason} — guard checks bypassed`);
  warned = true;
}

/**
 * Scan a user-submitted prompt. Returns:
 *   { ok: true,  sanitizedPrompt }  → safe (use sanitizedPrompt; may have PII redacted)
 *   { ok: false, reason, scanners } → block
 *   { ok: true,  skipped: true }    → guard unavailable (failed open)
 *
 * Callers should treat (ok: false) as 400 with `reason` exposed to user.
 */
export async function scanPrompt(prompt) {
  if (typeof prompt !== 'string' || !prompt.trim()) return { ok: true, sanitizedPrompt: prompt, skipped: true };
  const url = process.env.LLM_GUARD_URL;
  if (!url) { warnOnce('LLM_GUARD_URL not set'); return { ok: true, sanitizedPrompt: prompt, skipped: true }; }

  const timeoutMs = parseInt(process.env.LLM_GUARD_TIMEOUT_MS || `${DEFAULT_TIMEOUT_MS}`, 10);
  const scanners = (process.env.LLM_GUARD_SCANNERS || DEFAULT_SCANNERS).split(',').map((s) => s.trim()).filter(Boolean);

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/scan/prompt`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt, scanners }),
      signal: controller.signal,
    });
    clearTimeout(t);
    if (!res.ok) { warnOnce(`HTTP ${res.status}`); return { ok: true, sanitizedPrompt: prompt, skipped: true }; }
    const data = await res.json();
    // LLM Guard's reference API returns {sanitized_prompt, is_valid, results: {scanner: bool}}
    const isValid = data?.is_valid !== false; // default to valid when shape unknown
    const sanitized = data?.sanitized_prompt || prompt;
    if (!isValid) {
      const triggered = Object.entries(data?.results || {})
        .filter(([, v]) => v === false || v === 'false')
        .map(([k]) => k);
      return {
        ok: false,
        reason: triggered.length ? `Blocked by: ${triggered.join(', ')}` : 'Blocked by content policy',
        scanners: triggered,
      };
    }
    return { ok: true, sanitizedPrompt: sanitized };
  } catch (e) {
    clearTimeout(t);
    warnOnce(`request failed: ${e?.message || e}`);
    return { ok: true, sanitizedPrompt: prompt, skipped: true };
  }
}
