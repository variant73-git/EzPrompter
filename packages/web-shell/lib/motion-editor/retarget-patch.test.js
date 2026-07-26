import { describe, expect, it } from 'vitest';
import {
  buildFinalTargetPatch,
  buildOwnershipHintPatch,
  ownershipHintsFromPatches,
} from './retarget-patch.js';

const owner = {
  motionId: 'follow-up',
  channelId: 'follow-up:opacity',
  engine: 'GSAP',
  targetId: 'hero',
  semanticProperty: 'opacity',
  runtimeProperty: 'opacity',
  writeModel: 'absolute',
  responsiveScope: 'shared',
  order: 20,
};

describe('retarget patches', () => {
  it('builds a version-2 final-target patch instead of a hidden keyframe', () => {
    const patch = buildFinalTargetPatch({
      elementId: 'hero',
      property: 'opacity',
      before: '1',
      value: '0.7',
      owner,
    });

    expect(patch).toMatchObject({
      elementId: 'hero',
      kind: 'motion',
      motionId: 'follow-up',
      property: 'retarget.final',
      before: {
        schemaVersion: 2,
        semanticProperty: 'opacity',
        runtimeProperty: 'opacity',
        value: '1',
      },
      value: {
        schemaVersion: 2,
        semanticProperty: 'opacity',
        runtimeProperty: 'opacity',
        value: '0.7',
        owner: {
          channelId: 'follow-up:opacity',
          motionId: 'follow-up',
        },
      },
    });
    expect(patch.property.startsWith('keyframe.')).toBe(false);
    expect(JSON.stringify(patch)).not.toContain('timelineOffset');
  });

  it('preserves runtime semantics as retarget metadata rather than editing Motion behavior', () => {
    const patch = buildFinalTargetPatch({
      elementId: 'hero',
      property: 'translateX',
      before: '40px',
      value: '70px',
      owner: {
        ...owner,
        semanticProperty: 'translateX',
        runtimeProperty: 'x',
        writeModel: 'relative',
        sourceValue: '+=40',
        stagger: { each: 0.08, targetCount: 3 },
      },
    });

    expect(patch.value).toMatchObject({
      semanticProperty: 'translateX',
      runtimeProperty: 'x',
      value: '70px',
      writeModel: 'relative',
      sourceValue: '+=40',
      stagger: { each: 0.08, targetCount: 3 },
    });
    expect(patch.value).not.toHaveProperty('duration');
    expect(patch.value).not.toHaveProperty('easing');
    expect(patch.value).not.toHaveProperty('playbackMode');
  });

  it('uses a declarative style patch when motion does not own the property', () => {
    expect(buildFinalTargetPatch({
      elementId: 'hero',
      property: 'backgroundColor',
      before: 'rgb(0, 0, 0)',
      value: '#eea665',
      owner: null,
    })).toEqual({
      elementId: 'hero',
      kind: 'style',
      property: 'background-color',
      before: 'rgb(0, 0, 0)',
      value: '#eea665',
    });
  });

  it('persists and rehydrates the selected ownership channel from manifest patches', () => {
    const hint = buildOwnershipHintPatch({
      elementId: 'hero',
      property: 'opacity',
      owner,
      before: null,
    });
    const retarget = buildFinalTargetPatch({
      elementId: 'hero',
      property: 'opacity',
      before: '1',
      value: '0.7',
      owner,
    });

    expect(ownershipHintsFromPatches([hint, retarget])).toEqual({
      opacity: {
        channelId: 'follow-up:opacity',
        motionId: 'follow-up',
      },
    });
  });
});
