import { measureVisibility } from './visibility.js';

export const SETTLEMENT_TIMEOUT_MS = 800;

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function isLoopingMotion(motion) {
  const iterations = motion?.timing?.iterations;
  return iterations === Infinity
    || iterations === 'Infinity'
    || motion?.timing?.playbackMode === 'loop'
    || motion?.timing?.playbackMode === 'ping-pong';
}

function effectiveEnd(motion) {
  return finite(motion?.timing?.delay) + finite(motion?.timing?.duration) + finite(motion?.timing?.endDelay);
}

export function settlementIdentity({ elementId, deviceId = 'desktop', motions = [] }) {
  const writers = motions.map((motion) => String(motion?.id || '')).filter(Boolean).sort();
  return `${deviceId}:${elementId || 'none'}:${writers.join(',')}`;
}

export function createSettlementPlan({
  elementId,
  deviceId = 'desktop',
  motions = [],
  progressByMotionId = {},
  elementRect,
  viewportRect,
}) {
  const visibility = measureVisibility({ elementRect, viewportRect });
  const identity = settlementIdentity({ elementId, deviceId, motions });
  if (!visibility.meaningful) {
    return {
      identity,
      eligible: false,
      reason: 'not-meaningfully-visible',
      loop: false,
      writers: [],
      visibility,
      timeoutMs: SETTLEMENT_TIMEOUT_MS,
    };
  }

  const supported = motions.filter((motion) => motion?.id);
  if (!supported.length) {
    return {
      identity,
      eligible: false,
      reason: 'no-motion',
      loop: false,
      writers: [],
      visibility,
      timeoutMs: SETTLEMENT_TIMEOUT_MS,
    };
  }
  if (supported.some((motion) => finite(motion?.group?.targetCount, 1) > 1)) {
    return {
      identity,
      eligible: false,
      reason: 'shared-writer',
      loop: supported.some(isLoopingMotion),
      writers: [],
      visibility,
      timeoutMs: SETTLEMENT_TIMEOUT_MS,
    };
  }

  const writers = [...supported]
    .sort((first, second) => effectiveEnd(first) - effectiveEnd(second))
    .map((motion) => {
      const loop = isLoopingMotion(motion);
      return {
        motionId: motion.id,
        action: loop ? 'freeze-current' : 'settle-end',
        progress: loop
          ? Math.max(0, Math.min(1, finite(progressByMotionId[motion.id])))
          : 1,
        loop,
      };
    });

  return {
    identity,
    eligible: true,
    reason: null,
    loop: writers.some((writer) => writer.loop),
    writers,
    visibility,
    timeoutMs: SETTLEMENT_TIMEOUT_MS,
  };
}
