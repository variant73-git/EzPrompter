// lib/idempotency.js — client-side idempotency ticket manager (money-safety;
// spec 2026-07-24 §8). ONE stable ticket per logical user action, minted on the
// first send, REUSED on retry, cleared on confirmed completion.
//
// Why: a paid request can commit + charge on the server and then lose its
// response (network drop). If the client re-sends with a FRESH key, the server
// can't tell it's a retry → the same action is charged twice. So the client
// carries a stable ticket keyed by the ACTION (e.g. `extract:<node>:<to>`):
//   - kept while the action is in flight → a retry of the same gesture reuses it
//     and the server dedups (no second charge);
//   - mirrored to localStorage → survives a page reload mid-flight (otherwise the
//     in-memory ticket is lost and the re-trigger double-charges);
//   - cleared on a completed response → a later, deliberate redo of the identical
//     action mints a NEW ticket and PAYS, matching the product rule (results are
//     consistent; a deliberate re-run always pays).

const MEM = new Map(); // actionKey -> ticket (fast path within a session)
const LS_KEY = 'uncraft:idem-pending';

function uuid() {
  try {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') return globalThis.crypto.randomUUID();
  } catch { /* no crypto */ }
  return `idem-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

function loadLS() {
  try {
    const raw = globalThis.localStorage && globalThis.localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function saveLS(obj) {
  try { globalThis.localStorage && globalThis.localStorage.setItem(LS_KEY, JSON.stringify(obj)); } catch { /* private mode / SSR */ }
}

// Get (or mint) the pending ticket for a logical action. Idempotent: the same
// actionKey returns the same ticket until it is cleared — across the in-memory
// map AND the localStorage mirror (so a reload keeps the same ticket).
export function ticketFor(actionKey) {
  if (MEM.has(actionKey)) return MEM.get(actionKey);
  const ls = loadLS();
  if (ls[actionKey]) { MEM.set(actionKey, ls[actionKey]); return ls[actionKey]; }
  const t = uuid();
  MEM.set(actionKey, t);
  ls[actionKey] = t;
  saveLS(ls);
  return t;
}

// Forget a completed action's ticket (both mirrors). A future identical gesture
// mints a fresh ticket and is billed as a new action.
export function clearTicket(actionKey) {
  MEM.delete(actionKey);
  const ls = loadLS();
  if (Object.prototype.hasOwnProperty.call(ls, actionKey)) {
    delete ls[actionKey];
    saveLS(ls);
  }
}

// Run a paid request under a stable ticket. `send(ticket)` performs the fetch and
// returns its parsed result (or throws on a non-ok / network failure).
//   - success  → clear the ticket (a later identical gesture pays);
//   - throw    → KEEP the ticket, so a retry of the SAME gesture reuses it and the
//                server dedups instead of double-charging. Re-throws to the caller.
export async function withTicket(actionKey, send) {
  const ticket = ticketFor(actionKey);
  const out = await send(ticket); // throws propagate WITHOUT clearing (retry reuses)
  clearTicket(actionKey);
  return out;
}

// Test-only: reset in-memory state (localStorage is left to the test's fake).
export function __resetMemForTest() { MEM.clear(); }
