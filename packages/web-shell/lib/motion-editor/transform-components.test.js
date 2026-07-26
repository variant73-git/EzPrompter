import { describe, expect, it } from 'vitest';
import {
  decomposeTransform,
  serializeTransform,
  transformComponentValue,
  updateTransformComponent,
} from './transform-components.js';

describe('transform components', () => {
  it('keeps translate, scale, rotate, skew, and transform-origin independently editable', () => {
    const parsed = decomposeTransform(
      'translateX(12px) translateY(-8px) rotate(15deg) skewX(4deg) scaleX(1.2) scaleY(0.8)',
      '25% 75%',
    );

    expect(parsed.reliable).toBe(true);
    expect(transformComponentValue(parsed, 'translateX')).toBe('12px');
    expect(transformComponentValue(parsed, 'translateY')).toBe('-8px');
    expect(transformComponentValue(parsed, 'rotate')).toBe('15deg');
    expect(transformComponentValue(parsed, 'skewX')).toBe('4deg');
    expect(transformComponentValue(parsed, 'scaleX')).toBe('1.2');
    expect(transformComponentValue(parsed, 'scaleY')).toBe('0.8');
    expect(transformComponentValue(parsed, 'transformOriginX')).toBe('25%');
    expect(transformComponentValue(parsed, 'transformOriginY')).toBe('75%');
  });

  it('preserves unedited components and authored transform order', () => {
    const parsed = decomposeTransform(
      'rotate(15deg) translateX(12px) scale(1.2, 0.8) skewY(3deg)',
      '50% 50%',
    );
    const changed = updateTransformComponent(parsed, 'translateX', '40px');

    expect(serializeTransform(changed)).toBe('rotate(15deg) translateX(40px) scale(1.2, 0.8) skewY(3deg)');
    expect(transformComponentValue(changed, 'rotate')).toBe('15deg');
    expect(transformComponentValue(changed, 'scaleY')).toBe('0.8');
  });

  it('decomposes and recomposes a 2D matrix without losing sibling values', () => {
    const parsed = decomposeTransform('matrix(2, 0, 0, 3, 40, -10)', '50% 50%');
    expect(parsed.reliable).toBe(true);
    expect(transformComponentValue(parsed, 'translateX')).toBe('40px');
    expect(transformComponentValue(parsed, 'translateY')).toBe('-10px');
    expect(transformComponentValue(parsed, 'scaleX')).toBe('2');
    expect(transformComponentValue(parsed, 'scaleY')).toBe('3');

    const changed = updateTransformComponent(parsed, 'rotate', '30deg');
    expect(serializeTransform(changed)).toMatch(/^matrix\(/);
    expect(transformComponentValue(changed, 'translateX')).toBe('40px');
    expect(transformComponentValue(changed, 'scaleY')).toBe('3');
  });

  it('does not masquerade complex 3D or procedural transforms as standard fields', () => {
    expect(decomposeTransform('matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)').reliable).toBe(false);
    expect(decomposeTransform('translateX(calc(var(--offset) * 1px))').reliable).toBe(false);
    expect(decomposeTransform('rotateY(30deg) perspective(900px)').classification).toBe('code');
  });

  it('can add a missing component without reordering existing functions', () => {
    const parsed = decomposeTransform('rotate(10deg) scale(1.2)', '50% 50%');
    const changed = updateTransformComponent(parsed, 'translateY', '18px');
    expect(serializeTransform(changed)).toBe('rotate(10deg) scale(1.2) translateY(18px)');
  });
});
