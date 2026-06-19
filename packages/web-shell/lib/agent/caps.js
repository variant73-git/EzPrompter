/**
 * Agent run caps — defaults per spec §7, overridable per env.
 *
 *   UNCRAFT_AGENT_SOFT_ITER       Soft-pause iteration threshold. Default 10.
 *   UNCRAFT_AGENT_HARD_ITER       Hard-kill iteration threshold. Default 50.
 *   UNCRAFT_AGENT_RETRY_BUDGET    Per-tool retry budget per run. Default 3.
 *   UNCRAFT_AGENT_WALL_TIMEOUT_MS Wall-clock timeout for one run. Default 10min.
 */
const DEFAULTS = {
  softIterations: 10,
  hardIterations: 50,
  retryBudget: 3,
  // 10min (was 5): a single captureUrl through the reconstruct pipeline
  // takes 2-3min by itself; clone-then-work runs were dying on wall_timeout
  // with the old cap (observed 2026-06-12).
  wallTimeoutMs: 10 * 60 * 1000,
};

function asPositiveInt(raw, fallback) {
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function getCaps() {
  return {
    softIterations: asPositiveInt(process.env.UNCRAFT_AGENT_SOFT_ITER, DEFAULTS.softIterations),
    hardIterations: asPositiveInt(process.env.UNCRAFT_AGENT_HARD_ITER, DEFAULTS.hardIterations),
    retryBudget:    asPositiveInt(process.env.UNCRAFT_AGENT_RETRY_BUDGET, DEFAULTS.retryBudget),
    wallTimeoutMs:  asPositiveInt(process.env.UNCRAFT_AGENT_WALL_TIMEOUT_MS, DEFAULTS.wallTimeoutMs),
  };
}
