import type { CaptureOptions, EvidenceData, EvidenceMetadata, ScreenshotData, ExtractedContent } from '../shared/types';
import type {
  ExtensionMessage,
  CaptureProgressMessage,
  CaptureCompleteMessage,
  CaptureErrorMessage,
  ExtractContentMessage,
  GeneratePDFMessage,
  ExtractionCompleteMessage,
  PDFReadyMessage,
  GetDimensionsMessage,
  DimensionsResponseMessage
} from '../shared/messages';
import { EXTENSION_VERSION } from '../shared/constants';
import { CAPTURE_CONFIG } from '../shared/constants';
import { startOperation, log, recordError } from '../shared/error-reporter';
import { isBrowserInternalUrl } from './url-guard';
import { describeInjectionError } from './injection-errors';

// Track offscreen document state
let offscreenDocumentCreating: Promise<void> | null = null;

// Prevent concurrent capture requests (double-click, popup + icon click, etc.)
let captureInProgress = false;

// Tracks the active capture so cancel requests can target the right tab.
let activeCaptureTabId: number | null = null;
let captureCancelled = false;

// Sentinel thrown when the user cancels; treated specially by the catch block
// so we don't surface it as an error or open the error report page.
class CaptureCancelledError extends Error {
  constructor() { super('Capture cancelled by user'); this.name = 'CaptureCancelledError'; }
}

// Timestamp of the last captureVisibleTab call (successful or failed)
let lastCaptureVisibleTabTime = 0;

// Serialize captureVisibleTab calls to avoid concurrent bursts across contexts
let captureViewportQueue: Promise<void> = Promise.resolve();

function tryStartCapture(): boolean {
  if (captureInProgress) return false;
  captureInProgress = true;
  captureCancelled = false;
  activeCaptureTabId = null;
  return true;
}

function throwIfCancelled() {
  if (captureCancelled) throw new CaptureCancelledError();
}

// Fire-and-forget message to the popup. The popup may be closed, in which
// case chrome throws synchronously or rejects; either way we don't care.
function silentSend(message: ExtensionMessage): void {
  try {
    chrome.runtime.sendMessage(message)?.catch(() => {});
  } catch {
    // Popup closed; ignore.
  }
}

function sendProgress(stage: CaptureProgressMessage['stage'], message: string) {
  silentSend({ type: 'CAPTURE_PROGRESS', stage, message } as CaptureProgressMessage);
}

function sendComplete(success: boolean) {
  silentSend({ type: 'CAPTURE_COMPLETE', success } as CaptureCompleteMessage);
}

// Open the error report tab. Caller is responsible for ensuring recordError
// has run first so the page reads fresh data from chrome.storage.local.
async function openErrorReportTab(sourceTabIndex?: number) {
  try {
    const errorPageUrl = chrome.runtime.getURL('error-report.html');
    const createOptions: chrome.tabs.CreateProperties = { url: errorPageUrl, active: true };
    if (sourceTabIndex !== undefined) {
      createOptions.index = sourceTabIndex + 1;
    }
    await chrome.tabs.create(createOptions);
  } catch (e) {
    log(`Failed to open error report tab: ${e}`);
  }
}

// Capture visible tab screenshot
async function captureViewport(tabId: number): Promise<string> {
  const captureOperation = async (): Promise<string> => {
    const tab = await chrome.tabs.get(tabId);
    if (!tab.windowId) throw new Error('Tab has no window');

    // Enforce global cooldown across all captureVisibleTab call sites
    if (lastCaptureVisibleTabTime > 0) {
      const elapsed = performance.now() - lastCaptureVisibleTabTime;
      const waitMs = CAPTURE_CONFIG.rateLimitMs - elapsed;
      if (waitMs > 0) {
        await sleep(waitMs);
      }
    }

    try {
      // Use JPEG with quality 90 - much smaller than PNG, visually identical
      // PNG can be 5-10MB, JPEG is typically 200-500KB
      return await chrome.tabs.captureVisibleTab(tab.windowId, {
        format: 'jpeg',
        quality: 90
      });
    } finally {
      lastCaptureVisibleTabTime = performance.now();
    }
  };

  const capturePromise = captureViewportQueue.then(captureOperation, captureOperation);
  captureViewportQueue = capturePromise.then(() => undefined, () => undefined);
  return capturePromise;
}

// Get image dimensions by asking the content script (viewport) and using the stitched height when applicable
async function getImageDimensions(tabId: number, dataUrl: string, captureType: 'viewport' | 'full-page') {
  if (captureType === 'viewport') {
    const dims = await sendMessageToTab<DimensionsResponseMessage>(tabId, { type: 'GET_DIMENSIONS' } as GetDimensionsMessage);
    return { width: dims.width, height: dims.height };
  }

  // For full-page stitched images, use createImageBitmap (works in service workers)
  // Convert data URL to blob first
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);
  const dimensions = { width: bitmap.width, height: bitmap.height };
  bitmap.close(); // Free memory
  return dimensions;
}

