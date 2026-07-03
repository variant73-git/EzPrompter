import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRafCoalescer } from './raf-coalesce.js';

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

describe('createRafCoalescer', () => {
  it('invokes once per frame with the latest args', () => {
    const fn = vi.fn();
    const c = createRafCoalescer(fn);
    c.push(1, 10);
    c.push(2, 20);
    c.push(3, 30);
    expect(fn).not.toHaveBeenCalled();
    runFrame();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(3, 30);
  });

  it('schedules a fresh frame for pushes after a fire', () => {
    const fn = vi.fn();
    const c = createRafCoalescer(fn);
    c.push(1);
    runFrame();
    c.push(2);
    runFrame();
    expect(fn.mock.calls).toEqual([[1], [2]]);
  });

  it('flush cancels the pending frame and fires synchronously', () => {
    const fn = vi.fn();
    const c = createRafCoalescer(fn);
    c.push(5, 6);
    c.flush();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(5, 6);
    runFrame(); // the cancelled frame must not double-fire
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('flush is a no-op when nothing is pending', () => {
    const fn = vi.fn();
    const c = createRafCoalescer(fn);
    c.flush();
    expect(fn).not.toHaveBeenCalled();
  });

  it('cancel drops pending work without invoking', () => {
    const fn = vi.fn();
    const c = createRafCoalescer(fn);
    c.push(9);
    c.cancel();
    runFrame();
    c.flush();
    expect(fn).not.toHaveBeenCalled();
  });
});
