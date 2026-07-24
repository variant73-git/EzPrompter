// lib/billing/idem-derive.js
// Derive a stable idempotency key for a paid op that has no client-supplied
// ticket — the agent path (money-safety; spec 2026-07-24). The model doesn't know
// it's retrying after a false timeout: its re-call is a NEW tool_use with the same
// INPUT, so the only thing stable across the original call and its re-call is the
// content. Keying on (runId, tool, normalized input) makes the re-call dedup while
// keeping genuinely different actions (or different agent runs) distinct.
import { createHash } from 'node:crypto';

// Returns a stable hex key, or null when there is no run to scope it to (a
// Phase-1 caller with no runId) — null means "no dedup", the safe pre-existing
// behavior, never a collision.
export function deriveIdemKey(parts) {
  const arr = Array.isArray(parts) ? parts : [parts];
  if (arr.some((p) => p == null || p === '')) return null;
  const h = createHash('sha256');
  h.update(arr.map((p) => String(p)).join('␟')); // unit-separator delimiter
  return `d:${h.digest('hex').slice(0, 32)}`;
}
