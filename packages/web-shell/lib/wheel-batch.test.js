import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createWheelBatcher } from './wheel-batch.js';

let frameCbs;

beforeEach(() => {
  frameCbs = new Map();
  let nextId = 1;
  vi.stubGlobal('requestAnimationFrame', (cb) => {
    const id = nextId++;
    frameCbs.set(id, cb);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id) => {
    frameCbs.delete(id);
  });
});

afterEach(() => vi.unstubAllGlobals());

function runFrame() {
  const cbs = [...frameCbs.values()];
  frameCbs.clear();
  cbs.forEach((cb) => cb());
}

describe('createWheelBatcher', () => {
  it('sums pan deltas into one onPan per frame', () => {
    const onPan = vi.fn();
    const onZoom = vi.fn();
    const b = createWheelBatcher({ onPan, onZoom });
    b.addPan(2, 3);
    b.addPan(5, -1);
    b.addPan(-1, 4);
    expect(onPan).not.toHaveBeenCalled();
    runFrame();
    expect(onPan).toHaveBeenCalledTimes(1);
    expect(onPan).toHaveBeenCalledWith(6, 6);
    expect(onZoom).not.toHaveBeenCalled();
  });

  it('sums zoom deltas and passes the LATEST anchor point', () => {
    const onPan = vi.fn();
    const onZoom = vi.fn();
    const b = createWheelBatcher({ onPan, onZoom });
    b.addZoom(-40, 100, 100);
    b.addZoom(-40, 120, 110);
    runFrame();
    expect(onZoom).toHaveBeenCalledTimes(1);
    expect(onZoom).toHaveBeenCalledWith(-80, 120, 110);
    expect(onPan).not.toHaveBeenCalled();
  });

  it('fires pan before zoom when both land in the same frame', () => {
    const order = [];
    const b = createWheelBatcher({
      onPan: () => order.push('pan'),
      onZoom: () => order.push('zoom'),
    });
    b.addZoom(-10, 5, 5);
    b.addPan(1, 1);
    runFrame();
    expect(order).toEqual(['pan', 'zoom']);
  });

  it('schedules fresh frames for input after a fire', () => {
    const onPan = vi.fn();
    const b = createWheelBatcher({ onPan, onZoom: vi.fn() });
    b.addPan(1, 0);
    runFrame();
    b.addPan(2, 0);
    runFrame();
    expect(onPan.mock.calls).toEqual([[1, 0], [2, 0]]);
  });

  it('a frame with nothing pending fires nothing', () => {
    const onPan = vi.fn();
    const onZoom = vi.fn();
    const b = createWheelBatcher({ onPan, onZoom });
    b.addPan(1, 1);
    runFrame();
    runFrame();
    expect(onPan).toHaveBeenCalledTimes(1);
    expect(onZoom).not.toHaveBeenCalled();
  });

  it('cancel drops pending input without firing', () => {
    const onPan = vi.fn();
    const onZoom = vi.fn();
    const b = createWheelBatcher({ onPan, onZoom });
    b.addPan(9, 9);
    b.addZoom(-30, 1, 1);
    b.cancel();
    runFrame();
    expect(onPan).not.toHaveBeenCalled();
    expect(onZoom).not.toHaveBeenCalled();
  });
});
