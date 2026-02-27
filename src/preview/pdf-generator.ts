import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import { PDF_CONFIG, CANVAS_MAX_DIMENSION } from '../shared/constants';
import { getRegionRelativeToContainer } from './pdf-export-utils';

export interface GeneratePdfParams {
  includeScreenshot: boolean;
  includeContent: boolean;
  screenshotDataUrls: string[];
  evidenceHeaderElement: HTMLElement;
  contentSectionElement: HTMLElement;
  annotationOverlay: SVGSVGElement;
  containerElement: HTMLElement;
  onProgress?: (message: string) => void;
}

// Load an image from a data URL, returns the Image element with natural dimensions
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = src;
  });
}

// Calculate a safe html2canvas scale so the canvas stays within browser limits
function computeSafeScale(elementHeight: number): number {
  const desired = PDF_CONFIG.html2canvas.scale;
  if (elementHeight * desired <= CANVAS_MAX_DIMENSION) return desired;
  // Reduce scale to fit, minimum 0.5
  return Math.max(0.5, Math.floor((CANVAS_MAX_DIMENSION / elementHeight) * 10) / 10);
}

// Render a DOM element to a canvas via html2canvas with safe scaling
async function renderElementToCanvas(element: HTMLElement): Promise<HTMLCanvasElement> {
  const scale = computeSafeScale(element.offsetHeight);
  return html2canvas(element, {
    scale,
    useCORS: true,
    scrollY: 0,
    logging: false,
  });
}

// Collect annotation bounding boxes from the live SVG overlay
function collectAnnotationBounds(overlay: SVGSVGElement): { y: number; height: number }[] {
  const bounds: { y: number; height: number }[] = [];
  for (const child of Array.from(overlay.children)) {
    if (child.tagName === 'defs') continue;
    const gfx = child as SVGGraphicsElement;
    try {
      const bbox = gfx.getBBox();
      bounds.push({ y: bbox.y, height: bbox.height });
    } catch { /* skip non-graphics elements */ }
  }
  return bounds;
}

// Check if any annotations overlap a given Y range in container coordinates
function hasAnnotationsInRange(
  annotationBounds: { y: number; height: number }[],
  yStart: number,
  yEnd: number,
): boolean {
  return annotationBounds.some(b => b.y + b.height > yStart && b.y < yEnd);
}

