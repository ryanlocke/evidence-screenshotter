export function getVisibleScreenshotDataUrls(container: ParentNode): string[] {
  const images = container.querySelectorAll<HTMLImageElement>('.screenshot-section-item:not(.removed) img');
  return Array.from(images).map(img => img.src).filter(Boolean);
}

export interface RegionRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function getRegionRelativeToContainer(
  containerRect: Pick<DOMRect, 'left' | 'top'>,
  elementRect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
): RegionRect {
  return {
    left: elementRect.left - containerRect.left,
    top: elementRect.top - containerRect.top,
    width: elementRect.width,
    height: elementRect.height,
  };
}
