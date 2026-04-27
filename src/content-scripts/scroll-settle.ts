// Wait for layout to stop changing after a scroll, instead of sleeping for a
// fixed delay. On fast pages this returns in a few frames; on slow pages
// (lazy-loading, infinite scroll, virtualized lists) it waits up to maxWaitMs.

export interface SettleDeps {
  now: () => number;
  raf: (cb: () => void) => void;
  getHeight: () => number;
}

export interface SettleOptions {
  minWaitMs: number;
  maxWaitMs: number;
  stableFrames: number;
}

export function waitForLayoutSettle(deps: SettleDeps, opts: SettleOptions): Promise<void> {
  return new Promise(resolve => {
    const start = deps.now();
    let stableCount = 0;
    let lastHeight = deps.getHeight();

    const tick = () => {
      const elapsed = deps.now() - start;
      const height = deps.getHeight();

      if (height === lastHeight) {
        stableCount++;
      } else {
        stableCount = 0;
        lastHeight = height;
      }

      const settled = stableCount >= opts.stableFrames && elapsed >= opts.minWaitMs;
      if (settled || elapsed >= opts.maxWaitMs) {
        resolve();
        return;
      }

      deps.raf(tick);
    };

    deps.raf(tick);
  });
}

// Convenience factory for the real browser. Tests should call
// waitForLayoutSettle directly with controlled deps.
export function makeBrowserSettleDeps(): SettleDeps {
  return {
    now: () => performance.now(),
    raf: (cb) => requestAnimationFrame(cb),
    getHeight: () => Math.max(
      document.body.scrollHeight,
      document.documentElement.scrollHeight
    )
  };
}