// Render a region of the SVG overlay to a canvas for compositing onto a screenshot
async function renderAnnotationRegion(
  overlay: SVGSVGElement,
  regionLeft: number,
  regionTop: number,
  regionWidth: number,
  regionHeight: number,
): Promise<HTMLCanvasElement | null> {
  if (regionWidth <= 0 || regionHeight <= 0) return null;

  // Clone the SVG and set viewBox to just this region
  const clone = overlay.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('viewBox', `${regionLeft} ${regionTop} ${regionWidth} ${regionHeight}`);
  clone.setAttribute('width', regionWidth.toString());
  clone.setAttribute('height', regionHeight.toString());

  const svgString = new XMLSerializer().serializeToString(clone);
  const svgDataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgString)}`;

  try {
    const img = await loadImage(svgDataUrl);
    const canvas = document.createElement('canvas');
    canvas.width = regionWidth;
    canvas.height = regionHeight;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0, regionWidth, regionHeight);
    return canvas;
  } catch {
    return null;
  }
}

// Composite a screenshot data URL with an annotation overlay region
async function compositeWithAnnotations(
  screenshotDataUrl: string,
  overlay: SVGSVGElement,
  regionLeft: number,
  regionTop: number,
  regionWidth: number,
  regionHeight: number,
): Promise<string> {
  const annotationCanvas = await renderAnnotationRegion(
    overlay,
    regionLeft,
    regionTop,
    regionWidth,
    regionHeight,
  );
  if (!annotationCanvas) return screenshotDataUrl;

  const img = await loadImage(screenshotDataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  // Scale annotation canvas to match screenshot dimensions
  ctx.drawImage(annotationCanvas, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.95);
}

export async function generatePdfDocument(params: GeneratePdfParams): Promise<jsPDF> {
  const {
    includeScreenshot,
    includeContent,
    screenshotDataUrls,
    evidenceHeaderElement,
    contentSectionElement,
    annotationOverlay,
    containerElement,
    onProgress,
  } = params;

  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = PDF_CONFIG.margin;
  const contentWidth = pageWidth - margin * 2;
  const contentHeight = pageHeight - margin * 2;

  let yPos = margin; // current Y position in mm on the current page
  let isFirstPage = true;

  function ensurePage() {
    if (isFirstPage) {
      isFirstPage = false;
    } else {
      pdf.addPage();
      yPos = margin;
    }
  }

  function needsNewPage(requiredMm: number): boolean {
    return yPos + requiredMm > pageHeight - margin;
  }

  // --- 1. Render evidence header ---
  onProgress?.('Rendering header...');
  const headerCanvas = await renderElementToCanvas(evidenceHeaderElement);
  const headerDataUrl = headerCanvas.toDataURL('image/jpeg', 0.95);
  const headerHeightMm = (headerCanvas.height / headerCanvas.width) * contentWidth;

  ensurePage();
  pdf.addImage(headerDataUrl, 'JPEG', margin, yPos, contentWidth, headerHeightMm);
  yPos += headerHeightMm + 5; // 5mm gap after header

  // Collect overlay bounds once for both screenshot and content compositing.
  const annotationBounds = collectAnnotationBounds(annotationOverlay);
  const hasAnnotations = annotationBounds.length > 0;
  const containerRect = containerElement.getBoundingClientRect();

  // --- 2. Add screenshot images directly ---
  if (includeScreenshot && screenshotDataUrls.length > 0) {
    // Add "ORIGINAL SCREENSHOT" section title
    pdf.setFontSize(14);
    pdf.setFont('helvetica', 'bold');
    if (needsNewPage(12)) { pdf.addPage(); yPos = margin; }
    pdf.text('ORIGINAL SCREENSHOT', margin, yPos + 5);
    yPos += 8;
    // Draw underline
    pdf.setDrawColor(26, 26, 26);
    pdf.setLineWidth(0.5);
    pdf.line(margin, yPos, margin + contentWidth, yPos);
    yPos += 5;

    const screenshotElements =
      containerElement.querySelectorAll<HTMLElement>('.screenshot-section-item:not(.removed)');

    for (let i = 0; i < screenshotDataUrls.length; i++) {
      onProgress?.(`Adding screenshot ${i + 1} of ${screenshotDataUrls.length}...`);

      let dataUrl = screenshotDataUrls[i];

      // Composite annotations if any overlap this screenshot section
      if (hasAnnotations && screenshotElements[i]) {
        const elRect = screenshotElements[i].getBoundingClientRect();
        const region = getRegionRelativeToContainer(containerRect, elRect);

        if (hasAnnotationsInRange(annotationBounds, region.top, region.top + region.height)) {
          dataUrl = await compositeWithAnnotations(
            dataUrl,
            annotationOverlay,
            region.left,
            region.top,
            region.width,
            region.height,
          );
        }
      }

      const img = await loadImage(dataUrl);
      const imgHeightMm = (img.naturalHeight / img.naturalWidth) * contentWidth;

      // If image is taller than a full page, scale it to fit one page
      const effectiveHeight = Math.min(imgHeightMm, contentHeight);
      const effectiveWidth = imgHeightMm > contentHeight
        ? (img.naturalWidth / img.naturalHeight) * contentHeight
        : contentWidth;
      const xOffset = imgHeightMm > contentHeight
        ? margin + (contentWidth - effectiveWidth) / 2
        : margin;

      if (needsNewPage(effectiveHeight + 2)) {
        pdf.addPage();
        yPos = margin;
      }

      pdf.addImage(dataUrl, 'JPEG', xOffset, yPos, effectiveWidth, effectiveHeight);
      yPos += effectiveHeight + 2; // 2mm gap between sections
    }
  }

  // --- 3. Render extracted content ---
  if (includeContent && contentSectionElement.style.display !== 'none') {
    onProgress?.('Rendering content...');

    // Start content on a new page for clean separation
    pdf.addPage();
    yPos = margin;

    const contentEl = contentSectionElement;
    let contentCanvas = await renderElementToCanvas(contentEl);

    if (hasAnnotations) {
      const contentRect = contentEl.getBoundingClientRect();
      const region = getRegionRelativeToContainer(containerRect, contentRect);

      if (hasAnnotationsInRange(annotationBounds, region.top, region.top + region.height)) {
        const annotationCanvas = await renderAnnotationRegion(
          annotationOverlay,
          region.left,
          region.top,
          region.width,
          region.height,
        );

        if (annotationCanvas) {
          const compositeCanvas = document.createElement('canvas');
          compositeCanvas.width = contentCanvas.width;
          compositeCanvas.height = contentCanvas.height;
          const compositeCtx = compositeCanvas.getContext('2d');
          if (compositeCtx) {
            compositeCtx.drawImage(contentCanvas, 0, 0);
            compositeCtx.drawImage(annotationCanvas, 0, 0, compositeCanvas.width, compositeCanvas.height);
            contentCanvas = compositeCanvas;
          }
        }
      }
    }

    if (contentCanvas.width > 0 && contentCanvas.height > 0) {
      const canvasDataUrl = contentCanvas.toDataURL('image/jpeg', 0.95);
      const totalHeightMm = (contentCanvas.height / contentCanvas.width) * contentWidth;

      if (totalHeightMm <= contentHeight) {
        // Fits on one page
        pdf.addImage(canvasDataUrl, 'JPEG', margin, yPos, contentWidth, totalHeightMm);
        yPos += totalHeightMm;
      } else {
        // Split canvas into page-sized strips
        const pxPerMm = contentCanvas.width / contentWidth;
        const stripHeightPx = Math.floor(contentHeight * pxPerMm);
        let srcY = 0;

        while (srcY < contentCanvas.height) {
          const remainingPx = contentCanvas.height - srcY;
          const thisStripPx = Math.min(stripHeightPx, remainingPx);
          const thisStripMm = thisStripPx / pxPerMm;

          // Extract strip from source canvas
          const stripCanvas = document.createElement('canvas');
          stripCanvas.width = contentCanvas.width;
          stripCanvas.height = thisStripPx;
          const stripCtx = stripCanvas.getContext('2d')!;
          stripCtx.drawImage(
            contentCanvas,
            0, srcY, contentCanvas.width, thisStripPx,
            0, 0, contentCanvas.width, thisStripPx,
          );

          const stripDataUrl = stripCanvas.toDataURL('image/jpeg', 0.95);

          if (srcY > 0) {
            pdf.addPage();
            yPos = margin;
          }

          pdf.addImage(stripDataUrl, 'JPEG', margin, yPos, contentWidth, thisStripMm);
          yPos += thisStripMm;
          srcY += thisStripPx;
        }
      }
    }
  }

  return pdf;
}
