export const MOTION_DRIVERS = Object.freeze({
  TIME: 'time',
  SCROLL: 'scroll',
  POINTER: 'pointer',
  MEDIA: 'media',
  EVENT: 'event',
});

export const MOTION_EDITABILITY = Object.freeze({
  DIRECT: 'direct',
  ADAPTER: 'adapter',
  CODE: 'code',
});

export const MOTION_PROPERTY_GROUPS = Object.freeze({
  transform: ['transform', 'translate', 'scale', 'rotate', 'skew', 'perspective'],
  appearance: ['opacity', 'filter', 'clipPath', 'backgroundColor', 'color', 'boxShadow'],
  layout: ['width', 'height', 'inset', 'gap', 'padding', 'borderRadius'],
  path: ['offsetDistance', 'offsetPath', 'offsetRotate'],
});

export function motionCapabilityLabel(editability) {
  if (editability === MOTION_EDITABILITY.DIRECT) return 'Editable';
  if (editability === MOTION_EDITABILITY.ADAPTER) return 'Adapter';
  return 'Code only';
}

export function motionDriverLabel(driver) {
  const type = typeof driver === 'string' ? driver : driver?.type;
  if (type === MOTION_DRIVERS.SCROLL) return 'Scroll';
  if (type === MOTION_DRIVERS.POINTER) return 'Pointer';
  if (type === MOTION_DRIVERS.MEDIA) return 'Media';
  if (type === MOTION_DRIVERS.EVENT) return 'Event';
  return 'Time';
}

export function coerceMotionValue(property, value) {
  if (['timing.duration', 'timing.delay', 'timing.endDelay', 'timing.iterations', 'timing.repeatDelay'].includes(property)) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }
  if (['timing.yoyo', 'scroll.scrub', 'scroll.pin', 'scroll.snap'].includes(property)) {
    return value === true || value === 'true';
  }
  return value;
}

export function motionPlaybackMode(timing = {}) {
  if (timing.yoyo || timing.direction === 'alternate' || timing.direction === 'alternate-reverse') return 'ping-pong';
  if (timing.iterations === Infinity || Number(timing.iterations) > 1) return 'loop';
  return 'once';
}

export function normalizeMotionClip(input = {}) {
  const timing = input.timing || {};
  return {
    id: String(input.id || ''),
    engine: input.engine || 'Unknown',
    name: input.name || 'Animation',
    editability: input.editability || MOTION_EDITABILITY.CODE,
    driver: input.driver || { type: MOTION_DRIVERS.TIME },
    trigger: input.trigger || { type: 'load' },
    timing: {
      delay: Number.isFinite(timing.delay) ? timing.delay : 0,
      duration: Number.isFinite(timing.duration) ? timing.duration : 0,
      endDelay: Number.isFinite(timing.endDelay) ? timing.endDelay : 0,
      iterations: timing.iterations ?? 1,
      direction: timing.direction || 'normal',
      fill: timing.fill || 'none',
      easing: timing.easing || 'linear',
      yoyo: Boolean(timing.yoyo),
      repeatDelay: Number.isFinite(timing.repeatDelay) ? timing.repeatDelay : 0,
    },
    tracks: Array.isArray(input.tracks) ? input.tracks : [],
    scroll: input.scroll || null,
    capabilities: input.capabilities || {},
    source: input.source || {},
    playState: input.playState || 'idle',
  };
}
