import { describe, expect, it, vi } from 'vitest';
import { waitForLayoutSettle, type SettleDeps } from './scroll-settle';

interface SimDeps extends SettleDeps {
  tickCount(): number;
}

// Build a deterministic deps stub: each rAF advances the clock by frameMs
// and returns the next height from the provided sequence (last value sticks).
function makeDeps(opts: {
  heights: number[];
  frameMs: number;
}): SimDeps {
  let clock = 0;
  let frame = 0;
  const pending: Array<() => void> = [];

  const deps: SimDeps = {
    now: () => clock,
    raf: (cb) => {
      pending.push(() => {
        clock += opts.frameMs;
        frame++;
        cb();
      });
    },
    getHeight: () => opts.heights[Math.min(frame, opts.heights.length - 1)],
    tickCount: () => frame
  };
  // Drain queued rAF callbacks lazily as the promise awaits them.
  const drain = () => {
    while (pending.length > 0) {
      const next = pending.shift()!;
      next();
    }
  };
  // Patch raf to schedule via microtasks so the promise resolves between frames.
  const origRaf = deps.raf;
  deps.raf = (cb) => {
    origRaf(cb);
    queueMicrotask(drain);
  };
  return deps;
}

describe('waitForLayoutSettle', () => {
  it('resolves once height has been stable for the configured frames', async () => {
    const deps = makeDeps({
      heights: [1000, 1000, 1000, 1000],
      frameMs: 16
    });
    const settle = waitForLayoutSettle(deps, {
      minWaitMs: 0,
      maxWaitMs: 1000,
      stableFrames: 3
    });
    await settle;
    // 3 stable frames should have ticked
    expect(deps.tickCount()).toBeGreaterThanOrEqual(3);
  });

  it('resets the stable counter when height changes', async () => {
    const deps = makeDeps({
      // grows on frames 1 and 2, then stabilizes
      heights: [1000, 1500, 2000, 2000, 2000, 2000],
      frameMs: 16
    });
    await waitForLayoutSettle(deps, {
      minWaitMs: 0,
      maxWaitMs: 1000,
      stableFrames: 3
    });
    // Need at least 3 stable + the 2 unstable ticks
    expect(deps.tickCount()).toBeGreaterThanOrEqual(5);
  });

  it('respects minWaitMs even when height never changes', async () => {
    const deps = makeDeps({
      heights: [500],
      frameMs: 16
    });
    await waitForLayoutSettle(deps, {
      minWaitMs: 100,
      maxWaitMs: 1000,
      stableFrames: 2
    });
    // Need ceil(100/16) = 7 ticks before minWait satisfied
    expect(deps.now()).toBeGreaterThanOrEqual(100);
  });

  it('resolves at maxWaitMs even if height never settles', async () => {
    let h = 0;
    const deps: SettleDeps & { tickCount: () => number; now: () => number } = (() => {
      let clock = 0;
      let frame = 0;
      const pending: Array<() => void> = [];
      const d = {
        now: () => clock,
        raf: (cb: () => void) => {
          pending.push(() => { clock += 16; frame++; cb(); });
          queueMicrotask(() => {
            while (pending.length) pending.shift()!();
          });
        },
        getHeight: () => ++h, // changes every frame
        tickCount: () => frame
      };
      return d;
    })();

    const start = deps.now();
    await waitForLayoutSettle(deps, {
      minWaitMs: 0,
      maxWaitMs: 96, // 6 frames at 16ms
      stableFrames: 3
    });
    expect(deps.now() - start).toBeGreaterThanOrEqual(96);
  });

  it('does not call rAF after resolving', async () => {
    const deps = makeDeps({
      heights: [800, 800, 800, 800, 800],
      frameMs: 16
    });
    const rafSpy = vi.spyOn(deps, 'raf');
    await waitForLayoutSettle(deps, {
      minWaitMs: 0,
      maxWaitMs: 500,
      stableFrames: 2
    });
    const callsAtResolve = rafSpy.mock.calls.length;
    // Wait a tick to ensure no further calls leak.
    await Promise.resolve();
    expect(rafSpy.mock.calls.length).toBe(callsAtResolve);
  });
});
