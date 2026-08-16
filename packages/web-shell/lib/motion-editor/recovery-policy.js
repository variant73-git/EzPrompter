import {
  FAILURE_CLASSES,
  classifyFailureCode,
  normalizeFailureCode,
} from './failure-codes.js';

export const RECOVERY_ACTIONS = Object.freeze({
  RETRY_TRANSPORT: 'retry-transport',
  REINSPECT: 'reinspect',
  REBIND: 'rebind',
  RELOAD_RUNTIME: 'reload-runtime',
  REGENERATE_CONTROL: 'regenerate-control',
  DISABLE_CONTROL: 'disable-control',
  FALLBACK_SNAPSHOT: 'fallback-snapshot',
});

export const RECOVERY_LIMITS = Object.freeze({
  transportRetries: 3,
  runtimeRecoveryAttempts: 2,
  controlRegenerations: 1,
  controlRecoveryWindowMs: 30_000,
  transportBaseDelayMs: 250,
  transportMaxDelayMs: 2_000,
  jitterRatio: 0.2,
});

export const EXHAUSTED_CONTROL_PRESENTATIONS = Object.freeze({
  DISABLED: 'disabled',
  HIDDEN: 'hidden',
});

// Task 15 approved the disabled presentation for the current product. This
// resolver prevents a later hidden policy from shipping without a separate
// approved decision linked to its evidence runs.
export function resolveExhaustedControlPresentation({
  requested = EXHAUSTED_CONTROL_PRESENTATIONS.DISABLED,
  decision = null,
} = {}) {
  const evidenceRunIds = Array.isArray(decision?.evidenceRunIds)
    ? decision.evidenceRunIds.filter((value) => typeof value === 'string' && value)
    : [];
  const approved = requested === EXHAUSTED_CONTROL_PRESENTATIONS.HIDDEN
    && decision?.approved === true
    && typeof decision?.decisionId === 'string'
    && Boolean(decision.decisionId)
    && evidenceRunIds.length > 0;
  if (!approved) {
    return {
      presentation: EXHAUSTED_CONTROL_PRESENTATIONS.DISABLED,
      approved: false,
      evidenceRunIds,
    };
  }
  return {
    presentation: EXHAUSTED_CONTROL_PRESENTATIONS.HIDDEN,
    approved: true,
    decisionId: decision.decisionId,
    evidenceRunIds,
  };
}

const SEQUENCES = Object.freeze({
  [FAILURE_CLASSES.TRANSIENT_TRANSPORT]: [
    RECOVERY_ACTIONS.RETRY_TRANSPORT,
    RECOVERY_ACTIONS.RETRY_TRANSPORT,
    RECOVERY_ACTIONS.RETRY_TRANSPORT,
    RECOVERY_ACTIONS.RELOAD_RUNTIME,
  ],
  [FAILURE_CLASSES.STALE_BINDING]: [
    RECOVERY_ACTIONS.REINSPECT,
    RECOVERY_ACTIONS.REBIND,
    RECOVERY_ACTIONS.RELOAD_RUNTIME,
    RECOVERY_ACTIONS.REGENERATE_CONTROL,
    RECOVERY_ACTIONS.DISABLE_CONTROL,
  ],
  [FAILURE_CLASSES.RUNTIME_FINGERPRINT_CHANGE]: [
    RECOVERY_ACTIONS.RELOAD_RUNTIME,
    RECOVERY_ACTIONS.REGENERATE_CONTROL,
    RECOVERY_ACTIONS.DISABLE_CONTROL,
  ],
  [FAILURE_CLASSES.REJECTED_MUTATION]: [
    RECOVERY_ACTIONS.REINSPECT,
    RECOVERY_ACTIONS.REBIND,
    RECOVERY_ACTIONS.DISABLE_CONTROL,
  ],
  [FAILURE_CLASSES.VALIDATION_NO_EFFECT]: [
    RECOVERY_ACTIONS.REINSPECT,
    RECOVERY_ACTIONS.REGENERATE_CONTROL,
    RECOVERY_ACTIONS.DISABLE_CONTROL,
  ],
  [FAILURE_CLASSES.UNSUPPORTED_CAPABILITY]: [RECOVERY_ACTIONS.DISABLE_CONTROL],
  [FAILURE_CLASSES.FATAL_RUNTIME]: [
    RECOVERY_ACTIONS.RELOAD_RUNTIME,
    RECOVERY_ACTIONS.REGENERATE_CONTROL,
    RECOVERY_ACTIONS.DISABLE_CONTROL,
  ],
});

