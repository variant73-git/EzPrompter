import { describe, expect, it } from 'vitest';
import {
  SETTLEMENT_TIMEOUT_MS,
  createSettlementPlan,
  isLoopingMotion,
  settlementIdentity,
} from './settlement.js';

const visible = {
  elementRect: { left: 40, top: 40, right: 240, bottom: 140 },
  viewportRect: { left: 0, top: 0, right: 400, bottom: 300 },
};

function motion(id, { iterations = 1, delay = 0, duration = 400, targetCount = 1 } = {}) {
  return {
    id,
    timing: { iterations, delay, duration },
    group: { targetCount },
  };
}

describe('motion settlement planning', () => {
  it('settles every finite writer in effective end order', () => {
    const plan = createSettlementPlan({
      elementId: 'hero',
      motions: [
        motion('late', { delay: 300, duration: 500 }),
        motion('early', { delay: 0, duration: 200 }),
      ],
      ...visible,
    });

    expect(plan).toMatchObject({ eligible: true, loop: false, timeoutMs: SETTLEMENT_TIMEOUT_MS });
    expect(plan.writers.map(({ motionId, action, progress }) => ({ motionId, action, progress }))).toEqual([
      { motionId: 'early', action: 'settle-end', progress: 1 },
      { motionId: 'late', action: 'settle-end', progress: 1 },
    ]);
  });

  it('freezes a loop at its currently visible normalized progress', () => {
    const looping = motion('marquee', { iterations: Infinity });
    const plan = createSettlementPlan({
      elementId: 'ticker',
      motions: [looping],
      progressByMotionId: { marquee: 0.63 },
      ...visible,
    });

    expect(isLoopingMotion(looping)).toBe(true);
    expect(plan).toMatchObject({ eligible: true, loop: true });
    expect(plan.writers).toEqual([{
      motionId: 'marquee',
      action: 'freeze-current',
      progress: 0.63,
      loop: true,
    }]);
  });

  it('does not claim a shared writer can settle without affecting its other targets', () => {
    const plan = createSettlementPlan({
      elementId: 'card-2',
      motions: [motion('shared-stagger', { targetCount: 4 })],
      ...visible,
    });

    expect(plan).toMatchObject({ eligible: false, reason: 'shared-writer' });
    expect(plan.writers).toEqual([]);
  });

  it('skips automatic settlement for an offscreen sliver', () => {
    const plan = createSettlementPlan({
      elementId: 'footer',
      motions: [motion('footer-in')],
      elementRect: { left: 399, top: 0, right: 799, bottom: 300 },
      viewportRect: visible.viewportRect,
    });

    expect(plan).toMatchObject({ eligible: false, reason: 'not-meaningfully-visible' });
  });

  it('uses a deterministic identity for duplicate selection events per device and writer set', () => {
    const first = settlementIdentity({
      elementId: 'hero',
      deviceId: 'desktop',
      motions: [motion('fade'), motion('rise')],
    });
    const duplicate = settlementIdentity({
      elementId: 'hero',
      deviceId: 'desktop',
      motions: [motion('rise'), motion('fade')],
    });
    const mobile = settlementIdentity({
      elementId: 'hero',
      deviceId: 'mobile',
      motions: [motion('fade'), motion('rise')],
    });

    expect(duplicate).toBe(first);
    expect(mobile).not.toBe(first);
  });
});
