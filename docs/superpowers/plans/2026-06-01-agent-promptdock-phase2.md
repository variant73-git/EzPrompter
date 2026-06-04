# Agent PromptDock — Phase 2 Implementation Plan (destructive tools + caps + confirm/cancel flow)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship destructive tool support in the canvas agent. End of Phase 2: user types "delete every prompt node" or "run the flow on node X" and the agent pauses on each destructive action with a confirm chip; user clicks Confirm or Skip; run resumes. Anti-loop caps prevent runaway agents (soft pause at 10 iterations, hard kill at 50, 3-retry budget per tool, 5min wall clock).

**Architecture:** A singleton in-memory `Map<runId, ResumeHandles>` keyed by `agent_runs.id` is shared between the agent driver loop (inside `POST /api/chat`) and three control routes (`POST /api/chat/confirm|continue|cancel`). When the driver hits a destructive tool, it emits `needs_confirm` over SSE and awaits a Promise stored in the map; the control route looks up the runId and resolves it. The `agent_runs` table tracks status transitions (`running` → `paused_confirm` → `running` → `completed|failed|hard_limited|cancelled`). 3 new destructive tools (`deleteNode`, `runFlow`, `editSite`) wrap existing API logic.

**Tech Stack:** Next.js 15 App Router (Node.js runtime), `@anthropic-ai/sdk` / `openai` / `@google/genai` (all installed), Postgres via `@neondatabase/serverless`, Vitest for unit + integration tests.

**Out of scope for Phase 2 (deferred to Phase 3+):**
- `createImage` tool — depends on a new `POST /api/images/generate` route with provider routing (Gemini Imagen + OpenAI gpt-image-1) and the `needs_choice` event flow. Phase 3 ships both together.
- Smart Edit chat dock wire-up — Phase 4.
- Chat history reconstruction (assistant messages + tool_calls JSONB on reload) — Phase 5b.
- Cost tracking enforcement — Phase 5c.
- Horizontal scaling of the runMap (Redis-backed) — Phase 6 if/when needed.

**Working directory:** `/Users/adilsonporto/Desktop/IA/Uncraft`. Branch: `feat/canvas` (will keep going on the same branch; commits will be granular and squashable).

**Source-of-truth files:**
- Spec at `docs/superpowers/specs/2026-05-31-agent-promptdock-design.md`
- Phase 1 plan at `docs/superpowers/plans/2026-05-31-agent-promptdock-phase1.md` (mirror its style)
- Handoff at `docs/superpowers/handoffs/2026-05-31-agent-promptdock-handoff.md` (what's currently shipped)

---

## Phase 0 — Hygiene cleanup before adding more

### Task 0.1: Remove debug log from PromptDock SSE handler

**Files:**
- Modify: `packages/web-shell/components/PromptDock.jsx:296`

- [ ] **Step 1: Locate the line**

Open `packages/web-shell/components/PromptDock.jsx` and find:

```js
console.log('[chat-sse]', name, payload);
```

This was added during Phase 1 to debug Gemini Flash adapter behavior; it shouldn't ship.

- [ ] **Step 2: Delete the line**

Remove just that single line.

- [ ] **Step 3: Verify no other debug logs remain in chat path**

```bash
grep -n "console.log.*chat-sse\|console.log.*\[chat\]" packages/web-shell/components/PromptDock.jsx
```

Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add packages/web-shell/components/PromptDock.jsx
git commit -m "chore(chat): remove SSE debug log in PromptDock"
```

---

## Phase 1 — Run map + cap configuration (foundation)

### Task 1.1: lib/agent/run-map.js — singleton resumable-run registry

**Files:**
- Create: `packages/web-shell/lib/agent/run-map.js`
- Create: `packages/web-shell/lib/agent/run-map.test.js`

The map is keyed by `runId` (= `agent_runs.id` UUID). Each entry holds Promise resolvers for confirm / choice / continue plus a cancellation flag. The driver loop calls `awaitConfirm(runId, toolCallId)` which registers a Promise and returns it; the control route calls `resolveConfirm(runId, toolCallId, decision)` which resolves it.

- [ ] **Step 1: Write the failing test**

Create `packages/web-shell/lib/agent/run-map.test.js`:

```js
import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerRun, unregisterRun, hasRun,
  awaitConfirm, resolveConfirm,
  awaitChoice, resolveChoice,
  awaitContinue, resolveContinue,
  cancelRun, isCancelled,
  _resetForTests,
} from './run-map.js';

beforeEach(() => _resetForTests());

