import { describe, expect, it, vi } from 'vitest';
import { captureViewportWithRetry } from './capture-retry';
import { CAPTURE_CONFIG } from '../shared/constants';

const RATE_LIMIT_ERR = new Error('MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND exceeded');

function makeSleepSpy() {
  // Resolves immediately so tests run fast; records the requested delay.
  const calls: number[] = [];
  const sleep = vi.fn((ms: number) => {
    calls.push(ms);
    return Promise.resolve();
  });
  return { sleep, calls };
}

describe('captureViewportWithRetry', () => {
  it('returns the data URL on first-attempt success', async () => {
    const requestCapture = vi.fn().mockResolvedValue('data:image/jpeg;base64,AAA');
    const { sleep } = makeSleepSpy();

    const result = await captureViewportWithRetry({
      requestCapture,
      sleep,
      currentDelay: CAPTURE_CONFIG.rateLimitMs
    });

    expect(result.dataUrl).toBe('data:image/jpeg;base64,AAA');
    expect(requestCapture).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('keeps the current delay when at base rate limit', async () => {
    const requestCapture = vi.fn().mockResolvedValue('ok');
    const { sleep } = makeSleepSpy();

    const result = await captureViewportWithRetry({
      requestCapture,
      sleep,
      currentDelay: CAPTURE_CONFIG.rateLimitMs
    });

    expect(result.nextDelay).toBe(CAPTURE_CONFIG.rateLimitMs);
  });

  it('decays delay toward base when previously elevated, but not below it', async () => {
    const requestCapture = vi.fn().mockResolvedValue('ok');
    const { sleep } = makeSleepSpy();

    const elevated = CAPTURE_CONFIG.rateLimitMs * 2;
    const result = await captureViewportWithRetry({
      requestCapture,
      sleep,
      currentDelay: elevated
    });

    expect(result.nextDelay).toBe(elevated * 0.9);
    expect(result.nextDelay).toBeGreaterThanOrEqual(CAPTURE_CONFIG.rateLimitMs);
  });

  it('floors decayed delay at the base rate limit', async () => {
    const requestCapture = vi.fn().mockResolvedValue('ok');
    const { sleep } = makeSleepSpy();

    // Slightly above base; 0.9x would dip below base, so it should floor.
    const justAbove = CAPTURE_CONFIG.rateLimitMs + 50;
    const result = await captureViewportWithRetry({
      requestCapture,
      sleep,
      currentDelay: justAbove
    });

    expect(result.nextDelay).toBe(CAPTURE_CONFIG.rateLimitMs);
  });

  it('retries with 1.5x backoff on rate-limit error, then succeeds', async () => {
    const requestCapture = vi.fn()
      .mockRejectedValueOnce(RATE_LIMIT_ERR)
      .mockResolvedValueOnce('ok');
    const { sleep, calls } = makeSleepSpy();

    const start = CAPTURE_CONFIG.rateLimitMs;
    const result = await captureViewportWithRetry({
      requestCapture,
      sleep,
      currentDelay: start
    });

    expect(requestCapture).toHaveBeenCalledTimes(2);
    expect(calls).toEqual([start * 1.5]);
    // After success at elevated delay, decay 0.9x
    expect(result.nextDelay).toBe(start * 1.5 * 0.9);
    expect(result.dataUrl).toBe('ok');
  });

  it('caps backoff at maxBackoffMs across many rate-limit errors', async () => {
    const failures = new Array(6).fill(RATE_LIMIT_ERR);
    const requestCapture = vi.fn();
    failures.forEach(e => requestCapture.mockRejectedValueOnce(e));
    requestCapture.mockResolvedValueOnce('ok');

    const { sleep, calls } = makeSleepSpy();

    await captureViewportWithRetry({
      requestCapture,
      sleep,
      currentDelay: CAPTURE_CONFIG.rateLimitMs,
      maxRetries: 7
    });

    expect(calls.length).toBe(6);
    // Final sleep should be capped
    expect(calls[calls.length - 1]).toBeLessThanOrEqual(CAPTURE_CONFIG.maxBackoffMs);
    // Sleeps should be monotonically non-decreasing until cap
    for (let i = 1; i < calls.length; i++) {
      expect(calls[i]).toBeGreaterThanOrEqual(calls[i - 1] - 1);
    }
  });

  it('does not retry on non-rate-limit errors', async () => {
    const otherError = new Error('Network down');
    const requestCapture = vi.fn().mockRejectedValue(otherError);
    const { sleep } = makeSleepSpy();

    await expect(
      captureViewportWithRetry({
        requestCapture,
        sleep,
        currentDelay: CAPTURE_CONFIG.rateLimitMs
      })
    ).rejects.toThrow('Network down');

    expect(requestCapture).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('throws the rate-limit error after exhausting retries', async () => {
    const requestCapture = vi.fn().mockRejectedValue(RATE_LIMIT_ERR);
    const { sleep } = makeSleepSpy();

    await expect(
      captureViewportWithRetry({
        requestCapture,
        sleep,
        currentDelay: CAPTURE_CONFIG.rateLimitMs,
        maxRetries: 3
      })
    ).rejects.toThrow(/MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND/);

    expect(requestCapture).toHaveBeenCalledTimes(3);
  });

  it('invokes the optional log callback on each retry', async () => {
    const requestCapture = vi.fn()
      .mockRejectedValueOnce(RATE_LIMIT_ERR)
      .mockRejectedValueOnce(RATE_LIMIT_ERR)
      .mockResolvedValueOnce('ok');
    const { sleep } = makeSleepSpy();
    const log = vi.fn();

    await captureViewportWithRetry({
      requestCapture,
      sleep,
      log,
      currentDelay: CAPTURE_CONFIG.rateLimitMs
    });

    expect(log).toHaveBeenCalledTimes(2);
    expect(log.mock.calls[0][0]).toMatch(/Rate limited/);
  });
});
