import { describe, expect, it } from 'vitest';
import { describeInjectionError } from './injection-errors';

describe('describeInjectionError', () => {
  it('explains chrome:// blocks', () => {
    const msg = describeInjectionError(new Error('Cannot access a chrome:// URL'));
    expect(msg).toMatch(/browser settings/);
  });

  it('explains generic extension-blocked URLs (Web Store, PDF viewer)', () => {
    const msg = describeInjectionError(new Error('Cannot access contents of url "https://chrome.google.com/webstore/...".'));
    expect(msg).toMatch(/Web Store/);
  });

  it('explains manifest-permission errors as the same blocked-page case', () => {
    const msg = describeInjectionError(new Error('Extension manifest must request permission to access this host.'));
    expect(msg).toMatch(/blocks extensions from capturing/);
  });

  it('explains CSP blocks', () => {
    const msg = describeInjectionError(new Error('Refused to execute inline script because it violates the Content Security Policy.'));
    expect(msg).toMatch(/Content Security Policy/);
  });

  it('explains tab-closed errors', () => {
    expect(describeInjectionError(new Error('No tab with id 42'))).toMatch(/tab was closed/);
    expect(describeInjectionError(new Error('The tab was closed.'))).toMatch(/tab was closed/);
  });

  it('explains frame-gone errors as a navigation race', () => {
    expect(describeInjectionError(new Error('No frame with id 0 in tab 7'))).toMatch(/navigated or reloaded/);
  });

  it('falls back to a generic message that includes the raw error', () => {
    expect(describeInjectionError(new Error('something weird happened'))).toMatch(/something weird happened/);
  });

  it('handles non-Error throwables', () => {
    expect(describeInjectionError('plain string error')).toMatch(/plain string error/);
  });
});