describe('run-map', () => {
  it('registers and unregisters a run', () => {
    registerRun('run-1');
    expect(hasRun('run-1')).toBe(true);
    unregisterRun('run-1');
    expect(hasRun('run-1')).toBe(false);
  });

  it('awaitConfirm resolves when resolveConfirm is called', async () => {
    registerRun('run-1');
    const p = awaitConfirm('run-1', 'tc-1');
    resolveConfirm('run-1', 'tc-1', { action: 'confirm' });
    await expect(p).resolves.toEqual({ action: 'confirm' });
  });

  it('awaitConfirm for unknown toolCallId rejects via control-route 404 contract', () => {
    registerRun('run-1');
    const ok = resolveConfirm('run-1', 'no-such-tc', { action: 'confirm' });
    expect(ok).toBe(false);
  });

  it('awaitChoice resolves with the user-picked option', async () => {
    registerRun('run-1');
    const p = awaitChoice('run-1', 'tc-1');
    resolveChoice('run-1', 'tc-1', { choice: 'gemini' });
    await expect(p).resolves.toEqual({ choice: 'gemini' });
  });

  it('awaitContinue resolves when soft-pause is unblocked', async () => {
    registerRun('run-1');
    const p = awaitContinue('run-1');
    resolveContinue('run-1', { action: 'continue' });
    await expect(p).resolves.toEqual({ action: 'continue' });
  });

  it('cancelRun marks the run cancelled and isCancelled reports it', () => {
    registerRun('run-1');
    expect(isCancelled('run-1')).toBe(false);
    cancelRun('run-1');
    expect(isCancelled('run-1')).toBe(true);
  });

  it('cancelRun resolves any pending awaits with cancelled action', async () => {
    registerRun('run-1');
    const pConfirm = awaitConfirm('run-1', 'tc-1');
    const pChoice = awaitChoice('run-1', 'tc-2');
    const pCont = awaitContinue('run-1');
    cancelRun('run-1');
    await expect(pConfirm).resolves.toMatchObject({ action: 'cancelled' });
    await expect(pChoice).resolves.toMatchObject({ action: 'cancelled' });
    await expect(pCont).resolves.toMatchObject({ action: 'cancelled' });
  });

  it('unregisterRun cleans up so subsequent resolve returns false', () => {
    registerRun('run-1');
    unregisterRun('run-1');
    const ok = resolveConfirm('run-1', 'tc-1', { action: 'confirm' });
    expect(ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test (FAIL — module missing)**

```bash
cd packages/web-shell && npm test -- lib/agent/run-map.test.js
```

Expected: FAIL with `Cannot find module './run-map.js'`.

- [ ] **Step 3: Implement run-map.js**

```js
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
```

- [ ] **Step 4: Run test (PASS)**

```bash
npm test -- lib/agent/run-map.test.js
```

Expected: 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/web-shell/lib/agent/run-map.js packages/web-shell/lib/agent/run-map.test.js
git commit -m "feat(agent): in-memory run map for pause/resume"
```

---

### Task 1.2: lib/agent/caps.js — env-driven cap config

**Files:**
- Create: `packages/web-shell/lib/agent/caps.js`
- Create: `packages/web-shell/lib/agent/caps.test.js`

- [ ] **Step 1: Write failing test**

```js
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getCaps } from './caps.js';

const env = { ...process.env };
beforeEach(() => {
  delete process.env.UNCRAFT_AGENT_SOFT_ITER;
  delete process.env.UNCRAFT_AGENT_HARD_ITER;
  delete process.env.UNCRAFT_AGENT_RETRY_BUDGET;
  delete process.env.UNCRAFT_AGENT_WALL_TIMEOUT_MS;
});
afterEach(() => { process.env = { ...env }; });

describe('getCaps', () => {
  it('returns spec defaults when no env set', () => {
    expect(getCaps()).toEqual({
      softIterations: 10,
      hardIterations: 50,
      retryBudget: 3,
      wallTimeoutMs: 5 * 60 * 1000,
    });
  });

  it('respects env overrides', () => {
    process.env.UNCRAFT_AGENT_SOFT_ITER = '2';
    process.env.UNCRAFT_AGENT_HARD_ITER = '5';
    process.env.UNCRAFT_AGENT_RETRY_BUDGET = '1';
    process.env.UNCRAFT_AGENT_WALL_TIMEOUT_MS = '30000';
    expect(getCaps()).toEqual({
      softIterations: 2,
      hardIterations: 5,
      retryBudget: 1,
      wallTimeoutMs: 30000,
    });
  });

  it('falls back to defaults on invalid env values', () => {
    process.env.UNCRAFT_AGENT_SOFT_ITER = 'not a number';
    process.env.UNCRAFT_AGENT_HARD_ITER = '-1';
    expect(getCaps().softIterations).toBe(10);
    expect(getCaps().hardIterations).toBe(50);
  });
});
```

- [ ] **Step 2: Run (FAIL)**

```bash
npm test -- lib/agent/caps.test.js
```

Expected: FAIL.

- [ ] **Step 3: Implement caps.js**

```js
/**
 * Agent run caps — defaults per spec §7, overridable per env.
 *
 *   UNCRAFT_AGENT_SOFT_ITER       Soft-pause iteration threshold. Default 10.
 *   UNCRAFT_AGENT_HARD_ITER       Hard-kill iteration threshold. Default 50.
 *   UNCRAFT_AGENT_RETRY_BUDGET    Per-tool retry budget per run. Default 3.
 *   UNCRAFT_AGENT_WALL_TIMEOUT_MS Wall-clock timeout for one run. Default 5min.
 */
const DEFAULTS = {
  softIterations: 10,
  hardIterations: 50,
  retryBudget: 3,
  wallTimeoutMs: 5 * 60 * 1000,
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
```

- [ ] **Step 4: Run (PASS)**

```bash
npm test -- lib/agent/caps.test.js
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/web-shell/lib/agent/caps.js packages/web-shell/lib/agent/caps.test.js
git commit -m "feat(agent): env-driven cap config (soft/hard/retry/wall)"
```

---

## Phase 2 — Driver: destructive flow + caps + cancel

### Task 2.1: Driver accepts caps + runId, tracks iteration counter

The driver already has a `maxIterations` param (used as the hard cap in Phase 1). Phase 2 expands this into the full cap config and surfaces the iteration counter so the soft-pause logic can fire mid-run.

**Files:**
- Modify: `packages/web-shell/lib/agent/driver.js`
- Create: `packages/web-shell/lib/agent/driver.test.js` (Phase 1 had no tests for the driver itself; we add them now)

- [ ] **Step 1: Write failing test for caps wiring**

Create `packages/web-shell/lib/agent/driver.test.js`:

```js
import { describe, it, expect, vi } from 'vitest';
import { runAgentLoop } from './driver.js';
import { Registry } from './registry.js';

function buildRegistry(toolDefs) {
  const r = new Registry();
  for (const def of toolDefs) r.register(def);
  return r;
}

function buildLLM(scenarios) {
  // Each call to the LLM dequeues one scenario from the list.
  // Scenario shape: { events: [...], finalContent: [...], stop_reason }
  const queue = [...scenarios];
  return vi.fn(async ({ onEvent }) => {
    const s = queue.shift();
    if (!s) throw new Error('llm called more times than scenarios');
    for (const ev of s.events || []) onEvent(ev);
    return { content: s.finalContent || [], stop_reason: s.stop_reason, usage: { input_tokens: 1, output_tokens: 1 } };
  });
}

describe('runAgentLoop — caps', () => {
  it('hard-limits when iterations exceed hardIterations cap', async () => {
    const reg = buildRegistry([{
      name: 'noop', classification: 'safe',
      inputSchema: { type: 'object' },
      execute: async () => ({ ok: true }),
    }]);
    const llm = buildLLM([
      { events: [{ type: 'tool_use', id: 't1', name: 'noop', input: {} }],
        finalContent: [{ type: 'tool_use', id: 't1', name: 'noop', input: {} }],
        stop_reason: 'tool_use' },
      { events: [{ type: 'tool_use', id: 't2', name: 'noop', input: {} }],
        finalContent: [{ type: 'tool_use', id: 't2', name: 'noop', input: {} }],
        stop_reason: 'tool_use' },
      { events: [{ type: 'tool_use', id: 't3', name: 'noop', input: {} }],
        finalContent: [{ type: 'tool_use', id: 't3', name: 'noop', input: {} }],
        stop_reason: 'tool_use' },
    ]);
    const events = [];
    await runAgentLoop({
      llm, registry: reg, systemPrompt: 's', messages: [{ role: 'user', content: 'go' }],
      modelId: 'm', apiKey: 'k', ctx: {},
      onEvent: (ev) => events.push(ev),
      caps: { softIterations: 99, hardIterations: 2, retryBudget: 3, wallTimeoutMs: 60000 },
    });
    const status = events.find((e) => e.type === 'run_status');
    expect(status.status).toBe('hard_limited');
  });
});
```

- [ ] **Step 2: Run (FAIL — driver doesn't accept `caps` yet)**

```bash
npm test -- lib/agent/driver.test.js
```

Expected: FAIL (cap not honored — test asserts hard_limited at 2 iter; current driver uses `maxIterations` only).

- [ ] **Step 3: Update driver to accept and honor caps**

Modify `packages/web-shell/lib/agent/driver.js`. Replace the function signature and the iteration-cap branch:

```js
/**
 * Agent loop driver. Generic over LLM adapter (Claude / OpenAI / Gemini wired in Phase 5a).
 *
 *   while not done:
 *     1. Call LLM with current message history + tool spec.
 *     2. Stream text deltas + tool_use events out via onEvent.
 *     3. If stop_reason='tool_use', execute each tool call:
 *        - safe → run immediately
 *        - destructive → emit needs_confirm, await user decision via runMap
 *        - needs_choice (Phase 3) → emit needs_choice, await with choice
 *     4. If stop_reason='end_turn', exit loop.
 *     5. Soft-pause when iterations ≥ softIterations (env-configurable, default 10).
 *     6. Hard-kill when iterations ≥ hardIterations (default 50).
 *     7. Per-tool retry budget — 3 failures of the same tool short-circuit the 4th call.
 *     8. Wall-clock timeout (5min default) wraps the loop in Promise.race.
 */
import {
  awaitConfirm, awaitChoice, awaitContinue,
  isCancelled,
} from './run-map.js';

const DEFAULT_CAPS = {
  softIterations: 10,
  hardIterations: 50,
  retryBudget: 3,
  wallTimeoutMs: 5 * 60 * 1000,
};

export async function runAgentLoop(opts) {
  const {
    llm, registry, systemPrompt, messages, modelId, apiKey, ctx, onEvent,
    toolAllowlist = null,
    tools: providedTools = null,
    runId = null,                 // null = Phase 1 callers without pause/resume support
    caps = DEFAULT_CAPS,
  } = opts;

  const tools = providedTools || registry.toAnthropicSpec(toolAllowlist);
  const history = [...messages];
  const totalUsage = { input_tokens: 0, output_tokens: 0 };
  const toolCounts = {};        // toolName → invocation count
  const toolFailures = {};      // toolName → consecutive failures (resets on success)
  let iterations = 0;
  let lastSoftPauseAt = 0;       // last iteration count at which we paused

  // Wall-clock timer.
  let wallExpired = false;
  const wallTimer = setTimeout(() => { wallExpired = true; }, caps.wallTimeoutMs);

  try {
    while (true) {
      if (runId && isCancelled(runId)) {
        onEvent({ type: 'run_status', status: 'cancelled' });
        return { stop_reason: 'cancelled', iterations, usage: totalUsage, toolCounts };
      }
      if (wallExpired) {
        onEvent({ type: 'run_status', status: 'failed', err: 'wall_timeout' });
        return { stop_reason: 'wall_timeout', iterations, usage: totalUsage, toolCounts };
      }
      if (iterations >= caps.hardIterations) {
        onEvent({ type: 'run_status', status: 'hard_limited' });
        return { stop_reason: 'hard_limited', iterations, usage: totalUsage, toolCounts };
      }

      // Soft pause: pause every `softIterations` steps (10, 20, 30, …).
      if (runId && iterations > 0 && iterations - lastSoftPauseAt >= caps.softIterations) {
        onEvent({
          type: 'needs_softlimit_continue',
          id: `soft-${iterations}`,
          iterationsSoFar: iterations,
          breakdown: { ...toolCounts },
        });
        const decision = await awaitContinue(runId);
        if (decision.action !== 'continue') {
          onEvent({ type: 'run_status', status: 'cancelled' });
          return { stop_reason: 'cancelled_softpause', iterations, usage: totalUsage, toolCounts };
        }
        lastSoftPauseAt = iterations;
      }
      iterations++;

      // ── LLM call ───────────────────────────────────────────────────────
      const toolCalls = [];
      const finalMsg = await llm({
        model: modelId, system: systemPrompt, messages: history, tools, apiKey,
        onEvent: (ev) => {
          if (ev.type === 'tool_use') toolCalls.push(ev);
          if (ev.type === 'message_complete') {
            totalUsage.input_tokens  += ev.usage?.input_tokens  || 0;
            totalUsage.output_tokens += ev.usage?.output_tokens || 0;
          }
          onEvent(ev);
        },
      });
      history.push({ role: 'assistant', content: finalMsg.content });

      if (finalMsg.stop_reason === 'end_turn' || finalMsg.stop_reason === 'stop_sequence') {
        onEvent({ type: 'run_status', status: 'completed' });
        return { stop_reason: 'end_turn', iterations, usage: totalUsage, toolCounts };
      }
      if (finalMsg.stop_reason !== 'tool_use') {
        onEvent({ type: 'run_status', status: 'failed', err: `unexpected stop_reason: ${finalMsg.stop_reason}` });
        return { stop_reason: 'failed', iterations, usage: totalUsage, toolCounts };
      }

      // ── Execute tool calls ────────────────────────────────────────────
      const toolResultsForHistory = [];
      for (const call of toolCalls) {
        const tool = registry.get(call.name);
        toolCounts[call.name] = (toolCounts[call.name] || 0) + 1;

        if (!tool) {
          const err = { error: 'unknown_tool', message: `no tool named ${call.name}` };
          onEvent({ type: 'tool_status', id: call.id, status: 'error', error: err.message });
          toolResultsForHistory.push({ tool_use_id: call.id, content: JSON.stringify(err), is_error: true });
          continue;
        }

        // Retry budget check: short-circuit if this tool already failed `retryBudget` times.
        if ((toolFailures[call.name] || 0) >= caps.retryBudget) {
          const err = { error: 'too_many_failures', message: `tool ${call.name} failed too many times in this run` };
          onEvent({ type: 'tool_status', id: call.id, status: 'error', error: err.message });
          toolResultsForHistory.push({ tool_use_id: call.id, content: JSON.stringify(err), is_error: true });
          continue;
        }

        // ── Classification routing ──────────────────────────────────────
        let decision = null;
        if (tool.classification === 'destructive') {
          if (!runId) {
            // No runId means caller doesn't support pause (legacy Phase 1 path).
            // Treat as auto-confirm but log a warning so we notice in dev.
            console.warn(`[agent] destructive tool ${call.name} executed without runId — pause/resume unavailable`);
            decision = { action: 'confirm' };
          } else {
            onEvent({
              type: 'needs_confirm',
              id: call.id,
              name: call.name,
              args: call.input,
              summary: summarizeDestructiveCall(call.name, call.input),
            });
            decision = await awaitConfirm(runId, call.id);
          }
        } else if (tool.classification === 'needs_choice') {
          // Phase 3 wires this for real; Phase 2 still emits the event for the UI.
          if (!runId) {
            decision = { action: 'confirm', choice: null };
          } else {
            onEvent({
              type: 'needs_choice',
              id: call.id,
              name: call.name,
              args: call.input,
              summary: summarizeDestructiveCall(call.name, call.input),
              choices: tool.choices?.(call.input, ctx) || [],
            });
            decision = await awaitChoice(runId, call.id);
          }
        } else {
          decision = { action: 'confirm' };
        }

        if (decision.action === 'skip') {
          onEvent({ type: 'tool_status', id: call.id, status: 'skipped' });
          toolResultsForHistory.push({
            tool_use_id: call.id,
            content: JSON.stringify({ skipped: true, reason: 'user_skipped' }),
          });
          continue;
        }
        if (decision.action === 'cancelled') {
          // Surface to outer loop on next iter via isCancelled() check.
          onEvent({ type: 'tool_status', id: call.id, status: 'skipped' });
          toolResultsForHistory.push({
            tool_use_id: call.id,
            content: JSON.stringify({ skipped: true, reason: 'cancelled' }),
          });
          continue;
        }

        // ── Execute ─────────────────────────────────────────────────────
        onEvent({ type: 'tool_status', id: call.id, status: 'running' });
        try {
          const result = await tool.execute(call.input, { ...ctx, choice: decision.choice || null });
          if (result && result.error) {
            toolFailures[call.name] = (toolFailures[call.name] || 0) + 1;
            onEvent({ type: 'tool_status', id: call.id, status: 'error', error: result.message || result.error });
            toolResultsForHistory.push({ tool_use_id: call.id, content: JSON.stringify(result), is_error: true });
          } else {
            toolFailures[call.name] = 0;
            onEvent({ type: 'tool_status', id: call.id, status: 'done', result });
            toolResultsForHistory.push({ tool_use_id: call.id, content: JSON.stringify(result) });
          }
        } catch (e) {
          toolFailures[call.name] = (toolFailures[call.name] || 0) + 1;
          const errPayload = { error: 'execution_failed', message: String(e?.message || e) };
          onEvent({ type: 'tool_status', id: call.id, status: 'error', error: errPayload.message });
          toolResultsForHistory.push({ tool_use_id: call.id, content: JSON.stringify(errPayload), is_error: true });
        }
      }

      history.push({
        role: 'user',
        content: toolResultsForHistory.map((r) => ({
          type: 'tool_result',
          tool_use_id: r.tool_use_id,
          content: r.content,
          ...(r.is_error ? { is_error: true } : {}),
        })),
      });
    }
  } finally {
    clearTimeout(wallTimer);
  }
}

/** Short human-readable summary shown in confirm chips. Per-tool overrides preferred. */
function summarizeDestructiveCall(name, args) {
  switch (name) {
    case 'deleteNode': return `Delete node ${String(args?.id || '').slice(0, 8)}`;
    case 'runFlow':    return `Run flow on node ${String(args?.nodeId || '').slice(0, 8)}${args?.modelId ? ` with ${args.modelId}` : ''}`;
    case 'editSite':   return `Edit site ${String(args?.nodeId || '').slice(0, 8)} — "${(args?.instruction || '').slice(0, 60)}"`;
    case 'createImage': return `Generate image — "${(args?.prompt || '').slice(0, 60)}"`;
    default:           return `${name}(...)`;
  }
}
```

- [ ] **Step 4: Run hard-limit test (PASS)**

```bash
npm test -- lib/agent/driver.test.js
```

Expected: `hard-limits when iterations exceed hardIterations cap` passes.

- [ ] **Step 5: Add soft-pause test**

Append to `lib/agent/driver.test.js`:

```js
import { registerRun, resolveContinue, _resetForTests } from './run-map.js';

describe('runAgentLoop — soft pause', () => {
  it('emits needs_softlimit_continue and waits for resolveContinue', async () => {
    _resetForTests();
    registerRun('run-soft');
    const reg = buildRegistry([{
      name: 'noop', classification: 'safe',
      inputSchema: { type: 'object' },
      execute: async () => ({ ok: true }),
    }]);
    const llm = buildLLM([
      { events: [{ type: 'tool_use', id: 't1', name: 'noop', input: {} }],
        finalContent: [{ type: 'tool_use', id: 't1', name: 'noop', input: {} }],
        stop_reason: 'tool_use' },
      { events: [{ type: 'tool_use', id: 't2', name: 'noop', input: {} }],
        finalContent: [{ type: 'tool_use', id: 't2', name: 'noop', input: {} }],
        stop_reason: 'tool_use' },
      { events: [], finalContent: [{ type: 'text', text: 'done' }], stop_reason: 'end_turn' },
    ]);
    const events = [];
    const loopP = runAgentLoop({
      llm, registry: reg, systemPrompt: 's', messages: [{ role: 'user', content: 'go' }],
      modelId: 'm', apiKey: 'k', ctx: {}, runId: 'run-soft',
      onEvent: (ev) => events.push(ev),
      caps: { softIterations: 2, hardIterations: 99, retryBudget: 3, wallTimeoutMs: 60000 },
    });
    // Wait one microtask cycle for the loop to emit the soft-pause event.
    await new Promise((r) => setTimeout(r, 10));
    expect(events.some((e) => e.type === 'needs_softlimit_continue')).toBe(true);
    resolveContinue('run-soft', { action: 'continue' });
    const result = await loopP;
    expect(result.stop_reason).toBe('end_turn');
  });
});
```

- [ ] **Step 6: Run (PASS)**

```bash
npm test -- lib/agent/driver.test.js
```

Expected: both tests pass.

- [ ] **Step 7: Add destructive confirm test**

Append:

```js
import { resolveConfirm } from './run-map.js';

describe('runAgentLoop — destructive confirm', () => {
  it('emits needs_confirm and awaits user decision', async () => {
    _resetForTests();
    registerRun('run-conf');
    const reg = buildRegistry([{
      name: 'zap', classification: 'destructive',
      inputSchema: { type: 'object' },
      execute: async (args) => ({ ok: true, args }),
    }]);
    const llm = buildLLM([
      { events: [{ type: 'tool_use', id: 'tc-1', name: 'zap', input: { x: 1 } }],
        finalContent: [{ type: 'tool_use', id: 'tc-1', name: 'zap', input: { x: 1 } }],
        stop_reason: 'tool_use' },
      { events: [], finalContent: [{ type: 'text', text: 'done' }], stop_reason: 'end_turn' },
    ]);
    const events = [];
    const loopP = runAgentLoop({
      llm, registry: reg, systemPrompt: 's', messages: [{ role: 'user', content: 'go' }],
      modelId: 'm', apiKey: 'k', ctx: {}, runId: 'run-conf',
      onEvent: (ev) => events.push(ev),
      caps: { softIterations: 99, hardIterations: 99, retryBudget: 3, wallTimeoutMs: 60000 },
    });
    await new Promise((r) => setTimeout(r, 10));
    const confirmEv = events.find((e) => e.type === 'needs_confirm');
    expect(confirmEv).toBeTruthy();
    expect(confirmEv.name).toBe('zap');
    resolveConfirm('run-conf', 'tc-1', { action: 'confirm' });
    await loopP;
    expect(events.some((e) => e.type === 'tool_status' && e.status === 'done')).toBe(true);
  });

  it('skips destructive tool when user clicks Skip', async () => {
    _resetForTests();
    registerRun('run-skip');
    const reg = buildRegistry([{
      name: 'zap', classification: 'destructive',
      inputSchema: { type: 'object' },
      execute: async () => { throw new Error('should not be called'); },
    }]);
    const llm = buildLLM([
      { events: [{ type: 'tool_use', id: 'tc-1', name: 'zap', input: {} }],
        finalContent: [{ type: 'tool_use', id: 'tc-1', name: 'zap', input: {} }],
        stop_reason: 'tool_use' },
      { events: [], finalContent: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn' },
    ]);
    const events = [];
    const loopP = runAgentLoop({
      llm, registry: reg, systemPrompt: 's', messages: [{ role: 'user', content: 'go' }],
      modelId: 'm', apiKey: 'k', ctx: {}, runId: 'run-skip',
      onEvent: (ev) => events.push(ev),
      caps: { softIterations: 99, hardIterations: 99, retryBudget: 3, wallTimeoutMs: 60000 },
    });
    await new Promise((r) => setTimeout(r, 10));
    resolveConfirm('run-skip', 'tc-1', { action: 'skip' });
    await loopP;
    expect(events.some((e) => e.type === 'tool_status' && e.status === 'skipped')).toBe(true);
  });
});
```

- [ ] **Step 8: Run (PASS)**

```bash
npm test -- lib/agent/driver.test.js
```

Expected: 4 tests pass.

- [ ] **Step 9: Add retry-budget test**

Append:

```js
describe('runAgentLoop — retry budget', () => {
  it('short-circuits 4th call with too_many_failures after 3 errors', async () => {
    _resetForTests();
    const reg = buildRegistry([{
      name: 'flaky', classification: 'safe',
      inputSchema: { type: 'object' },
      execute: async () => ({ error: 'execution_failed', message: 'boom' }),
    }]);
    const llm = buildLLM([
      ...Array.from({ length: 4 }).map(() => ({
        events: [{ type: 'tool_use', id: `tc-${Math.random()}`, name: 'flaky', input: {} }],
        finalContent: [{ type: 'tool_use', id: `tc-${Math.random()}`, name: 'flaky', input: {} }],
        stop_reason: 'tool_use',
      })),
      { events: [], finalContent: [{ type: 'text', text: 'give up' }], stop_reason: 'end_turn' },
    ]);
    const events = [];
    await runAgentLoop({
      llm, registry: reg, systemPrompt: 's', messages: [{ role: 'user', content: 'go' }],
      modelId: 'm', apiKey: 'k', ctx: {},
      onEvent: (ev) => events.push(ev),
      caps: { softIterations: 99, hardIterations: 99, retryBudget: 3, wallTimeoutMs: 60000 },
    });
    const errors = events.filter((e) => e.type === 'tool_status' && e.status === 'error');
    expect(errors.length).toBeGreaterThanOrEqual(4);
    expect(errors[3].error).toMatch(/too many failures/i);
  });
});
```

- [ ] **Step 10: Run (PASS)**

```bash
npm test -- lib/agent/driver.test.js
```

Expected: 5 tests pass.

- [ ] **Step 11: Commit**

```bash
git add packages/web-shell/lib/agent/driver.js packages/web-shell/lib/agent/driver.test.js
git commit -m "feat(agent): driver caps + destructive confirm + retry budget + soft pause"
```

---

## Phase 3 — agent_runs persistence

### Task 3.1: chat-persistence — agent run helpers

**Files:**
- Modify: `packages/web-shell/lib/chat-persistence.js`
- Modify: `packages/web-shell/lib/chat-persistence.test.js`

- [ ] **Step 1: Write failing test**

Append to `lib/chat-persistence.test.js`:

```js
import { startAgentRun, updateAgentRunStatus, finishAgentRun } from './chat-persistence.js';

describe('agent_runs helpers', () => {
  it('startAgentRun inserts a row with status=running and returns it', async () => {
    sql._nextResult = [{ id: 'run-1', thread_id: 't1', status: 'running', iterations: 0 }];
    const r = await startAgentRun({ threadId: 't1' });
    expect(r.id).toBe('run-1');
    expect(r.status).toBe('running');
  });

  it('updateAgentRunStatus updates status', async () => {
    sql._nextResult = [{ id: 'run-1', status: 'paused_confirm' }];
    const r = await updateAgentRunStatus({ runId: 'run-1', status: 'paused_confirm' });
    expect(r.status).toBe('paused_confirm');
  });

  it('finishAgentRun updates status + iterations + tool_call_counts + completed_at', async () => {
    sql._nextResult = [{ id: 'run-1', status: 'completed', iterations: 4 }];
    const r = await finishAgentRun({
      runId: 'run-1', status: 'completed', iterations: 4,
      toolCallCounts: { createNode: 3, addEdge: 1 },
    });
    expect(r.status).toBe('completed');
    expect(r.iterations).toBe(4);
  });
});
```

- [ ] **Step 2: Run (FAIL)**

```bash
npm test -- lib/chat-persistence.test.js
```

Expected: 3 new tests fail (functions don't exist).

- [ ] **Step 3: Add helpers to chat-persistence.js**

Append at the end of `lib/chat-persistence.js`:

```js
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
 */
export async function finishAgentRun({ runId, status, iterations, toolCallCounts = {}, err = null }) {
  const [r] = await sql`
    UPDATE agent_runs
       SET status = ${status},
           iterations = ${iterations},
           tool_call_counts = ${JSON.stringify(toolCallCounts)}::jsonb,
           err = ${err},
           completed_at = NOW()
     WHERE id = ${runId}
     RETURNING *
  `;
  return r;
}
```

- [ ] **Step 4: Run (PASS)**

```bash
npm test -- lib/chat-persistence.test.js
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/web-shell/lib/chat-persistence.js packages/web-shell/lib/chat-persistence.test.js
git commit -m "feat(chat): agent_runs start/update/finish helpers"
```

---

## Phase 4 — Control routes: confirm / continue / cancel

### Task 4.1: POST /api/chat/confirm

**Files:**
- Create: `packages/web-shell/app/api/chat/confirm/route.js`
- Create: `packages/web-shell/app/api/chat/confirm/route.test.js`

- [ ] **Step 1: Write failing test**

Create `packages/web-shell/app/api/chat/confirm/route.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../lib/auth.js', () => ({
  requireUser: vi.fn(async () => ({ user: { id: 42 } })),
}));

const runMap = await import('../../../../lib/agent/run-map.js');
const { POST } = await import('./route.js');

beforeEach(() => runMap._resetForTests());

describe('POST /api/chat/confirm', () => {
  it('returns 400 when body missing fields', async () => {
    const req = new Request('http://test/api/chat/confirm', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 404 when runId unknown', async () => {
    const req = new Request('http://test/api/chat/confirm', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ runId: 'nope', toolCallId: 'tc-1', action: 'confirm' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(404);
  });

  it('resolves the pending confirm and returns 204', async () => {
    runMap.registerRun('run-1');
    const decisionP = runMap.awaitConfirm('run-1', 'tc-1');
    const req = new Request('http://test/api/chat/confirm', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ runId: 'run-1', toolCallId: 'tc-1', action: 'confirm' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(204);
    await expect(decisionP).resolves.toEqual({ action: 'confirm' });
  });

  it('passes choice when action="confirm" with choice', async () => {
    runMap.registerRun('run-2');
    const decisionP = runMap.awaitChoice('run-2', 'tc-2');
    const req = new Request('http://test/api/chat/confirm', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ runId: 'run-2', toolCallId: 'tc-2', action: 'confirm', choice: 'gemini' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(204);
    await expect(decisionP).resolves.toEqual({ action: 'confirm', choice: 'gemini' });
  });
});
```

- [ ] **Step 2: Run (FAIL)**

```bash
npm test -- app/api/chat/confirm/route.test.js
```

Expected: FAIL.

- [ ] **Step 3: Implement POST /api/chat/confirm**

```js
import { NextResponse } from 'next/server';
import { requireUser } from '../../../../lib/auth.js';
import { hasRun, resolveConfirm, resolveChoice } from '../../../../lib/agent/run-map.js';

export const runtime = 'nodejs';

export async function POST(request) {
  const { error } = await requireUser(request);
  if (error) return error;

  const body = await request.json().catch(() => ({}));
  const { runId, toolCallId, action, choice } = body || {};

  if (!runId || !toolCallId || !action) {
    return NextResponse.json({ error: 'runId, toolCallId, action required' }, { status: 400 });
  }
  if (!['confirm', 'skip'].includes(action)) {
    return NextResponse.json({ error: 'action must be confirm|skip' }, { status: 400 });
  }
  if (!hasRun(runId)) {
    return NextResponse.json({ error: 'unknown run' }, { status: 404 });
  }

  // Try choice first (if this is a needs_choice resolution) then confirm.
  const decision = { action, ...(choice ? { choice } : {}) };
  const choiceResolved = resolveChoice(runId, toolCallId, decision);
  if (!choiceResolved) {
    const confirmResolved = resolveConfirm(runId, toolCallId, decision);
    if (!confirmResolved) {
      return NextResponse.json({ error: 'no pending decision for that toolCallId' }, { status: 404 });
    }
  }
  return new Response(null, { status: 204 });
}
```

- [ ] **Step 4: Run (PASS)**

```bash
npm test -- app/api/chat/confirm/route.test.js
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/web-shell/app/api/chat/confirm/route.js packages/web-shell/app/api/chat/confirm/route.test.js
git commit -m "feat(api): POST /api/chat/confirm — resolves tool confirm/skip/choice"
```

---

### Task 4.2: POST /api/chat/continue

**Files:**
- Create: `packages/web-shell/app/api/chat/continue/route.js`
- Create: `packages/web-shell/app/api/chat/continue/route.test.js`

- [ ] **Step 1: Write failing test**

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../lib/auth.js', () => ({
  requireUser: vi.fn(async () => ({ user: { id: 42 } })),
}));

const runMap = await import('../../../../lib/agent/run-map.js');
const { POST } = await import('./route.js');

beforeEach(() => runMap._resetForTests());

describe('POST /api/chat/continue', () => {
  it('returns 400 when missing runId', async () => {
    const req = new Request('http://test/api/chat/continue', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect((await POST(req)).status).toBe(400);
  });

  it('returns 404 when run unknown', async () => {
    const req = new Request('http://test/api/chat/continue', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ runId: 'nope', action: 'continue' }),
    });
    expect((await POST(req)).status).toBe(404);
  });

  it('resolves a pending soft pause with continue', async () => {
    runMap.registerRun('run-1');
    const p = runMap.awaitContinue('run-1');
    const req = new Request('http://test/api/chat/continue', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ runId: 'run-1', action: 'continue' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(204);
    await expect(p).resolves.toEqual({ action: 'continue' });
  });

  it('resolves a pending soft pause with stop', async () => {
    runMap.registerRun('run-2');
    const p = runMap.awaitContinue('run-2');
    const req = new Request('http://test/api/chat/continue', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ runId: 'run-2', action: 'stop' }),
    });
    expect((await POST(req)).status).toBe(204);
    await expect(p).resolves.toEqual({ action: 'stop' });
  });
});
```

- [ ] **Step 2: Run (FAIL)**

```bash
npm test -- app/api/chat/continue/route.test.js
```

- [ ] **Step 3: Implement**

```js
import { NextResponse } from 'next/server';
import { requireUser } from '../../../../lib/auth.js';
import { hasRun, resolveContinue } from '../../../../lib/agent/run-map.js';

export const runtime = 'nodejs';

export async function POST(request) {
  const { error } = await requireUser(request);
  if (error) return error;

  const body = await request.json().catch(() => ({}));
  const { runId, action } = body || {};

  if (!runId || !action) {
    return NextResponse.json({ error: 'runId, action required' }, { status: 400 });
  }
  if (!['continue', 'stop'].includes(action)) {
    return NextResponse.json({ error: 'action must be continue|stop' }, { status: 400 });
  }
  if (!hasRun(runId)) {
    return NextResponse.json({ error: 'unknown run' }, { status: 404 });
  }

  const ok = resolveContinue(runId, { action });
  if (!ok) return NextResponse.json({ error: 'no soft-pause pending' }, { status: 404 });
  return new Response(null, { status: 204 });
}
```

- [ ] **Step 4: Run (PASS)** and **Step 5: Commit**

```bash
npm test -- app/api/chat/continue/route.test.js
git add packages/web-shell/app/api/chat/continue/
git commit -m "feat(api): POST /api/chat/continue — resolves soft-pause"
```

---

### Task 4.3: POST /api/chat/cancel

**Files:**
- Create: `packages/web-shell/app/api/chat/cancel/route.js`
- Create: `packages/web-shell/app/api/chat/cancel/route.test.js`

- [ ] **Step 1: Write failing test**

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../lib/auth.js', () => ({
  requireUser: vi.fn(async () => ({ user: { id: 42 } })),
}));

const runMap = await import('../../../../lib/agent/run-map.js');
const { POST } = await import('./route.js');

beforeEach(() => runMap._resetForTests());

describe('POST /api/chat/cancel', () => {
  it('returns 400 when missing runId', async () => {
    const req = new Request('http://test/api/chat/cancel', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect((await POST(req)).status).toBe(400);
  });

  it('returns 404 when run unknown', async () => {
    const req = new Request('http://test/api/chat/cancel', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ runId: 'nope' }),
    });
    expect((await POST(req)).status).toBe(404);
  });

  it('marks run cancelled and returns 204', async () => {
    runMap.registerRun('run-1');
    const req = new Request('http://test/api/chat/cancel', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ runId: 'run-1' }),
    });
    expect((await POST(req)).status).toBe(204);
    expect(runMap.isCancelled('run-1')).toBe(true);
  });
});
```

- [ ] **Step 2: Run (FAIL)**

```bash
npm test -- app/api/chat/cancel/route.test.js
```

- [ ] **Step 3: Implement**

```js
import { NextResponse } from 'next/server';
import { requireUser } from '../../../../lib/auth.js';
import { hasRun, cancelRun } from '../../../../lib/agent/run-map.js';

