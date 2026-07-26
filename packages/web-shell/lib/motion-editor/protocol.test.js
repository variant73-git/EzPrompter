import { describe, expect, it } from 'vitest';
import {
  MOTION_EDITOR_PROTOCOL,
  MOTION_EDITOR_PROTOCOL_V2,
  SUPPORTED_MOTION_EDITOR_PROTOCOLS,
  command,
  commandV2,
  createPatch,
  invertPatch,
  isRuntimeMessage,
  matchesRuntimeContext,
  removeRejectedPatch,
  storageKey,
} from './protocol.js';

describe('motion editor protocol', () => {
  it('accepts only versioned runtime messages', () => {
    expect(isRuntimeMessage({
      protocol: MOTION_EDITOR_PROTOCOL,
      source: 'runtime',
      type: 'ready',
    })).toBe(true);
    expect(isRuntimeMessage({ protocol: MOTION_EDITOR_PROTOCOL, source: 'host', type: 'ready' })).toBe(false);
    expect(isRuntimeMessage(null)).toBe(false);
  });

  it('creates reversible patches', () => {
    const patch = createPatch({
      elementId: 'wf-hero-title',
      kind: 'style',
      property: 'color',
      before: 'rgb(0, 0, 0)',
      value: '#eea665',
    });
    const inverse = invertPatch(patch);

    expect(inverse.elementId).toBe(patch.elementId);
    expect(inverse.before).toBe('#eea665');
    expect(inverse.value).toBe('rgb(0, 0, 0)');
  });

  it('rejects malformed patches', () => {
    expect(() => createPatch({ kind: 'style', property: 'color' })).toThrow('elementId');
    expect(() => createPatch({ elementId: 'x', kind: 'style' })).toThrow('property');
    expect(() => createPatch({ elementId: 'x', kind: 'script' })).toThrow('Unsupported');
  });

  it('supports replacing inline SVG markup without a property name', () => {
    const patch = createPatch({
      elementId: 'logo',
      kind: 'svg',
      before: '<svg />',
      value: '<svg viewBox="0 0 10 10" />',
    });
    expect(patch.property).toBeNull();
  });

  it('creates reversible motion patches with an animation identity', () => {
    const patch = createPatch({
      elementId: 'hero-title',
      kind: 'motion',
      motionId: 'gsap-intro',
      property: 'timing.duration',
      before: 800,
      value: 1200,
    });
    expect(patch.motionId).toBe('gsap-intro');
    expect(invertPatch(patch)).toMatchObject({ before: 1200, value: 800, motionId: 'gsap-intro' });
    expect(() => createPatch({ elementId: 'hero-title', kind: 'motion', property: 'timing.duration' })).toThrow('motionId');
  });

  it('preserves keyframe descriptors when a motion patch is inverted', () => {
    const patch = createPatch({
      elementId: 'hero-title',
      kind: 'motion',
      motionId: 'css-reveal',
      property: 'keyframe.opacity',
      before: { offset: 0.5, exists: false },
      value: { offset: 0.5, value: '0.6', exists: true },
    });
    expect(invertPatch(patch)).toMatchObject({
      before: { offset: 0.5, value: '0.6', exists: true },
      value: { offset: 0.5, exists: false },
    });
  });

  it('drops a rejected patch from history so undo/save never replay a write the runtime refused', () => {
    const kept = createPatch({ elementId: 'a', kind: 'style', property: 'color', before: 'red', value: 'blue' });
    const rejected = createPatch({ elementId: 'b', kind: 'motion', motionId: 'scroll-1', property: 'scroll.start', before: 400, value: 300 });
    expect(removeRejectedPatch([kept, rejected], rejected)).toEqual([kept]);
    // Unknown or id-less rejections leave history untouched.
    expect(removeRejectedPatch([kept], { ...rejected, id: 'other' })).toEqual([kept]);
    expect(removeRejectedPatch([kept], null)).toEqual([kept]);
  });

  it('creates host commands and source-scoped storage keys', () => {
    expect(command('set-mode', { mode: 'edit' })).toEqual({
      protocol: MOTION_EDITOR_PROTOCOL,
      source: 'host',
      type: 'set-mode',
      payload: { mode: 'edit' },
    });
    expect(storageKey('/api/native-clone/index.html')).toContain('/api/native-clone/index.html');
  });

  it('creates a bounded v2 envelope with explicit negotiation and runtime context', () => {
    const message = commandV2('apply-transaction', { transaction: { id: 'tx-1', patches: [] } }, {
      sessionNonce: 'nonce-1234567890',
      requestId: 'request-1',
      runtimeGeneration: 3,
      bundleId: 'bundle-1',
      sessionId: 'session-1',
    });

    expect(message).toEqual({
      protocol: MOTION_EDITOR_PROTOCOL_V2,
      protocolVersion: MOTION_EDITOR_PROTOCOL_V2,
      supportedProtocols: SUPPORTED_MOTION_EDITOR_PROTOCOLS,
      source: 'host',
      type: 'apply-transaction',
      sessionNonce: 'nonce-1234567890',
      requestId: 'request-1',
      runtimeGeneration: 3,
      bundleId: 'bundle-1',
      sessionId: 'session-1',
      payload: { transaction: { id: 'tx-1', patches: [] } },
    });
  });

  it('accepts v1 during migration but requires the complete v2 envelope', () => {
    const context = {
      sessionNonce: 'nonce-1234567890',
      requestId: 'runtime-event-1',
      runtimeGeneration: 4,
      bundleId: 'bundle-1',
      sessionId: 'session-1',
    };
    const message = {
      ...commandV2('runtime-health', { status: 'healthy' }, context),
      source: 'runtime',
    };

    expect(isRuntimeMessage(message)).toBe(true);
    expect(isRuntimeMessage({ ...message, requestId: '' })).toBe(false);
    expect(isRuntimeMessage({ ...message, sessionNonce: null })).toBe(false);
    expect(isRuntimeMessage({ ...message, runtimeGeneration: 0 })).toBe(false);
    expect(isRuntimeMessage({ ...message, protocolVersion: MOTION_EDITOR_PROTOCOL })).toBe(false);
  });

  it('rejects runtime events from a stale or foreign runtime context', () => {
    const expected = {
      sessionNonce: 'nonce-1234567890',
      runtimeGeneration: 5,
      bundleId: 'bundle-1',
      sessionId: 'session-1',
      origin: 'https://runtime.uncraft.test',
    };
    const message = {
      ...commandV2('transaction-committed', {}, {
        ...expected,
        requestId: 'request-5',
      }),
      source: 'runtime',
    };

    expect(matchesRuntimeContext(message, expected, 'https://runtime.uncraft.test')).toBe(true);
    expect(matchesRuntimeContext({ ...message, bundleId: 'bundle-2' }, expected, expected.origin)).toBe(false);
    expect(matchesRuntimeContext({ ...message, sessionId: 'session-2' }, expected, expected.origin)).toBe(false);
    expect(matchesRuntimeContext({ ...message, runtimeGeneration: 4 }, expected, expected.origin)).toBe(false);
    expect(matchesRuntimeContext(message, expected, 'https://other.test')).toBe(false);
  });
});
