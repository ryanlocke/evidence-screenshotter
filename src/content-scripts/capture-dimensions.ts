// Compute the actual canvas dimensions we can use for a full-page capture.
// Browsers refuse to render canvases larger than CANVAS_MAX_DIMENSION on either
// axis (typically 65535px on Chromium). Above that, captures silently produce
// a blank result. This helper clamps the page height to fit and surfaces a
// clear error if even a single viewport row would overflow the width axis.

export interface ClampInput {
  viewportWidth: number;
  totalHeight: number;
  dpr: number;
  configuredMaxHeight: number;
  canvasMaxDimension: number;
}

export interface ClampResult {
  canvasWidth: number;
  canvasHeight: number;
  effectiveMaxHeight: number;
  wasClampedByCanvasLimit: boolean;
}

export function clampCanvasDimensions(input: ClampInput): ClampResult {
  const { viewportWidth, totalHeight, dpr, configuredMaxHeight, canvasMaxDimension } = input;

  const canvasWidth = viewportWidth * dpr;
  if (canvasWidth > canvasMaxDimension) {
    throw new Error(
      `Page is too wide to capture: ${viewportWidth}px at ${dpr}x DPR ` +
      `exceeds the ${canvasMaxDimension}px canvas limit. ` +
      `Try zooming out or reducing the window width.`
    );
  }

  // Two ceilings: the user-configured max page height and the per-axis
  // canvas limit at this device pixel ratio.
  const dprMaxHeight = Math.floor(canvasMaxDimension / dpr);
  const effectiveMaxHeight = Math.min(totalHeight, configuredMaxHeight, dprMaxHeight);
  const wasClampedByCanvasLimit = totalHeight > dprMaxHeight && configuredMaxHeight > dprMaxHeight;

  return {
    canvasWidth,
    canvasHeight: effectiveMaxHeight * dpr,
    effectiveMaxHeight,
    wasClampedByCanvasLimit
  };
}