export const runtime = 'nodejs';

export async function POST(request) {
  const { error } = await requireUser(request);
  if (error) return error;

  const body = await request.json().catch(() => ({}));
  const { runId } = body || {};
  if (!runId) return NextResponse.json({ error: 'runId required' }, { status: 400 });
  if (!hasRun(runId)) return NextResponse.json({ error: 'unknown run' }, { status: 404 });

  cancelRun(runId);
  return new Response(null, { status: 204 });
}
```

- [ ] **Step 4: Run (PASS)** and **Step 5: Commit**

```bash
npm test -- app/api/chat/cancel/route.test.js
git add packages/web-shell/app/api/chat/cancel/
git commit -m "feat(api): POST /api/chat/cancel — abort in-flight run"
```

---

## Phase 5 — Destructive tools

### Task 5.1: deleteNode tool

**Files:**
- Create: `packages/web-shell/lib/agent/tools/delete-node.js`
- Create: `packages/web-shell/lib/agent/tools/delete-node.test.js`

- [ ] **Step 1: Write failing test**

```js
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../db.js', () => {
  const sql = vi.fn();
  sql._nextResult = null;
  sql.mockImplementation(() => Promise.resolve(sql._nextResult || []));
  return { sql };
});

const { sql } = await import('../../db.js');
const { deleteNodeTool } = await import('./delete-node.js');

