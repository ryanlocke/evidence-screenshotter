import type { CaptureOptions, ExtractedContent, EvidenceData } from './types';

// Message types for communication between extension components
export type MessageType =
  | 'CAPTURE_REQUEST'
  | 'CAPTURE_VIEWPORT'
  | 'EXTRACT_CONTENT'
  | 'EXTRACTION_COMPLETE'
  | 'GENERATE_PDF'
  | 'PDF_READY'
  | 'CAPTURE_COMPLETE'
  | 'CAPTURE_ERROR'
  | 'CAPTURE_PROGRESS'
  | 'GET_DIMENSIONS'
  | 'DIMENSIONS_RESPONSE';

// Base message interface
interface BaseMessage {
  type: MessageType;
}

// Popup -> Service Worker: Request capture
export interface CaptureRequestMessage extends BaseMessage {
  type: 'CAPTURE_REQUEST';
  options: CaptureOptions;
}

// Content Script -> Service Worker: Request viewport capture
export interface CaptureViewportMessage extends BaseMessage {
  type: 'CAPTURE_VIEWPORT';
}

// Service Worker -> Content Script: request current viewport dimensions
export interface GetDimensionsMessage extends BaseMessage {
  type: 'GET_DIMENSIONS';
}

// Content Script -> Service Worker: return dimensions
export interface DimensionsResponseMessage extends BaseMessage {
  type: 'DIMENSIONS_RESPONSE';
  width: number;
  height: number;
}

// Service Worker -> Content Script: Extract content
export interface ExtractContentMessage extends BaseMessage {
  type: 'EXTRACT_CONTENT';
  strategy: CaptureOptions['strategy'];
}

// Content Script -> Service Worker: Extraction complete
export interface ExtractionCompleteMessage extends BaseMessage {
  type: 'EXTRACTION_COMPLETE';
  content: ExtractedContent;
  url: string;
  title: string;
}

// Service Worker -> Offscreen: Generate PDF
export interface GeneratePDFMessage extends BaseMessage {
  type: 'GENERATE_PDF';
  data: EvidenceData;
}

// Offscreen -> Service Worker: PDF ready
export interface PDFReadyMessage extends BaseMessage {
  type: 'PDF_READY';
  pdfDataUrl: string;
}

// Service Worker -> Popup: Capture complete
export interface CaptureCompleteMessage extends BaseMessage {
  type: 'CAPTURE_COMPLETE';
  success: boolean;
}

// Service Worker -> Popup: Capture error
export interface CaptureErrorMessage extends BaseMessage {
  type: 'CAPTURE_ERROR';
  error: string;
}

// Service Worker -> Popup: Progress update
export interface CaptureProgressMessage extends BaseMessage {
  type: 'CAPTURE_PROGRESS';
  stage: 'capturing' | 'extracting' | 'generating' | 'downloading';
  message: string;
}

// Union type for all messages
export type ExtensionMessage =
  | CaptureRequestMessage
  | CaptureViewportMessage
  | GetDimensionsMessage
  | DimensionsResponseMessage
  | ExtractContentMessage
  | ExtractionCompleteMessage
  | GeneratePDFMessage
  | PDFReadyMessage
  | CaptureCompleteMessage
  | CaptureErrorMessage
  | CaptureProgressMessage;
