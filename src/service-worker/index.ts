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

// Track offscreen document state
let offscreenDocumentCreating: Promise<void> | null = null;

// Send progress update to popup (may fail if popup closed, that's ok)
function sendProgress(stage: CaptureProgressMessage['stage'], message: string) {
  try {
    chrome.runtime.sendMessage({
      type: 'CAPTURE_PROGRESS',
      stage,
      message
    } as CaptureProgressMessage);
  } catch {
    // Popup probably closed, ignore
  }
}

// Send completion to popup (may fail if popup closed, that's ok)
function sendComplete(success: boolean) {
  try {
    chrome.runtime.sendMessage({
      type: 'CAPTURE_COMPLETE',
      success
    } as CaptureCompleteMessage);
  } catch {
    // Popup probably closed, ignore
  }
}

// Send error to popup and open error report page
async function sendError(error: string, openErrorPage = true) {
  console.log('sendError called:', error, 'openErrorPage:', openErrorPage);

  // Send to popup (may fail if popup is closed, that's ok)
  try {
    chrome.runtime.sendMessage({
      type: 'CAPTURE_ERROR',
      error
    } as CaptureErrorMessage);
  } catch (e) {
    console.log('Could not send to popup (probably closed):', e);
  }

  // Open error report page for easy copying
  if (openErrorPage) {
    console.log('Opening error report page...');
    try {
      const errorPageUrl = chrome.runtime.getURL('error-report.html');
      console.log('Error page URL:', errorPageUrl);
      await chrome.tabs.create({ url: errorPageUrl, active: true });
      console.log('Error report page opened');
    } catch (e) {
      console.error('Failed to open error report page:', e);
    }
  }
}

// Capture visible tab screenshot
async function captureViewport(tabId: number): Promise<string> {
  const tab = await chrome.tabs.get(tabId);
  if (!tab.windowId) throw new Error('Tab has no window');

  // Use JPEG with quality 90 - much smaller than PNG, visually identical
  // PNG can be 5-10MB, JPEG is typically 200-500KB
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
    format: 'jpeg',
    quality: 90
  });

  return dataUrl;
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
  try {
    // Get active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url) {
      throw new Error('No active tab found');
    }

    const tabId = tab.id;
    const url = tab.url;
    const pageTitle = tab.title || url;

    // Start operation logging
    startOperation(`${options.captureType} capture`, url, {
      captureType: options.captureType,
      strategy: options.strategy,
      pageTitle
    });
    log('Capture request started');

    // Check for browser internal pages that can't be captured
    const browserPagePrefixes = ['chrome://', 'chrome-extension://', 'brave://', 'edge://', 'about:', 'devtools://'];
    if (browserPagePrefixes.some(prefix => url.startsWith(prefix))) {
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
      throw new Error(`Cannot capture this page. It may be restricted or require special permissions.`);
    }
    console.timeEnd('injectScript');

    // Minimal delay to let content script initialize its listener
    await sleep(20);

    // Step 2: Capture screenshot
    sendProgress('capturing', options.captureType === 'full-page' ? 'Capturing full page...' : 'Capturing screenshot...');
    const screenshotTimer = `captureScreenshot_${startTime}`;
    console.time(screenshotTimer);

    let screenshotDataUrl: string;

    if (options.captureType === 'full-page') {
      // Request full-page capture from content script
      const response = await sendMessageToTab<{ type: string; dataUrl?: string; error?: string }>(
        tabId,
        { type: 'CAPTURE_FULL_PAGE' }
      );

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
      console.error('Storage failed:', storageErr);
      throw new Error(`Failed to save capture data: ${storageErr}`);
    }

    // Open preview page in new tab
    console.time('openPreview');
    try {
      const previewUrl = chrome.runtime.getURL('preview.html');
      console.log('Opening preview URL:', previewUrl);
      await chrome.tabs.create({ url: previewUrl });
      console.timeEnd('openPreview');
    } catch (tabErr) {
      console.error('Failed to open preview tab:', tabErr);
      throw new Error(`Failed to open preview: ${tabErr}`);
    }

    console.log('Total capture time:', performance.now() - startTime, 'ms');
    sendComplete(true);

  } catch (err) {
    console.error('Capture failed:', err);
    const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
    console.log('Recording error and opening error page for:', errorMessage);

    // Open error page FIRST, before anything else can fail
    try {
      const errorPageUrl = chrome.runtime.getURL('error-report.html');
      console.log('Opening error page:', errorPageUrl);
      await chrome.tabs.create({ url: errorPageUrl, active: true });
    } catch (openErr) {
      console.error('Failed to open error page:', openErr);
    }

    // Then record and notify
    try {
      await recordError(err instanceof Error ? err : new Error(String(err)));
    } catch (recordErr) {
      console.error('Failed to record error:', recordErr);
    }

    try {
      await sendError(errorMessage, false); // false = don't open page again
    } catch (sendErr) {
      console.error('Failed to send error:', sendErr);
    }
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
      handleCaptureRequest(message.options);
      break;

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
  if (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
    console.log('Cannot capture browser internal pages');
    return;
  }

  console.log('Extension icon clicked, starting capture...');
  handleCaptureRequest({
    captureType: 'full-page',
    strategy: 'readability'
  });
});

console.log('Evidence Screenshotter service worker loaded');