describe('deleteNodeTool', () => {
  it('classification is destructive', () => {
    expect(deleteNodeTool.classification).toBe('destructive');
  });

  it('returns error when id missing', async () => {
    const r = await deleteNodeTool.execute({}, { boardId: 'b1', userId: 42 });
    expect(r.error).toBe('invalid_args');
  });

  it('returns error when node not owned', async () => {
    sql._nextResult = []; // ownership check empty
    const r = await deleteNodeTool.execute({ id: 'n1' }, { boardId: 'b1', userId: 42 });
    expect(r.error).toBe('forbidden');
  });

  it('deletes node when owned and returns deleted summary', async () => {
    let call = 0;
    sql.mockImplementation(() => {
      call++;
      if (call === 1) return Promise.resolve([{ id: 'n1', kind: 'site', meta: { name: 'demo' } }]); // ownership ok
      return Promise.resolve([{ id: 'n1' }]); // delete returning
    });
    const r = await deleteNodeTool.execute({ id: 'n1' }, { boardId: 'b1', userId: 42 });
    expect(r).toMatchObject({ deleted: true, id: 'n1' });
  });
});
```

- [ ] **Step 2: Run (FAIL)**

```bash
npm test -- lib/agent/tools/delete-node.test.js
```

- [ ] **Step 3: Implement delete-node.js**

```js
import { sql } from '../../db.js';

export const deleteNodeTool = {
  name: 'deleteNode',
  description: `Delete a node from the user's current board.

DESTRUCTIVE: the user will be asked to confirm before this runs. Use sparingly. Always check with queryNodes first to make sure you're targeting the right node, and prefer addressing it by id rather than name.`,
  classification: 'destructive',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'UUID of the node to delete' },
    },
    required: ['id'],
  },
  async execute(args, ctx) {
    const { id } = args || {};
    if (!id) return { error: 'invalid_args', message: 'id required' };

    const owned = await sql`
      SELECT n.id, n.kind, n.meta FROM nodes n
        JOIN boards b ON b.id = n.board_id
       WHERE n.id = ${id} AND b.user_id = ${ctx.userId} AND b.id = ${ctx.boardId}
    `;
    if (!owned.length) return { error: 'forbidden', message: 'node not found on this board' };

    const [del] = await sql`DELETE FROM nodes WHERE id = ${id} RETURNING id`;
    return {
      deleted: true,
      id: del?.id || id,
      summary: `removed ${owned[0].kind} node ${(owned[0].meta?.name || id).slice(0, 40)}`,
    };
  },
};
```

- [ ] **Step 4: Run (PASS)**

```bash
npm test -- lib/agent/tools/delete-node.test.js
```

- [ ] **Step 5: Commit**

```bash
git add packages/web-shell/lib/agent/tools/delete-node.js packages/web-shell/lib/agent/tools/delete-node.test.js
git commit -m "feat(agent): deleteNode tool (destructive)"
```

---

### Task 5.2: runFlow tool

**Files:**
- Create: `packages/web-shell/lib/agent/tools/run-flow.js`
- Create: `packages/web-shell/lib/agent/tools/run-flow.test.js`

This tool wraps `runCompose` from `lib/run-flow.js`. It loads target + incoming edges + source snapshots and calls the engine. Returns the new snapshot summary.

> **Follow-up #3 fix:** the existing `add-edge.js` inserts edges with `kind='generic'`, bypassing the `/api/edges` allow-list. `run-flow.js` reads incoming edges to gather sources; it doesn't care about kind. So **runFlow does not need a fix here** — but going forward, the cleanest move is widening the `/api/edges` route allow-list to include `'generic'`. We'll do that as a 2-line change in Task 5.2 Step 6 below.

- [ ] **Step 1: Write failing test**

```js
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../db.js', () => {
  const sql = vi.fn();
  sql.mockImplementation(() => Promise.resolve(sql._nextResult || []));
  return { sql };
});

vi.mock('../../run-flow.js', () => ({
  runCompose: vi.fn(async () => ({
    html: '<html><body>fresh</body></html>',
    snapshotId: 'snap-1',
  })),
}));

const { sql } = await import('../../db.js');
const { runFlowTool } = await import('./run-flow.js');

describe('runFlowTool', () => {
  it('classification is destructive', () => {
    expect(runFlowTool.classification).toBe('destructive');
  });

  it('returns error when nodeId missing', async () => {
    const r = await runFlowTool.execute({}, { boardId: 'b1', userId: 42 });
    expect(r.error).toBe('invalid_args');
  });

  it('returns error when target node not owned', async () => {
    sql._nextResult = [];
    const r = await runFlowTool.execute({ nodeId: 'n1' }, { boardId: 'b1', userId: 42 });
    expect(r.error).toBe('forbidden');
  });
});
```

- [ ] **Step 2: Run (FAIL)**

```bash
npm test -- lib/agent/tools/run-flow.test.js
```

- [ ] **Step 3: Implement run-flow.js (the tool, NOT the engine)**

```js
import { sql } from '../../db.js';
import { runCompose } from '../../run-flow.js';

