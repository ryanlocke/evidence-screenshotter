import type { CaptureOptions } from '../shared/types';
import type { CaptureRequestMessage, CaptureProgressMessage, CaptureCompleteMessage, CaptureErrorMessage } from '../shared/messages';
import { getErrorSummary, generateErrorReport, clearErrorLog } from '../shared/error-reporter';

// DOM elements
const captureBtn = document.getElementById('captureBtn') as HTMLButtonElement;
const optionsDiv = document.getElementById('options') as HTMLDivElement;
const progressDiv = document.getElementById('progress') as HTMLDivElement;
const progressText = document.getElementById('progressText') as HTMLParagraphElement;
const errorDiv = document.getElementById('error') as HTMLDivElement;
const errorText = document.getElementById('errorText') as HTMLParagraphElement;

// Report modal elements
const reportBtn = document.getElementById('reportBtn') as HTMLButtonElement;
const errorBadge = document.getElementById('errorBadge') as HTMLSpanElement;
const reportModal = document.getElementById('reportModal') as HTMLDivElement;
const closeReportBtn = document.getElementById('closeReportBtn') as HTMLButtonElement;
const reportText = document.getElementById('reportText') as HTMLTextAreaElement;
const copyReportBtn = document.getElementById('copyReportBtn') as HTMLButtonElement;
const clearErrorsBtn = document.getElementById('clearErrorsBtn') as HTMLButtonElement;

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

// Update error badge count
async function updateErrorBadge() {
  const summary = await getErrorSummary();
  if (summary.count > 0) {
    errorBadge.textContent = summary.count.toString();
    errorBadge.classList.remove('hidden');
  } else {
    errorBadge.classList.add('hidden');
  }
}

// Show report modal
async function showReportModal() {
  const report = await generateErrorReport();
  reportText.value = report;
  reportModal.classList.remove('hidden');
}

// Hide report modal
function hideReportModal() {
  reportModal.classList.add('hidden');
}

// Copy report to clipboard
async function copyReport() {
  try {
    await navigator.clipboard.writeText(reportText.value);
    copyReportBtn.textContent = 'Copied!';
    setTimeout(() => {
      copyReportBtn.textContent = 'Copy to Clipboard';
    }, 2000);
  } catch {
    // Fallback for older browsers
    reportText.select();
    document.execCommand('copy');
    copyReportBtn.textContent = 'Copied!';
    setTimeout(() => {
      copyReportBtn.textContent = 'Copy to Clipboard';
    }, 2000);
  }
}

// Clear error log
async function clearErrors() {
  await clearErrorLog();
  await updateErrorBadge();
  const report = await generateErrorReport();
  reportText.value = report;
  clearErrorsBtn.textContent = 'Cleared!';
  setTimeout(() => {
    clearErrorsBtn.textContent = 'Clear Error Log';
  }, 2000);
}

// Event listeners for report modal
reportBtn.addEventListener('click', showReportModal);
closeReportBtn.addEventListener('click', hideReportModal);
copyReportBtn.addEventListener('click', copyReport);
clearErrorsBtn.addEventListener('click', clearErrors);

// Close modal on background click
reportModal.addEventListener('click', (e) => {
  if (e.target === reportModal) {
    hideReportModal();
  }
});

// Initialize error badge
updateErrorBadge();