// Helper to wait
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Send message to tab with retry (for content script timing)
async function sendMessageToTab<T>(tabId: number, message: unknown, maxRetries = 5): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, message);
      return response as T;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      // Short delay before retry - content script should be ready quickly
      await sleep(50);
    }
  }

  throw lastError || new Error('Failed to send message to tab');
}

// Ensure offscreen document exists
async function ensureOffscreenDocument(): Promise<void> {
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT]
  });

  if (existingContexts.length > 0) {
    return;
  }

  if (offscreenDocumentCreating) {
    await offscreenDocumentCreating;
    return;
  }

  offscreenDocumentCreating = chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: [chrome.offscreen.Reason.DOM_PARSER],
    justification: 'Generate PDF from captured content'
  });

  await offscreenDocumentCreating;
  offscreenDocumentCreating = null;
}

// Storage key for captured data
const CAPTURE_STORAGE_KEY = 'evidence_capture_data';

// Main capture flow - now opens preview page instead of generating PDF directly
async function handleCaptureRequest(options: CaptureOptions) {
  const startTime = performance.now();
  let sourceTabIndex: number | undefined;
  try {
    // Get active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url) {
      throw new Error('No active tab found');
    }

    const tabId = tab.id;
    const url = tab.url;
    const pageTitle = tab.title || url;
    sourceTabIndex = tab.index;
    activeCaptureTabId = tabId;

    // Start operation logging
    startOperation(`${options.captureType} capture`, url, {
      captureType: options.captureType,
      strategy: options.strategy,
      pageTitle
    });
    log('Capture request started');
    throwIfCancelled();

    // Check for browser internal pages that can't be captured
    if (isBrowserInternalUrl(url)) {
      throw new Error(`Cannot capture browser pages (${url.split('/')[0]}//). Please navigate to a regular webpage.`);
    }

    // Step 1: Inject content script first (needed for full-page capture)
    log('Injecting content script');
    console.time('injectScript');
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content-script.js']
      });
    } catch (injectErr) {
      log(`Script injection failed: ${injectErr}`);
      throw new Error(describeInjectionError(injectErr));
    }
    console.timeEnd('injectScript');

    // Minimal delay to let content script initialize its listener
    await sleep(20);
    throwIfCancelled();

    // Step 2: Capture screenshot
    sendProgress('capturing', options.captureType === 'full-page' ? 'Capturing full page...' : 'Capturing screenshot...');
    const screenshotTimer = `captureScreenshot_${startTime}`;
    console.time(screenshotTimer);

    let screenshotDataUrl: string;

    if (options.captureType === 'full-page') {
      // Request full-page capture from content script
      const response = await sendMessageToTab<{ type: string; dataUrl?: string; error?: string; cancelled?: boolean }>(
        tabId,
        { type: 'CAPTURE_FULL_PAGE' }
      );

      if (response.cancelled) {
        throw new CaptureCancelledError();
      }
      if (response.type === 'FULL_PAGE_ERROR' || !response.dataUrl) {
        throw new Error(response.error || 'Full page capture failed');
      }

      screenshotDataUrl = response.dataUrl;
    } else {
      // Viewport capture only
      screenshotDataUrl = await captureViewport(tabId);
    }

    console.timeEnd(screenshotTimer);
    console.log('Screenshot size:', screenshotDataUrl.length, 'chars');
    throwIfCancelled();
    const dimensions = await getImageDimensions(tabId, screenshotDataUrl, options.captureType);

    const screenshot: ScreenshotData = {
      dataUrl: screenshotDataUrl,
      captureType: options.captureType,
      dimensions
    };

    // Step 3: Extract content (content script already injected above)
    sendProgress('extracting', 'Extracting page content...');

    // Request content extraction (with retry for timing issues)
    const extractMessage: ExtractContentMessage = {
      type: 'EXTRACT_CONTENT',
      strategy: options.strategy
    };

    console.time('extractContent');
    const extractionResponse = await sendMessageToTab<ExtractionCompleteMessage>(tabId, extractMessage);
    console.timeEnd('extractContent');

    if (!extractionResponse || extractionResponse.type !== 'EXTRACTION_COMPLETE') {
      throw new Error('Content extraction failed');
    }

    // Step 4: Store data and open preview
    sendProgress('generating', 'Opening preview...');

    const metadata: EvidenceMetadata = {
      url,
      capturedAt: new Date(),
      pageTitle,
      extensionVersion: EXTENSION_VERSION
    };

    const evidenceData: EvidenceData = {
      metadata,
      screenshot,
      extractedContent: extractionResponse.content
    };

    // Store captured data for preview page to read
    console.time('storageSet');
    console.log('Screenshot data size:', evidenceData.screenshot.dataUrl.length, 'chars');
    try {
      await chrome.storage.local.set({ [CAPTURE_STORAGE_KEY]: evidenceData });
      console.timeEnd('storageSet');
    } catch (storageErr) {
      log(`Storage failed: ${storageErr}`);
      throw new Error(`Failed to save capture data: ${storageErr}`);
    }

    // Open preview page in new tab (to the right of source tab)
    console.time('openPreview');
    try {
      const previewUrl = chrome.runtime.getURL('preview.html');
      console.log('Opening preview URL:', previewUrl);
      await chrome.tabs.create({ url: previewUrl, index: sourceTabIndex + 1 });
      console.timeEnd('openPreview');
    } catch (tabErr) {
      log(`Failed to open preview tab: ${tabErr}`);
      throw new Error(`Failed to open preview: ${tabErr}`);
    }

    console.log('Total capture time:', performance.now() - startTime, 'ms');
    sendComplete(true);

  } catch (err) {
    if (err instanceof CaptureCancelledError) {
      log('Capture cancelled by user');
      silentSend({ type: 'CAPTURE_CANCELLED' });
      return;
    }

    const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
    log(`Capture failed: ${errorMessage}`);

    // Record first so chrome.storage.local is up to date before the error
    // report page reads it. recordError catches its own storage failures.
    try {
      await recordError(err instanceof Error ? err : new Error(String(err)));
    } catch (recordErr) {
      log(`Failed to record error: ${recordErr}`);
    }

    // Then open the report tab and notify the popup. Both are best-effort.
    await openErrorReportTab(sourceTabIndex);
    silentSend({ type: 'CAPTURE_ERROR', error: errorMessage } as CaptureErrorMessage);
  } finally {
    captureInProgress = false;
    activeCaptureTabId = null;
  }
}

