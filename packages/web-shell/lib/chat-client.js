/**
 * chat-client.js — typed event-source wrapper for the chat SSE endpoint.
 *
 * Usage:
 *   const stream = createChatStream({ url: '/api/chat?runId=...' });
 *   stream.on('assistant_token', (p) => append(p.delta));
 *   stream.on('tool_call', (p) => renderChip(p));
 *   stream.on('run_status', (p) => { if (p.status === 'completed') stream.close(); });
 *
 * Event payloads are JSON-parsed automatically. Parse errors emit on 'error'.
 */
const EVENT_TYPES = [
  'thread_id', 'run_id',
  'assistant_token', 'tool_call', 'tool_status',
  'needs_confirm', 'needs_choice', 'needs_softlimit_continue',
  'run_status',
];

export function createChatStream({ url }) {
  const es = new EventSource(url, { withCredentials: true });
  const handlers = new Map(); // type → Set<callback>

  // Register listeners for every known event type upfront so JSON parse
  // errors are routed to 'error' handlers even when the user hasn't
  // subscribed to that specific event type.
  for (const type of EVENT_TYPES) {
    es.addEventListener(type, (ev) => {
      let payload;
      try { payload = JSON.parse(ev.data); }
      catch (err) {
        handlers.get('error')?.forEach((h) => h({ err, raw: ev.data }));
        return;
      }
      handlers.get(type)?.forEach((h) => h(payload));
    });
  }

  function on(type, cb) {
    if (!handlers.has(type)) handlers.set(type, new Set());
    handlers.get(type).add(cb);
  }

  function off(type, cb) {
    handlers.get(type)?.delete(cb);
  }

  function close() { es.close(); }

  return { on, off, close, knownEvents: EVENT_TYPES };
}
