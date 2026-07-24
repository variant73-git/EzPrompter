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
    // Failure: restore the hold via the settle's single balance UPDATE
    // (holdCredits=estimate, chargeCredits=0 → diff=estimate adds the hold back)
    // and persist the zero-charge metering. Replaces the old refundHold()+
    // settle(0,0) where BOTH errors were swallowed, so a transient refund
    // failure left the user debited behind a clean error. Now a settle failure
    // is logged LOUDLY (a debited-but-unrefunded balance is observable) and
    // never masks `err`. NOTE (pre-existing, tracked follow-up): settleOperation
    // is not yet transactional across (balance UPDATE + usage_events INSERT) nor
    // idempotent by opId — a durable RETRY of a partially-applied settlement
    // could double-refund; a per-opId settled-marker + a transaction is the
    // proper fix (it hardens the success path too).
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
