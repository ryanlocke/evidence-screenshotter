// chrome.scripting.executeScript surfaces a small set of error messages.
// Translate them into something useful for end users.

export function describeInjectionError(rawError: unknown): string {
  const msg = rawError instanceof Error ? rawError.message : String(rawError);
  const lower = msg.toLowerCase();

  if (lower.includes('cannot access') && lower.includes('chrome://')) {
    return 'Chrome blocks extensions from capturing browser settings pages.';
  }

  if (lower.includes('cannot access contents of url') ||
      lower.includes('extension manifest must request permission')) {
    return 'Chrome blocks extensions from capturing this page type (e.g. the Web Store, PDF viewer, or another extension).';
  }

  if (lower.includes('blocked by content security policy') || lower.includes('csp')) {
    return "This page's Content Security Policy blocks the extension from injecting its capture script.";
  }

  if (lower.includes('no tab with id') ||
      lower.includes('the tab was closed') ||
      lower.includes('tab does not exist')) {
    return 'The tab was closed before capture could start.';
  }

  if (lower.includes('frame with id') || lower.includes('no frame')) {
    return 'The page navigated or reloaded before capture could start.';
  }

  return `Cannot capture this page (${msg}).`;
}
