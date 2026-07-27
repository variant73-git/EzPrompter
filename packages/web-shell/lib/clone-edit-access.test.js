import { describe, expect, it } from 'vitest';
import { canUseCloneEdit } from './clone-edit-access.js';

describe('Clone & Edit plan access', () => {
  it.each(['pro', 'ultimate', 'enterprise'])('allows the paid %s plan', (plan) => {
    expect(canUseCloneEdit(plan)).toBe(true);
  });

  it.each(['free', '', null, undefined, 'trial', 'unknown'])('fails closed for %s', (plan) => {
    expect(canUseCloneEdit(plan)).toBe(false);
  });
});
