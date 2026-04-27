import type { ExtractContentMessage, ExtractionCompleteMessage } from '../shared/messages';
import type { DimensionsResponseMessage } from '../shared/messages';
import { CAPTURE_CONFIG } from '../shared/constants';
import { startOperation, log, recordError } from '../shared/error-reporter';
import { extractContent } from './extraction';
import { captureViewportWithRetry } from './capture-retry';

// Request a single viewport capture from service worker
async function requestViewportCapture(): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    chrome.runtime.sendMessage({ type: 'CAPTURE_VIEWPORT' }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (response?.error) {
        reject(new Error(response.error));
      } else if (typeof response === 'string') {
        resolve(response);
      } else {
        reject(new Error('Invalid response from service worker'));
      }
    });
  });
}

// Full-page screenshot via scroll-stitching
async function captureFullPage(): Promise<string> {
  const viewportHeight = window.innerHeight;
  const viewportWidth = window.innerWidth;
  const dpr = window.devicePixelRatio || 1;
  const totalHeight = Math.max(
    document.body.scrollHeight,
    document.documentElement.scrollHeight
  );

  const maxHeight = Math.min(totalHeight, CAPTURE_CONFIG.maxPageHeight);
  const numCaptures = Math.ceil(maxHeight / viewportHeight);

  startOperation('Full-page capture', location.href, {
    viewportHeight,
    viewportWidth,
    totalHeight,
    maxHeight,
    numCaptures,
    dpr
  });

  log(`Page dimensions: ${viewportWidth}x${totalHeight}, capturing ${numCaptures} sections`);

  const originalScrollY = window.scrollY;

  const canvas = document.createElement('canvas');
  canvas.width = viewportWidth * dpr;
  canvas.height = maxHeight * dpr;
  const ctx = canvas.getContext('2d')!;

  // Adaptive delay - starts at configured rate limit, adjusts based on success/failure
  let adaptiveDelay = CAPTURE_CONFIG.rateLimitMs;
  let lastCaptureTime = performance.now();

  const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

  for (let i = 0; i < numCaptures; i++) {
    const scrollY = i * viewportHeight;

    window.scrollTo(0, scrollY);
    await sleep(CAPTURE_CONFIG.scrollDelay);
    log(`Capturing section ${i + 1}/${numCaptures}`);

    // Wait for rate limit between sections; global cross-run cooldown is enforced in service worker
    if (i > 0) {
      const now = performance.now();
      const elapsed = now - lastCaptureTime;
      const wait = Math.max(CAPTURE_CONFIG.minCaptureDelay, adaptiveDelay - elapsed);
      await sleep(Math.max(wait, 0));
    }

    const { dataUrl, nextDelay } = await captureViewportWithRetry({
      requestCapture: requestViewportCapture,
      sleep,
      log,
      currentDelay: adaptiveDelay
    });
    adaptiveDelay = nextDelay;
    lastCaptureTime = performance.now();

    // Draw on canvas - captureVisibleTab returns image at device pixel ratio
    await new Promise<void>((resolve) => {
      const img = new Image();
      img.onload = () => {
        const destY = scrollY * dpr;
        const destHeight = Math.min(img.height, canvas.height - destY);
        ctx.drawImage(
          img,
          0, 0, img.width, destHeight,
          0, destY, img.width, destHeight
        );
        resolve();
      };
      img.src = dataUrl;
    });
  }

  window.scrollTo(0, originalScrollY);

  return canvas.toDataURL('image/jpeg', 0.9);
}

chrome.runtime.onMessage.addListener((message: ExtractContentMessage & { type: string }, sender, sendResponse) => {
  if (message.type === 'EXTRACT_CONTENT') {
    console.log('Content script: extracting with strategy:', message.strategy);

    try {
      const content = extractContent(document, message.strategy, location.href);

      const response: ExtractionCompleteMessage = {
        type: 'EXTRACTION_COMPLETE',
        content,
        url: location.href,
        title: document.title
      };

      sendResponse(response);
    } catch (err) {
      console.error('Content extraction error:', err);
      const response: ExtractionCompleteMessage = {
        type: 'EXTRACTION_COMPLETE',
        content: {
          title: document.title || 'Unknown Page',
          content: '<p>Content extraction failed</p>',
          textContent: 'Content extraction failed',
          images: [],
          pageType: 'generic',
          confidence: 0
        },
        url: location.href,
        title: document.title
      };
      sendResponse(response);
    }

    return true;
  }

  if (message.type === 'CAPTURE_FULL_PAGE') {
    console.log('Content script: capturing full page');
    captureFullPage().then(dataUrl => {
      log('Full page capture completed successfully');
      sendResponse({ type: 'FULL_PAGE_CAPTURED', dataUrl });
    }).catch(async (err) => {
      console.error('Full page capture failed:', err);
      await recordError(err instanceof Error ? err : new Error(String(err)));
      sendResponse({ type: 'FULL_PAGE_ERROR', error: String(err) });
    });
    return true;
  }

  if (message.type === 'GET_DIMENSIONS') {
    const response: DimensionsResponseMessage = {
      type: 'DIMENSIONS_RESPONSE',
      width: window.innerWidth,
      height: window.innerHeight
    };
    sendResponse(response);
    return true;
  }
});

console.log('Evidence Screenshotter content script loaded');
