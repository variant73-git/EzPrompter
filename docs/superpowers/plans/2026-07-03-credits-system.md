# Credits System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Meter the real AI cost (micro-cents) of every operation in the web-shell and charge users dynamic credits per operation, with per-op margin, atomic holds, a ledger, welcome pack + anti-farm gates, and v1 UI (balance pill, estimates, block/plans modals).

**Architecture:** An AsyncLocalStorage billing context wraps each billable route (`runBilledOperation`); ~10 LLM/image seams call `recordUsage`/`recordImage` into the innermost context; at operation end the context settles an atomic hold into a `credit_ledger` charge with per-op multiplier pricing from a single config. Chat is meter-only (free). Spec: `docs/superpowers/specs/2026-07-03-credits-system-design.md`.

**Tech Stack:** Next.js app routes (nodejs runtime), postgres via the `sql` tagged-template helper (`lib/db.js`), Vitest, React client components in `components/`.

## Global Constraints

- All work in `packages/web-shell/` — run tests with `cd packages/web-shell && npx vitest run`.
- 1 credit = $0.01 of price. Internal cost unit = micro-cents (1¢ = 10,000 µ¢), integers only.
- Charge rounding: `max(5, ceil(raw/5)*5)` — once per operation, never per call.
- Per-op pricing (spec §3): compose/extract/transplant/edit 3× · extract.clone/styleclone + image.generate 4× · reconstruct 10× floor 150 · extract.html flat 25 · capture/chat free.
- Failures never charge (hold fully refunded); usage is ALWAYS recorded (even free/failed) for the monthly real-cost cap.
- All user-facing product text in ENGLISH.
- Welcome pack: 500 credits, once per identity (normalized email + device/IP 30-day window), global monthly budget env `WELCOME_BUDGET_MONTHLY_CREDITS`.
- Never break the existing 456-test suite; each task ends green.
- Email VERIFICATION FLOW (sending mail) is a separate follow-up plan; this plan only adds the `email_verified_at` column and treats accounts created BEFORE the migration as grandfathered (verified).

---

### Task 1: Micro-cent cost math in `lib/agent/cost.js`

**Files:**
- Modify: `packages/web-shell/lib/agent/cost.js`
- Test: `packages/web-shell/lib/agent/cost.test.js` (create if missing; check for an existing file first and append)

**Interfaces:**
- Produces: `computeCostMicrocents({ model, tokensIn, tokensOut, cachedInTokens, cacheWriteTokens })` → integer µ¢; `imageCostMicrocents({ provider, quality })` → integer µ¢; existing `computeCost` now derives from µ¢ (same results as before); `MODEL_PRICES` unchanged.

- [ ] **Step 1: Write the failing tests**

```js
// append to lib/agent/cost.test.js (create with vitest imports if absent)
import { describe, it, expect } from 'vitest';
import { computeCost, computeCostMicrocents, imageCostMicrocents } from './cost.js';

describe('computeCostMicrocents', () => {
  it('keeps sub-cent costs exact (the 0.02¢ Flash call)', () => {
    // gemini-2.5-flash: in $0.10/M, out $0.40/M → 12k in + 800 out
    // = $0.0012 + $0.00032 = $0.00152 = 0.152¢ = 1520 µ¢
    expect(computeCostMicrocents({ model: 'gemini-2.5-flash', tokensIn: 12000, tokensOut: 800 })).toBe(1520);
  });
  it('returns 0 for unknown models (conservative)', () => {
    expect(computeCostMicrocents({ model: 'nope', tokensIn: 1e6, tokensOut: 1e6 })).toBe(0);
  });
  it('computeCost derives from µ¢ (integer cents, unchanged behaviour)', () => {
    // gpt-5.5: 100k in + 10k out = $0.50 + $0.15 = 65¢
    expect(computeCost({ model: 'gpt-5.5', tokensIn: 100000, tokensOut: 10000 })).toBe(65);
  });
});

describe('imageCostMicrocents', () => {
  it('prices gpt-image-1 by quality', () => {
    expect(imageCostMicrocents({ provider: 'openai', quality: 'high' })).toBe(250000);   // $0.25
    expect(imageCostMicrocents({ provider: 'openai', quality: 'medium' })).toBe(60000);  // $0.06
  });
  it('prices Imagen fast flat and unknown providers at 0', () => {
    expect(imageCostMicrocents({ provider: 'gemini' })).toBe(40000);                     // $0.04
    expect(imageCostMicrocents({ provider: 'other' })).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd packages/web-shell && npx vitest run lib/agent/cost.test.js`
Expected: FAIL — `computeCostMicrocents` is not exported.

- [ ] **Step 3: Implement**

In `lib/agent/cost.js`, replace the body of `computeCost` and add the new exports (MODEL_PRICES and the doc comment stay):

```js
/**
 * Exact cost in MICRO-CENTS (1¢ = 10,000 µ¢), integer. This is the metering
 * unit — computeCost (integer cents) derives from it. Sub-cent calls (a
 * 0.02¢ Flash turn) stay exact instead of rounding to 0.
 */
export function computeCostMicrocents({ model, tokensIn = 0, tokensOut = 0, cachedInTokens = 0, cacheWriteTokens = 0 }) {
  const price = MODEL_PRICES[model];
  if (!price) return 0;
  const freshIn = Math.max(0, tokensIn - cachedInTokens);
  const cachedInRate   = price.cachedInPerM   != null ? price.cachedInPerM   : price.inPerM;
  const cacheWriteRate = price.cacheWritePerM != null ? price.cacheWritePerM : price.inPerM;
  const usd = (freshIn          / 1_000_000) * price.inPerM
            + (cachedInTokens   / 1_000_000) * cachedInRate
            + (cacheWriteTokens / 1_000_000) * cacheWriteRate
            + (tokensOut        / 1_000_000) * price.outPerM;
  return Math.round(usd * 1_000_000); // $ → µ¢ (100¢ × 10,000)
}

export function computeCost(args) {
  return Math.round(computeCostMicrocents(args) / 10_000);
}

// Per-image µ¢ by provider + quality. gpt-image-1's old flat 6¢ was the
// MEDIUM price while the adapter runs HIGH (~25¢) — quality is now explicit.
const IMAGE_PRICES_MICRO = {
  openai: { high: 250_000, medium: 60_000, low: 20_000 },
  gemini: { default: 40_000 }, // Imagen 3.0 fast
};

export function imageCostMicrocents({ provider, quality } = {}) {
  const p = IMAGE_PRICES_MICRO[provider];
  if (!p) return 0;
  return p[quality] ?? p.high ?? p.default ?? 0;
}

export function getCostPerImage(provider) {
  return Math.round(imageCostMicrocents({ provider }) / 10_000);
}
```

Delete the old `IMAGE_PRICES` const and the old bodies of `computeCost`/`getCostPerImage` (keep their export names). Keep `MODEL_PRICES` exactly as is.

- [ ] **Step 4: Run tests**

Run: `npx vitest run lib/agent/cost.test.js` → PASS. Then full suite: `npx vitest run` → all green (the chat route uses `computeCost`, results unchanged).

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(billing): micro-cent cost math + image prices by quality"`

---

### Task 2: Pricing config `lib/billing/pricing.js`

**Files:**
- Create: `packages/web-shell/lib/billing/pricing.js`
- Test: `packages/web-shell/lib/billing/pricing.test.js`

**Interfaces:**
- Produces: `OP_PRICING` (config object); `pricingFor(op)` (longest-prefix match); `roundCredits(raw)`; `creditsForOperation({ op, totalMicrocents })` → integer credits; `OP_ESTIMATES` + `estimateOp(op)` + `estimateChain(ops)` → integer credits. All pure.

- [ ] **Step 1: Failing tests**