export const runFlowTool = {
  name: 'runFlow',
  description: `Run the compose pipeline on a target node, pulling content from its incoming sources (edges) and writing a new snapshot.

DESTRUCTIVE: pauses for user confirmation before running because it costs money. Use after you've created and connected the right nodes — don't call runFlow before any edges exist (the result will be empty). Specify modelId to override the user's picker for this specific run.`,
  classification: 'destructive',
  inputSchema: {
    type: 'object',
    properties: {
      nodeId:  { type: 'string', description: 'UUID of the target node to run the flow on' },
      modelId: { type: 'string', description: 'Optional model override (e.g. "claude-sonnet-4-6", "gpt-5.5", "gemini-3.1-pro")' },
    },
    required: ['nodeId'],
  },
  async execute(args, ctx) {
    const { nodeId, modelId = null } = args || {};
    if (!nodeId) return { error: 'invalid_args', message: 'nodeId required' };

    const [target] = await sql`
      SELECT n.* FROM nodes n
        JOIN boards b ON b.id = n.board_id
       WHERE n.id = ${nodeId} AND b.user_id = ${ctx.userId} AND b.id = ${ctx.boardId}
    `;
    if (!target) return { error: 'forbidden', message: 'node not found on this board' };

    const incoming = await sql`
      SELECT e.*, n.kind AS source_kind, n.current_snapshot_id AS source_snapshot_id
        FROM edges e JOIN nodes n ON n.id = e.from_node_id
       WHERE e.to_node_id = ${nodeId}
    `;
    if (!incoming.length) {
      return { error: 'no_sources', message: 'target has no incoming edges — connect sources before running' };
    }

    const sources = [];
    for (const edge of incoming) {
      let snap = null;
      if (edge.source_snapshot_id) {
        const [s] = await sql`SELECT id, html, design_md, prompt, screenshot_url FROM snapshots WHERE id = ${edge.source_snapshot_id}`;
        snap = s || null;
      }
      sources.push({ kind: edge.source_kind, snapshot: snap, edgeMeta: edge.meta || null });
    }

    try {
      const result = await runCompose({ target, sources, modelId });
      // Persist the new snapshot + mark target's current_snapshot_id.
      const [newSnap] = await sql`
        INSERT INTO snapshots (node_id, html, source)
        VALUES (${nodeId}, ${result.html}, 'agent-run')
        RETURNING id
      `;
      await sql`UPDATE nodes SET current_snapshot_id = ${newSnap.id} WHERE id = ${nodeId}`;
      return {
        ran: true,
        nodeId,
        snapshotId: newSnap.id,
        bytes: result.html?.length || 0,
      };
    } catch (e) {
      return { error: 'run_failed', message: String(e?.message || e) };
    }
  },
};
```

- [ ] **Step 4: Run (PASS)**

```bash
npm test -- lib/agent/tools/run-flow.test.js
```

- [ ] **Step 5: Widen `/api/edges` allow-list to include 'generic' (follow-up #3 fix)**

Find and read `packages/web-shell/app/api/edges/route.js`. Locate the allow-list (likely a constant like `VALID_EDGE_KINDS`). Add `'generic'` to it. If the constant doesn't exist (validation is inline), add `'generic'` to the inline check.

Verify:
```bash
grep -n "kind" packages/web-shell/app/api/edges/route.js
```

- [ ] **Step 6: Commit**

```bash
git add packages/web-shell/lib/agent/tools/run-flow.js packages/web-shell/lib/agent/tools/run-flow.test.js packages/web-shell/app/api/edges/route.js
git commit -m "feat(agent): runFlow tool (destructive) + widen edge allow-list"
```

---

### Task 5.3: editSite tool

**Files:**
- Create: `packages/web-shell/lib/agent/tools/edit-site.js`
- Create: `packages/web-shell/lib/agent/tools/edit-site.test.js`

editSite wraps `runCompose` with the `EDIT_SITE_SYSTEM` prompt and a synthetic "prompt" source carrying the user's instruction. It refuses cleanly when the target node is currently open in edit mode (spec §16 decision).

How do we know the node is "open in edit mode"? Phase 1 doesn't track that — it's a client-only state in CanvasClient. For Phase 2, we look at `nodes.meta.editing` if present (the canvas will start writing this when the user enters edit; if not present, we don't refuse). This is a graceful degradation: if canvas client wiring isn't shipped yet, editSite just runs.

- [ ] **Step 1: Write failing test**

```js
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../db.js', () => {
  const sql = vi.fn();
  sql.mockImplementation(() => Promise.resolve(sql._nextResult || []));
  return { sql };
});

vi.mock('../../run-flow.js', () => ({
  runCompose: vi.fn(async () => ({ html: '<html><body>edited</body></html>' })),
}));

const { sql } = await import('../../db.js');
const { editSiteTool } = await import('./edit-site.js');

describe('editSiteTool', () => {
  it('classification is destructive', () => {
    expect(editSiteTool.classification).toBe('destructive');
  });

  it('returns error when required args missing', async () => {
    const r = await editSiteTool.execute({}, { boardId: 'b1', userId: 42 });
    expect(r.error).toBe('invalid_args');
  });

  it('returns node_open_in_edit when meta.editing=true', async () => {
    let call = 0;
    sql.mockImplementation(() => {
      call++;
      if (call === 1) return Promise.resolve([{ id: 'n1', kind: 'site', meta: { editing: true } }]);
      return Promise.resolve([]);
    });
    const r = await editSiteTool.execute({ nodeId: 'n1', instruction: 'make it red' }, { boardId: 'b1', userId: 42 });
    expect(r.error).toBe('node_open_in_edit');
  });
});
```

- [ ] **Step 2: Run (FAIL)**

```bash
npm test -- lib/agent/tools/edit-site.test.js
```

- [ ] **Step 3: Implement edit-site.js**

```js
import { sql } from '../../db.js';
import { runCompose } from '../../run-flow.js';
import { EDIT_SITE_SYSTEM } from '../prompts.js';

export const editSiteTool = {
  name: 'editSite',
  description: `Apply a plain-language edit to a website node, producing a new snapshot.

DESTRUCTIVE: pauses for user confirmation. Use when the user describes a change to an existing site rather than building something new — e.g. "make the hero teal", "rewrite the headline to say X", "swap the logo for this image".

This will refuse if the user is currently editing the node in-place (you'll get error="node_open_in_edit") — wait for them to close edit mode first.`,
  classification: 'destructive',
  inputSchema: {
    type: 'object',
    properties: {
      nodeId:      { type: 'string', description: 'UUID of the site node to edit' },
      instruction: { type: 'string', description: 'Plain-language instruction describing the change' },
    },
    required: ['nodeId', 'instruction'],
  },
  async execute(args, ctx) {
    const { nodeId, instruction } = args || {};
    if (!nodeId || !instruction) return { error: 'invalid_args', message: 'nodeId and instruction required' };

    const [target] = await sql`
      SELECT n.* FROM nodes n
        JOIN boards b ON b.id = n.board_id
       WHERE n.id = ${nodeId} AND b.user_id = ${ctx.userId} AND b.id = ${ctx.boardId}
    `;
    if (!target) return { error: 'forbidden', message: 'node not found on this board' };

    if (target.meta?.editing === true) {
      return { error: 'node_open_in_edit', message: 'node is currently open in edit mode — ask the user to close it' };
    }
    if (!target.current_snapshot_id) {
      return { error: 'no_snapshot', message: 'node has no current snapshot to edit' };
    }

    const [snap] = await sql`SELECT id, html FROM snapshots WHERE id = ${target.current_snapshot_id}`;
    if (!snap) return { error: 'no_snapshot', message: 'current snapshot not found' };

    try {
      const result = await runCompose({
        target,
        sources: [
          { kind: 'site', snapshot: { html: snap.html } },
          { kind: 'prompt', snapshot: { prompt: instruction } },
        ],
        systemPromptOverride: EDIT_SITE_SYSTEM,
      });
      const [newSnap] = await sql`
        INSERT INTO snapshots (node_id, html, source)
        VALUES (${nodeId}, ${result.html}, 'agent-edit')
        RETURNING id
      `;
      await sql`UPDATE nodes SET current_snapshot_id = ${newSnap.id} WHERE id = ${nodeId}`;
      return { edited: true, nodeId, snapshotId: newSnap.id, bytes: result.html?.length || 0 };
    } catch (e) {
      return { error: 'edit_failed', message: String(e?.message || e) };
    }
  },
};
```

- [ ] **Step 4: Verify runCompose supports `systemPromptOverride`**

Check `packages/web-shell/lib/run-flow.js`:

```bash
grep -n "systemPromptOverride\|COMPOSE_SYSTEM" packages/web-shell/lib/run-flow.js
```

If `systemPromptOverride` is not handled, add it. Locate the LLM call inside `runCompose` and change the system prompt to: `const sys = opts.systemPromptOverride || COMPOSE_SYSTEM;`. If COMPOSE_SYSTEM is the only existing prompt and it's already imported, this is a 2-line change.

- [ ] **Step 5: Run (PASS)**

```bash
npm test -- lib/agent/tools/edit-site.test.js
```

- [ ] **Step 6: Commit**

```bash
git add packages/web-shell/lib/agent/tools/edit-site.js packages/web-shell/lib/agent/tools/edit-site.test.js packages/web-shell/lib/run-flow.js
git commit -m "feat(agent): editSite tool (destructive) + systemPromptOverride in runCompose"
```

---

### Task 5.4: tools/index — buildFullRegistry()

**Files:**
- Modify: `packages/web-shell/lib/agent/tools/index.js`
- Modify: `packages/web-shell/lib/agent/tools/index.test.js`

- [ ] **Step 1: Write failing test**

Modify `packages/web-shell/lib/agent/tools/index.test.js`. Add:

```js
import { buildFullRegistry } from './index.js';

describe('buildFullRegistry', () => {
  it('registers all 9 Phase 2 tools', () => {
    const r = buildFullRegistry();
    const names = r.all().map((t) => t.name).sort();
    expect(names).toEqual([
      'addEdge', 'createNode', 'deleteNode', 'editSite',
      'getNodeOutput', 'listAssets', 'queryNodes', 'runFlow', 'updateNode',
    ]);
  });
});
```

- [ ] **Step 2: Run (FAIL)**

```bash
npm test -- lib/agent/tools/index.test.js
```

- [ ] **Step 3: Update tools/index.js**

```js
import { Registry } from '../registry.js';
import { createNodeTool }    from './create-node.js';
import { addEdgeTool }       from './add-edge.js';
import { updateNodeTool }    from './update-node.js';
import { queryNodesTool }    from './query-nodes.js';
import { getNodeOutputTool } from './get-node-output.js';
import { listAssetsTool }    from './list-assets.js';
import { deleteNodeTool }    from './delete-node.js';
import { runFlowTool }       from './run-flow.js';
import { editSiteTool }      from './edit-site.js';

/** Phase 1 safe tools only — kept for the smoke-test path and for asset-scoped chats. */
export function buildSafeRegistry() {
  const r = new Registry();
  r.register(createNodeTool);
  r.register(addEdgeTool);
  r.register(updateNodeTool);
  r.register(queryNodesTool);
  r.register(getNodeOutputTool);
  r.register(listAssetsTool);
  return r;
}

/** Phase 2 full board-agent surface — safe + destructive. */
export function buildFullRegistry() {
  const r = buildSafeRegistry();
  r.register(deleteNodeTool);
  r.register(runFlowTool);
  r.register(editSiteTool);
  return r;
}
```

- [ ] **Step 4: Run (PASS)**

```bash
npm test -- lib/agent/tools/index.test.js
```

- [ ] **Step 5: Commit**

```bash
git add packages/web-shell/lib/agent/tools/index.js packages/web-shell/lib/agent/tools/index.test.js
git commit -m "feat(agent): buildFullRegistry wires 9 tools (6 safe + 3 destructive)"
```

---

## Phase 6 — Wire route to use runId + caps + full registry + persistence

### Task 6.1: POST /api/chat — wire runMap, caps, full registry, agent_runs persistence

**Files:**
- Modify: `packages/web-shell/app/api/chat/route.js`
- Modify: `packages/web-shell/app/api/chat/route.post.test.js`

Phase 1 route used `buildSafeRegistry()` and didn't pass `runId`. Phase 2 swaps to `buildFullRegistry()`, registers the run in the runMap, persists agent_runs lifecycle, and forwards the new SSE event types.

- [ ] **Step 1: Read the current route to find insertion points**

```bash
sed -n '105,220p' packages/web-shell/app/api/chat/route.js
```

Note the lines where:
- `const registry = buildSafeRegistry();` (~line 142)
- `const initialMessages = ...` block
- `await runAgentLoop({...})` call
- `await appendMessage({... role: 'assistant' ...})` final stub at end

- [ ] **Step 2: Update imports**

Replace the top-of-file imports with:

```js
import { NextResponse } from 'next/server';
import { requireUser } from '../../../lib/auth.js';
import { getOrCreateActiveThread, loadMessages, appendMessage,
         startAgentRun, finishAgentRun, updateAgentRunStatus } from '../../../lib/chat-persistence.js';