// Listen for messages
chrome.runtime.onMessage.addListener((message: ExtensionMessage & { type: string }, sender, sendResponse) => {
  console.log('Service worker received:', message.type);

  switch (message.type) {
    case 'PING':
      // Warm-up ping from popup - just respond to keep service worker alive
      sendResponse({ type: 'PONG' });
      return false;

    case 'CAPTURE_REQUEST':
      if (!tryStartCapture()) {
        sendResponse({ ok: false, error: 'Capture already in progress' });
        return false;
      }
      sendResponse({ ok: true });
      handleCaptureRequest(message.options);
      return false;

    case 'CAPTURE_VIEWPORT':
      // Handle viewport capture request from content script (for full-page stitching)
      if (sender.tab?.id) {
        captureViewport(sender.tab.id)
          .then(dataUrl => sendResponse(dataUrl))
          .catch(err => {
            console.error('CAPTURE_VIEWPORT failed:', err);
            sendResponse({ error: err.message || 'Capture failed' });
          });
        return true; // Keep channel open for async response
      } else {
        console.error('CAPTURE_VIEWPORT: No tab ID available');
        sendResponse({ error: 'No tab ID available' });
        return false;
      }

    case 'CAPTURE_CANCEL':
      if (!captureInProgress) {
        sendResponse({ ok: false, reason: 'no-capture' });
        return false;
      }
      captureCancelled = true;
      log('Cancel requested');
      // Forward to content script so the full-page scroll loop stops at the
      // next iteration. Best-effort; if the tab is gone we still flip the flag
      // and the orchestration loop will throw on its next checkpoint.
      if (activeCaptureTabId !== null) {
        chrome.tabs.sendMessage(activeCaptureTabId, { type: 'CAPTURE_CANCEL' }).catch(() => {
          // Tab gone, that's fine
        });
      }
      sendResponse({ ok: true });
      return false;
  }

  return false;
});

// Handle extension icon click - immediately capture
chrome.action.onClicked.addListener((tab) => {
  if (!tab?.id || !tab.url) {
    console.error('No active tab found');
    return;
  }

  // Skip chrome:// and extension pages
  if (isBrowserInternalUrl(tab.url)) {
    console.log('Cannot capture browser internal pages');
    return;
  }

  console.log('Extension icon clicked, starting capture...');
  if (!tryStartCapture()) {
    console.log('Capture already in progress, ignoring icon click');
    return;
  }
  handleCaptureRequest({
    captureType: 'full-page',
    strategy: 'readability'
  });
});

console.log('Evidence Screenshotter service worker loaded');
