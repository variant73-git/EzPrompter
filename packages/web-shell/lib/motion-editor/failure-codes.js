export const FAILURE_CLASSES = Object.freeze({
  TRANSIENT_TRANSPORT: 'transient-transport',
  STALE_BINDING: 'stale-binding',
  RUNTIME_FINGERPRINT_CHANGE: 'runtime-fingerprint-change',
  REJECTED_MUTATION: 'rejected-mutation',
  VALIDATION_NO_EFFECT: 'validation-no-effect',
  UNSUPPORTED_CAPABILITY: 'unsupported-capability',
  FATAL_RUNTIME: 'fatal-runtime',
});

const FAILURE_CODES = Object.freeze({
  bridge_timeout: FAILURE_CLASSES.TRANSIENT_TRANSPORT,
  heartbeat_timeout: FAILURE_CLASSES.TRANSIENT_TRANSPORT,
  message_dropped: FAILURE_CLASSES.TRANSIENT_TRANSPORT,
  execution_timeout: FAILURE_CLASSES.TRANSIENT_TRANSPORT,
  settlement_timeout: FAILURE_CLASSES.TRANSIENT_TRANSPORT,
  temporarily_unavailable: FAILURE_CLASSES.TRANSIENT_TRANSPORT,

  target_missing: FAILURE_CLASSES.STALE_BINDING,
  motion_missing: FAILURE_CLASSES.STALE_BINDING,
  control_missing: FAILURE_CLASSES.STALE_BINDING,
  stale_binding: FAILURE_CLASSES.STALE_BINDING,
  changed_animation_id: FAILURE_CLASSES.STALE_BINDING,

  fingerprint_mismatch: FAILURE_CLASSES.RUNTIME_FINGERPRINT_CHANGE,
  runtime_mismatch: FAILURE_CLASSES.RUNTIME_FINGERPRINT_CHANGE,
  runtime_fingerprint_changed: FAILURE_CLASSES.RUNTIME_FINGERPRINT_CHANGE,

  invalid_value: FAILURE_CLASSES.REJECTED_MUTATION,
  write_failed: FAILURE_CLASSES.REJECTED_MUTATION,
  transaction_failed: FAILURE_CLASSES.REJECTED_MUTATION,
  transaction_rejected: FAILURE_CLASSES.REJECTED_MUTATION,
  rollback_failed: FAILURE_CLASSES.REJECTED_MUTATION,
  scope_escape: FAILURE_CLASSES.REJECTED_MUTATION,

  no_effect: FAILURE_CLASSES.VALIDATION_NO_EFFECT,
  effect_mismatch: FAILURE_CLASSES.VALIDATION_NO_EFFECT,
  non_deterministic: FAILURE_CLASSES.VALIDATION_NO_EFFECT,
  validation_failed: FAILURE_CLASSES.VALIDATION_NO_EFFECT,

  capability_missing: FAILURE_CLASSES.UNSUPPORTED_CAPABILITY,
  unsupported_capability: FAILURE_CLASSES.UNSUPPORTED_CAPABILITY,
  unsupported_patch: FAILURE_CLASSES.UNSUPPORTED_CAPABILITY,
  unsupported_value: FAILURE_CLASSES.UNSUPPORTED_CAPABILITY,
  scope_mismatch: FAILURE_CLASSES.UNSUPPORTED_CAPABILITY,

  runtime_exception: FAILURE_CLASSES.FATAL_RUNTIME,
  runtime_unavailable: FAILURE_CLASSES.FATAL_RUNTIME,
  runtime_session_unavailable: FAILURE_CLASSES.FATAL_RUNTIME,
  invalid_runtime_contract: FAILURE_CLASSES.FATAL_RUNTIME,
  negotiation_failed: FAILURE_CLASSES.FATAL_RUNTIME,
  replay_failed: FAILURE_CLASSES.FATAL_RUNTIME,
  unknown_failure: FAILURE_CLASSES.FATAL_RUNTIME,
});

const SAFE_IDENTIFIER = /^[a-z0-9][a-z0-9._:-]{0,95}$/i;
const SAFE_TRANSITIONS = new Set([
  'failure-detected',
  'recovery-started',
  'recovery-step',
  'recovery-succeeded',
  'recovery-exhausted',
  'control-disabled',
  'runtime-reopened',
  'snapshot-restored',
]);

function safeIdentifier(value) {
  return typeof value === 'string' && SAFE_IDENTIFIER.test(value) ? value : null;
}

export function normalizeFailureCode(value) {
  const normalized = safeIdentifier(value)?.toLowerCase() || 'unknown_failure';
  return FAILURE_CODES[normalized] ? normalized : 'unknown_failure';
}

export function classifyFailureCode(value) {
  return FAILURE_CODES[normalizeFailureCode(value)] || FAILURE_CLASSES.FATAL_RUNTIME;
}

export function createSanitizedDiagnostic(input = {}) {
  const code = normalizeFailureCode(input.code);
  const transition = SAFE_TRANSITIONS.has(input.transition) ? input.transition : 'failure-detected';
  const controlId = safeIdentifier(input.controlId);
  const operation = safeIdentifier(input.operation);
  const output = {
    schemaVersion: 1,
    transition,
    code,
    failureClass: classifyFailureCode(code),
  };
  if (controlId) output.controlId = controlId;
  if (operation) output.operation = operation;
  if (Number.isSafeInteger(input.attempt) && input.attempt >= 0) {
    output.attempt = Math.min(99, input.attempt);
  }
  if (typeof input.recovered === 'boolean') output.recovered = input.recovered;
  return output;
}

export const KNOWN_FAILURE_CODES = Object.freeze(Object.keys(FAILURE_CODES));
