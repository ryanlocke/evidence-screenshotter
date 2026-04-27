import { CAPTURE_CONFIG } from '../shared/constants';

export interface CaptureRetryOptions {
  requestCapture: () => Promise<string>;
  sleep: (ms: number) => Promise<void>;
  log?: (msg: string) => void;
  currentDelay: number;
  maxRetries?: number;
}

// Capture viewport with retry and exponential backoff for rate limit errors.
// On success, decays the delay back toward the base rate limit.
export async function captureViewportWithRetry(
  opts: CaptureRetryOptions
): Promise<{ dataUrl: string; nextDelay: number }> {
  const { requestCapture, sleep, log, currentDelay } = opts;
  const maxRetries = opts.maxRetries ?? CAPTURE_CONFIG.maxRetries;

  let delay = currentDelay;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const dataUrl = await requestCapture();
      const reducedDelay = delay > CAPTURE_CONFIG.rateLimitMs
        ? Math.max(CAPTURE_CONFIG.rateLimitMs, delay * 0.9)
        : delay;
      return { dataUrl, nextDelay: reducedDelay };
    } catch (err) {
      const isRateLimited = err instanceof Error &&
        err.message.includes('MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND');

      if (isRateLimited && attempt < maxRetries - 1) {
        delay = Math.min(delay * 1.5, CAPTURE_CONFIG.maxBackoffMs);
        log?.(`Rate limited, retrying in ${delay}ms (attempt ${attempt + 2}/${maxRetries})`);
        await sleep(delay);
        continue;
      }
      throw err;
    }
  }

  throw new Error('Max retries exceeded for viewport capture');
}
