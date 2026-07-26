import { describe, expect, it } from 'vitest';
import {
  isNativeBundleSnapshotEligible,
  parseNativeBundleDescriptor,
  serializeNativeBundleDescriptor,
} from './bundle-contract.js';

const HASH_A = `sha256:${'a'.repeat(64)}`;
const HASH_B = `sha256:${'b'.repeat(64)}`;
const BUNDLE_ID = '11111111-1111-4111-8111-111111111111';

function validDescriptor(overrides = {}) {
  return {
    schemaVersion: 1,
    bundleId: BUNDLE_ID,
    storageKey: `native-bundles/v1/${BUNDLE_ID}`,
    contentHash: HASH_A,
    entryPath: 'index.html',
    assetIndex: [
      { path: 'index.html', contentType: 'text/html; charset=utf-8', byteLength: 15, contentHash: HASH_B },
    ],
    runtimeFingerprint: HASH_B,
    reconstructionCapabilities: {
      detectedEngines: ['gsap'],
      candidateControls: [],
    },
    ...overrides,
  };
}

describe('NativeBundleDescriptor', () => {
  it.each([
    '/index.html',
    '../index.html',
    '%2e%2e/index.html',
    '%252e%252e/index.html',
    'C:\\bundle\\index.html',
    '\\\\server\\share\\index.html',
    'assets/..%2findex.html',
    'assets/%00bad.js',
  ])('rejects unsafe entry paths: %s', (entryPath) => {
    expect(() => parseNativeBundleDescriptor(validDescriptor({ entryPath }))).toThrow(/path/i);
  });

  it('rejects unknown schema versions', () => {
    expect(() => parseNativeBundleDescriptor(validDescriptor({ schemaVersion: 2 }))).toThrow(/schema/i);
  });

  it('rejects duplicate normalized asset paths', () => {
    expect(() => parseNativeBundleDescriptor(validDescriptor({
      assetIndex: [
        { path: 'assets/site.css', contentType: 'text/css', byteLength: 1, contentHash: HASH_A },
        { path: 'assets//site.css', contentType: 'text/css', byteLength: 1, contentHash: HASH_A },
        { path: 'index.html', contentType: 'text/html', byteLength: 1, contentHash: HASH_B },
      ],
    }))).toThrow(/duplicate/i);
  });

  it('requires the entry path to exist in the declared asset index', () => {
    expect(() => parseNativeBundleDescriptor(validDescriptor({
      assetIndex: [{ path: 'assets/app.js', contentType: 'text/javascript', byteLength: 1, contentHash: HASH_A }],
    }))).toThrow(/entry/i);
  });

  it('rejects malformed hashes, UUIDs, and filesystem-backed storage keys', () => {
    expect(() => parseNativeBundleDescriptor(validDescriptor({ contentHash: 'sha256:nope' }))).toThrow(/hash/i);
    expect(() => parseNativeBundleDescriptor(validDescriptor({ bundleId: 'bundle-1' }))).toThrow(/bundle/i);
    expect(() => parseNativeBundleDescriptor(validDescriptor({ storageKey: '/tmp/native-bundle' }))).toThrow(/storage/i);
    expect(() => parseNativeBundleDescriptor(validDescriptor({ storageKey: 'file:///tmp/native-bundle' }))).toThrow(/storage/i);
  });

  it('normalizes, freezes, and serializes a valid descriptor deterministically', () => {
    const parsed = parseNativeBundleDescriptor(validDescriptor());
    expect(parsed).toEqual(validDescriptor());
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.assetIndex)).toBe(true);
    expect(JSON.parse(serializeNativeBundleDescriptor(parsed))).toEqual(parsed);
  });

  it('does not mistake animation detection or Iter9 HTML for native eligibility', () => {
    expect(isNativeBundleSnapshotEligible({ meta: { animatedDetected: true } })).toBe(false);
    expect(isNativeBundleSnapshotEligible({ html: '<html></html>', meta: { reconstructionEngine: 'iter9' } })).toBe(false);
    expect(isNativeBundleSnapshotEligible({ nativeBundle: validDescriptor() })).toBe(true);
    expect(isNativeBundleSnapshotEligible({ nativeBundle: { ...validDescriptor(), entryPath: '../index.html' } })).toBe(false);
  });
});
