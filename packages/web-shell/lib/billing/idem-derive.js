// lib/billing/idem-derive.js
// Derive a stable idempotency key for a paid op that has no client-supplied
// ticket — the agent path (money-safety; spec 2026-07-24). The model doesn't know
// it's retrying after a false timeout: its re-call is a NEW tool_use with the same
// INPUT, so the only thing stable across the original call and its re-call is the
// content. Keying on (runId, tool, normalized input) makes the re-call dedup while
// keeping genuinely different actions (or different agent runs) distinct.
import { createHash } from 'node:crypto';

// The FIRST part is the SCOPE ANCHOR (e.g. runId): if it's absent there is no run
// to scope a stable key to → return null (no dedup, safe best-effort). But a LATER
// part being empty is a LEGITIMATE stable value — no modelId, empty edit prompt, a
// missing optional id — so it is normalized to a sentinel, NOT allowed to nullify
// the whole key. Nullifying on any-empty was a money footgun (Sol audit #2): it
// silently dropped dedup on the exact common paths (omitted modelId, empty prompt),
// re-charging retries. Callers MUST pass only STABLE identity in later parts —
// never a value that changes per attempt (e.g. a freshly-inserted placeholder id).
const SENTINEL = '∅'; // ∅
export function deriveIdemKey(parts) {
  const arr = Array.isArray(parts) ? parts : [parts];
  if (arr.length === 0 || arr[0] == null || arr[0] === '') return null;
  const h = createHash('sha256');
  h.update(arr.map((p) => (p == null || p === '' ? SENTINEL : String(p))).join('␟'));
  return `d:${h.digest('hex').slice(0, 32)}`;
}
