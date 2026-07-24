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
    // Failure: restore the hold with a single zero-charge settle (now ONE atomic
    // transaction in ledger.js). If it fails, log LOUDLY (the hold was deducted
    // in a SEPARATE earlier commit, so a failed refund strands it — a debit with
    // no settlement row) and never mask `err`.
    //
    // ⚠️ KNOWN money-safety residual (Sol audit 2026-07-24, NOT closed here —
    // needs a feature): the hold and the settlement are separate commits, and
    // every op gets a fresh opId, so (a) a settlement that rolls back strands the
    // hold, and (b) a paid op that commits+settles then loses its HTTP/tool
    // response is RE-RUN by the client/agent under a NEW opId → the same logical
    // action is charged twice. The fix is LOGICAL-operation idempotency: a stable
    // key from the request/tool boundary + a durable operation record that dedups
    // or resumes on retry (and reconciles stranded holds). A per-opId marker does
    // NOT help — the opId is fresh per retry. Tracked in the 2026-07-23 handoff.
    try {
      await ledger.settleOperation({ sql, userId, opId, op, boardId, nodeId, events: ctx.events, holdCredits: estimate, chargeCredits: 0 });
    } catch (settleErr) {
      // eslint-disable-next-line no-console
      console.error(`[billing] refund-on-error FAILED (user=${userId} op=${op} opId=${opId} held=${estimate}) — balance may be debited:`, settleErr);
    }
    throw err;
  }
  const totalMicrocents = ctx.events.reduce((s, e) => s + (e.costMicrocents || 0), 0);
  const credits = billed ? creditsForOperation({ op, totalMicrocents }) : 0;
  let balanceAfter;
  try {
    ({ balanceAfter } = await ledger.settleOperation({
      sql, userId, opId, op, boardId, nodeId, events: ctx.events,
      holdCredits: billed ? estimate : 0, chargeCredits: credits,
    }));
  } catch (settleErr) {
    // Success-path settlement failed: the work is done but billing didn't settle,
    // so the hold is stranded (see the residual note above). Surface it loudly
    // rather than an opaque 500, then rethrow.
    // eslint-disable-next-line no-console
    console.error(`[billing] settle-on-success FAILED (user=${userId} op=${op} opId=${opId} held=${billed ? estimate : 0} charge=${credits}) — hold may be stranded:`, settleErr);
    throw settleErr;
  }
  return { result, credits, balanceAfter, opId };
}

export function runBilledOperation(opts, fn, deps) {
  return runOperation({ ...opts, billed: true }, fn, deps);
}

export function runMeteredOperation(opts, fn, deps) {
  return runOperation({ ...opts, billed: false }, fn, deps);
}