import { buildFullRegistry, buildSafeRegistry } from '../../../lib/agent/tools/index.js';
import { runAgentLoop } from '../../../lib/agent/driver.js';
import { callAnthropic } from '../../../lib/agent/llm-anthropic.js';
import { callOpenAI }    from '../../../lib/agent/llm-openai.js';
import { callGemini }    from '../../../lib/agent/llm-gemini.js';
import { BOARD_AGENT, EDIT_IMAGE_SYSTEM } from '../../../lib/agent/prompts.js';
import { createSseStream, SSE_HEADERS } from '../../../lib/agent/sse-bridge.js';
import { registerRun, unregisterRun } from '../../../lib/agent/run-map.js';
import { getCaps } from '../../../lib/agent/caps.js';
```

- [ ] **Step 3: Swap registry selection based on threadScope**

Replace `const registry = buildSafeRegistry();` with:

```js
// Asset-scoped chats (Smart Edit) get the safe registry only — they can't
// delete/runFlow/editSite from there. Board chats get the full registry.
const registry = threadScope === 'asset' ? buildSafeRegistry() : buildFullRegistry();
```

- [ ] **Step 4: Register run + start agent_runs row before driver invocation**

In the `(async () => { ... })()` IIFE, BEFORE `await runAgentLoop(...)`, insert:

```js
const run = await startAgentRun({ threadId: thread.id });
registerRun(run.id);
send('run_id', { runId: run.id });
const caps = getCaps();
```

Then update the `runAgentLoop` call to pass these:

```js
const loopResult = await runAgentLoop({
  llm: resolved.adapter,
  registry,
  systemPrompt,
  messages: initialMessages,
  modelId: resolvedModel,
  apiKey: resolved.apiKey,
  ctx: { boardId, userId: user.id },
  toolAllowlist,
  tools,
  runId: run.id,
  caps,
  onEvent: (ev) => {
    switch (ev.type) {
      case 'text_delta':
        send('assistant_token', { delta: ev.text });
        break;
      case 'tool_use':
        send('tool_call', {
          id: ev.id, name: ev.name, args: ev.input,
          classification: registry.get(ev.name)?.classification || 'safe',
        });
        break;
      case 'tool_status':
        send('tool_status', { id: ev.id, status: ev.status, result: ev.result, error: ev.error });
        break;
      case 'needs_confirm':
        send('needs_confirm', { id: ev.id, name: ev.name, args: ev.args, summary: ev.summary });
        break;
      case 'needs_choice':
        send('needs_choice', { id: ev.id, name: ev.name, args: ev.args, summary: ev.summary, choices: ev.choices });
        break;
      case 'needs_softlimit_continue':
        send('needs_softlimit_continue', {
          id: ev.id,
          iterationsSoFar: ev.iterationsSoFar,
          breakdown: ev.breakdown,
        });
        break;
      case 'message_complete':
        break;
      case 'run_status':
        send('run_status', { status: ev.status, err: ev.err });
        break;
    }
  },
});
```

- [ ] **Step 5: Replace final assistant stub + finishAgentRun**

After the `runAgentLoop` await, replace:

```js
await appendMessage({
  threadId: thread.id,
  role: 'assistant',
  content: '',
  model: resolvedModel,
  agentRunId: null,
});
```

with:

```js
const finalStatus = mapLoopResultToRunStatus(loopResult.stop_reason);
await finishAgentRun({
  runId: run.id,
  status: finalStatus,
  iterations: loopResult.iterations,
  toolCallCounts: loopResult.toolCounts || {},
});
await appendMessage({
  threadId: thread.id,
  role: 'assistant',
  content: '',                       // Phase 5b will populate this from the run.
  model: resolvedModel,
  agentRunId: run.id,                // No longer null — links to the run row.
});
```

- [ ] **Step 6: Add the mapping helper + cleanup in `finally`**

Above `export async function POST` add:

```js
function mapLoopResultToRunStatus(stopReason) {
  switch (stopReason) {
    case 'end_turn':            return 'completed';
    case 'hard_limited':        return 'hard_limited';
    case 'wall_timeout':        return 'failed';
    case 'cancelled':
    case 'cancelled_softpause': return 'cancelled';
    default:                    return 'failed';
  }
}
```

Wrap the existing try/catch/finally so the `finally` always calls `unregisterRun`:

```js
(async () => {
  send('thread_id', { threadId: thread.id });
  let runId = null;
  try {
    const run = await startAgentRun({ threadId: thread.id });
    runId = run.id;
    registerRun(runId);
    send('run_id', { runId });
    const caps = getCaps();
    // ... existing tools spec selection + runAgentLoop call ...
    // ... finishAgentRun + appendMessage (from Step 5) ...
  } catch (e) {
    console.error('[POST /api/chat] agent error', e);
    send('run_status', { status: 'failed', err: String(e?.message || e) });
    if (runId) {
      try {
        await finishAgentRun({ runId, status: 'failed', iterations: 0, err: String(e?.message || e) });
      } catch (_) {}
    }
  } finally {
    if (runId) unregisterRun(runId);
    close();
  }
})();
```

- [ ] **Step 7: Update POST test to assert new events flow**

Open `packages/web-shell/app/api/chat/route.post.test.js` and add (do not remove existing tests):

```js
describe('POST /api/chat — Phase 2 wiring', () => {
  it('emits run_id before assistant_token', async () => {
    // Mock requireUser, getOrCreateActiveThread, startAgentRun, finishAgentRun, llm adapter.
    // Assert SSE event order: thread_id → run_id → assistant_token → run_status.
    // (Implementation detail: copy the existing happy-path test's mocks and add assertions for run_id.)
  });
});
```

Actually we'll write this properly. Replace the placeholder above with:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const startAgentRunMock = vi.fn(async () => ({ id: 'run-99' }));
const finishAgentRunMock = vi.fn(async () => ({}));

vi.mock('../../../lib/auth.js', () => ({
  requireUser: vi.fn(async () => ({ user: { id: 42 } })),
}));
vi.mock('../../../lib/chat-persistence.js', () => ({
  getOrCreateActiveThread: vi.fn(async () => ({ id: 't1' })),
  loadMessages: vi.fn(async () => []),
  appendMessage: vi.fn(async () => ({ id: 'm-x' })),
  startAgentRun: startAgentRunMock,
  finishAgentRun: finishAgentRunMock,
  updateAgentRunStatus: vi.fn(),
}));
vi.mock('../../../lib/agent/llm-anthropic.js', () => ({
  callAnthropic: vi.fn(async ({ onEvent }) => {
    onEvent({ type: 'text_delta', text: 'hi' });
    onEvent({ type: 'message_complete', usage: { input_tokens: 1, output_tokens: 1 } });
    return { content: [{ type: 'text', text: 'hi' }], stop_reason: 'end_turn', usage: {} };
  }),
}));
vi.mock('../../../lib/agent/llm-openai.js', () => ({ callOpenAI: vi.fn() }));
vi.mock('../../../lib/agent/llm-gemini.js', () => ({ callGemini: vi.fn() }));

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = 'sk-fake';
  process.env.UNCRAFT_AGENT_MODEL = 'claude-sonnet-4-6';
});

const { POST } = await import('./route.js');

async function readSseEvents(res) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const events = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value);
    let idx;
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const block = buf.slice(0, idx); buf = buf.slice(idx + 2);
      const lines = block.split('\n');
      const event = lines.find((l) => l.startsWith('event:'))?.slice(6).trim();
      const data = lines.find((l) => l.startsWith('data:'))?.slice(5).trim();
      events.push({ event, data: data ? JSON.parse(data) : null });
    }
  }
  return events;
}

describe('POST /api/chat — Phase 2 wiring', () => {
  it('emits thread_id → run_id → assistant_token → run_status in order', async () => {
    const req = new Request('http://test/api/chat', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ boardId: 'b1', message: 'hi' }),
    });
    const res = await POST(req);
    const events = await readSseEvents(res);
    const order = events.map((e) => e.event);
    expect(order.indexOf('thread_id')).toBeLessThan(order.indexOf('run_id'));
    expect(order.indexOf('run_id')).toBeLessThan(order.indexOf('assistant_token'));
    expect(order[order.length - 1]).toBe('run_status');
  });

  it('persists agent run as completed when LLM stops naturally', async () => {
    const req = new Request('http://test/api/chat', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ boardId: 'b1', message: 'hi' }),
    });
    await readSseEvents(await POST(req));
    expect(startAgentRunMock).toHaveBeenCalledWith({ threadId: 't1' });
    expect(finishAgentRunMock).toHaveBeenCalledWith(
      expect.objectContaining({ runId: 'run-99', status: 'completed' })
    );
  });
});
```

- [ ] **Step 8: Run all tests**

```bash
npm test -- app/api/chat/route.post.test.js
```

Expected: existing tests still pass; new Phase 2 tests pass.

- [ ] **Step 9: Commit**

```bash
git add packages/web-shell/app/api/chat/route.js packages/web-shell/app/api/chat/route.post.test.js
git commit -m "feat(api): wire POST /api/chat to runMap + caps + agent_runs + full registry"
```

---

## Phase 7 — Frontend: ToolChip new states + SoftPauseChip + PromptDock wiring

### Task 7.1: ToolChip — awaiting_confirm + skipped + needs_choice states

**Files:**
- Modify: `packages/web-shell/components/chat/ToolChip.jsx`
- Modify: `packages/web-shell/components/chat/ToolChip.test.jsx`
- Modify: `packages/web-shell/components/chat/chat.css`

- [ ] **Step 1: Write failing tests**

Append to `ToolChip.test.jsx`:

```jsx
import userEvent from '@testing-library/user-event';

describe('ToolChip — awaiting_confirm', () => {
  it('renders summary + Confirm + Skip buttons', () => {
    const onConfirm = vi.fn();
    const onSkip = vi.fn();
    render(
      <ToolChip
        toolName="deleteNode"
        status="awaiting_confirm"
        args={{ id: 'n1' }}
        summary="Delete node n1"
        onConfirm={onConfirm}
        onSkip={onSkip}
      />
    );
    expect(screen.getByText('Delete node n1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /confirm/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /skip/i })).toBeInTheDocument();
  });

  it('fires onConfirm when Confirm clicked', async () => {
    const onConfirm = vi.fn();
    render(<ToolChip toolName="deleteNode" status="awaiting_confirm" args={{}} summary="x" onConfirm={onConfirm} onSkip={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: /confirm/i }));
    expect(onConfirm).toHaveBeenCalled();
  });
});

describe('ToolChip — awaiting_choice', () => {
  it('renders choice buttons and fires onChoose with picked id', async () => {
    const onChoose = vi.fn();
    render(
      <ToolChip
        toolName="createImage"
        status="awaiting_choice"
        args={{ prompt: 'cat' }}
        summary="Generate image"
        choices={[{ id: 'gemini', label: 'Gemini (auto)' }, { id: 'openai', label: 'GPT-5.5' }]}
        onChoose={onChoose}
        onSkip={() => {}}
      />
    );
    expect(screen.getByText('Generate image')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /gemini/i }));
    expect(onChoose).toHaveBeenCalledWith('gemini');
  });
});

describe('ToolChip — skipped', () => {
  it('renders skipped indicator', () => {
    render(<ToolChip toolName="deleteNode" status="skipped" args={{}} />);
    expect(screen.getByText(/skipped/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run (FAIL)**

```bash
npm test -- components/chat/ToolChip.test.jsx
```

- [ ] **Step 3: Update ToolChip.jsx**

Replace the existing implementation with:

```jsx
'use client';

