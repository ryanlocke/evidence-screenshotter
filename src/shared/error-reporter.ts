// Error reporting utility for internal debugging

import { EXTENSION_VERSION } from './constants';

export interface ErrorLogEntry {
  id: string;
  timestamp: string;
  version: string;
  action: string;
  url: string;
  error: string;
  stack?: string;
  context: Record<string, unknown>;
  logs: string[];
}

export interface ErrorReport {
  entries: ErrorLogEntry[];
  browserInfo: string;
  osInfo: string;
}

const ERROR_LOG_KEY = 'evidence_error_log';
const MAX_ERROR_ENTRIES = 20;
const MAX_LOG_LINES = 50;

// In-memory log buffer for current operation
let currentLogs: string[] = [];
let currentAction = '';
let currentUrl = '';
let currentContext: Record<string, unknown> = {};

// Start tracking a new operation
export function startOperation(action: string, url: string, context: Record<string, unknown> = {}) {
  currentAction = action;
  currentUrl = url;
  currentContext = context;
  currentLogs = [];
  log(`Started: ${action}`);
}

// Add a log line
export function log(message: string) {
  const timestamp = new Date().toLocaleTimeString();
  const line = `[${timestamp}] ${message}`;
  currentLogs.push(line);
  console.log(`[EvidenceScreenshotter] ${message}`);

  // Keep log buffer bounded
  if (currentLogs.length > MAX_LOG_LINES) {
    currentLogs = currentLogs.slice(-MAX_LOG_LINES);
  }
}

// Record an error
export async function recordError(error: Error | string, additionalContext: Record<string, unknown> = {}) {
  const errorMessage = error instanceof Error ? error.message : error;
  const stack = error instanceof Error ? error.stack : undefined;

  log(`ERROR: ${errorMessage}`);

  const entry: ErrorLogEntry = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    timestamp: new Date().toISOString(),
    version: EXTENSION_VERSION,
    action: currentAction || 'Unknown',
    url: currentUrl || 'Unknown',
    error: errorMessage,
    stack,
    context: { ...currentContext, ...additionalContext },
    logs: [...currentLogs]
  };

  // Save to storage
  try {
    const existing = await getErrorLog();
    const updated = [entry, ...existing].slice(0, MAX_ERROR_ENTRIES);
    await chrome.storage.local.set({ [ERROR_LOG_KEY]: updated });
  } catch (e) {
    console.error('Failed to save error log:', e);
  }

  return entry;
}

// Get all error log entries
export async function getErrorLog(): Promise<ErrorLogEntry[]> {
  return new Promise((resolve) => {
    chrome.storage.local.get(ERROR_LOG_KEY, (result) => {
      resolve(result[ERROR_LOG_KEY] || []);
    });
  });
}

// Clear error log
export async function clearErrorLog(): Promise<void> {
  await chrome.storage.local.remove(ERROR_LOG_KEY);
}

// Get browser and OS info
function getBrowserInfo(): string {
  const ua = navigator.userAgent;
  const chromeMatch = ua.match(/Chrome\/(\d+\.\d+\.\d+\.\d+)/);
  return chromeMatch ? `Chrome ${chromeMatch[1]}` : 'Unknown browser';
}

function getOSInfo(): string {
  const ua = navigator.userAgent;
  if (ua.includes('Mac OS X')) {
    const match = ua.match(/Mac OS X (\d+[._]\d+[._]?\d*)/);
    return match ? `macOS ${match[1].replace(/_/g, '.')}` : 'macOS';
  }
  if (ua.includes('Windows')) {
    if (ua.includes('Windows NT 10.0')) return 'Windows 10/11';
    return 'Windows';
  }
  if (ua.includes('Linux')) return 'Linux';
  return 'Unknown OS';
}

// Format a single error entry for display
export function formatErrorEntry(entry: ErrorLogEntry): string {
  const lines = [
    `Time: ${new Date(entry.timestamp).toLocaleString()}`,
    `Action: ${entry.action}`,
    `URL: ${entry.url}`,
    `Error: ${entry.error}`,
  ];

  if (entry.stack) {
    // Truncate stack to first 5 lines
    const stackLines = entry.stack.split('\n').slice(0, 5);
    lines.push(`Stack: ${stackLines.join('\n       ')}`);
  }

  if (Object.keys(entry.context).length > 0) {
    lines.push(`Context: ${JSON.stringify(entry.context)}`);
  }

  if (entry.logs.length > 0) {
    lines.push('', 'Log:');
    entry.logs.slice(-10).forEach(log => lines.push(`  ${log}`));
  }

  return lines.join('\n');
}

// Generate full error report for copying
export async function generateErrorReport(): Promise<string> {
  const entries = await getErrorLog();

  const lines = [
    'Evidence Screenshotter Error Report',
    '===================================',
    `Generated: ${new Date().toLocaleString()}`,
    `Version: ${EXTENSION_VERSION}`,
    `Browser: ${getBrowserInfo()}`,
    `OS: ${getOSInfo()}`,
    '',
  ];

  if (entries.length === 0) {
    lines.push('No errors recorded.');
  } else {
    lines.push(`Recent errors (${entries.length}):`);
    lines.push('');

    entries.slice(0, 5).forEach((entry, i) => {
      lines.push(`--- Error ${i + 1} ---`);
      lines.push(formatErrorEntry(entry));
      lines.push('');
    });
  }

  return lines.join('\n');
}

// Generate a short summary for the popup
export async function getErrorSummary(): Promise<{ count: number; lastError?: ErrorLogEntry }> {
  const entries = await getErrorLog();
  return {
    count: entries.length,
    lastError: entries[0]
  };
}
