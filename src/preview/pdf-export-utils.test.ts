import { describe, expect, it } from 'vitest';
import { getRegionRelativeToContainer, getVisibleScreenshotDataUrls } from './pdf-export-utils';

describe('getVisibleScreenshotDataUrls', () => {
  it('returns only screenshot data URLs from non-removed sections', () => {
    const container = document.createElement('div');
    container.innerHTML = `
      <div class="screenshot-section-item"><img src="data:image/jpeg;base64,AAA" /></div>
      <div class="screenshot-section-item removed"><img src="data:image/jpeg;base64,BBB" /></div>
      <div class="screenshot-section-item"><img src="data:image/jpeg;base64,CCC" /></div>
    `;

    expect(getVisibleScreenshotDataUrls(container)).toEqual([
      'data:image/jpeg;base64,AAA',
      'data:image/jpeg;base64,CCC',
    ]);
  });

  it('includes a section again after removed class is cleared (undo scenario)', () => {
    const container = document.createElement('div');
    container.innerHTML = '<div class="screenshot-section-item removed"><img src="data:image/jpeg;base64,DDD" /></div>';
    const section = container.querySelector('.screenshot-section-item');
    section?.classList.remove('removed');

    expect(getVisibleScreenshotDataUrls(container)).toEqual(['data:image/jpeg;base64,DDD']);
  });
});

describe('getRegionRelativeToContainer', () => {
  it('preserves left and top offsets from the container origin', () => {
    const containerRect = new DOMRect(100, 50, 1000, 1000);
    const elementRect = new DOMRect(220, 140, 400, 300);

    expect(getRegionRelativeToContainer(containerRect, elementRect)).toEqual({
      left: 120,
      top: 90,
      width: 400,
      height: 300,
    });
  });
});