export default function ToolChip({
  toolName, status, args, result, error,
  summary, choices,
  onConfirm, onSkip, onChoose,
}) {
  const cls = `tool-chip tool-chip-${status}`;
  const icon = (
    status === 'done'             ? '✓'
    : status === 'error'          ? '✕'
    : status === 'skipped'        ? '⊘'
    : status === 'awaiting_confirm' || status === 'awaiting_choice' ? '⚠'
    : null
  );

  const summaryNode = (
    summary
      ? summary
      : result ? summarizeResult(toolName, result)
      : null
  );

  return (
    <div className={cls} data-tool={toolName} data-status={status}>
      <span className="tool-chip-icon">
        {icon || <span role="status" className="tool-chip-spinner" aria-label="working" />}
      </span>
      <span className="tool-chip-name">{toolName}</span>
      {summaryNode && <span className="tool-chip-summary"> — {summaryNode}</span>}
      {error && <span className="tool-chip-error"> — {error}</span>}

      {status === 'awaiting_confirm' && (
        <span className="tool-chip-actions">
          <button type="button" className="tool-chip-btn tool-chip-confirm" onClick={() => onConfirm?.()}>Confirm</button>
          <button type="button" className="tool-chip-btn tool-chip-skip" onClick={() => onSkip?.()}>Skip</button>
        </span>
      )}
      {status === 'awaiting_choice' && (
        <span className="tool-chip-actions">
          {(choices || []).map((c) => (
            <button
              key={c.id}
              type="button"
              className="tool-chip-btn tool-chip-choice"
              title={c.hint || ''}
              onClick={() => onChoose?.(c.id)}
            >
              {c.label}
            </button>
          ))}
          <button type="button" className="tool-chip-btn tool-chip-skip" onClick={() => onSkip?.()}>Skip</button>
        </span>
      )}
    </div>
  );
}

function summarizeResult(toolName, result) {
  if (!result) return null;
  switch (toolName) {
    case 'createNode':  return result.id ? `created ${result.id.slice(0, 8)}` : 'created';
    case 'addEdge':     return result.id ? `edge ${result.id.slice(0, 8)}` : 'connected';
    case 'updateNode':  return 'updated';
    case 'queryNodes':  return `${Array.isArray(result) ? result.length : '?'} nodes`;
    case 'listAssets':  return `${Array.isArray(result) ? result.length : '?'} assets`;
    case 'getNodeOutput': return result.truncated ? 'output (truncated)' : 'output';
    case 'deleteNode':  return result.deleted ? `deleted ${String(result.id || '').slice(0, 8)}` : null;
    case 'runFlow':     return result.ran ? `ran flow (${result.bytes || '?'} bytes)` : null;
    case 'editSite':    return result.edited ? `edited site` : null;
    default: return null;
  }
}
```

- [ ] **Step 4: Append CSS for new states**

Append to `packages/web-shell/components/chat/chat.css`:

```css
.tool-chip-awaiting_confirm,
.tool-chip-awaiting_choice {
  background: rgba(251, 191, 36, 0.10);
  border-color: rgba(251, 191, 36, 0.30);
  color: rgba(254, 226, 168, 0.95);
}
.tool-chip-skipped {
  background: rgba(120, 120, 120, 0.10);
  border-color: rgba(255, 255, 255, 0.08);
  color: rgba(170, 170, 170, 0.75);
  font-style: italic;
}
.tool-chip-actions {
  display: inline-flex;
  gap: 4px;
  margin-left: 8px;
}
.tool-chip-btn {
  font-family: inherit;
  font-size: 10px;
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  background: rgba(255, 255, 255, 0.05);
  color: inherit;
  cursor: pointer;
}
.tool-chip-btn:hover { background: rgba(255, 255, 255, 0.10); }
.tool-chip-confirm { border-color: rgba(74, 222, 128, 0.35); color: rgba(187, 247, 208, 0.95); }
.tool-chip-confirm:hover { background: rgba(74, 222, 128, 0.15); }
.tool-chip-skip { color: rgba(255, 255, 255, 0.6); }
.tool-chip-choice { border-color: rgba(186, 230, 253, 0.35); color: rgba(186, 230, 253, 0.95); }
.tool-chip-choice:hover { background: rgba(56, 189, 248, 0.15); }
```

- [ ] **Step 5: Run (PASS)**

```bash
npm test -- components/chat/ToolChip.test.jsx
```

Expected: all tests pass (including original Phase 1 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/web-shell/components/chat/ToolChip.jsx packages/web-shell/components/chat/ToolChip.test.jsx packages/web-shell/components/chat/chat.css
git commit -m "feat(chat): ToolChip states — awaiting_confirm/awaiting_choice/skipped"
```

---

### Task 7.2: SoftPauseChip component

**Files:**
- Create: `packages/web-shell/components/chat/SoftPauseChip.jsx`
- Create: `packages/web-shell/components/chat/SoftPauseChip.test.jsx`
- Modify: `packages/web-shell/components/chat/chat.css`

- [ ] **Step 1: Write failing test**

```jsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SoftPauseChip from './SoftPauseChip.jsx';

describe('SoftPauseChip', () => {
  it('renders iteration count + breakdown text', () => {
    render(
      <SoftPauseChip
        iterationsSoFar={10}
        breakdown={{ createNode: 8, addEdge: 2 }}
        onContinue={() => {}}
        onStop={() => {}}
      />
    );
    expect(screen.getByText(/10 actions/i)).toBeInTheDocument();
    expect(screen.getByText(/createNode × 8/)).toBeInTheDocument();
    expect(screen.getByText(/addEdge × 2/)).toBeInTheDocument();
  });

  it('fires onContinue / onStop on click', async () => {
    const onContinue = vi.fn();
    const onStop = vi.fn();
    render(<SoftPauseChip iterationsSoFar={10} breakdown={{}} onContinue={onContinue} onStop={onStop} />);
    await userEvent.click(screen.getByRole('button', { name: /continue/i }));
    expect(onContinue).toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: /stop/i }));
    expect(onStop).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run (FAIL)**

```bash
npm test -- components/chat/SoftPauseChip.test.jsx
```

- [ ] **Step 3: Implement SoftPauseChip.jsx**

```jsx
'use client';

