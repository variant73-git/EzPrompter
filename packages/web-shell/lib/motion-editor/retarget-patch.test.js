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

  it('emits a v3 per-target descriptor when the owner has an available per-target channel', () => {
    const perTargetOwner = {
      ...owner,
      semanticProperty: 'translateX',
      runtimeProperty: 'x',
      channelId: 'follow-up:translateX',
      affectedTargetCount: 2,
      perTarget: {
        available: true,
        states: [
          { elementId: 'hero', intent: 'override', value: 160 },
          { elementId: 'sibling', intent: 'none' },
        ],
      },
    };
    const patch = buildFinalTargetPatch({
      elementId: 'hero',
      property: 'translateX',
      before: '100',
      value: 170,
      owner: perTargetOwner,
    });
    expect(patch).toMatchObject({
      elementId: 'hero',
      kind: 'motion',
      motionId: 'follow-up',
      property: 'retarget.final',
      value: {
        schemaVersion: 3,
        runtimeProperty: 'x',
        targetScope: { mode: 'single' },
        intent: 'override',
        value: 170,
      },
      // O before vem do perTarget.states do ALVO (estado override 160), não
      // do argumento `before` da UI.
      before: {
        schemaVersion: 3,
        targetScope: { mode: 'single' },
        intent: 'override',
        value: 160,
      },
    });

    // Alvo sem entrada (none): before = intent clear SEM chave value.
    const sibling = buildFinalTargetPatch({
      elementId: 'sibling',
      property: 'translateX',
      before: '100',
      value: 140,
      owner: perTargetOwner,
    });
    expect(sibling.before).toMatchObject({ schemaVersion: 3, intent: 'clear' });
    expect(sibling.before).not.toHaveProperty('value');
  });

  it('emits an intent-removal v3 descriptor for a per-target reset', () => {
    const perTargetOwner = {
      ...owner,
      semanticProperty: 'translateX',
      runtimeProperty: 'x',
      channelId: 'follow-up:translateX',
      affectedTargetCount: 2,
      perTarget: {
        available: true,
        states: [{ elementId: 'hero', intent: 'override', value: 160 }],
      },
    };
    const patch = buildFinalTargetPatch({
      elementId: 'hero',
      property: 'translateX',
      before: null,
      value: null,
      owner: perTargetOwner,
      intent: 'clear',
    });
    expect(patch.value).toMatchObject({ schemaVersion: 3, intent: 'clear', targetScope: { mode: 'single' } });
    expect(patch.value).not.toHaveProperty('value');
    expect(patch.before).toMatchObject({ schemaVersion: 3, intent: 'override', value: 160 });
  });

  it('keeps the v2 descriptor untouched for owners without a per-target channel', () => {
    const patch = buildFinalTargetPatch({
      elementId: 'hero',
      property: 'opacity',
      before: '1',
      value: '0.7',
      owner,
    });
    expect(patch.value.schemaVersion).toBe(2);
    expect(patch.value).not.toHaveProperty('targetScope');
    expect(patch.value).not.toHaveProperty('intent');
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