```js
// lib/billing/pricing.test.js
import { describe, it, expect } from 'vitest';
import { roundCredits, creditsForOperation, estimateOp, estimateChain, pricingFor } from './pricing.js';

describe('roundCredits', () => {
  it('rounds UP to multiples of 5 with a floor of 5', () => {
    expect(roundCredits(159)).toBe(160);
    expect(roundCredits(161)).toBe(165);
    expect(roundCredits(0.9)).toBe(5);
    expect(roundCredits(155)).toBe(155);
  });
});

describe('creditsForOperation', () => {
  it('applies the per-op multiplier ($0.53 clone × 4 → 215)', () => {
    expect(creditsForOperation({ op: 'extract.clone', totalMicrocents: 530_000 })).toBe(215);
  });
  it('compose at 3× ($0.20 → 60)', () => {
    expect(creditsForOperation({ op: 'compose', totalMicrocents: 200_000 })).toBe(60);
  });
  it('reconstruct has a 150 floor even when cheap', () => {
    expect(creditsForOperation({ op: 'reconstruct', totalMicrocents: 100_000 })).toBe(150); // $0.10×10=100→floor
    expect(creditsForOperation({ op: 'reconstruct', totalMicrocents: 250_000 })).toBe(250);
  });
  it('static site clone is flat 25 regardless of measured cost', () => {
    expect(creditsForOperation({ op: 'extract.html', totalMicrocents: 0 })).toBe(25);
  });
  it('chat and capture are free', () => {
    expect(creditsForOperation({ op: 'chat', totalMicrocents: 5_000 })).toBe(0);
    expect(creditsForOperation({ op: 'capture', totalMicrocents: 0 })).toBe(0);
  });
  it('unknown extract.<to> falls back to the extract prefix (3×)', () => {
    expect(pricingFor('extract.designmd').mult).toBe(3);
    expect(creditsForOperation({ op: 'extract.designmd', totalMicrocents: 100_000 })).toBe(30);
  });
});

describe('estimates', () => {
  it('single-op estimates match the spec table', () => {
    expect(estimateOp('extract.clone')).toBe(250);
    expect(estimateOp('compose')).toBe(75);
    expect(estimateOp('reconstruct')).toBe(200);
  });
  it('chain estimate is the sum', () => {
    expect(estimateChain(['extract.clone', 'transplant', 'image.generate.gemini', 'image.generate.gemini']))
      .toBe(250 + 75 + 20 + 20);
  });
});
```

- [ ] **Step 2: Run** — `npx vitest run lib/billing/pricing.test.js` → FAIL (module missing).

- [ ] **Step 3: Implement**

```js
// lib/billing/pricing.js
/**
 * Per-operation pricing — the ONE place business levers live (spec §3).
 * mult = multiplier over real µ¢ cost · floorCredits = value floor ·
 * flat = fixed price (no token cost, e.g. static site clone) ·
 * free/meterOnly = charge 0 (usage still recorded).
 * Longest-prefix match: 'extract.clone' beats 'extract'.
 */
export const OP_PRICING = {
  'compose':            { mult: 3 },
  'extract':            { mult: 3 },
  'extract.clone':      { mult: 4 },
  'extract.styleclone': { mult: 4 },
  'extract.html':       { flat: 25 },
  'transplant':         { mult: 3 },
  'edit':               { mult: 3 },
  'reconstruct':        { mult: 10, floorCredits: 150 },
  'image.generate':     { mult: 4 },
  'chat':               { free: true },
  'capture':            { free: true },
};

export function pricingFor(op) {
  let key = String(op || '');
  while (key) {
    if (OP_PRICING[key]) return OP_PRICING[key];
    const i = key.lastIndexOf('.');
    key = i === -1 ? '' : key.slice(0, i);
  }
  return { mult: 3 }; // conservative default for unmapped ops
}

export function roundCredits(raw) {
  return Math.max(5, Math.ceil(raw / 5) * 5);
}

export function creditsForOperation({ op, totalMicrocents = 0 }) {
  const p = pricingFor(op);
  if (p.free) return 0;
  if (p.flat != null) return p.flat;
  const raw = (totalMicrocents * (p.mult || 3)) / 10_000; // µ¢ → credits (1 credit = 1¢)
  const rounded = roundCredits(raw);
  return p.floorCredits != null ? Math.max(p.floorCredits, rounded) : rounded;
}

// Pre-flight estimates (spec §4) — recalibrate later from ledger data.
export const OP_ESTIMATES = {
  'extract.clone': 250,
  'extract.styleclone': 300,
  'extract.html': 25,
  'extract': 30,
  'compose': 75,
  'transplant': 75,
  'edit': 50,
  'reconstruct': 200,
  'image.generate.openai': 100,
  'image.generate.gemini': 20,
  'image.generate': 100,
  'chat': 0,
  'capture': 0,
};

export function estimateOp(op) {
  let key = String(op || '');
  while (key) {
    if (OP_ESTIMATES[key] != null) return OP_ESTIMATES[key];
    const i = key.lastIndexOf('.');
    key = i === -1 ? '' : key.slice(0, i);
  }
  return 30;
}

export function estimateChain(ops) {
  return (ops || []).reduce((sum, op) => sum + estimateOp(op), 0);
}
```

- [ ] **Step 4: Run** — file tests PASS, full suite green.
- [ ] **Step 5: Commit** — `git commit -am "feat(billing): per-op pricing config with floors, flats and estimates"`

---

### Task 3: Migration — tables, columns, indexes

**Files:**
- Modify: `packages/web-shell/schema.sql` (append at end)
- Create: `packages/web-shell/migrations/2026-07-03-credits.sql` (same content, standalone for prod apply)

**Interfaces:**
- Produces: tables `usage_events`, `credit_ledger`; `users` columns `credits_cents, monthly_cost_cents, cost_window_start, email_verified_at, signup_ip, signup_device_hash`. Consumed by Tasks 4-19.

- [ ] **Step 1: Append the DDL (idempotent, matches the existing schema.sql style)**

```sql
-- ── Credits system (2026-07-03) ─────────────────────────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS credits_cents BIGINT DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS monthly_cost_cents BIGINT DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS cost_window_start TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS signup_ip TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS signup_device_hash TEXT;

-- Per-AI-call audit (metering; charge 0 rows included — cost cap counts them).
CREATE TABLE IF NOT EXISTS usage_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  op_id UUID NOT NULL,
  op VARCHAR(40) NOT NULL,
  board_id UUID,
  node_id UUID,
  provider VARCHAR(20),
  model VARCHAR(80),
  tokens_in INT DEFAULT 0,
  tokens_out INT DEFAULT 0,
  cached_in INT DEFAULT 0,
  images INT DEFAULT 0,
  cost_microcents BIGINT DEFAULT 0,
  charged BOOLEAN DEFAULT FALSE,
  meta JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS usage_events_user_time ON usage_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS usage_events_op ON usage_events(op_id);

-- Balance history — every credit movement (welcome/charge/refund/grant/purchase).
CREATE TABLE IF NOT EXISTS credit_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  delta_credits INT NOT NULL,
  reason VARCHAR(20) NOT NULL,
  op_id UUID,
  balance_after BIGINT NOT NULL,
  meta JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS credit_ledger_user_time ON credit_ledger(user_id, created_at DESC);
```

- [ ] **Step 2: Apply to the dev database**

Run: `psql "$DATABASE_URL" -f migrations/2026-07-03-credits.sql` (or paste into the Neon console — whichever the project uses for schema.sql today).
Verify: `psql "$DATABASE_URL" -c "\d usage_events"` shows the table; `\d users` shows `email_verified_at`.

- [ ] **Step 3: Retroactive grants for existing accounts** (spec §10 — run ONCE, after Task 6 ships `grantCredits`; keep the SQL here):

```sql
-- Existing accounts: grandfather verification + welcome 500.
UPDATE users SET email_verified_at = NOW() WHERE email_verified_at IS NULL;
WITH grants AS (
  UPDATE users SET credits_cents = COALESCE(credits_cents, 0) + 500
  WHERE NOT EXISTS (SELECT 1 FROM credit_ledger l WHERE l.user_id = users.id AND l.reason = 'welcome')
  RETURNING id, credits_cents
)
INSERT INTO credit_ledger (user_id, delta_credits, reason, balance_after, meta)
SELECT id, 500, 'welcome', credits_cents, '{"retroactive":true}' FROM grants;
```

- [ ] **Step 4: Commit** — `git commit -am "feat(billing): credits schema — usage_events, credit_ledger, users columns"`

---

### Task 4: Ledger primitives `lib/billing/ledger.js`

**Files:**
- Create: `packages/web-shell/lib/billing/ledger.js`
- Test: `packages/web-shell/lib/billing/ledger.test.js`

**Interfaces:**
- Consumes: `sql` tagged-template (passed in — every function takes `{ sql }` so tests inject fakes, same pattern as `lib/canvas-layout.js`).
- Produces:
  - `holdCredits({ sql, userId, credits })` → `{ held: boolean, balance: number }`
  - `refundHold({ sql, userId, credits })` → `{ balance }`
  - `settleOperation({ sql, userId, opId, op, boardId, nodeId, events, holdCredits, chargeCredits })` → `{ balanceAfter }`
  - `grantCredits({ sql, userId, credits, reason, meta })` → `{ balanceAfter }`
  - `getBalance({ sql, userId })` → number · `recentLedger({ sql, userId, limit })` → rows

