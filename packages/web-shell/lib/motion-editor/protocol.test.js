import { describe, expect, it } from 'vitest';
import {
  MOTION_EDITOR_PROTOCOL,
  command,
  createPatch,
  invertPatch,
  isRuntimeMessage,
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

  it('creates host commands and source-scoped storage keys', () => {
    expect(command('set-mode', { mode: 'edit' })).toEqual({
      protocol: MOTION_EDITOR_PROTOCOL,
      source: 'host',
      type: 'set-mode',
      payload: { mode: 'edit' },
    });
    expect(storageKey('/api/native-clone/index.html')).toContain('/api/native-clone/index.html');
  });
});
