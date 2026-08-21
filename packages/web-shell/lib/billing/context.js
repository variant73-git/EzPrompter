// lib/billing/context.js
/**
 * Billing operation context (spec §8-9) + logical-operation idempotency
 * (money-safety; spec 2026-07-24). A route opens ONE context per user-visible
 * operation; any seam deep in the stack records usage into the INNERMOST context
 * via AsyncLocalStorage — no userId threading.
 *
 * Lifecycle for a PAID op (or any op carrying an idempotency ticket):
 *   1. CLAIM — insert a durable `operations` row (keyed by the requester's
 *      ticket) and deduct the hold, in ONE atomic statement. If a row already
 *      exists: settled → replay the stored response (DEDUP, no second charge);
 *      in_flight → 409 in-progress; failed/expired → reclaim and re-run.
 *   2. RUN — the fn (LLM + side effects) records usage into the context.
 *   3. SETTLE — charge the real cost, store the replay response, flip the row to
 *      `settled`; OR on failure refund the hold and flip to `failed`. Both are a
 *      single atomic transaction, so a stranded hold can only be an in_flight row
 *      the reconciliation sweep (operations.js) finds and refunds.
 *
 * Without a ticket, a paid op still gets a durable row + reconcilable hold, but
 * a fresh key per call means NO dedup — the pre-existing behavior, made safe.
 * Metered (unbilled) ops with no ticket skip the operations table entirely
 * (lightweight path — they only meter usage, never hold or charge).
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { computeCostMicrocents, imageCostMicrocents } from '../agent/cost.js';
import { creditsForOperation, estimateOp } from './pricing.js';
import * as realLedger from './ledger.js';
import * as realOps from './operations.js';

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

// A retry arrived while the SAME logical operation is still running (its
// in_flight row is not yet settled). The caller should wait/retry — NOT start a
// second paid run.
export class OperationInProgressError extends Error {
  constructor({ op }) {
    super(`operation in progress: ${op}`);
    this.name = 'OperationInProgressError';
    this.status = 409;
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

// Unwrap a stored dedup response ({ response } wrapper written on settle) back to
// the caller's original payload.
function unwrapResult(stored) {
  if (stored && typeof stored === 'object' && Object.prototype.hasOwnProperty.call(stored, 'response')) return stored.response;
  return stored;
}

// Claim the logical operation (or short-circuit on dedup). Returns either
// { deduped: true, dedupResult } — replay the stored response, or
// { operationId } — we own the run. Throws InsufficientCredits / OperationInProgress.
async function claimOrDedup({ ops, sql, userId, idemKey, op, boardId, nodeId, estimate }) {
  const claim = await ops.claimOperation({ sql, userId, idemKey, op, boardId, nodeId, estimate });
  if (claim.outcome === 'insufficient') throw new InsufficientCreditsError({ estimate, balance: claim.balance, op });
  if (claim.outcome === 'claimed') return { operationId: claim.operationId };

  // duplicate — inspect the existing row.
  const row = claim.row;
  if (row.status === 'settled') {
    return { deduped: true, dedupResult: { result: unwrapResult(row.result), credits: Number(row.charge_credits || 0), balanceAfter: null, opId: row.id, deduped: true, usageMicrocents: null } };
  }
  if (row.status === 'in_flight') throw new OperationInProgressError({ op });

  // failed | expired → reclaim for a fresh attempt.
  const rc = await ops.reclaimOperation({ sql, userId, idemKey, estimate });
  if (rc.outcome === 'reclaimed') return { operationId: rc.operationId };
  if (rc.outcome === 'insufficient') throw new InsufficientCreditsError({ estimate, balance: rc.balance, op });
  // raced: another attempt moved the row. If it settled meanwhile, replay; else busy.
  if (rc.row?.status === 'settled') {
    return { deduped: true, dedupResult: { result: unwrapResult(rc.row.result), credits: Number(rc.row.charge_credits || 0), balanceAfter: null, opId: rc.row.id, deduped: true, usageMicrocents: null } };
  }
  throw new OperationInProgressError({ op });
}

async function runOperation({ sql, userId, op, boardId = null, nodeId = null, billed, idemKey = null }, fn, deps) {
  const ledger = deps || realLedger;
  const ops = deps || realOps; // tests inject one deps object providing both ledger + ops fns
  const estimate = billed ? estimateOp(op) : 0;
  // The operations table backs any PAID op or any op carrying a ticket. Metered
  // ops with no ticket stay on the lightweight path (meter-only, no row).
  const useOps = billed || !!idemKey;

  let operationId;
  if (useOps) {
    const key = idemKey || randomUUID(); // no ticket → fresh key → durable row, but no dedup
    const claimed = await claimOrDedup({ ops, sql, userId, idemKey: key, op, boardId, nodeId, estimate });
    if (claimed.deduped) return claimed.dedupResult;
    operationId = claimed.operationId;
  } else {
    operationId = randomUUID(); // audit id only — no operations row
  }

  const ctx = { events: [] };
  let result;
  try {
    result = await als.run(ctx, fn);
  } catch (err) {
    // Failure: refund the hold + flip the row to `failed`, atomically (one
    // transaction in ledger.js). If it fails, log LOUDLY — the hold is then a
    // stranded in_flight row the reconciliation sweep will refund — and never
    // mask `err`.
    try {
      await ledger.settleOperation({
        sql, userId, opId: operationId, op, boardId, nodeId, events: ctx.events,
        holdCredits: estimate, chargeCredits: 0, opStatus: useOps ? 'failed' : null,
      });
    } catch (settleErr) {
      // eslint-disable-next-line no-console
      console.error(`[billing] fail-settle FAILED (user=${userId} op=${op} opId=${operationId} held=${estimate}) — hold stranded (reconciliation will refund):`, settleErr);
    }
    throw err;
  }

  const totalMicrocents = ctx.events.reduce((s, e) => s + (e.costMicrocents || 0), 0);
  const credits = billed ? creditsForOperation({ op, totalMicrocents }) : 0;
  // Persist a replayable response ONLY when dedup is actually possible (an
  // explicit ticket was supplied). Fresh-key and metered rows store nothing —
  // they can never be deduped, so there is no response to replay.
  const storeResult = idemKey ? { response: result } : undefined;

  let balanceAfter;
  try {
    ({ balanceAfter } = await ledger.settleOperation({
      sql, userId, opId: operationId, op, boardId, nodeId, events: ctx.events,
      holdCredits: billed ? estimate : 0, chargeCredits: credits,
      opStatus: useOps ? 'settled' : null, result: storeResult,
    }));
  } catch (settleErr) {
    // Success-path settlement failed: the work is done but billing didn't settle,
    // so the hold is a stranded in_flight row (reconciliation refunds it). Surface
    // loudly rather than an opaque 500, then rethrow.
    // eslint-disable-next-line no-console
    console.error(`[billing] settle-on-success FAILED (user=${userId} op=${op} opId=${operationId} charge=${credits}) — hold stranded (reconciliation will refund):`, settleErr);
    throw settleErr;
  }
  return { result, credits, balanceAfter, opId: operationId, deduped: false, usageMicrocents: totalMicrocents };
}

// Paid operation. Pass `idemKey` in opts to enable retry-dedup (the requester's
// ticket); without it, behaves as before but with a durable, reconcilable record.
export function runBilledOperation(opts, fn, deps) {
  return runOperation({ ...opts, billed: true }, fn, deps);
}

// A paid op that carries an idempotency ticket. REQUIRES a nonempty `idemKey` —
// the name must never silently be non-idempotent (audit 2026-07-24): a missing
// key would mint a fresh UUID per call and re-charge on retry. Callers with no
// stable key must use runBilledOperation (explicitly best-effort) instead.
export function runIdempotentOperation(opts, fn, deps) {
  if (!opts || typeof opts.idemKey !== 'string' || opts.idemKey.length === 0) {
    throw new Error('runIdempotentOperation requires a nonempty idemKey (use runBilledOperation for keyless paid ops)');
  }
  return runOperation({ ...opts, billed: true }, fn, deps);
}

export function runMeteredOperation(opts, fn, deps) {
  return runOperation({ ...opts, billed: false }, fn, deps);
}
