/**
 * In-memory registry of in-flight agent runs that can pause/resume.
 *
 * Slice 1 = single Next.js instance. If we ever horizontally scale, this Map
 * moves to Redis with the same shape (see spec §5 "Pause/resume").
 *
 * Lifecycle per run:
 *   registerRun(runId)                              ← POST /api/chat enters loop
 *   const decision = await awaitConfirm(runId, tc)  ← driver pauses on destructive tool
 *   resolveConfirm(runId, tc, {action})             ← POST /api/chat/confirm
 *   unregisterRun(runId)                            ← run completes/fails/cancelled
 */

const runs = new Map(); // runId → { confirms: Map<tcId, resolveFn>, choices: Map<tcId, resolveFn>, continues: resolveFn|null, cancelled: bool }

export function registerRun(runId) {
  if (!runs.has(runId)) {
    runs.set(runId, {
      confirms: new Map(),
      choices: new Map(),
      continues: null,
      cancelled: false,
    });
  }
}

export function unregisterRun(runId) {
  const entry = runs.get(runId);
  if (entry) {
    // Flush any pending awaits so callers don't hang. cancelRun is idempotent
    // — safe to call even if there are no pending Promises.
    cancelRun(runId);
  }
  runs.delete(runId);
}

export function hasRun(runId) {
  return runs.has(runId);
}

export function isCancelled(runId) {
  return runs.get(runId)?.cancelled === true;
}

export function awaitConfirm(runId, toolCallId) {
  const entry = runs.get(runId);
  if (!entry) return Promise.resolve({ action: 'cancelled', reason: 'unknown_run' });
  return new Promise((resolve) => {
    entry.confirms.set(toolCallId, resolve);
  });
}

export function resolveConfirm(runId, toolCallId, decision) {
  const entry = runs.get(runId);
  if (!entry) return false;
  const fn = entry.confirms.get(toolCallId);
  if (!fn) return false;
  entry.confirms.delete(toolCallId);
  fn(decision);
  return true;
}

export function awaitChoice(runId, toolCallId) {
  const entry = runs.get(runId);
  if (!entry) return Promise.resolve({ action: 'cancelled', reason: 'unknown_run' });
  return new Promise((resolve) => {
    entry.choices.set(toolCallId, resolve);
  });
}

export function resolveChoice(runId, toolCallId, decision) {
  const entry = runs.get(runId);
  if (!entry) return false;
  const fn = entry.choices.get(toolCallId);
  if (!fn) return false;
  entry.choices.delete(toolCallId);
  fn(decision);
  return true;
}

export function awaitContinue(runId) {
  const entry = runs.get(runId);
  if (!entry) return Promise.resolve({ action: 'cancelled', reason: 'unknown_run' });
  return new Promise((resolve) => {
    if (entry.continues) {
      // A previous awaitContinue is still pending — shouldn't happen in normal
      // driver flow, but resolve it cleanly instead of orphaning the Promise.
      entry.continues({ action: 'cancelled', reason: 'overwritten' });
    }
    entry.continues = resolve;
  });
}

export function resolveContinue(runId, decision) {
  const entry = runs.get(runId);
  if (!entry || !entry.continues) return false;
  const fn = entry.continues;
  entry.continues = null;
  fn(decision);
  return true;
}

export function cancelRun(runId) {
  const entry = runs.get(runId);
  if (!entry) return false;
  entry.cancelled = true;
  // Resolve any pending awaits so the loop can clean up.
  for (const [tcId, fn] of entry.confirms.entries()) {
    fn({ action: 'cancelled' });
    entry.confirms.delete(tcId);
  }
  for (const [tcId, fn] of entry.choices.entries()) {
    fn({ action: 'cancelled' });
    entry.choices.delete(tcId);
  }
  if (entry.continues) {
    entry.continues({ action: 'cancelled' });
    entry.continues = null;
  }
  return true;
}

/** Test-only — clears the singleton between vitest runs. */
export function _resetForTests() {
  runs.clear();
}
