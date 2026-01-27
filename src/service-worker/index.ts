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

// Track offscreen document state
let offscreenDocumentCreating: Promise<void> | null = null;

// Send progress update to popup
function sendProgress(stage: CaptureProgressMessage['stage'], message: string) {
  chrome.runtime.sendMessage({
    type: 'CAPTURE_PROGRESS',
    stage,
    message
  } as CaptureProgressMessage);
}

// Send completion to popup
function sendComplete(success: boolean) {
  chrome.runtime.sendMessage({
    type: 'CAPTURE_COMPLETE',
    success
  } as CaptureCompleteMessage);
}

// Send error to popup
function sendError(error: string) {
  chrome.runtime.sendMessage({
    type: 'CAPTURE_ERROR',
    error
  } as CaptureErrorMessage);
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

  // For full-page stitched images, decode once to get real dimensions
  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.width, height: img.height });
    img.onerror = () => reject(new Error('Failed to read stitched image dimensions'));
    img.src = dataUrl;
  });
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

    // Step 1: Inject content script first (needed for full-page capture)
    console.time('injectScript');
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content-script.js']
    });
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
    await chrome.storage.local.set({ [CAPTURE_STORAGE_KEY]: evidenceData });
    console.timeEnd('storageSet');

    // Open preview page in new tab
    console.time('openPreview');
    await chrome.tabs.create({
      url: chrome.runtime.getURL('preview.html')
    });
    console.timeEnd('openPreview');

    console.log('Total capture time:', performance.now() - startTime, 'ms');
    sendComplete(true);

  } catch (err) {
    console.error('Capture failed:', err);
    sendError(err instanceof Error ? err.message : 'Unknown error occurred');
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
        captureViewport(sender.tab.id).then(sendResponse);
        return true; // Keep channel open for async response
      }
      break;
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