function failureKey({ code, controlId, operationId }) {
  return `${normalizeFailureCode(code)}:${controlId || 'session'}:${operationId || 'default'}`;
}

function cloneFailures(failures) {
  return Object.fromEntries([...failures.entries()].map(([key, value]) => [key, { ...value }]));
}

export function createRecoveryPolicy({
  now = () => Date.now(),
  random = () => Math.random(),
  limits = RECOVERY_LIMITS,
} = {}) {
  const failures = new Map();
  let runtimeFailures = 0;

  function transportDelay(attempt) {
    const raw = Math.min(
      limits.transportMaxDelayMs,
      limits.transportBaseDelayMs * (2 ** Math.max(0, attempt - 1)),
    );
    const randomValue = Math.max(0, Math.min(1, Number(random()) || 0));
    const factor = 1 - limits.jitterRatio + (2 * limits.jitterRatio * randomValue);
    return Math.round(raw * factor);
  }

  function next(input = {}) {
    const code = normalizeFailureCode(input.code);
    const failureClass = classifyFailureCode(code);
    const key = failureKey({ ...input, code });
    const previous = failures.get(key);
    const record = previous || { attempts: 0, startedAt: now(), regenerations: 0 };
    const elapsedMs = Math.max(0, now() - record.startedAt);
    const sequence = SEQUENCES[failureClass] || SEQUENCES[FAILURE_CLASSES.FATAL_RUNTIME];
    let action = sequence[Math.min(record.attempts, sequence.length - 1)];

    if (action === RECOVERY_ACTIONS.REGENERATE_CONTROL) {
      if (!input.controlId
        || record.regenerations >= limits.controlRegenerations
        || elapsedMs > limits.controlRecoveryWindowMs) {
        action = RECOVERY_ACTIONS.DISABLE_CONTROL;
      } else {
        record.regenerations += 1;
      }
    }

    record.attempts += 1;
    failures.set(key, record);
    const exhausted = action === RECOVERY_ACTIONS.DISABLE_CONTROL;
    return {
      action,
      code,
      failureClass,
      attempt: record.attempts,
      elapsedMs,
      scope: input.controlId ? 'control' : 'session',
      controlId: input.controlId || null,
      operationId: input.operationId || null,
      exhausted,
      ...(action === RECOVERY_ACTIONS.RETRY_TRANSPORT
        ? { delayMs: transportDelay(record.attempts) }
        : {}),
    };
  }

  function runtimeFailure(input = {}) {
    if (runtimeFailures >= limits.runtimeRecoveryAttempts) {
      return {
        action: RECOVERY_ACTIONS.FALLBACK_SNAPSHOT,
        code: normalizeFailureCode(input.code),
        failureClass: classifyFailureCode(input.code),
        scope: 'session',
        runtimeAttempt: limits.runtimeRecoveryAttempts,
        exhausted: true,
      };
    }
    runtimeFailures += 1;
    return {
      action: RECOVERY_ACTIONS.RELOAD_RUNTIME,
      code: normalizeFailureCode(input.code),
      failureClass: classifyFailureCode(input.code),
      scope: 'session',
      runtimeAttempt: runtimeFailures,
      exhausted: false,
    };
  }

  function recovered() {
    failures.clear();
    runtimeFailures = 0;
  }

  function snapshot() {
    return { failures: cloneFailures(failures), runtimeFailures };
  }

  return { next, runtimeFailure, recovered, snapshot };
}
