import { describe, expect, it } from 'vitest';
import {
  FAILURE_CLASSES,
  classifyFailureCode,
  createSanitizedDiagnostic,
  normalizeFailureCode,
} from './failure-codes.js';

describe('motion editor failure codes', () => {
  it.each([
    ['bridge_timeout', FAILURE_CLASSES.TRANSIENT_TRANSPORT],
    ['target_missing', FAILURE_CLASSES.STALE_BINDING],
    ['fingerprint_mismatch', FAILURE_CLASSES.RUNTIME_FINGERPRINT_CHANGE],
    ['write_failed', FAILURE_CLASSES.REJECTED_MUTATION],
    ['no_effect', FAILURE_CLASSES.VALIDATION_NO_EFFECT],
    ['capability_missing', FAILURE_CLASSES.UNSUPPORTED_CAPABILITY],
    ['runtime_exception', FAILURE_CLASSES.FATAL_RUNTIME],
  ])('classifies %s as %s', (code, expected) => {
    expect(classifyFailureCode(code)).toBe(expected);
  });

  it('normalizes unknown or unsafe codes without reflecting technical details', () => {
    expect(normalizeFailureCode(' Error: token=secret /Users/me/site.js:42 ')).toBe('unknown_failure');
    expect(classifyFailureCode('totally_new_code')).toBe(FAILURE_CLASSES.FATAL_RUNTIME);
  });

  it('emits only bounded identifiers in diagnostic events', () => {
    const diagnostic = createSanitizedDiagnostic({
      transition: 'recovery-started',
      code: 'target_missing',
      controlId: 'control-1234567890abcdef12345678',
      operation: 'reinspect',
      attempt: 2,
      recovered: false,
      message: 'secret stack and page text',
      selector: '#private-value',
    });

    expect(diagnostic).toEqual({
      schemaVersion: 1,
      transition: 'recovery-started',
      code: 'target_missing',
      failureClass: FAILURE_CLASSES.STALE_BINDING,
      controlId: 'control-1234567890abcdef12345678',
      operation: 'reinspect',
      attempt: 2,
      recovered: false,
    });
    expect(JSON.stringify(diagnostic)).not.toMatch(/secret|selector|page text/i);
  });
});
