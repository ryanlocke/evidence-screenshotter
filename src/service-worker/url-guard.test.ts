import { describe, expect, it } from 'vitest';
import { isBrowserInternalUrl } from './url-guard';

describe('isBrowserInternalUrl', () => {
  it.each([
    'chrome://settings',
    'chrome://newtab/',
    'chrome-extension://abcdef/popup.html',
    'brave://rewards',
    'edge://settings/profiles',
    'about:blank',
    'about:config',
    'devtools://devtools/bundled/inspector.html'
  ])('flags %s as browser-internal', (url) => {
    expect(isBrowserInternalUrl(url)).toBe(true);
  });

  it.each([
    'https://example.com',
    'http://localhost:3000',
    'https://reddit.com/r/programming',
    'file:///Users/me/page.html',
    'data:text/html,<p>hi</p>'
  ])('does not flag %s', (url) => {
    expect(isBrowserInternalUrl(url)).toBe(false);
  });

  it('does not match a regular URL that contains "chrome://" later', () => {
    expect(isBrowserInternalUrl('https://example.com/?q=chrome://')).toBe(false);
  });
});
