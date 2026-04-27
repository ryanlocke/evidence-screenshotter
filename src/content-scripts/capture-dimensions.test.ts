import { describe, expect, it } from 'vitest';
import { clampCanvasDimensions } from './capture-dimensions';

const MAX = 65535;

describe('clampCanvasDimensions', () => {
  it('passes through when totalHeight fits under all limits', () => {
    const result = clampCanvasDimensions({
      viewportWidth: 1280,
      totalHeight: 4000,
      dpr: 2,
      configuredMaxHeight: 120000,
      canvasMaxDimension: MAX
    });
    expect(result.canvasWidth).toBe(2560);
    expect(result.canvasHeight).toBe(8000);
    expect(result.effectiveMaxHeight).toBe(4000);
    expect(result.wasClampedByCanvasLimit).toBe(false);
  });

  it('clamps tall pages to the canvas hardware limit at dpr=2', () => {
    const result = clampCanvasDimensions({
      viewportWidth: 1280,
      totalHeight: 200000,
      dpr: 2,
      configuredMaxHeight: 120000,
      canvasMaxDimension: MAX
    });
    // 65535 / 2 = 32767 effective device-independent px
    expect(result.effectiveMaxHeight).toBe(Math.floor(MAX / 2));
    expect(result.canvasHeight).toBeLessThanOrEqual(MAX);
    expect(result.wasClampedByCanvasLimit).toBe(true);
  });

  it('clamps tall pages to the canvas hardware limit at dpr=3', () => {
    const result = clampCanvasDimensions({
      viewportWidth: 1280,
      totalHeight: 100000,
      dpr: 3,
      configuredMaxHeight: 120000,
      canvasMaxDimension: MAX
    });
    expect(result.effectiveMaxHeight).toBe(Math.floor(MAX / 3));
    expect(result.canvasHeight).toBeLessThanOrEqual(MAX);
    expect(result.wasClampedByCanvasLimit).toBe(true);
  });

  it('respects the user-configured max even when it is below the canvas limit', () => {
    const result = clampCanvasDimensions({
      viewportWidth: 1280,
      totalHeight: 200000,
      dpr: 1,
      configuredMaxHeight: 20000,
      canvasMaxDimension: MAX
    });
    expect(result.effectiveMaxHeight).toBe(20000);
    expect(result.wasClampedByCanvasLimit).toBe(false);
  });

  it('throws a clear error when viewport width itself overflows the canvas', () => {
    expect(() => clampCanvasDimensions({
      viewportWidth: 40000,
      totalHeight: 1000,
      dpr: 2,
      configuredMaxHeight: 120000,
      canvasMaxDimension: MAX
    })).toThrow(/too wide/);
  });

  it('does not throw when width is exactly at the canvas limit', () => {
    expect(() => clampCanvasDimensions({
      viewportWidth: MAX,
      totalHeight: 100,
      dpr: 1,
      configuredMaxHeight: 120000,
      canvasMaxDimension: MAX
    })).not.toThrow();
  });

  it('width-clamp error message includes the offending dimension and DPR', () => {
    try {
      clampCanvasDimensions({
        viewportWidth: 4000,
        totalHeight: 100,
        dpr: 20,
        configuredMaxHeight: 120000,
        canvasMaxDimension: MAX
      });
      throw new Error('did not throw');
    } catch (e) {
      expect((e as Error).message).toMatch(/4000/);
      expect((e as Error).message).toMatch(/20x/);
    }
  });
});
