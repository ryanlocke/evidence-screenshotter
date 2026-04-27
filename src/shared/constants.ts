// Extension version (should match manifest.json)
export const EXTENSION_VERSION = '1.0.0';

// Social media domains for page type detection
export const SOCIAL_MEDIA_DOMAINS = [
  'twitter.com',
  'x.com',
  'facebook.com',
  'fb.com',
  'instagram.com',
  'linkedin.com',
  'threads.net',
  'mastodon.social',
  'bsky.app'
];

// Forum indicators for page type detection
export const FORUM_INDICATORS = [
  'reddit.com',
  'news.ycombinator.com',
  'discourse',
  'forum',
  'forums',
  'community'
];

// Chrome's maximum canvas pixel dimension (larger canvases render blank)
export const CANVAS_MAX_DIMENSION = 65535;

// PDF configuration
export const PDF_CONFIG = {
  margin: 15,
  filename: 'evidence-capture.pdf',
  image: { type: 'jpeg' as const, quality: 0.95 },
  html2canvas: { scale: 2, useCORS: true },
  jsPDF: {
    orientation: 'portrait' as const,
    unit: 'mm' as const,
    format: 'a4' as const
  }
};

// Capture timing
export const CAPTURE_CONFIG = {
  // Adaptive scroll settle: after scrolling, wait for layout to stop changing
  // for `scrollStableFrames` consecutive animation frames. Bounded by min/max.
  scrollMinSettleMs: 50,   // never proceed before this elapses (browser repaint floor)
  scrollMaxSettleMs: 800,  // cap on settle wait per scroll step
  scrollStableFrames: 3,
  // Generous default to avoid silent truncation on long pages; adjust if memory is constrained
  maxPageHeight: 120000,   // max pixels for full-page capture (further clamped by canvas hardware limit)
  minCaptureDelay: 100,    // ms floor between captures
  rateLimitMs: 600,        // Chrome captureVisibleTab limit ~2/s (500ms); 600ms = 1.2x safety margin
  maxBackoffMs: 3000,      // Max delay when backing off from rate limit errors
  maxRetries: 7            // Max retry attempts per viewport capture
};