export default function SoftPauseChip({ iterationsSoFar, breakdown, onContinue, onStop }) {
  const breakdownStr = Object.entries(breakdown || {})
    .sort((a, b) => b[1] - a[1])
    .map(([name, n]) => `${name} × ${n}`)
    .join(', ');
  return (
    <div className="soft-pause-chip">
      <div className="soft-pause-line">
        <span className="soft-pause-icon">⏸</span>
        <span>Did {iterationsSoFar} actions so far. Continue?</span>
      </div>
      {breakdownStr && <div className="soft-pause-breakdown">{breakdownStr}</div>}
      <div className="soft-pause-actions">
        <button type="button" className="soft-pause-btn soft-pause-continue" onClick={onContinue}>Continue</button>
        <button type="button" className="soft-pause-btn soft-pause-stop" onClick={onStop}>Stop</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: CSS**

Append to chat.css:

```css
.soft-pause-chip {
  margin: 8px 0;
  padding: 10px 14px;
  border-radius: 14px;
  background: rgba(251, 191, 36, 0.06);
  border: 1px solid rgba(251, 191, 36, 0.18);
  color: rgba(254, 226, 168, 0.95);
  font-family: var(--popup-font-sans, system-ui);
  font-size: 12px;
}
.soft-pause-line { display: flex; gap: 8px; align-items: center; }
.soft-pause-icon { opacity: 0.85; }
.soft-pause-breakdown { margin-top: 6px; opacity: 0.7; font-size: 11px; }
.soft-pause-actions { margin-top: 8px; display: flex; gap: 6px; }
.soft-pause-btn {
  font-family: inherit; font-size: 11px;
  padding: 4px 12px; border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  background: rgba(255, 255, 255, 0.05); color: inherit; cursor: pointer;
}
.soft-pause-btn:hover { background: rgba(255, 255, 255, 0.10); }
.soft-pause-continue { border-color: rgba(74, 222, 128, 0.35); color: rgba(187, 247, 208, 0.95); }
.soft-pause-stop { color: rgba(255, 255, 255, 0.6); }
```

- [ ] **Step 5: Run (PASS)**

```bash
npm test -- components/chat/SoftPauseChip.test.jsx
```

- [ ] **Step 6: Commit**

```bash
git add packages/web-shell/components/chat/SoftPauseChip.jsx packages/web-shell/components/chat/SoftPauseChip.test.jsx packages/web-shell/components/chat/chat.css
git commit -m "feat(chat): SoftPauseChip for whole-run pause flow"
```

---

### Task 7.3: ChatPanel — render SoftPauseChip and wire callbacks through

**Files:**
- Modify: `packages/web-shell/components/chat/ChatPanel.jsx`
- Modify: `packages/web-shell/components/chat/ChatPanel.test.jsx`

- [ ] **Step 1: Write failing test**

Append to `ChatPanel.test.jsx`:

```jsx
import SoftPauseChip from './SoftPauseChip.jsx';

describe('ChatPanel — soft pause', () => {
  it('renders softPause prop as SoftPauseChip and fires through callbacks', async () => {
    const onContinue = vi.fn();
    const onStop = vi.fn();
    render(
      <ChatPanel
        messages={[{ id: 'm1', role: 'assistant', content: 'working' }]}
        activeToolCalls={[]}
        softPause={{ iterationsSoFar: 10, breakdown: { createNode: 10 } }}
        onSoftContinue={onContinue}
        onSoftStop={onStop}
      />
    );
    expect(screen.getByText(/10 actions/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /continue/i }));
    expect(onContinue).toHaveBeenCalled();
  });
});
```

(Make sure `import userEvent from '@testing-library/user-event'` is at the top of the file.)

- [ ] **Step 2: Run (FAIL)**

```bash
npm test -- components/chat/ChatPanel.test.jsx
```

- [ ] **Step 3: Update ChatPanel.jsx**

Add the SoftPauseChip import:

```jsx
import SoftPauseChip from './SoftPauseChip.jsx';
```

Accept new props:
```jsx
export default function ChatPanel({
  messages, activeToolCalls,
  softPause, onSoftContinue, onSoftStop,
  onConfirmTool, onSkipTool, onChooseTool,
}) {
```

Pass callbacks to each `<ToolChip>` for activeToolCalls:
```jsx
{idx === lastAssistantIdx && activeToolCalls.map((tc) => (
  <ToolChip
    key={tc.id}
    toolName={tc.name}
    status={tc.status || 'running'}
    args={tc.args}
    result={tc.result}
    error={tc.error}
    summary={tc.summary}
    choices={tc.choices}
    onConfirm={() => onConfirmTool?.(tc.id)}
    onSkip={() => onSkipTool?.(tc.id)}
    onChoose={(choiceId) => onChooseTool?.(tc.id, choiceId)}
  />
))}
```

After the messages map, render the SoftPauseChip:
```jsx
{softPause && (
  <SoftPauseChip
    iterationsSoFar={softPause.iterationsSoFar}
    breakdown={softPause.breakdown}
    onContinue={onSoftContinue}
    onStop={onSoftStop}
  />
)}
```

- [ ] **Step 4: Run (PASS)** and **Step 5: Commit**

```bash
npm test -- components/chat/ChatPanel.test.jsx
git add packages/web-shell/components/chat/ChatPanel.jsx packages/web-shell/components/chat/ChatPanel.test.jsx
git commit -m "feat(chat): ChatPanel renders SoftPauseChip + threads confirm/skip/choice callbacks"
```

---

### Task 7.4: PromptDock — handle new SSE events + POST confirm/continue/cancel

**Files:**
- Modify: `packages/web-shell/components/PromptDock.jsx`

PromptDock's `chatState` reducer needs new actions for `needs_confirm`, `needs_choice`, `needs_softlimit_continue`. The SSE event handler in `sendChatMessage` needs to dispatch these. New helpers POST to `/api/chat/confirm` and `/api/chat/continue`.

- [ ] **Step 1: Locate the reducer**

```bash
grep -n "function chatReducer\|reducer =" packages/web-shell/components/PromptDock.jsx | head -5
```

- [ ] **Step 2: Add new action types and reducer branches**

Add to the reducer:

```js
case 'TOOL_NEEDS_CONFIRM': {
  return {
    ...state,
    activeToolCalls: state.activeToolCalls.map((tc) =>
      tc.id === action.id ? { ...tc, status: 'awaiting_confirm', summary: action.summary } : tc
    ),
    loading: 'paused',
  };
}
case 'TOOL_NEEDS_CHOICE': {
  return {
    ...state,
    activeToolCalls: state.activeToolCalls.map((tc) =>
      tc.id === action.id ? { ...tc, status: 'awaiting_choice', summary: action.summary, choices: action.choices } : tc
    ),
    loading: 'paused',
  };
}
case 'TOOL_RESUMED': {
  return {
    ...state,
    activeToolCalls: state.activeToolCalls.map((tc) =>
      tc.id === action.id ? { ...tc, status: 'running' } : tc
    ),
    loading: 'streaming',
  };
}
case 'RUN_SOFT_PAUSED': {
  return {
    ...state,
    softPause: { iterationsSoFar: action.iterationsSoFar, breakdown: action.breakdown },
    loading: 'paused',
  };
}
case 'RUN_CONTINUED': {
  return { ...state, softPause: null, loading: 'streaming' };
}
case 'RUN_ID_RECEIVED': {
  return { ...state, activeRun: { runId: action.runId, status: 'running' } };
}
```

- [ ] **Step 3: Map SSE events in `sendChatMessage`**

In the SSE event switch:

```js
case 'run_id':
  dispatch({ type: 'RUN_ID_RECEIVED', runId: payload.runId });
  break;
case 'needs_confirm':
  dispatch({ type: 'TOOL_NEEDS_CONFIRM', id: payload.id, summary: payload.summary });
  break;
case 'needs_choice':
  dispatch({ type: 'TOOL_NEEDS_CHOICE', id: payload.id, summary: payload.summary, choices: payload.choices });
  break;
case 'needs_softlimit_continue':
  dispatch({ type: 'RUN_SOFT_PAUSED', iterationsSoFar: payload.iterationsSoFar, breakdown: payload.breakdown });
  break;
```

- [ ] **Step 4: Add control-call helpers**

Above the component (or inside, before the JSX):

```js
async function postConfirm({ runId, toolCallId, action, choice }) {
  return fetch('/api/chat/confirm', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ runId, toolCallId, action, ...(choice ? { choice } : {}) }),
  });
}

async function postContinue({ runId, action }) {
  return fetch('/api/chat/continue', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ runId, action }),
  });
}

async function postCancel({ runId }) {
  return fetch('/api/chat/cancel', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ runId }),
  });
}
```

- [ ] **Step 5: Wire ChatPanel callbacks**

When rendering `<ChatPanel ... />`, pass:

```jsx
<ChatPanel
  messages={state.messages}
  activeToolCalls={state.activeToolCalls}
  softPause={state.softPause}
  onConfirmTool={async (toolCallId) => {
    await postConfirm({ runId: state.activeRun?.runId, toolCallId, action: 'confirm' });
    dispatch({ type: 'TOOL_RESUMED', id: toolCallId });
  }}
  onSkipTool={async (toolCallId) => {
    await postConfirm({ runId: state.activeRun?.runId, toolCallId, action: 'skip' });
    dispatch({ type: 'TOOL_RESUMED', id: toolCallId });
  }}
  onChooseTool={async (toolCallId, choiceId) => {
    await postConfirm({ runId: state.activeRun?.runId, toolCallId, action: 'confirm', choice: choiceId });
    dispatch({ type: 'TOOL_RESUMED', id: toolCallId });
  }}
  onSoftContinue={async () => {
    await postContinue({ runId: state.activeRun?.runId, action: 'continue' });
    dispatch({ type: 'RUN_CONTINUED' });
  }}
  onSoftStop={async () => {
    await postContinue({ runId: state.activeRun?.runId, action: 'stop' });
    dispatch({ type: 'RUN_CONTINUED' });
  }}
/>
```

- [ ] **Step 6: Run all existing PromptDock-related tests**

```bash
cd packages/web-shell && npm test
```

Expected: all tests still pass. (PromptDock has no dedicated tests for chatState yet — Phase 5 covers that. Phase 2 validates via manual smoke test in Task 8.1.)

- [ ] **Step 7: Commit**

```bash
git add packages/web-shell/components/PromptDock.jsx
git commit -m "feat(chat): PromptDock handles needs_confirm/choice/softlimit + posts decisions"
```

---

## Phase 8 — End-to-end smoke test (manual)

These steps are manual verification, not automated tests. The plan executor runs through them once after all code lands, and records observed behavior.

### Task 8.1: Confirm flow — delete a node

- [ ] **Step 1: Restart dev server**

```bash
cd packages/web-shell && npm run dev
```

- [ ] **Step 2: Open canvas with at least 1 node**

Open `http://localhost:3030/canvas/<board-id>` in browser. If no nodes, click "+" to add a blank-website node.

- [ ] **Step 3: Send delete prompt**

Type in the PromptDock: `delete the blank website node`. Submit.

- [ ] **Step 4: Verify confirm chip appears**

Expected: chat panel expands; amber chip `⚠ deleteNode — Delete node ... [Confirm] [Skip]` appears under the assistant bubble. Loading indicator shows "paused".

- [ ] **Step 5: Click Confirm**

Expected: chip turns to running (blue), then done (grey ✓). Canvas refetches; deleted node is gone.

- [ ] **Step 6: Repeat with Skip**

Repeat steps 2-4. Click Skip instead. Expected: chip turns to `⊘ skipped`. Node stays. Agent continues or wraps up.

### Task 8.2: Soft pause — configure cap to 2, run many tools

- [ ] **Step 1: Edit `.env.local`**

Add `UNCRAFT_AGENT_SOFT_ITER=2` to `packages/web-shell/.env.local`. Restart dev.

- [ ] **Step 2: Send heavy prompt**

Type: `create 5 prompt nodes`. Submit.

- [ ] **Step 3: Verify soft pause chip**

Expected: after 2 createNode calls, SoftPauseChip appears: `⏸ Did 2 actions so far. Continue?` with breakdown `createNode × 2`.

- [ ] **Step 4: Click Continue, repeat at 4**

Verify pause re-appears at iter 4, then proceeds to completion.

### Task 8.3: Hard kill — configure cap to 3

- [ ] **Step 1: Set `UNCRAFT_AGENT_HARD_ITER=3` + `UNCRAFT_AGENT_SOFT_ITER=99`**

Restart dev.

- [ ] **Step 2: Send same prompt as 8.2**

- [ ] **Step 3: Verify hard kill**

Expected: 3 createNode calls execute, then chat shows `run_status: hard_limited`. ChatBubble or status indicator confirms "Hit the action limit".

### Task 8.4: Cancel mid-run

- [ ] **Step 1: Reset env caps**

Remove the `UNCRAFT_AGENT_*` overrides. Restart dev.

- [ ] **Step 2: Start a long run**

Type: `delete every prompt node` (assuming you have 3+ prompt nodes). Submit. Confirm chip appears for first delete.

- [ ] **Step 3: Cancel via cancel button**

(If a cancel button isn't wired in Phase 2 UI, manually call from devtools console:)

```js
fetch('/api/chat/cancel', { method:'POST', headers:{'content-type':'application/json'}, credentials:'include', body: JSON.stringify({ runId: '<runId from state>' }) });
```

Expected: run status = `cancelled`. No further tool calls execute. Chat returns to idle.

### Task 8.5: agent_runs row verification

- [ ] **Step 1: Connect to DB**

```bash
psql "$DATABASE_URL" -c "SELECT id, status, iterations, tool_call_counts, completed_at FROM agent_runs ORDER BY started_at DESC LIMIT 5"
```

Expected: rows from the smoke tests above with correct statuses (`completed`, `cancelled`, `hard_limited`).

---

## Phase 9 — Documentation + handoff for Phase 3

### Task 9.1: Update CLAUDE.md item index

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add new numbered item 129 after item 128**

Append to the numbered learnings list:

```markdown
129. ✅ **Agent PromptDock chat — Phase 2** (sessão 2026-06-XX, branch `feat/canvas`). Destructive tools (`deleteNode`, `runFlow`, `editSite`) + pause/resume + anti-loop caps. Stack: in-memory `lib/agent/run-map.js` keyed by `agent_runs.id` shared between driver loop and 3 control routes (`/api/chat/confirm|continue|cancel`). Driver emits `needs_confirm`/`needs_choice`/`needs_softlimit_continue` SSE events, awaits Promise from runMap, resumes on user click. ToolChip gains `awaiting_confirm`/`awaiting_choice`/`skipped` states; new SoftPauseChip for whole-run pause. Caps env-configurable: `UNCRAFT_AGENT_SOFT_ITER=10`, `UNCRAFT_AGENT_HARD_ITER=50`, `UNCRAFT_AGENT_RETRY_BUDGET=3`, `UNCRAFT_AGENT_WALL_TIMEOUT_MS=300000`. `agent_runs` table now populated (status transitions, iterations, tool_call_counts). `createImage` deferred to Phase 3 (needs provider routing + image-gen route). Follow-up #1 (debug log) cleaned up. Follow-up #3 (edge kind) folded — `/api/edges` allow-list widened to include `'generic'`. Phase 2 plan: `docs/superpowers/plans/2026-06-01-agent-promptdock-phase2.md`. Commits: <fill in after execution>.
```

- [ ] **Step 2: Update mem0 checkpoint**

Create `~/.claude/projects/-Users-adilsonporto-Desktop-IA-Uncraft/memory/checkpoint_2026-06-01_047.md` with the same content as item 129 above, plus list any quirks discovered during smoke test.

Update `MEMORY.md` index with a new line at the top:

```markdown
- [checkpoint_2026-06-01_047.md](./checkpoint_2026-06-01_047.md) — ACTIVE: Agent PromptDock Phase 2 — destructive tools + pause/resume + caps + agent_runs populated. Tools: deleteNode, runFlow, editSite. Caps env-driven. Phase 2 plan: docs/superpowers/plans/2026-06-01-agent-promptdock-phase2.md.
```

- [ ] **Step 3: Write Phase 3 handoff**

Create `docs/superpowers/handoffs/2026-06-01-agent-phase3-handoff.md`. Cover:
- What Phase 2 shipped (point at item 129)
- What's still open (Phase 3 = image gen + createImage; Phase 4 = Smart Edit dock; Phase 5b = history reconstruction; Phase 5c = cost tracking)
- File map updates (new files in Phase 2)
- Suggested next pickup: Phase 3 image gen if user wants more agent power, Phase 5b if user wants history polish.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md docs/superpowers/handoffs/ ~/.claude/projects/-Users-adilsonporto-Desktop-IA-Uncraft/memory/
git commit -m "docs: Phase 2 handoff + CLAUDE.md item 129"
```

---

## Self-review checklist (executed before handing off plan)

**Spec coverage check** (spec §1–§16):
- §6 destructive tools: ✅ deleteNode (5.1), runFlow (5.2), editSite (5.3). createImage explicitly deferred to Phase 3 (documented in plan header).
- §7 caps: ✅ all four implemented in driver (2.1) with env config (1.2).
- §5 pause/resume HTTP shape: ✅ confirm (4.1), continue (4.2), cancel (4.3). new-thread is Phase 1 already shipped or Phase 5 — confirmed deferred.
- §8 UI: ✅ ToolChip new states (7.1), SoftPauseChip (7.2), ChatPanel wiring (7.3), PromptDock dispatch (7.4).
- §9 persistence: ✅ agent_runs helpers (3.1), wired in route (6.1).
- §10 createImage routing: deferred to Phase 3.
- §13 error handling table: ✅ retry budget, wall timeout, hard cap, target-not-found, invalid args, execution_failed — all covered in driver (2.1) and tools (5.x).
- §14 testing: ✅ unit tests per task; manual smoke tests in Phase 8.

**Placeholder scan:** none — all code blocks contain runnable code; all commands are exact.

**Type consistency:**
- `awaitConfirm(runId, toolCallId)` consistent in run-map, route, driver.
- `decision = { action, choice? }` consistent across confirm/choice flows.
- `caps = { softIterations, hardIterations, retryBudget, wallTimeoutMs }` consistent in caps.js + driver.js.
- `runId` (UUID from agent_runs.id) consistent everywhere.
- SSE event names: `run_id`, `needs_confirm`, `needs_choice`, `needs_softlimit_continue`, `tool_status` — consistent in driver, route, PromptDock dispatch.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-01-agent-promptdock-phase2.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
