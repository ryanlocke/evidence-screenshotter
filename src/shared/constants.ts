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
  scrollDelay: 150,        // ms to wait after each scroll
  // Generous default to avoid silent truncation on long pages; adjust if memory is constrained
  maxPageHeight: 120000,   // max pixels for full-page capture
  minCaptureDelay: 50,     // ms floor between captures
  rateLimitMs: 550         // Chrome captureVisibleTab practical minimum interval
};
