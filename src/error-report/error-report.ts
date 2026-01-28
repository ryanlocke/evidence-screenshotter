import { generateErrorReport, getErrorLog } from '../shared/error-reporter';

// DOM elements
const errorMessage = document.getElementById('errorMessage')!;
const reportText = document.getElementById('reportText') as HTMLTextAreaElement;
const copyBtn = document.getElementById('copyBtn') as HTMLButtonElement;
const retryBtn = document.getElementById('retryBtn') as HTMLButtonElement;
const closeBtn = document.getElementById('closeBtn') as HTMLButtonElement;
const toast = document.getElementById('toast')!;

// Show toast notification
function showToast(message: string) {
  toast.textContent = message;
  toast.classList.remove('hidden');
  setTimeout(() => {
    toast.classList.add('hidden');
  }, 2000);
}

// Load and display error report
async function loadErrorReport() {
  // Get the most recent error
  const errors = await getErrorLog();
  const latestError = errors[0];

  if (latestError) {
    errorMessage.textContent = latestError.error;
  } else {
    errorMessage.textContent = 'No error details available';
  }

  // Generate full report
  const report = await generateErrorReport();
  reportText.value = report;
}

// Copy report to clipboard
async function copyReport() {
  try {
    await navigator.clipboard.writeText(reportText.value);
    showToast('Copied to clipboard!');
    copyBtn.innerHTML = '<span class="btn-icon">✓</span> Copied!';
    setTimeout(() => {
      copyBtn.innerHTML = '<span class="btn-icon">📋</span> Copy to Clipboard';
    }, 2000);
  } catch {
    // Fallback
    reportText.select();
    document.execCommand('copy');
    showToast('Copied to clipboard!');
  }
}

// Retry capture - go back to previous tab
function retryCapture() {
  // Close this tab and let user try again
  window.close();
}

// Close tab
function closeTab() {
  window.close();
}

// Event listeners
copyBtn.addEventListener('click', copyReport);
retryBtn.addEventListener('click', retryCapture);
closeBtn.addEventListener('click', closeTab);

// Initialize
loadErrorReport();
