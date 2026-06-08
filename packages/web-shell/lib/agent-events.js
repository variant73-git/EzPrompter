/**
 * Append events to the `agent_run_events` audit log.
 *
 * This is the chronological event stream that complements `agent_runs`
 * (the aggregated summary). Used for: production debugging, LGPD/GDPR
 * right-to-access requests, cost attribution per turn, security review.
 *
 * Failure mode: NEVER throws to the agent loop. If the insert fails, we
 * log to stderr and continue — losing one telemetry event is far less
 * bad than a failed audit log call breaking the chat.
 *
 * Truncation: large payloads (LLM responses, tool results with images,
 * captured HTML) are truncated at MAX_PAYLOAD_BYTES before insert. The
 * trace is for forensics, not for full replay — the driver already
 * persists the dataUrls/HTML in the snapshot/asset tables.
 */
import { sql } from './db.js';

const MAX_PAYLOAD_BYTES = 16_000; // ~4 KB per row after JSON overhead

function truncatePayload(payload) {
  if (payload == null || typeof payload !== 'object') return payload;
  const json = JSON.stringify(payload);
  if (json.length <= MAX_PAYLOAD_BYTES) return payload;
  return {
    __truncated: true,
    __original_bytes: json.length,
    preview: json.slice(0, MAX_PAYLOAD_BYTES),
  };
}

let warned = false;
function warnOnce(reason) {
  if (warned) return;
  // eslint-disable-next-line no-console
  console.warn(`[agent-events] ${reason} — event log writes silently dropped`);
  warned = true;
}

/**
 * @param {Object} opts
 * @param {string} opts.runId
 * @param {number} opts.userId
 * @param {string} opts.type      One of the CHECK-constrained enum values in schema.sql.
 * @param {Object} [opts.payload] Structured data describing the event.
 * @param {number} [opts.durationMs]
 * @param {number} [opts.costCents]
 */
export async function logAgentEvent({ runId, userId, type, payload = null, durationMs = null, costCents = null }) {
  if (!runId || !userId || !type) return;
  try {
    await sql`
      INSERT INTO agent_run_events (run_id, user_id, type, payload, duration_ms, cost_cents)
      VALUES (
        ${runId},
        ${userId},
        ${type},
        ${JSON.stringify(truncatePayload(payload) || {})}::jsonb,
        ${durationMs},
        ${costCents}
      )
    `;
  } catch (e) {
    warnOnce(String(e?.message || e));
  }
}

/**
 * Load the event timeline for a given run. Used by /api/account/export
 * (LGPD), the debug UI (if/when built), and the public audit endpoint.
 */
export async function getRunEvents({ runId, userId, limit = 1000 }) {
  const cap = Math.min(Math.max(limit, 1), 5000);
  return await sql`
    SELECT id, ts, type, payload, duration_ms, cost_cents
    FROM agent_run_events
    WHERE run_id = ${runId} AND user_id = ${userId}
    ORDER BY ts ASC
    LIMIT ${cap}
  `;
}
