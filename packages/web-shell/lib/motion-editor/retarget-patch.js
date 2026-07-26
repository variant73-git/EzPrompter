import { normalizeSemanticProperty, propertyHasTransformSemantics } from './motion-ownership.js';
import {
  decomposeTransform,
  serializeTransform,
  serializeTransformOrigin,
  updateTransformComponent,
} from './transform-components.js';

export const RETARGET_PATCH_SCHEMA_VERSION = 2;
export const OWNERSHIP_HINT_SCHEMA_VERSION = 1;

function cssProperty(property) {
  return String(property || '').replace(/[A-Z]/g, (character) => `-${character.toLowerCase()}`);
}

function ownerDescriptor(owner) {
  return {
    channelId: owner.channelId,
    motionId: owner.motionId,
    animationId: owner.animationId || owner.motionId,
    engine: owner.engine || 'Unknown',
    targetId: owner.targetId || null,
  };
}

function retargetDescriptor({ property, value, owner }) {
  const semanticProperty = normalizeSemanticProperty(property);
  return {
    schemaVersion: RETARGET_PATCH_SCHEMA_VERSION,
    semanticProperty,
    runtimeProperty: owner.runtimeProperty || semanticProperty,
    ...(owner.component ? { component: owner.component } : {}),
    value,
    writeModel: owner.writeModel || 'absolute',
    responsiveScope: owner.responsiveScope || 'shared',
    owner: ownerDescriptor(owner),
    ...(owner.sourceValue != null ? { sourceValue: owner.sourceValue } : {}),
    ...(owner.stagger ? { stagger: owner.stagger } : {}),
    affectedTargetCount: owner.affectedTargetCount || 1,
    keyframe: { position: 'final-existing' },
  };
}

function directTransformPatch({
  elementId,
  property,
  value,
  transform,
  transformOrigin,
}) {
  const state = decomposeTransform(transform || 'none', transformOrigin || '50% 50%');
  if (!state.reliable) throw new TypeError('The transform cannot be edited as standard components');
  const changed = updateTransformComponent(state, property, value);
  const origin = property.startsWith('transformOrigin');
  return {
    elementId,
    kind: 'style',
    property: origin ? 'transform-origin' : 'transform',
    before: origin ? serializeTransformOrigin(state) : (transform || 'none'),
    value: origin ? serializeTransformOrigin(changed) : serializeTransform(changed),
  };
}

export function buildFinalTargetPatch({
  elementId,
  property,
  before,
  value,
  owner = null,
  transform = null,
  transformOrigin = null,
}) {
  if (!elementId) throw new TypeError('A retarget patch requires an element ID');
  const semanticProperty = normalizeSemanticProperty(property);
  if (!owner) {
    if (propertyHasTransformSemantics(semanticProperty)) {
      return directTransformPatch({
        elementId,
        property: semanticProperty,
        value,
        transform,
        transformOrigin,
      });
    }
    return {
      elementId,
      kind: 'style',
      property: cssProperty(semanticProperty),
      before,
      value,
    };
  }
  if (!owner.motionId || !owner.channelId) throw new TypeError('A retarget owner requires motion and channel IDs');
  return {
    elementId,
    kind: 'motion',
    motionId: owner.motionId,
    property: 'retarget.final',
    before: retargetDescriptor({ property: semanticProperty, value: before, owner }),
    value: retargetDescriptor({ property: semanticProperty, value, owner }),
  };
}

export function buildOwnershipHintPatch({
  elementId,
  property,
  owner,
  before = null,
}) {
  if (!elementId || !owner?.motionId || !owner?.channelId) {
    throw new TypeError('An ownership hint requires element, motion, and channel IDs');
  }
  const semanticProperty = normalizeSemanticProperty(property);
  return {
    elementId,
    kind: 'motion',
    motionId: owner.motionId,
    property: 'ownership.hint',
    before,
    value: {
      schemaVersion: OWNERSHIP_HINT_SCHEMA_VERSION,
      semanticProperty,
      channelId: owner.channelId,
      motionId: owner.motionId,
    },
  };
}

export function ownershipHintsFromPatches(patches = []) {
  const hints = {};
  patches.forEach((patch) => {
    if (patch?.kind !== 'motion') return;
    if (patch.property === 'ownership.hint') {
      const value = patch.value;
      if (value?.semanticProperty && value?.channelId && value?.motionId) {
        hints[value.semanticProperty] = {
          channelId: value.channelId,
          motionId: value.motionId,
        };
      }
      return;
    }
    if (patch.property === 'retarget.final') {
      const value = patch.value;
      if (value?.semanticProperty && value?.owner?.channelId && value?.owner?.motionId) {
        hints[value.semanticProperty] = {
          channelId: value.owner.channelId,
          motionId: value.owner.motionId,
        };
      }
    }
  });
  return hints;
}
