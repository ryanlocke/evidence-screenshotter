import type { CaptureOptions } from '../shared/types';
import type { CaptureRequestMessage, CaptureProgressMessage, CaptureCompleteMessage, CaptureErrorMessage } from '../shared/messages';

// DOM elements
const captureBtn = document.getElementById('captureBtn') as HTMLButtonElement;
const optionsDiv = document.getElementById('options') as HTMLDivElement;
const progressDiv = document.getElementById('progress') as HTMLDivElement;
const progressText = document.getElementById('progressText') as HTMLParagraphElement;
const errorDiv = document.getElementById('error') as HTMLDivElement;
const errorText = document.getElementById('errorText') as HTMLParagraphElement;

// Get selected options
function getOptions(): CaptureOptions {
  const captureType = (document.querySelector('input[name="captureType"]:checked') as HTMLInputElement)?.value as 'viewport' | 'full-page';

  return {
    captureType,
    strategy: 'readability' // Always use readability initially, AI enhancement available in preview
  };
}

// UI state management
function showProgress(message: string) {
  optionsDiv.classList.add('hidden');
  captureBtn.classList.add('hidden');
  errorDiv.classList.add('hidden');
  progressDiv.classList.remove('hidden');
  progressText.textContent = message;
}

function showError(message: string) {
  progressDiv.classList.add('hidden');
  errorDiv.classList.remove('hidden');
  errorText.textContent = message;
  optionsDiv.classList.remove('hidden');
  captureBtn.classList.remove('hidden');
  captureBtn.disabled = false;
}

// Handle capture button click
captureBtn.addEventListener('click', async () => {
  const options = getOptions();

  captureBtn.disabled = true;
  showProgress('Starting capture...');

  try {
    const message: CaptureRequestMessage = {
      type: 'CAPTURE_REQUEST',
      options
    };

    await chrome.runtime.sendMessage(message);
  } catch (err) {
    showError(`Failed to start capture: ${err instanceof Error ? err.message : 'Unknown error'}`);
  }
});

// Listen for messages from service worker
chrome.runtime.onMessage.addListener((message: CaptureProgressMessage | CaptureCompleteMessage | CaptureErrorMessage) => {
  switch (message.type) {
    case 'CAPTURE_PROGRESS':
      showProgress(message.message);
      break;
    case 'CAPTURE_COMPLETE':
      if (message.success) {
        // Preview opens in new tab, close popup
        window.close();
      } else {
        showError('Capture failed');
      }
      break;
    case 'CAPTURE_ERROR':
      showError(message.error);
      break;
  }
});

// Pre-warm service worker AFTER UI is ready (deferred to not block render)
setTimeout(() => {
  chrome.runtime.sendMessage({ type: 'PING' }).catch(() => {});
}, 0);
