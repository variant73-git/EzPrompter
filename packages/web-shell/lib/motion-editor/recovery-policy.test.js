import { describe, expect, it } from 'vitest';
import {
  RECOVERY_ACTIONS,
  RECOVERY_LIMITS,
  createRecoveryPolicy,
} from './recovery-policy.js';

describe('bounded automatic motion recovery', () => {
  it('retries transient bridge timeouts with exponential backoff and bounded jitter', () => {
    const policy = createRecoveryPolicy({ random: () => 1, now: () => 1_000 });
    const first = policy.next({ code: 'bridge_timeout' });
    const second = policy.next({ code: 'bridge_timeout' });
    const third = policy.next({ code: 'bridge_timeout' });

    expect([first.action, second.action, third.action]).toEqual([
      RECOVERY_ACTIONS.RETRY_TRANSPORT,
      RECOVERY_ACTIONS.RETRY_TRANSPORT,
      RECOVERY_ACTIONS.RETRY_TRANSPORT,
    ]);
    expect([first.delayMs, second.delayMs, third.delayMs]).toEqual([300, 600, 1200]);
    expect(policy.next({ code: 'bridge_timeout' }).action).toBe(RECOVERY_ACTIONS.RELOAD_RUNTIME);
  });

  it('reinspects a stale binding, rebinds it, then reloads before exhausting locally', () => {
    const policy = createRecoveryPolicy({ random: () => 0.5 });
    const failure = { code: 'target_missing', controlId: 'control-a', operationId: 'change-a' };

    expect(policy.next(failure).action).toBe(RECOVERY_ACTIONS.REINSPECT);
    expect(policy.next(failure).action).toBe(RECOVERY_ACTIONS.REBIND);
    expect(policy.next(failure).action).toBe(RECOVERY_ACTIONS.RELOAD_RUNTIME);
    expect(policy.next(failure).action).toBe(RECOVERY_ACTIONS.REGENERATE_CONTROL);
    expect(policy.next(failure).action).toBe(RECOVERY_ACTIONS.DISABLE_CONTROL);
    expect(policy.next(failure).action).toBe(RECOVERY_ACTIONS.DISABLE_CONTROL);
  });

  it('regenerates a custom control only once and within its elapsed-time budget', () => {
    let now = 5_000;
    const policy = createRecoveryPolicy({ now: () => now, random: () => 0.5 });
    const failure = { code: 'no_effect', controlId: 'control-a' };

    expect(policy.next(failure).action).toBe(RECOVERY_ACTIONS.REINSPECT);
    expect(policy.next(failure).action).toBe(RECOVERY_ACTIONS.REGENERATE_CONTROL);
    now += RECOVERY_LIMITS.controlRecoveryWindowMs + 1;
    expect(policy.next(failure).action).toBe(RECOVERY_ACTIONS.DISABLE_CONTROL);
  });

  it('disables only an unsupported control and never blocks the session', () => {
    const policy = createRecoveryPolicy();
    expect(policy.next({ code: 'capability_missing', controlId: 'control-a' })).toMatchObject({
      action: RECOVERY_ACTIONS.DISABLE_CONTROL,
      scope: 'control',
      controlId: 'control-a',
      exhausted: true,
    });
  });

  it('falls back to the immutable snapshot after exactly two failed runtime recoveries', () => {
    const policy = createRecoveryPolicy();
    expect(policy.runtimeFailure({ code: 'runtime_exception' })).toMatchObject({
      action: RECOVERY_ACTIONS.RELOAD_RUNTIME,
      runtimeAttempt: 1,
    });
    expect(policy.runtimeFailure({ code: 'runtime_session_unavailable' })).toMatchObject({
      action: RECOVERY_ACTIONS.RELOAD_RUNTIME,
      runtimeAttempt: 2,
    });
    expect(policy.runtimeFailure({ code: 'runtime_session_unavailable' })).toMatchObject({
      action: RECOVERY_ACTIONS.FALLBACK_SNAPSHOT,
      runtimeAttempt: 2,
      exhausted: true,
    });
  });

  it('revalidates the responsible control after a fatal runtime reload before disabling it', () => {
    const policy = createRecoveryPolicy();
    const failure = { code: 'runtime_exception', controlId: 'control-a', operationId: 'change-a' };
    expect(policy.next(failure).action).toBe(RECOVERY_ACTIONS.RELOAD_RUNTIME);
    expect(policy.next(failure).action).toBe(RECOVERY_ACTIONS.REGENERATE_CONTROL);
    expect(policy.next(failure).action).toBe(RECOVERY_ACTIONS.DISABLE_CONTROL);
  });

  it('clears identical-failure and runtime budgets only after successful recovery', () => {
    const policy = createRecoveryPolicy();
    policy.next({ code: 'target_missing', controlId: 'control-a' });
    policy.runtimeFailure({ code: 'runtime_exception' });
    expect(policy.snapshot()).toMatchObject({ runtimeFailures: 1 });

    policy.recovered({ code: 'target_missing', controlId: 'control-a' });
    expect(policy.snapshot()).toMatchObject({ runtimeFailures: 0, failures: {} });
  });
});
