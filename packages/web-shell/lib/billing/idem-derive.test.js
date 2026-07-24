// lib/billing/idem-derive.test.js
import { describe, it, expect } from 'vitest';
import { deriveIdemKey } from './idem-derive.js';

describe('deriveIdemKey', () => {
  it('returns null when the SCOPE ANCHOR (first part) is absent — safe best-effort, no dedup', () => {
    expect(deriveIdemKey([null, 'edit', 'n1'])).toBeNull();   // no runId
    expect(deriveIdemKey(['', 'edit', 'n1'])).toBeNull();
    expect(deriveIdemKey([])).toBeNull();
  });

  it('STILL forms a stable key when a LATER optional part is empty (the Sol #2 fix — must not drop dedup)', () => {
    // run-flow with omitted modelId; create-image with no base/replace ids.
    const a = deriveIdemKey(['run-1', 'compose', 'n1', '']);
    const b = deriveIdemKey(['run-1', 'compose', 'n1', '']);
    expect(a).toBeTruthy();
    expect(a).toBe(b); // stable across retries
  });

  it('is STABLE across a false-timeout re-call (identical parts) and DISTINCT across different inputs/runs', () => {
    const k = ['run-1', 'image', 'openai', 'a cat', '1:1', null, null];
    expect(deriveIdemKey(k)).toBe(deriveIdemKey([...k]));                       // re-call → same key
    expect(deriveIdemKey(k)).not.toBe(deriveIdemKey(['run-1', 'image', 'openai', 'a DOG', '1:1', null, null])); // diff prompt
    expect(deriveIdemKey(k)).not.toBe(deriveIdemKey(['run-2', 'image', 'openai', 'a cat', '1:1', null, null])); // diff run
  });

  it('an empty optional does NOT collide with a present value in the same slot', () => {
    // baseImageAssetId present vs absent must be distinct keys.
    expect(deriveIdemKey(['r', 'image', 'openai', 'p', '1:1', 'asset-9', null]))
      .not.toBe(deriveIdemKey(['r', 'image', 'openai', 'p', '1:1', null, null]));
  });
});
