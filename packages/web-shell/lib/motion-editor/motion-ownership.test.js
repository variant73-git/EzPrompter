import { describe, expect, it } from 'vitest';
import {
  analyzeMotionOwnership,
  motionChannelLabel,
  normalizeSemanticProperty,
} from './motion-ownership.js';

function clip({
  id,
  property = 'opacity',
  behavior = 'entrance',
  sequenceId = null,
  order = 0,
  relationship = sequenceId ? 'sequential' : 'independent',
  retargetable = true,
  writesValue = true,
  engine = 'GSAP',
  targetId = 'hero',
} = {}) {
  return {
    id,
    engine,
    name: id,
    editability: engine === 'GSAP' ? 'known' : 'direct',
    driver: { type: behavior === 'hover' ? 'pointer' : 'time' },
    tracks: [{
      property,
      keyframes: [
        { offset: 0, value: '0' },
        { offset: 1, value: '1' },
      ],
      ownership: {
        channelId: `${id}:${property}`,
        behavior,
        sequenceId,
        relationship,
        order,
        retargetable,
        writesValue,
        targetId,
        runtimeProperty: property,
      },
    }],
  };
}

describe('motion ownership', () => {
  it('normalizes DOM, CSS, GSAP, and transform aliases into semantic channels', () => {
    expect(normalizeSemanticProperty('background-color')).toBe('backgroundColor');
    expect(normalizeSemanticProperty('x')).toBe('translateX');
    expect(normalizeSemanticProperty('rotation')).toBe('rotate');
    expect(normalizeSemanticProperty('transform-origin')).toBe('transformOrigin');
  });

  it('resolves one safe finite writer automatically', () => {
    const result = analyzeMotionOwnership({
      motion: [clip({ id: 'hero-entrance' })],
      property: 'opacity',
      targetId: 'hero',
    });

    expect(result.status).toBe('owned');
    expect(result.owner).toMatchObject({
      motionId: 'hero-entrance',
      channelId: 'hero-entrance:opacity',
      semanticProperty: 'opacity',
      label: 'Entrance',
    });
  });

  it('retargets the last sequential writer that determines the resting value', () => {
    const result = analyzeMotionOwnership({
      motion: [
        clip({ id: 'entrance', sequenceId: 'hero-sequence', order: 10 }),
        clip({ id: 'follow-up', sequenceId: 'hero-sequence', order: 20 }),
      ],
      property: 'opacity',
      targetId: 'hero',
    });

    expect(result.status).toBe('owned');
    expect(result.owner.motionId).toBe('follow-up');
    expect(result.candidates.map((candidate) => candidate.motionId)).toEqual(['entrance', 'follow-up']);
  });

  it('does not report a scheduling-only parent timeline as the property owner', () => {
    const result = analyzeMotionOwnership({
      motion: [
        clip({ id: 'parent-timeline', sequenceId: 'hero-sequence', order: 30, writesValue: false }),
        clip({ id: 'writing-child', sequenceId: 'hero-sequence', order: 20 }),
      ],
      property: 'opacity',
      targetId: 'hero',
    });

    expect(result.status).toBe('owned');
    expect(result.owner.motionId).toBe('writing-child');
  });

  it('returns unowned when no motion writes the property', () => {
    const result = analyzeMotionOwnership({
      motion: [clip({ id: 'move', property: 'x' })],
      property: 'opacity',
      targetId: 'hero',
    });

    expect(result).toMatchObject({ status: 'unowned', candidates: [] });
  });

  it('does not retarget a descendant writer when the Properties field belongs to its host row', () => {
    const result = analyzeMotionOwnership({
      motion: [clip({ id: 'character-reveal', targetId: 'hero-character-1' })],
      property: 'opacity',
      targetId: 'hero',
    });

    expect(result).toMatchObject({ status: 'unowned', candidates: [] });
  });

  it('returns explicit ambiguity for independent writers and accepts a persisted hint', () => {
    const motion = [
      clip({ id: 'entrance', behavior: 'entrance' }),
      clip({ id: 'hover', behavior: 'hover' }),
    ];
    const ambiguous = analyzeMotionOwnership({ motion, property: 'opacity', targetId: 'hero' });

    expect(ambiguous.status).toBe('ambiguous');
    expect(ambiguous.candidates.map((candidate) => candidate.label)).toEqual(['Entrance', 'Hover']);

    const resolved = analyzeMotionOwnership({
      motion,
      property: 'opacity',
      targetId: 'hero',
      ownershipHint: { channelId: 'hover:opacity' },
    });
    expect(resolved.status).toBe('owned');
    expect(resolved.owner.motionId).toBe('hover');
    expect(resolved.resolvedBy).toBe('hint');
  });

  it('uses behavior language instead of runtime identifiers for contributor labels', () => {
    expect(motionChannelLabel({ behavior: 'entrance', name: 'gsap-4f2a' })).toBe('Entrance');
    expect(motionChannelLabel({ behavior: 'hover', name: 'waapi-9281' })).toBe('Hover');
    expect(motionChannelLabel({ behavior: 'scroll', name: 'scroll-11' })).toBe('Scroll');
  });

  it('keeps an unsafe writer visible but refuses to classify it as a normal property owner', () => {
    const result = analyzeMotionOwnership({
      motion: [clip({ id: 'procedural', retargetable: false })],
      property: 'opacity',
      targetId: 'hero',
    });

    expect(result.status).toBe('unsupported');
    expect(result.candidates[0]).toMatchObject({ editability: 'known', retargetable: false });
  });
});
