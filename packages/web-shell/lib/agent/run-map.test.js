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

  it('unregisterRun resolves pending awaits before deleting (no orphans)', async () => {
    registerRun('run-1');
    const pConfirm = awaitConfirm('run-1', 'tc-1');
    const pCont = awaitContinue('run-1');
    unregisterRun('run-1');
    await expect(pConfirm).resolves.toMatchObject({ action: 'cancelled' });
    await expect(pCont).resolves.toMatchObject({ action: 'cancelled' });
    expect(hasRun('run-1')).toBe(false);
  });

  it('awaitContinue called twice resolves the first with overwritten reason', async () => {
    registerRun('run-1');
    const p1 = awaitContinue('run-1');
    awaitContinue('run-1');  // overwrites
    await expect(p1).resolves.toEqual({ action: 'cancelled', reason: 'overwritten' });
  });
});