- [ ] **Step 1: Failing tests** (fake `sql` records queries and returns scripted rows; follow the `seqSql` style from `lib/canvas-layout.test.js`)

```js
// lib/billing/ledger.test.js
import { describe, it, expect } from 'vitest';
import { holdCredits, refundHold, settleOperation, grantCredits } from './ledger.js';

// Scripted fake: returns queued row-sets in order; records every call's
// template strings so assertions can check the SQL shape.
function fakeSql(results) {
  let i = 0;
  const calls = [];
  const sql = (strings, ...values) => {
    calls.push({ text: strings.join('¶'), values });
    return Promise.resolve(results[i++] ?? []);
  };
  sql.calls = calls;
  return sql;
}

describe('holdCredits', () => {
  it('holds atomically — conditional UPDATE returns the new balance', async () => {
    const sql = fakeSql([[{ credits_cents: 320 }]]);
    const out = await holdCredits({ sql, userId: 'u1', credits: 75 });
    expect(out).toEqual({ held: true, balance: 320 });
    expect(sql.calls[0].text).toContain('credits_cents >=');
  });
  it('reports a failed hold when the conditional matches no row', async () => {
    const sql = fakeSql([[], [{ credits_cents: 10 }]]); // no row updated → balance read
    const out = await holdCredits({ sql, userId: 'u1', credits: 75 });
    expect(out.held).toBe(false);
    expect(out.balance).toBe(10);
  });
  it('zero-credit hold is a no-op success', async () => {
    const sql = fakeSql([[{ credits_cents: 50 }]]);
    const out = await holdCredits({ sql, userId: 'u1', credits: 0 });
    expect(out.held).toBe(true);
  });
});

describe('settleOperation', () => {
  it('refunds the difference, inserts events and one charge row', async () => {
    const sql = fakeSql([
      [{ credits_cents: 160 }], // balance adjustment RETURNING
      [],                       // usage_events insert
      [],                       // ledger insert
    ]);
    const out = await settleOperation({
      sql, userId: 'u1', opId: 'op1', op: 'compose',
      events: [{ provider: 'openai', model: 'gpt-5.5', tokensIn: 10, tokensOut: 5, cachedIn: 0, images: 0, costMicrocents: 200000, meta: {} }],
      holdCredits: 75, chargeCredits: 60,
    });
    expect(out.balanceAfter).toBe(160);
    const ledgerCall = sql.calls[2].text;
    expect(ledgerCall).toContain('credit_ledger');
    expect(sql.calls[2].values).toContain(-60); // delta_credits of the charge
  });
});

describe('refundHold / grantCredits', () => {
  it('refund adds the held credits back', async () => {
    const sql = fakeSql([[{ credits_cents: 500 }]]);
    const out = await refundHold({ sql, userId: 'u1', credits: 75 });
    expect(out.balance).toBe(500);
  });
  it('grant writes a ledger row with balance_after', async () => {
    const sql = fakeSql([[{ credits_cents: 500 }], []]);
    const out = await grantCredits({ sql, userId: 'u1', credits: 500, reason: 'welcome', meta: {} });
    expect(out.balanceAfter).toBe(500);
    expect(sql.calls[1].values).toContain('welcome');
  });
});
```

- [ ] **Step 2: Run** → FAIL (module missing).

- [ ] **Step 3: Implement**

```js
// lib/billing/ledger.js
/**
 * Balance + ledger primitives. Every function takes { sql } so tests inject
 * fakes. Money model: users.credits_cents IS the credit balance (1 credit =
 * 1¢ of price). Holds are real balance deductions (first come wins — spec
 * §9); settle refunds the difference to the actual charge and writes the
 * audit trail (usage_events) + one ledger 'charge' row per operation.
 */

export async function getBalance({ sql, userId }) {
  const rows = await sql`SELECT COALESCE(credits_cents, 0) AS c FROM users WHERE id = ${userId}`;
  return Number(rows[0]?.c ?? 0);
}

export async function holdCredits({ sql, userId, credits }) {
  const n = Math.max(0, Math.ceil(credits || 0));
  if (n === 0) {
    return { held: true, balance: await getBalance({ sql, userId }) };
  }
  const rows = await sql`
    UPDATE users SET credits_cents = credits_cents - ${n}
    WHERE id = ${userId} AND COALESCE(credits_cents, 0) >= ${n}
    RETURNING credits_cents
  `;
  if (rows.length) return { held: true, balance: Number(rows[0].credits_cents) };
  return { held: false, balance: await getBalance({ sql, userId }) };
}

export async function refundHold({ sql, userId, credits }) {
  const n = Math.max(0, Math.ceil(credits || 0));
  if (n === 0) return { balance: await getBalance({ sql, userId }) };
  const rows = await sql`
    UPDATE users SET credits_cents = COALESCE(credits_cents, 0) + ${n}
    WHERE id = ${userId}
    RETURNING credits_cents
  `;
  return { balance: Number(rows[0]?.credits_cents ?? 0) };
}

// Settle: adjust balance from hold→charge, persist events + charge row.
// diff > 0 → refund; diff < 0 → charge the excess (floored at 0 by GREATEST).
export async function settleOperation({ sql, userId, opId, op, boardId = null, nodeId = null, events = [], holdCredits: held = 0, chargeCredits = 0 }) {
  const diff = Math.ceil(held) - Math.ceil(chargeCredits);
  const rows = await sql`
    UPDATE users SET credits_cents = GREATEST(0, COALESCE(credits_cents, 0) + ${diff})
    WHERE id = ${userId}
    RETURNING credits_cents
  `;
  const balanceAfter = Number(rows[0]?.credits_cents ?? 0);
  for (const e of events) {
    await sql`
      INSERT INTO usage_events (user_id, op_id, op, board_id, node_id, provider, model, tokens_in, tokens_out, cached_in, images, cost_microcents, charged, meta)
      VALUES (${userId}, ${opId}, ${op}, ${boardId}, ${nodeId}, ${e.provider || null}, ${e.model || null},
              ${e.tokensIn || 0}, ${e.tokensOut || 0}, ${e.cachedIn || 0}, ${e.images || 0},
              ${e.costMicrocents || 0}, ${chargeCredits > 0}, ${JSON.stringify(e.meta || {})})
    `;
  }
  if (chargeCredits > 0) {
    await sql`
      INSERT INTO credit_ledger (user_id, delta_credits, reason, op_id, balance_after, meta)
      VALUES (${userId}, ${-Math.ceil(chargeCredits)}, ${'charge'}, ${opId}, ${balanceAfter}, ${JSON.stringify({ op })})
    `;
  }
  return { balanceAfter };
}

export async function grantCredits({ sql, userId, credits, reason, meta = {} }) {
  const n = Math.max(0, Math.ceil(credits || 0));
  const rows = await sql`
    UPDATE users SET credits_cents = COALESCE(credits_cents, 0) + ${n}
    WHERE id = ${userId}
    RETURNING credits_cents
  `;
  const balanceAfter = Number(rows[0]?.credits_cents ?? 0);
  await sql`
    INSERT INTO credit_ledger (user_id, delta_credits, reason, balance_after, meta)
    VALUES (${userId}, ${n}, ${reason}, ${balanceAfter}, ${JSON.stringify(meta)})
  `;
  return { balanceAfter };
}

export async function recentLedger({ sql, userId, limit = 10 }) {
  return sql`
    SELECT delta_credits, reason, op_id, balance_after, meta, created_at
    FROM credit_ledger WHERE user_id = ${userId}
    ORDER BY created_at DESC LIMIT ${limit}
  `;
}
```

- [ ] **Step 4: Run** → PASS + full suite green.
- [ ] **Step 5: Commit** — `git commit -am "feat(billing): ledger primitives — atomic hold, settle, grant"`

---

### Task 5: Billing context `lib/billing/context.js`

**Files:**
- Create: `packages/web-shell/lib/billing/context.js`
- Test: `packages/web-shell/lib/billing/context.test.js`

**Interfaces:**
- Consumes: `creditsForOperation`, `estimateOp` (Task 2); ledger functions (Task 4, injectable via `deps`); `computeCostMicrocents`, `imageCostMicrocents` (Task 1).
- Produces (used by every seam and route task):
  - `runBilledOperation({ sql, userId, op, boardId, nodeId }, fn, deps?)` → `{ result, credits, balanceAfter, opId }`; throws `InsufficientCreditsError` (has `.status = 402`, `.estimate`, `.balance`) BEFORE running `fn`; refunds hold and rethrows if `fn` throws.
  - `runMeteredOperation({ sql, userId, op, boardId, nodeId }, fn, deps?)` → same shape with `credits: 0` (no hold — chat).
  - `recordUsage({ provider, model, tokensIn, tokensOut, cachedIn, cacheWrite, meta })` — no-op outside a context.
  - `recordImage({ provider, model, images, quality, meta })` — no-op outside a context.

