// lib/idempotency.test.js
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ticketFor, clearTicket, withTicket, __resetMemForTest } from './idempotency.js';

// Minimal localStorage fake so the module's persistence path is exercised.
function installLS() {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
  return store;
}

beforeEach(() => {
  __resetMemForTest();
  installLS();
});

describe('ticketFor', () => {
  it('mints a ticket once and returns the SAME one on repeat (dedup while pending)', () => {
    const a = ticketFor('extract:n1:designmd');
    const b = ticketFor('extract:n1:designmd');
    expect(a).toBe(b);
  });

  it('gives DIFFERENT actions different tickets', () => {
    expect(ticketFor('extract:n1:designmd')).not.toBe(ticketFor('extract:n2:designmd'));
  });

  it('survives a reload: a fresh in-memory map still recovers the pending ticket from localStorage', () => {
    const t = ticketFor('extract:n1:designmd');
    __resetMemForTest();                    // simulate page reload (memory gone, localStorage kept)
    expect(ticketFor('extract:n1:designmd')).toBe(t);
  });
});

describe('clearTicket', () => {
  it('forgets the ticket so the next identical gesture mints a NEW one (a deliberate redo pays)', () => {
    const first = ticketFor('extract:n1:designmd');
    clearTicket('extract:n1:designmd');
    const second = ticketFor('extract:n1:designmd');
    expect(second).not.toBe(first);
  });
});

describe('withTicket', () => {
  it('passes a stable ticket to send and clears it on success', async () => {
    const seen = [];
    const out = await withTicket('extract:n1:designmd', async (ticket) => { seen.push(ticket); return 'ok'; });
    expect(out).toBe('ok');
    // Cleared → the next gesture mints a different ticket.
    const next = ticketFor('extract:n1:designmd');
    expect(next).not.toBe(seen[0]);
  });

  it('KEEPS the ticket when send throws, so a retry reuses the SAME ticket (server dedups)', async () => {
    const first = ticketFor('extract:n1:designmd');
    // A network drop mid-flight: send throws.
    await expect(withTicket('extract:n1:designmd', async () => { throw new Error('network'); })).rejects.toThrow('network');
    // The retry reuses the same ticket — the server can dedup the (possibly already
    // charged) action instead of charging it again.
    const retryTickets = [];
    await withTicket('extract:n1:designmd', async (t) => { retryTickets.push(t); return 'ok'; });
    expect(retryTickets[0]).toBe(first);
  });
});
