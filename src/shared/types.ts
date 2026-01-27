// Page type detection
export type PageType = 'article' | 'social-media' | 'forum' | 'generic';

// Extraction strategies
export type ExtractionStrategy = 'readability' | 'heuristic';

// Capture options from popup
export interface CaptureOptions {
  captureType: 'viewport' | 'full-page';
  strategy: ExtractionStrategy;
}

// Extracted content from content script
export interface ExtractedContent {
  title: string;
  content: string;        // sanitized HTML
  textContent: string;    // plain text
  byline?: string;
  publishedTime?: string;
  images: ExtractedImage[];
  pageType: PageType;
  confidence: number;     // 0-1
}

export interface ExtractedImage {
  src: string;
  alt: string;
  caption?: string;
}

// Evidence metadata
export interface EvidenceMetadata {
  url: string;
  capturedAt: Date;
  pageTitle: string;
  extensionVersion: string;
}

// Screenshot data
export interface ScreenshotData {
  dataUrl: string;
  captureType: 'viewport' | 'full-page';
  dimensions: { width: number; height: number };
}

// Full evidence data for PDF generation
export interface EvidenceData {
  metadata: EvidenceMetadata;
  screenshot: ScreenshotData;
  extractedContent: ExtractedContent;
}

// Capture result
export interface CaptureResult {
  success: boolean;
  error?: string;
  pdfBlob?: Blob;
}

// Error codes
export enum ErrorCode {
  CAPTURE_FAILED = 'CAPTURE_FAILED',
  TAB_NOT_FOUND = 'TAB_NOT_FOUND',
  EXTRACTION_FAILED = 'EXTRACTION_FAILED',
  PDF_GENERATION_FAILED = 'PDF_GENERATION_FAILED',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR'
}