- [ ] **Step 1: Failing tests**

```js
// lib/billing/context.test.js
import { describe, it, expect, vi } from 'vitest';
import { runBilledOperation, runMeteredOperation, recordUsage, recordImage, InsufficientCreditsError } from './context.js';

function fakeDeps({ heldOk = true, balance = 1000 } = {}) {
  return {
    holdCredits: vi.fn(async () => ({ held: heldOk, balance })),
    refundHold: vi.fn(async () => ({ balance })),
    settleOperation: vi.fn(async ({ chargeCredits }) => ({ balanceAfter: balance - chargeCredits })),
  };
}
const sql = () => Promise.resolve([]);

describe('runBilledOperation', () => {
  it('meters usage recorded deep in the call stack and charges once', async () => {
    const deps = fakeDeps();
    const out = await runBilledOperation({ sql, userId: 'u1', op: 'compose' }, async () => {
      // deep code records without receiving userId
      recordUsage({ provider: 'openai', model: 'gpt-5.5', tokensIn: 20000, tokensOut: 6000 });
      return 'built';
    }, deps);
    // 20k in ($0.10) + 6k out ($0.09) = 190,000 µ¢ × 3 = 57¢ → 60 credits
    expect(out.result).toBe('built');
    expect(out.credits).toBe(60);
    expect(deps.settleOperation).toHaveBeenCalledOnce();
  });
  it('throws 402 BEFORE running fn when the hold fails', async () => {
    const deps = fakeDeps({ heldOk: false, balance: 10 });
    const fn = vi.fn();
    await expect(runBilledOperation({ sql, userId: 'u1', op: 'compose' }, fn, deps))
      .rejects.toBeInstanceOf(InsufficientCreditsError);
    expect(fn).not.toHaveBeenCalled();
  });
  it('refunds the whole hold and rethrows when fn throws (failure never charges)', async () => {
    const deps = fakeDeps();
    await expect(runBilledOperation({ sql, userId: 'u1', op: 'compose' }, async () => {
      recordUsage({ provider: 'openai', model: 'gpt-5.5', tokensIn: 1000, tokensOut: 100 });
      throw new Error('llm exploded');
    }, deps)).rejects.toThrow('llm exploded');
    expect(deps.refundHold).toHaveBeenCalled();
    expect(deps.settleOperation).toHaveBeenCalledWith(expect.objectContaining({ chargeCredits: 0 }));
  });
  it('records images with quality pricing', async () => {
    const deps = fakeDeps();
    const out = await runBilledOperation({ sql, userId: 'u1', op: 'image.generate' }, async () => {
      recordImage({ provider: 'openai', model: 'gpt-image-1', quality: 'high' });
    }, deps);
    expect(out.credits).toBe(100); // 250,000 µ¢ × 4 = 100¢ → 100 credits
  });
});

describe('nesting (innermost wins)', () => {
  it('chat outer stays free while the inner tool op charges its own price', async () => {
    const deps = fakeDeps();
    const outer = await runMeteredOperation({ sql, userId: 'u1', op: 'chat' }, async () => {
      recordUsage({ provider: 'gemini', model: 'gemini-2.5-flash', tokensIn: 12000, tokensOut: 800 }); // conversation
      const inner = await runBilledOperation({ sql, userId: 'u1', op: 'compose' }, async () => {
        recordUsage({ provider: 'openai', model: 'gpt-5.5', tokensIn: 20000, tokensOut: 6000 });
      }, deps);
      return inner;
    }, deps);
    expect(outer.credits).toBe(0);                 // conversation free
    expect(outer.result.credits).toBe(60);         // inner op charged
    // outer settle got ONLY the conversation event (1), not the tool's
    const outerSettle = deps.settleOperation.mock.calls.find((c) => c[0].op === 'chat');
    expect(outerSettle[0].events).toHaveLength(1);
  });
});

describe('recordUsage outside any context', () => {
  it('is a silent no-op', () => {
    expect(() => recordUsage({ provider: 'openai', model: 'gpt-5.5', tokensIn: 1 })).not.toThrow();
  });
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement**

```js
// lib/billing/context.js
/**
 * Billing operation context (spec §8-9). A route opens ONE context per
 * user-visible operation; any seam deep in the stack records usage into the
 * INNERMOST context via AsyncLocalStorage — no userId threading. On success
 * the hold settles to the real charge; on failure the hold is fully
 * refunded (failures meter but never charge).
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { computeCostMicrocents, imageCostMicrocents } from '../agent/cost.js';
import { creditsForOperation, estimateOp } from './pricing.js';
import * as realLedger from './ledger.js';

const als = new AsyncLocalStorage();

export class InsufficientCreditsError extends Error {
  constructor({ estimate, balance, op }) {
    super(`insufficient credits: ${op} needs ~${estimate}, balance ${balance}`);
    this.name = 'InsufficientCreditsError';
    this.status = 402;
    this.estimate = estimate;
    this.balance = balance;
    this.op = op;
  }
}

export function recordUsage({ provider, model, tokensIn = 0, tokensOut = 0, cachedIn = 0, cacheWrite = 0, meta = {} }) {
  const ctx = als.getStore();
  if (!ctx) return;
  ctx.events.push({
    provider, model, tokensIn, tokensOut, cachedIn, images: 0,
    costMicrocents: computeCostMicrocents({ model, tokensIn, tokensOut, cachedInTokens: cachedIn, cacheWriteTokens: cacheWrite }),
    meta,
  });
}

export function recordImage({ provider, model = null, images = 1, quality = null, meta = {} }) {
  const ctx = als.getStore();
  if (!ctx) return;
  ctx.events.push({
    provider, model, tokensIn: 0, tokensOut: 0, cachedIn: 0, images,
    costMicrocents: images * imageCostMicrocents({ provider, quality }),
    meta: { ...meta, quality },
  });
}

async function runOperation({ sql, userId, op, boardId = null, nodeId = null, billed }, fn, deps) {
  const ledger = deps || realLedger;
  const opId = randomUUID();
  const estimate = billed ? estimateOp(op) : 0;
  if (billed && estimate > 0) {
    const { held, balance } = await ledger.holdCredits({ sql, userId, credits: estimate });
    if (!held) throw new InsufficientCreditsError({ estimate, balance, op });
  }
  const ctx = { events: [] };
  let result;
  try {
    result = await als.run(ctx, fn);
  } catch (err) {
    // Failure: refund everything, persist the metering (charge 0), rethrow.
    if (billed && estimate > 0) await ledger.refundHold({ sql, userId, credits: estimate }).catch(() => {});
    await ledger.settleOperation({ sql, userId, opId, op, boardId, nodeId, events: ctx.events, holdCredits: 0, chargeCredits: 0 }).catch(() => {});
    throw err;
  }
  const totalMicrocents = ctx.events.reduce((s, e) => s + (e.costMicrocents || 0), 0);
  const credits = billed ? creditsForOperation({ op, totalMicrocents }) : 0;
  const { balanceAfter } = await ledger.settleOperation({
    sql, userId, opId, op, boardId, nodeId, events: ctx.events,
    holdCredits: billed ? estimate : 0, chargeCredits: credits,
  });
  return { result, credits, balanceAfter, opId };
}

export function runBilledOperation(opts, fn, deps) {
  return runOperation({ ...opts, billed: true }, fn, deps);
}

export function runMeteredOperation(opts, fn, deps) {
  return runOperation({ ...opts, billed: false }, fn, deps);
}
```

- [ ] **Step 4: Run** — context tests PASS (nesting works because `als.run` inside `fn` replaces the store for the inner scope and restores after). Full suite green.
- [ ] **Step 5: Commit** — `git commit -am "feat(billing): ALS operation context — hold, meter, settle, 402"`

---

### Task 6: Welcome pack + anti-farm `lib/billing/welcome.js`

**Files:**
- Create: `packages/web-shell/lib/billing/welcome.js`
- Create: `packages/web-shell/lib/billing/disposable-domains.js`
- Test: `packages/web-shell/lib/billing/welcome.test.js`

**Interfaces:**
- Consumes: `grantCredits` (Task 4).
- Produces: `WELCOME_CREDITS = 500`; `normalizeEmail(email)` → string; `isDisposableEmail(email)` → bool; `grantWelcomeIfEligible({ sql, userId, email, ip, deviceHash })` → `{ granted, credits, reason }`.

- [ ] **Step 1: Failing tests**

```js
// lib/billing/welcome.test.js
import { describe, it, expect, vi } from 'vitest';
import { normalizeEmail, isDisposableEmail, grantWelcomeIfEligible, WELCOME_CREDITS } from './welcome.js';

describe('normalizeEmail', () => {
  it('lowercases and strips plus-suffixes', () => {
    expect(normalizeEmail('Fulano+spam1@Gmail.com')).toBe('fulano@gmail.com');
    expect(normalizeEmail('a.b+x@empresa.com')).toBe('a.b@empresa.com');
  });
});

describe('isDisposableEmail', () => {
  it('flags known disposable domains', () => {
    expect(isDisposableEmail('x@mailinator.com')).toBe(true);
    expect(isDisposableEmail('x@gmail.com')).toBe(false);
  });
});

describe('grantWelcomeIfEligible', () => {
  function scriptedSql(results) {
    let i = 0;
    return () => Promise.resolve(results[i++] ?? []);
  }
  it('grants 500 to a clean signup', async () => {
    // queries: prior grant by email → none; ip/device window → none; monthly budget sum → 0; grant UPDATE; ledger INSERT
    const sql = scriptedSql([[], [], [{ total: 0 }], [{ credits_cents: 500 }], []]);
    const out = await grantWelcomeIfEligible({ sql, userId: 'u1', email: 'novo@gmail.com', ip: '1.2.3.4', deviceHash: 'd1' });
    expect(out).toEqual({ granted: true, credits: WELCOME_CREDITS, reason: 'ok' });
  });
  it('denies disposable emails without touching the db', async () => {
    const sql = vi.fn();
    const out = await grantWelcomeIfEligible({ sql, userId: 'u1', email: 'x@mailinator.com', ip: '1.2.3.4', deviceHash: 'd1' });
    expect(out.granted).toBe(false);
    expect(out.reason).toBe('disposable_email');
    expect(sql).not.toHaveBeenCalled();
  });
  it('denies a second pack from the same device/ip window', async () => {
    const sql = scriptedSql([[], [{ n: 1 }]]); // no email match, but ip/device hit
    const out = await grantWelcomeIfEligible({ sql, userId: 'u2', email: 'outro@gmail.com', ip: '1.2.3.4', deviceHash: 'd1' });
    expect(out.granted).toBe(false);
    expect(out.reason).toBe('identity_window');
  });
  it('denies when the global monthly budget is exhausted', async () => {
    process.env.WELCOME_BUDGET_MONTHLY_CREDITS = '1000';
    const sql = scriptedSql([[], [], [{ total: 900 }]]); // 900 + 500 > 1000
    const out = await grantWelcomeIfEligible({ sql, userId: 'u3', email: 'novo3@gmail.com', ip: '9.9.9.9', deviceHash: 'd9' });
    expect(out.granted).toBe(false);
    expect(out.reason).toBe('budget_exhausted');
    delete process.env.WELCOME_BUDGET_MONTHLY_CREDITS;
  });
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement**

```js
// lib/billing/disposable-domains.js
// Known throwaway-inbox domains (extend freely; checked by suffix).
export const DISPOSABLE_DOMAINS = new Set([
  'mailinator.com', 'guerrillamail.com', 'guerrillamail.info', '10minutemail.com',
  'tempmail.com', 'temp-mail.org', 'yopmail.com', 'trashmail.com', 'sharklasers.com',
  'getnada.com', 'dispostable.com', 'maildrop.cc', 'fakeinbox.com', 'mintemail.com',
  'throwawaymail.com', 'mohmal.com', 'tempinbox.com', 'mailnesia.com', 'spamgourmet.com',
  'mytemp.email', 'tmpmail.org', 'moakt.com', 'inboxkitten.com', 'emailondeck.com',
]);
```

```js
// lib/billing/welcome.js
/**
 * Welcome pack + anti-bot-farm identity gates (spec §6-7). Every gate lives
 * on IDENTITY or BUDGET — never on usage milestones (free exploration is
 * sacred). Ledger meta records email_norm/ip/device so the window checks
 * query the ledger itself (no extra table).
 */
