import {
  decomposeTransform,
  isTransformComponent,
  transformComponentValue,
} from './transform-components.js';

const PROPERTY_ALIASES = Object.freeze({
  x: 'translateX',
  y: 'translateY',
  xPercent: 'translateX',
  yPercent: 'translateY',
  rotation: 'rotate',
  rotationZ: 'rotate',
  scale: 'scale',
  skew: 'skew',
  transformOrigin: 'transformOrigin',
});

const COMPONENT_CONTRIBUTORS = Object.freeze({
  transform: ['translateX', 'translateY', 'scaleX', 'scaleY', 'rotate', 'skewX', 'skewY'],
  translate: ['translateX', 'translateY'],
  scale: ['scaleX', 'scaleY'],
  skew: ['skewX', 'skewY'],
  transformOrigin: ['transformOriginX', 'transformOriginY'],
});

const BEHAVIOR_LABELS = Object.freeze({
  entrance: 'Entrance',
  hover: 'Hover',
  scroll: 'Scroll',
  loop: 'Loop',
  interaction: 'Interaction',
  playback: 'Playback',
});

function camelCase(value) {
  return String(value || '').replace(/-([a-z])/g, (_, character) => character.toUpperCase());
}

function behaviorFromClip(clip, ownership = {}) {
  if (ownership.behavior) return ownership.behavior;
  const text = `${clip?.name || ''} ${clip?.id || ''} ${clip?.trigger?.type || ''}`.toLowerCase();
  if (clip?.driver?.type === 'pointer' || /hover|pointer|mouse/.test(text)) return 'hover';
  if (clip?.driver?.type === 'scroll' || /scroll|parallax/.test(text)) return 'scroll';
  if (clip?.timing?.iterations === Infinity || /loop|marquee|ticker/.test(text)) return 'loop';
  if (/click|tap|press|interaction/.test(text)) return 'interaction';
  if (/entrance|intro|reveal|fade.?in|load|hero/.test(text)) return 'entrance';
  return 'playback';
}

function humanName(value) {
  const text = String(value || '').trim();
  if (!text || /^(?:gsap|css|waapi|scroll|animation)[-_]?[a-z0-9]{3,}$/i.test(text)) return null;
  return text.length > 44 ? `${text.slice(0, 41)}...` : text;
}

export function normalizeSemanticProperty(property) {
  const normalized = camelCase(property);
  return PROPERTY_ALIASES[normalized] || normalized;
}

export function motionChannelLabel(input = {}) {
  const behavior = input.behavior || behaviorFromClip(input, input.ownership);
  return BEHAVIOR_LABELS[behavior] || humanName(input.name) || 'Animation';
}

function finalTrackValue(track) {
  const keyframes = Array.isArray(track?.keyframes) ? track.keyframes : [];
  return keyframes
    .filter((keyframe) => keyframe?.value != null)
    .sort((left, right) => Number(left.offset || 0) - Number(right.offset || 0))
    .at(-1)?.value ?? null;
}

function trackContribution(track, requestedProperty) {
  const runtimeProperty = normalizeSemanticProperty(track?.ownership?.runtimeProperty || track?.property);
  if (runtimeProperty === requestedProperty) {
    return { contributes: true, runtimeProperty: track?.ownership?.runtimeProperty || track.property, component: null };
  }
  const contributors = COMPONENT_CONTRIBUTORS[runtimeProperty] || [];
  if (!contributors.includes(requestedProperty)) return { contributes: false };
  if (runtimeProperty === 'transform') {
    const decomposed = decomposeTransform(finalTrackValue(track) || 'none');
    return {
      contributes: true,
      runtimeProperty: track?.ownership?.runtimeProperty || track.property,
      component: requestedProperty,
      transformReliable: decomposed.reliable,
      finalValue: decomposed.reliable ? transformComponentValue(decomposed, requestedProperty) : finalTrackValue(track),
    };
  }
  return {
    contributes: true,
    runtimeProperty: track?.ownership?.runtimeProperty || track.property,
    component: requestedProperty,
  };
}

