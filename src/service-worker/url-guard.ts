// URL prefixes for browser-internal pages that cannot be captured.
export const BROWSER_INTERNAL_PREFIXES = [
  'chrome://',
  'chrome-extension://',
  'brave://',
  'edge://',
  'about:',
  'devtools://'
];

export function isBrowserInternalUrl(url: string): boolean {
  return BROWSER_INTERNAL_PREFIXES.some(prefix => url.startsWith(prefix));
}