import { DISPOSABLE_DOMAINS } from './disposable-domains.js';
import { grantCredits } from './ledger.js';

export const WELCOME_CREDITS = 500;
const WINDOW_DAYS = 30;

export function normalizeEmail(email) {
  const [local = '', domain = ''] = String(email || '').toLowerCase().trim().split('@');
  return `${local.split('+')[0]}@${domain}`;
}

export function isDisposableEmail(email) {
  const domain = String(email || '').toLowerCase().split('@')[1] || '';
  return DISPOSABLE_DOMAINS.has(domain);
}

export async function grantWelcomeIfEligible({ sql, userId, email, ip = null, deviceHash = null }) {
  if (isDisposableEmail(email)) return { granted: false, credits: 0, reason: 'disposable_email' };
  const emailNorm = normalizeEmail(email);

  const prior = await sql`
    SELECT 1 FROM credit_ledger
    WHERE reason = 'welcome' AND meta->>'email_norm' = ${emailNorm}
    LIMIT 1
  `;
  if (prior.length) return { granted: false, credits: 0, reason: 'email_already_granted' };

  const windowHit = await sql`
    SELECT 1 AS n FROM credit_ledger
    WHERE reason = 'welcome'
      AND created_at > NOW() - INTERVAL '${WINDOW_DAYS} days'
      AND ((${ip}::text IS NOT NULL AND meta->>'ip' = ${ip}) OR (${deviceHash}::text IS NOT NULL AND meta->>'device' = ${deviceHash}))
    LIMIT 1
  `;
  if (windowHit.length) return { granted: false, credits: 0, reason: 'identity_window' };

  const budget = parseInt(process.env.WELCOME_BUDGET_MONTHLY_CREDITS ?? '0', 10);
  if (budget > 0) {
    const spent = await sql`
      SELECT COALESCE(SUM(delta_credits), 0) AS total FROM credit_ledger
      WHERE reason = 'welcome' AND created_at > date_trunc('month', NOW())
    `;
    if (Number(spent[0]?.total ?? 0) + WELCOME_CREDITS > budget) {
      console.warn('[welcome] monthly budget exhausted — new signup got no pack');
      return { granted: false, credits: 0, reason: 'budget_exhausted' };
    }
  }

  await grantCredits({ sql, userId, credits: WELCOME_CREDITS, reason: 'welcome', meta: { email_norm: emailNorm, ip, device: deviceHash } });
  return { granted: true, credits: WELCOME_CREDITS, reason: 'ok' };
}
```

Note: the `INTERVAL '${WINDOW_DAYS} days'` interpolation inside a tagged template becomes a bind parameter — postgres accepts `NOW() - INTERVAL '30 days'` only as literal. Write it as `NOW() - make_interval(days => ${WINDOW_DAYS})` instead. Use that form in the implementation.

- [ ] **Step 4: Run** → PASS; full suite green.
- [ ] **Step 5: Commit** — `git commit -am "feat(billing): welcome pack with identity gates + global budget"`

---

### Task 7: Rate limits `lib/billing/rate-limit.js`

**Files:**
- Create: `packages/web-shell/lib/billing/rate-limit.js`
- Test: `packages/web-shell/lib/billing/rate-limit.test.js`

**Interfaces:**
- Produces: `checkChatRate({ sql, userId })` → `{ allowed, reason? }` (10/min via usage_events op='chat', 150 light turns/day); `checkOpsRate({ sql, userId })` → `{ allowed }` (6 charges/min via credit_ledger). Defaults via env `UNCRAFT_CHAT_PER_MIN`, `UNCRAFT_LIGHT_TURNS_PER_DAY`, `UNCRAFT_OPS_PER_MIN`.

- [ ] **Step 1: Failing tests**

```js
// lib/billing/rate-limit.test.js
import { describe, it, expect } from 'vitest';
import { checkChatRate, checkOpsRate } from './rate-limit.js';

const sqlReturning = (rows) => { let i = 0; return () => Promise.resolve(rows[i++] ?? []); };