function candidateFor(clip, track, trackIndex, clipIndex, requestedProperty, targetId) {
  const ownership = track?.ownership || {};
  if (ownership.writesValue === false) return null;
  const writerTargetId = ownership.targetId || clip.group?.targetId || targetId || null;
  if (targetId && writerTargetId && writerTargetId !== targetId) return null;
  const contribution = trackContribution(track, requestedProperty);
  if (!contribution.contributes) return null;
  const behavior = behaviorFromClip(clip, ownership);
  const semanticProperty = requestedProperty;
  const finalValue = contribution.finalValue ?? finalTrackValue(track);
  const transformSafe = contribution.transformReliable !== false;
  const channelId = ownership.channelId || `${clip.id}:${semanticProperty}:${trackIndex}`;
  return {
    channelId,
    motionId: clip.id,
    animationId: ownership.animationId || clip.id,
    targetId: writerTargetId,
    semanticProperty,
    runtimeProperty: contribution.runtimeProperty,
    component: contribution.component,
    engine: clip.engine || 'Unknown',
    label: motionChannelLabel({ ...clip, behavior, ownership }),
    behavior,
    sequenceId: ownership.sequenceId || null,
    relationship: ownership.relationship || (ownership.sequenceId ? 'sequential' : 'independent'),
    order: Number.isFinite(ownership.order) ? ownership.order : clipIndex,
    retargetable: ownership.retargetable !== false && transformSafe && clip.editability !== 'code',
    editability: clip.editability || 'code',
    writeModel: ownership.writeModel || 'absolute',
    sourceValue: ownership.sourceValue ?? finalValue,
    finalValue,
    responsiveScope: ownership.responsiveScope || 'shared',
    stagger: ownership.stagger || null,
    affectedTargetCount: Number(ownership.affectedTargetCount || clip.group?.targetCount || 1),
  };
}

function candidatesFor(motion, property, targetId) {
  const semanticProperty = normalizeSemanticProperty(property);
  const candidates = [];
  (motion || []).forEach((clip, clipIndex) => {
    (clip?.tracks || []).forEach((track, trackIndex) => {
      const candidate = candidateFor(clip, track, trackIndex, clipIndex, semanticProperty, targetId);
      if (candidate) candidates.push(candidate);
    });
  });
  return candidates.sort((left, right) => left.order - right.order);
}

function hintedCandidate(candidates, hint) {
  if (!hint) return null;
  return candidates.find((candidate) => (
    hint.channelId && candidate.channelId === hint.channelId
  )) || candidates.find((candidate) => (
    hint.motionId && candidate.motionId === hint.motionId
  )) || null;
}

export function analyzeMotionOwnership({
  motion = [],
  property,
  targetId = null,
  ownershipHint = null,
} = {}) {
  const semanticProperty = normalizeSemanticProperty(property);
  const candidates = candidatesFor(motion, semanticProperty, targetId);
  if (!candidates.length) {
    return { status: 'unowned', property: semanticProperty, candidates: [], owner: null };
  }

  const hinted = hintedCandidate(candidates, ownershipHint);
  if (hinted?.retargetable) {
    return {
      status: 'owned',
      property: semanticProperty,
      candidates,
      owner: hinted,
      resolvedBy: 'hint',
    };
  }

  const safe = candidates.filter((candidate) => candidate.retargetable);
  if (!safe.length) {
    return { status: 'unsupported', property: semanticProperty, candidates, owner: null };
  }
  if (candidates.length === 1 && safe.length === 1) {
    return { status: 'owned', property: semanticProperty, candidates, owner: safe[0], resolvedBy: 'single' };
  }

  const sequenceId = candidates[0].sequenceId;
  const oneSequentialChannel = Boolean(sequenceId)
    && candidates.every((candidate) => (
      candidate.retargetable
      && candidate.relationship === 'sequential'
      && candidate.sequenceId === sequenceId
    ));
  if (oneSequentialChannel) {
    return {
      status: 'owned',
      property: semanticProperty,
      candidates,
      owner: candidates.at(-1),
      resolvedBy: 'resting-writer',
    };
  }
  return { status: 'ambiguous', property: semanticProperty, candidates, owner: null };
}

export function motionOwnershipForProperties({ motion = [], targetId = null, ownershipHints = {} } = {}) {
  const properties = [
    'color',
    'backgroundColor',
    'opacity',
    'borderRadius',
    'fontFamily',
    'fontWeight',
    'fontSize',
    'fontStyle',
    'lineHeight',
    'letterSpacing',
    'textAlign',
    'textTransform',
    'translateX',
    'translateY',
    'scaleX',
    'scaleY',
    'rotate',
    'skewX',
    'skewY',
    'transformOriginX',
    'transformOriginY',
  ];
  return Object.fromEntries(properties.map((property) => [
    property,
    analyzeMotionOwnership({
      motion,
      property,
      targetId,
      ownershipHint: ownershipHints[property],
    }),
  ]));
}

export function propertyHasTransformSemantics(property) {
  return isTransformComponent(normalizeSemanticProperty(property));
}
