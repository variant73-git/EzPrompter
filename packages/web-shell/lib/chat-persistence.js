/**
 * chat-persistence.js — DB layer for chat threads + messages.
 *
 * One active board-scope thread per board (enforced by unique index).
 * One active asset-scope thread per asset (same).
 * Messages are append-only — never edit or delete (chat history is a log).
 */
import { sql } from './db.js';

/**
 * Find the active thread for (boardId, scope[, assetId]) or create one.
 * scope='board' → asset must be null.
 * scope='asset' → assetId required.
 */
export async function getOrCreateActiveThread({ boardId, userId, scope = 'board', assetId = null }) {
  if (scope === 'asset' && !assetId) throw new Error('assetId required when scope=asset');
  const existing = scope === 'board'
    ? await sql`
        SELECT * FROM chat_threads
        WHERE board_id = ${boardId} AND scope = 'board' AND status = 'active'
        LIMIT 1
      `
    : await sql`
        SELECT * FROM chat_threads
        WHERE asset_id = ${assetId} AND scope = 'asset' AND status = 'active'
        LIMIT 1
      `;
  if (existing.length) return existing[0];

  const [created] = await sql`
    INSERT INTO chat_threads (board_id, user_id, scope, asset_id, status)
    VALUES (${boardId}, ${userId}, ${scope}, ${assetId}, 'active')
    RETURNING *
  `;
  return created;
}

/**
 * Append a message to a thread. Returns the created row.
 * - role='user'      → content required
 * - role='assistant' → content + optional toolCalls + model + agentRunId
 * - role='tool'      → content (= tool result) + toolCallId required
 * - role='system'    → reserved (rarely used; system prompt is sent as message, not persisted)
 */
export async function appendMessage({
  threadId, role, content = null, toolCalls = null, toolCallId = null, model = null, agentRunId = null,
}) {
  if (!['user', 'assistant', 'tool', 'system'].includes(role)) throw new Error(`bad role: ${role}`);
  if (role === 'user' && !content) throw new Error('user role requires content');
  if (role === 'tool' && !toolCallId) throw new Error('tool role requires toolCallId');

  const [created] = await sql`
    INSERT INTO chat_messages (thread_id, role, content, tool_calls, tool_call_id, model, agent_run_id)
    VALUES (
      ${threadId}, ${role}, ${content},
      ${toolCalls ? JSON.stringify(toolCalls) : null}::jsonb,
      ${toolCallId}, ${model}, ${agentRunId}
    )
    RETURNING *
  `;
  return created;
}

/**
 * Load the last N messages for a thread, oldest first.
 * Frontend reverses for display if it wants newest-at-bottom semantics.
 */
export async function loadMessages({ threadId, limit = 50, before = null }) {
  const rows = before
    ? await sql`
        SELECT * FROM chat_messages
        WHERE thread_id = ${threadId} AND created_at < (SELECT created_at FROM chat_messages WHERE id = ${before})
        ORDER BY created_at DESC LIMIT ${limit}
      `
    : await sql`
        SELECT * FROM chat_messages
        WHERE thread_id = ${threadId}
        ORDER BY created_at DESC LIMIT ${limit}
      `;
  return rows.reverse();
}

/**
 * Archive the current active thread for (boardId, scope[, assetId]).
 * Returns the archived thread row or null if none was active.
 */
export async function archiveActiveThread({ boardId, scope = 'board', assetId = null }) {
  if (scope === 'asset' && !assetId) throw new Error('assetId required when scope=asset');
  const rows = scope === 'board'
    ? await sql`
        UPDATE chat_threads SET status = 'archived', archived_at = NOW()
        WHERE board_id = ${boardId} AND scope = 'board' AND status = 'active'
        RETURNING *
      `
    : await sql`
        UPDATE chat_threads SET status = 'archived', archived_at = NOW()
        WHERE asset_id = ${assetId} AND scope = 'asset' AND status = 'active'
        RETURNING *
      `;
  return rows[0] || null;
}

/** Insert a new agent_runs row in status=running. Returns the row. */
export async function startAgentRun({ threadId }) {
  const [r] = await sql`
    INSERT INTO agent_runs (thread_id, status, iterations, tool_call_counts)
    VALUES (${threadId}, 'running', 0, '{}'::jsonb)
    RETURNING *
  `;
  return r;
}

/** Update just the status (e.g. running → paused_confirm). Returns the row. */
export async function updateAgentRunStatus({ runId, status }) {
  const [r] = await sql`
    UPDATE agent_runs SET status = ${status} WHERE id = ${runId} RETURNING *
  `;
  return r;
}

/**
 * Finalize the run: set status + iterations + tool_call_counts + completed_at + err.
 * `status` is one of: completed|failed|cancelled|hard_limited.
 * `tokensIn`, `tokensOut`, `costCents` are optional — persisted when provided.
 */
export async function finishAgentRun({
  runId, status, iterations,
  toolCallCounts = {}, err = null,
  tokensIn = null, tokensOut = null, costCents = null,
}) {
  const [r] = await sql`
    UPDATE agent_runs
       SET status = ${status},
           iterations = ${iterations},
           tool_call_counts = ${JSON.stringify(toolCallCounts)}::jsonb,
           err = ${err},
           tokens_in = ${tokensIn},
           tokens_out = ${tokensOut},
           cost_cents = ${costCents},
           completed_at = NOW()
     WHERE id = ${runId}
     RETURNING *
  `;
  return r;
}
