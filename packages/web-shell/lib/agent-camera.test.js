import { describe, expect, it } from 'vitest';
import { frameAgentNodes } from './agent-camera.js';

describe('agent camera landing', () => {
  it('fits and centers a complete node chain in the free viewport', () => {
    const nodes = [
      { pos_x: 1000, pos_y: 400, width: 600, height: 300 },
      { pos_x: 1900, pos_y: 400, width: 1280, height: 720 },
    ];
    const insets = { left: 224, right: 248, top: 46 };
    const frame = frameAgentNodes(nodes, {
      viewportWidth: 1600,
      viewportHeight: 1000,
      insets,
    });

    expect(frame).not.toBeNull();
    expect(frame.scale).toBeGreaterThan(0);
    const chainCenterX = (1000 + 3180) / 2;
    const chainCenterY = (400 + 1120) / 2;
    const screenCenterX = frame.positionX + chainCenterX * frame.scale;
    const screenCenterY = frame.positionY + chainCenterY * frame.scale;
    expect(screenCenterX).toBeCloseTo(insets.left + (1600 - insets.left - insets.right) / 2);
    expect(screenCenterY).toBeCloseTo(insets.top + (1000 - insets.top) / 2);
  });

  it('returns null when the run created no nodes', () => {
    expect(frameAgentNodes([], { viewportWidth: 1200, viewportHeight: 800 })).toBeNull();
  });
});