describe('checkChatRate', () => {
  it('allows under both windows', async () => {
    const sql = sqlReturning([[{ n: 3 }], [{ n: 40 }]]);
    expect(await checkChatRate({ sql, userId: 'u1' })).toEqual({ allowed: true });
  });
  it('blocks past the per-minute burst', async () => {
    const sql = sqlReturning([[{ n: 10 }]]);
    const out = await checkChatRate({ sql, userId: 'u1' });
    expect(out.allowed).toBe(false);
    expect(out.reason).toBe('chat_per_minute');
  });
  it('blocks past the daily light-turn allowance', async () => {
    const sql = sqlReturning([[{ n: 1 }], [{ n: 150 }]]);
    const out = await checkChatRate({ sql, userId: 'u1' });
    expect(out.allowed).toBe(false);
    expect(out.reason).toBe('daily_light_turns');
  });
});

describe('checkOpsRate', () => {
  it('blocks a burst of billable operations', async () => {
    const sql = sqlReturning([[{ n: 6 }]]);
    expect((await checkOpsRate({ sql, userId: 'u1' })).allowed).toBe(false);
  });
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement**

```js
// lib/billing/rate-limit.js
/**
 * Anti-flood fences (spec §5, §7.5). Counters read the tables we already
 * write — usage_events for chat turns, credit_ledger for charges — so there
 * is no extra infrastructure and limits survive restarts/instances.
 */
const CHAT_PER_MIN = () => parseInt(process.env.UNCRAFT_CHAT_PER_MIN ?? '10', 10);
const LIGHT_PER_DAY = () => parseInt(process.env.UNCRAFT_LIGHT_TURNS_PER_DAY ?? '150', 10);
const OPS_PER_MIN = () => parseInt(process.env.UNCRAFT_OPS_PER_MIN ?? '6', 10);

export async function checkChatRate({ sql, userId }) {
  const minute = await sql`
    SELECT COUNT(*)::int AS n FROM usage_events
    WHERE user_id = ${userId} AND op = 'chat' AND created_at > NOW() - make_interval(mins => 1)
  `;
  if (Number(minute[0]?.n ?? 0) >= CHAT_PER_MIN()) return { allowed: false, reason: 'chat_per_minute' };
  const day = await sql`
    SELECT COUNT(*)::int AS n FROM usage_events
    WHERE user_id = ${userId} AND op = 'chat' AND charged = FALSE AND created_at > NOW() - make_interval(hours => 24)
  `;
  if (Number(day[0]?.n ?? 0) >= LIGHT_PER_DAY()) return { allowed: false, reason: 'daily_light_turns' };
  return { allowed: true };
}

export async function checkOpsRate({ sql, userId }) {
  const minute = await sql`
    SELECT COUNT(*)::int AS n FROM credit_ledger
    WHERE user_id = ${userId} AND reason = 'charge' AND created_at > NOW() - make_interval(mins => 1)
  `;
  return { allowed: Number(minute[0]?.n ?? 0) < OPS_PER_MIN() };
}
```

- [ ] **Step 4: Run** → PASS; suite green.
- [ ] **Step 5: Commit** — `git commit -am "feat(billing): chat + ops rate limits on existing tables"`

---

### Task 8: Instrument `lib/extract-llm.js` (clone/describe seams)

**Files:**
- Modify: `packages/web-shell/lib/extract-llm.js` (functions `callText`, `callVision`)
- Test: `packages/web-shell/lib/extract-llm.usage.test.js` (new file — the existing extract tests mock this whole module, they stay untouched)

**Interfaces:**
- Consumes: `recordUsage` (Task 5).
- Produces: every `callText`/`callVision` call records usage into the ambient context. Return values UNCHANGED (still plain text) — callers don't change.

- [ ] **Step 1: Failing test** — mock the SDKs class-style (project convention from `style-extract.test.js`: `default: class { ... }`), run inside a metered context, assert the event landed:

```js
// lib/extract-llm.usage.test.js
import { describe, it, expect, vi } from 'vitest';

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = {
      stream: () => ({
        finalMessage: async () => ({
          content: [{ text: '<html>x</html>' }],
          usage: { input_tokens: 1200, output_tokens: 300, cache_read_input_tokens: 200, cache_creation_input_tokens: 0 },
        }),
      }),
    };
  },
}));
vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create: async () => (async function* () {
      yield { choices: [{ delta: { content: 'hi' } }] };
      yield { choices: [], usage: { prompt_tokens: 900, completion_tokens: 150, prompt_tokens_details: { cached_tokens: 100 } } };
    })() } };
  },
}));
vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContent: async () => ({
      text: 'tokens md',
      usageMetadata: { promptTokenCount: 500, candidatesTokenCount: 80, cachedContentTokenCount: 0 },
    }) };
  },
}));

import { describeImageAsTokens } from './extract-llm.js';
import { runMeteredOperation } from './billing/context.js';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';

describe('extract-llm usage metering', () => {
  it('records Gemini usage into the ambient billing context', async () => {
    process.env.GEMINI_API_KEY = 'test';
    const settle = vi.fn(async () => ({ balanceAfter: 0 }));
    await runMeteredOperation({ sql: () => Promise.resolve([]), userId: 'u1', op: 'extract.tokens' }, async () => {
      await describeImageAsTokens({ dataUrl: PNG, model: 'gemini-2.5-flash' });
    }, { holdCredits: vi.fn(), refundHold: vi.fn(), settleOperation: settle });
    const events = settle.mock.calls[0][0].events;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ provider: 'gemini', model: 'gemini-2.5-flash', tokensIn: 500, tokensOut: 80 });
  });
});
```

- [ ] **Step 2: Run** → FAIL (no event recorded).

- [ ] **Step 3: Implement** — in `lib/extract-llm.js` add the import and record at each provider return point:

```js
import { recordUsage } from './billing/context.js';
```

In `callText` (Anthropic branch), after `finalMessage()`:
```js
    const final = await client.messages.stream({ /* unchanged */ }).finalMessage();
    recordUsage({
      provider: 'anthropic', model,
      tokensIn: final.usage?.input_tokens || 0,
      tokensOut: final.usage?.output_tokens || 0,
      cachedIn: final.usage?.cache_read_input_tokens || 0,
      cacheWrite: final.usage?.cache_creation_input_tokens || 0,
    });
    return (final.content?.map((b) => b.text || '').join('') || '').trim();
```

In `callText` (Gemini branch), after `generateContent`:
```js
    const u = resp.usageMetadata || {};
    recordUsage({ provider: 'gemini', model, tokensIn: u.promptTokenCount || 0, tokensOut: u.candidatesTokenCount || 0, cachedIn: u.cachedContentTokenCount || 0 });
```

In `callVision`: same two blocks for Anthropic and Gemini; the OpenAI streaming branch needs usage enabled and captured:
```js
    const stream = await client.chat.completions.create({
      /* unchanged args */,
      stream: true,
      stream_options: { include_usage: true },
    });
    let text = '';
    let usage = null;
    for await (const chunk of stream) {
      const delta = chunk?.choices?.[0]?.delta?.content;
      if (typeof delta === 'string') text += delta;
      if (chunk?.usage) usage = chunk.usage;
    }
    recordUsage({
      provider: 'openai', model,
      tokensIn: usage?.prompt_tokens || 0,
      tokensOut: usage?.completion_tokens || 0,
      cachedIn: usage?.prompt_tokens_details?.cached_tokens || 0,
    });
    return text.trim();
```

- [ ] **Step 4: Run** — new test PASS; run the whole suite (`npx vitest run`) — the existing extract/clone tests mock `extract-llm.js` wholesale and stay green.
- [ ] **Step 5: Commit** — `git commit -am "feat(billing): meter extract-llm seams (3 providers, openai stream usage)"`

---

### Task 9: Instrument `lib/run-flow.js`, `lib/design/style-extract.js`, `lib/design-md.js`

**Files:**
- Modify: the three files' LLM call sites (same three provider shapes as Task 8)
- Test: `packages/web-shell/lib/run-flow.usage.test.js`

**Interfaces:** identical pattern to Task 8 — `recordUsage` after each provider response; returns unchanged.

- [ ] **Step 1: Failing test** — mirror Task 8's mock structure but import `runCompose`'s `callLLM` path indirectly: mock the SDKs, call the exported compose-adjacent function that reaches `callLLM` with a `gemini-2.5-flash` model and assert the settle event. Follow the existing `run-flow.test.js` for how runCompose is invoked with mocked SDKs (class-based mocks — project convention), wrap in `runMeteredOperation` with a spy `settleOperation`, assert `events[0].provider`.

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** — open each file, find every `messages.stream(...).finalMessage()` (Anthropic), `chat.completions.create({ stream: true ... })` (OpenAI) and `models.generateContent(...)` (Gemini) call; add the exact `recordUsage` blocks from Task 8 (adjusting the `model` variable name in scope). For OpenAI streaming sites add `stream_options: { include_usage: true }` and the `usage` capture loop. Import `recordUsage` from `'./billing/context.js'` (adjust relative path: `'../billing/context.js'` inside `lib/design/`).

- [ ] **Step 4: Run** → PASS + suite green (existing run-flow tests use class mocks without usage fields — `recordUsage` receives zeros and no context is open, so it no-ops).
- [ ] **Step 5: Commit** — `git commit -am "feat(billing): meter run-flow, style-extract, design-md seams"`

---

### Task 10: Instrument `lib/demarcelize.js` + `lib/reconstruct.js`

**Files:**
- Modify: both files' LLM call sites
- Test: extend `lib/run-flow.usage.test.js` with one demarcelize case (same mock harness)

Steps identical in shape to Task 9 (failing test → run → add `recordUsage` blocks per provider branch → run → commit `"feat(billing): meter demarcelize + reconstruct seams"`). `reconstruct.js` calls GPT-5.5 via the OpenAI SDK — same streaming/usage capture as Task 8's OpenAI block if streamed, or `resp.usage` directly if non-streaming (check the call site; non-streaming responses carry `usage` on the response object).

---

### Task 11: Instrument image adapters

**Files:**
- Modify: `packages/web-shell/lib/image-gen/openai-image.js`, `packages/web-shell/lib/image-gen/gemini-imagen.js`
- Test: `packages/web-shell/lib/image-gen/usage.test.js`

**Interfaces:**
- Consumes: `recordImage` (Task 5).
- Produces: every generated/edited image records `{ provider, quality }`; `generateOpenAIImage` passes its actual `quality` (currently hardcoded `'high'`).

- [ ] **Step 1: Failing test** — mock the SDK class-style, run `generateOpenAIImage` inside `runMeteredOperation` with a spy settle, assert one event `{ provider: 'openai', images: 1 }` with `costMicrocents: 250000`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** — in `openai-image.js` after a successful response: `recordImage({ provider: 'openai', model, quality: 'high', meta: { mode: baseImageDataUrl ? 'edit' : 'generate' } });` (import from `'../billing/context.js'`). In `gemini-imagen.js` after success: `recordImage({ provider: 'gemini', model, meta: { mode: 'generate' } });`
- [ ] **Step 4: Run** → PASS + suite green (clone-images cleanup path now meters too, inside whatever op is open).
- [ ] **Step 5: Commit** — `git commit -am "feat(billing): meter image adapters by quality"`

---

### Task 12: Instrument agent adapters

**Files:**
- Modify: `packages/web-shell/lib/agent/llm-anthropic.js`, `llm-openai.js`, `llm-gemini.js`
- Test: extend `lib/image-gen/usage.test.js` file or create `lib/agent/llm-usage.test.js` with one adapter case

Each adapter already extracts usage for the driver's aggregation — add a `recordUsage({ provider, model, ...sameFields })` right where usage is read (import from `'../billing/context.js'`). Driver and `agent_runs` persistence stay untouched (they keep run status + totals). Steps: failing test (mock SDK, call adapter inside metered ctx, assert event) → implement → suite green → commit `"feat(billing): agent adapters record into billing context"`.

---

### Task 13: Wire billable routes (run, extract, images/generate)

**Files:**
- Modify: `packages/web-shell/app/api/nodes/[id]/run/route.js`
- Modify: `packages/web-shell/app/api/nodes/[id]/extract/route.js`
- Modify: `packages/web-shell/app/api/images/generate/route.js`
- Modify: `packages/web-shell/lib/canvas-api.js` (client: surface `balanceAfter`, throw typed 402)
- Test: `packages/web-shell/app/api/billing-wiring.test.js` (route-level with mocked lib modules — follow the project's existing route test pattern if one exists; otherwise test the exported handler with a stubbed `requireUser`)

**Interfaces:**
- Produces: each route returns `..., credits, balanceAfter` on success; on insufficient balance returns `402 { error: 'insufficient_credits', estimate, balance }`. Client `api.*` helpers dispatch `window.dispatchEvent(new CustomEvent('uncraft:balance', { detail: { balance } }))` whenever a response carries `balanceAfter`, and throw an error object with `.code = 'insufficient_credits'`, `.estimate`, `.balance` on 402.

- [ ] **Step 1: Failing test** for the run route wrapper behaviour (mock `runCompose` and the billing context deps; assert 402 passthrough and balance in response).

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement.** Pattern for `nodes/[id]/run` (the section ▶ hits this per node, so flow-billing-per-node falls out automatically):

```js
import { runBilledOperation, InsufficientCreditsError } from '../../../../../lib/billing/context.js';
import { checkOpsRate } from '../../../../../lib/billing/rate-limit.js';

// ...inside POST, after target ownership check:
  const rate = await checkOpsRate({ sql, userId: user.id });
  if (!rate.allowed) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  try {
    const { result, credits, balanceAfter } = await runBilledOperation(
      { sql, userId: user.id, op: 'compose', boardId: target.board_id, nodeId: target.id },
      async () => {
        /* the ENTIRE existing body that calls runCompose + saves the snapshot,
           unchanged, moved inside and returning its current response payload */
      },
    );
    return NextResponse.json({ ...result, credits, balanceAfter });
  } catch (err) {
    if (err instanceof InsufficientCreditsError) {
      return NextResponse.json({ error: 'insufficient_credits', estimate: err.estimate, balance: err.balance }, { status: 402 });
    }
    throw err;
  }
```

`extract/route.js`: same wrapper with `op: \`extract.${to}\`` (the pricing prefix resolves clone 4× / html flat 25 / others 3×). `images/generate/route.js`: `op: 'image.generate'`. In `lib/canvas-api.js`, in the shared fetch helper: parse 402 into the typed error; after ANY ok response, if `data.balanceAfter != null` dispatch the `uncraft:balance` event.

- [ ] **Step 4: Run** → PASS + suite green.
- [ ] **Step 5: Commit** — `git commit -am "feat(billing): bill compose/extract/image routes with 402 + balance"`

---

### Task 14: Chat route meter-only + billable tools

**Files:**
- Modify: `packages/web-shell/app/api/chat/route.js`
- Modify: `packages/web-shell/lib/agent/tools/run-flow.js` (or wherever the runFlow executor lives — grep `buildFullRegistry` for the tool files), `create-image.js`, `edit-site.js`
- Test: extend `app/api/billing-wiring.test.js`

**Interfaces:**
- Chat route wraps the WHOLE agent loop in `runMeteredOperation({ op: 'chat' })` (conversation free but metered — replaces the current `hasEnoughCredits(100)` pre-check + `computeCost` block, which is DELETED); before the loop, `checkChatRate` → 429 with `{ error: 'rate_limited', reason }` mapped to a friendly SSE error event (copy: "Daily free chat limit reached — paid operations are still available.").
- Each destructive/billable tool executor wraps ITS work in `runBilledOperation` with its op (`runFlow` → `'compose'`, `createImage` → `'image.generate'`, `editSite` → `'edit'`); an inner 402 returns a structured tool error `{ error: 'insufficient_credits', estimate, balance }` so the agent can tell the user instead of crashing the run.

Steps: failing test (light chat run charges 0 + one usage event; runFlow tool inside chat produces its own charge) → implement → suite green → commit `"feat(billing): chat meter-only + tools billed as their own operations"`.

---

### Task 15: Capture always-free + deliberate reconstruct + signup welcome

**Files:**
- Modify: `packages/web-shell/lib/snapshot.js` (stop auto-delegating to `reconstructPage`; static capture always; return `animatedDetected: true` in the result meta when the probe scores ≥2)
- Create: `packages/web-shell/app/api/nodes/[id]/reconstruct/route.js` (POST — ownership check like the run route, wraps `reconstructPage(url)` in `runBilledOperation({ op: 'reconstruct' })`, saves the new snapshot, returns `{ node, credits, balanceAfter }`)
- Modify: `packages/web-shell/app/api/auth/signup/route.js` (capture `signup_ip` from `request.headers.get('x-forwarded-for')` first hop + `deviceHash` from body; after INSERT call `grantWelcomeIfEligible`; response includes `{ welcome: { granted, credits } }`)
- Test: extend `app/api/billing-wiring.test.js` (reconstruct 402; signup grants once)

Steps: failing tests → implement → run (the snapshot-route SSE keeps its progress events; the reconstruct branch inside it is removed — the route finishes fast with the static capture and the client decides) → suite green → commit `"feat(billing): free capture + billed reconstruct route + signup welcome pack"`.

---

### Task 16: Balance API + CreditsPill

**Files:**
- Create: `packages/web-shell/app/api/billing/balance/route.js`
- Create: `packages/web-shell/components/CreditsPill.jsx`
- Modify: `packages/web-shell/components/CanvasClient.jsx` (mount the pill next to UserPill)
- Modify: `packages/web-shell/app/globals.css` (`.credits-pill*` — frosted family, popup vars)
- Test: `packages/web-shell/components/CreditsPill.test.jsx` (RTL, jsdom — project already has RTL infra)

**Interfaces:**
- `GET /api/billing/balance` → `{ credits: number, ledger: [{ delta_credits, reason, created_at, meta }] }` (requireUser; `getBalance` + `recentLedger`).
- `<CreditsPill />`: fetches on mount; subscribes to `window` event `'uncraft:balance'` to update instantly after any billed call; click toggles a small frosted dropdown listing the last 10 ledger lines (`Clone −215`, `Welcome +500`) formatted from `meta.op`/`reason`.

Steps: failing RTL test (renders balance from fetch mock; updates on the custom event) → implement component + route + CSS (reuse `--popup-*` vars; pill matches `.canvas-toolbars-right` chip sizing) → tests pass → commit `"feat(billing): balance endpoint + credits pill"`.

---

### Task 17: Block modal + Plans modal

**Files:**
- Create: `packages/web-shell/components/PlansModal.jsx`
- Modify: `packages/web-shell/components/CanvasClient.jsx` (state `insufficientCredits` `{ estimate, balance }` set wherever `api.*` throws `.code === 'insufficient_credits'` — the runOneTarget/extract/image call sites; render `ConfirmModal`-styled block modal; "Buy credits" opens `PlansModal`)
- Modify: `packages/web-shell/app/globals.css` (`.plans-modal*`)
- Test: `packages/web-shell/components/PlansModal.test.jsx`

**Interfaces & copy (EN, spec §11):**
- Block modal: title "Not enough credits", message `This run needs ~{estimate} credits — you have {balance}.`, buttons [Cancel] [Buy credits].
- `PlansModal`: 3 columns — **Free** (badge "Current plan": "500 welcome credits · pay-as-you-go coming soon"), **Pro $12/mo** ("1,500 credits every month"), **Ultimate $39/mo** ("6,000 credits every month"); CTA buttons disabled with "Coming soon"; every CTA click POSTs `fetch('/api/billing/balance', { method: 'GET' })`? — NO: log demand via `navigator.sendBeacon` is out of scope; instead each click inserts nothing server-side in v1 — render a toast "You're on the list — plans are coming soon." and `console.info('[plans] click', plan)`. Keep it dumb; demand metrics come with Stripe in v2.

Steps: failing RTL tests (block modal renders estimate/balance; Buy credits opens plans; plan CTA shows toast) → implement → pass → commit `"feat(billing): insufficient-credits modal + plans modal (waitlist)"`.

---

### Task 18: Estimates in the UI + animated-site choice + transient debit

**Files:**
- Modify: `packages/web-shell/components/CanvasClient.jsx`:
  1. Section ▶ estimate: in `runSectionFlow`/the pill render, map the chain's runnable nodes to ops (site target → `'compose'`, asset target → `'image.generate'`) and show `≈ {estimateChain(ops)} cr` in the pill title attribute + in the existing re-run ConfirmModal message line.
  2. Animated-site choice: after `handleAddUrl`'s capture response, when `node.meta.animatedDetected`, show a `ConfirmModal`: title "Animated site detected", message "Quick capture saved (free) — animations are frozen. Rebuild it live with AI for ≈ 150-250 credits?", confirm "Reconstruct (~200 cr)" → `api.reconstructNode(id)` (add to `lib/canvas-api.js`), cancel "Keep free capture".
  3. Transient debit: when a billed api call resolves with `credits > 0`, set `nodeDebits: Map<nodeId, credits>` state entry and clear after 2.5s; `CanvasNode` receives optional prop `debit` and renders `−{debit}` in a small `.cnode-debit` chip (fade-out CSS animation, category-colour text) anchored top-right of the body.
- Modify: `packages/web-shell/lib/billing/estimates-client.js` — NO: `pricing.js` is pure JS with no node deps, import `estimateChain` directly in the client component (verify no server-only imports in its module graph — it has none).
- Test: extend `lib/billing/pricing.test.js` with the chain-mapping helper if extracted; UI verified manually (browser smoke).

Steps: implement (no new unit surface beyond what Task 2 covers; keep the chain→ops mapper as a small exported pure function `sectionOps(section, nodes, edges)` in `lib/section-run.js` WITH a unit test in `lib/section-run.test.js`: site terminal → `['compose']`, asset terminal → `['image.generate']`) → suite green → commit `"feat(billing): chain estimates, animated-site choice, transient node debits"`.

---

### Task 19: Archetype range tests + docs

**Files:**
- Create: `packages/web-shell/lib/billing/archetypes.test.js`
- Modify: `CLAUDE.md` (one summary line in the session-items list), `docs/superpowers/specs/2026-07-03-credits-system-design.md` (mark §14 defaults as shipped values)

- [ ] **Step 1: Write the archetype tests** (pure — fixture µ¢ per op from the spec's typical costs, assert the charged range):

```js
// lib/billing/archetypes.test.js
import { describe, it, expect } from 'vitest';
import { creditsForOperation } from './pricing.js';

const charge = (op, usd) => creditsForOperation({ op, totalMicrocents: Math.round(usd * 1_000_000) });

describe('flow archetypes land in their spec ranges (spec §4)', () => {
  it('prompt → site', () => {
    const total = charge('compose', 0.20);
    expect(total).toBeGreaterThanOrEqual(60); expect(total).toBeLessThanOrEqual(90);
  });
  it('image clone (clean / with cleanup regions)', () => {
    expect(charge('extract.clone', 0.53)).toBe(215);
    expect(charge('extract.clone', 0.53 + 0.25)).toBeGreaterThanOrEqual(315);
  });
  it('rebrand = extract + transplant', () => {
    const total = charge('extract.designmd', 0.05) + charge('transplant', 0.25);
    expect(total).toBeGreaterThanOrEqual(90); expect(total).toBeLessThanOrEqual(105);
  });
  it('reconstruct floor + typical', () => {
    expect(charge('reconstruct', 0.05)).toBe(150);
    expect(charge('reconstruct', 0.20)).toBe(200);
  });
  it('full showcase with Imagen stays under the 500 welcome pack', () => {
    const total = charge('extract.clone', 0.53) + charge('extract.designmd', 0.05)
      + charge('transplant', 0.25) + 2 * charge('image.generate', 0.04);
    expect(total).toBeLessThanOrEqual(500);
  });
});
```

- [ ] **Step 2: Run** → PASS (if any range misses, the PRICING numbers are wrong — fix `OP_PRICING`/spec, not the test).
- [ ] **Step 3: Docs** — CLAUDE.md item line: `146. ✅ **Sistema de créditos v1** — medição µ¢ em todos os funis, contexto ALS, hold atômico, ledger, welcome 500 + anti-farm, rate limits, rotas 402, CreditsPill + modais, capture grátis vs reconstruct 10×/piso 150. Spec: docs/superpowers/specs/2026-07-03-credits-system-design.md`.
- [ ] **Step 4: Full suite** → green. **Commit** — `git commit -am "test(billing): archetype price ranges + docs"`

---

## Self-Review (done while writing)

- **Spec coverage:** §2 math → T1-2 · §3 table → T2 · §4 flows/estimates → T2, T13 (per-node via run route), T18 · §5 chat fences → T7, T14 · §6 welcome → T6, T15 · §7 anti-farm → T6 (gates/budget), T7 (rates), T3 (identity columns; behavioral flags v1 = the ledger/usage data itself, queries ad-hoc) · §8 seams/context → T5, T8-12 · §9 hold/settle → T4-5 · §10 data → T3-4 · §11 UX → T16-18 · §12 email-verification flow → explicitly out (separate plan; column shipped in T3) · §13 tests → embedded per task + T19.
- **Type consistency:** `recordUsage`/`recordImage` signatures match between T5 and T8-12; ledger function shapes match between T4 and T5/T6; `estimateChain` name consistent T2/T18; error surface `insufficient_credits` consistent T13/T14/T17.
- **Placeholders:** none — every code step shows the code; T9/T10/T12/T14/T15 reference exact patterns defined verbatim in T8/T13.
