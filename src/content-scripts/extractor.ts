import { Readability } from '@mozilla/readability';
import DOMPurify from 'dompurify';
import type { ExtractedContent, PageType, ExtractionStrategy } from '../shared/types';
import type { ExtractContentMessage, ExtractionCompleteMessage } from '../shared/messages';
import { SOCIAL_MEDIA_DOMAINS, FORUM_INDICATORS, CAPTURE_CONFIG } from '../shared/constants';
import type { DimensionsResponseMessage, GetDimensionsMessage } from '../shared/messages';

// Detect page type based on URL and DOM structure
function detectPageType(url: string, doc: Document): PageType {
  const hostname = new URL(url).hostname.toLowerCase();

  // Check for social media
  if (SOCIAL_MEDIA_DOMAINS.some(domain => hostname.includes(domain))) {
    return 'social-media';
  }

  // Check for forums
  if (FORUM_INDICATORS.some(indicator => hostname.includes(indicator) || url.toLowerCase().includes(indicator))) {
    return 'forum';
  }

  // Check for article-like structure
  if (isLikelyArticle(doc)) {
    return 'article';
  }

  return 'generic';
}

// Check if page looks like an article
function isLikelyArticle(doc: Document): boolean {
  const hasArticleTag = doc.querySelector('article') !== null;
  const hasMainContent = doc.querySelector('main, [role="main"]') !== null;
  const hasAuthor = doc.querySelector('[rel="author"], .author, .byline') !== null;
  const hasPublishDate = doc.querySelector('time, .date, .published') !== null;

  const ogType = doc.querySelector('meta[property="og:type"]')?.getAttribute('content');
  const isOgArticle = ogType === 'article';

  let score = 0;
  if (hasArticleTag) score += 2;
  if (hasMainContent) score += 1;
  if (hasAuthor) score += 1;
  if (hasPublishDate) score += 1;
  if (isOgArticle) score += 2;

  return score >= 3;
}

// Extract content using Readability.js
function extractWithReadability(doc: Document): ExtractedContent | null {
  try {
    // Clone without serialize/parse round-trip to reduce CPU/memory
    const docClone = document.implementation.createHTMLDocument('reader');
    docClone.documentElement.innerHTML = doc.documentElement.innerHTML;

    const reader = new Readability(docClone);
    const article = reader.parse();

    if (!article) {
      return null;
    }

    // Sanitize content
    const sanitizedContent = DOMPurify.sanitize(article.content, {
      ALLOWED_TAGS: ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote', 'a', 'strong', 'em', 'img', 'figure', 'figcaption', 'br', 'hr'],
      ALLOWED_ATTR: ['href', 'src', 'alt', 'title']
    });

    // Extract images
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = sanitizedContent;
    const images = Array.from(tempDiv.querySelectorAll('img')).map(img => ({
      src: img.src,
      alt: img.alt || '',
      caption: img.closest('figure')?.querySelector('figcaption')?.textContent || undefined
    }));

    return {
      title: article.title,
      content: sanitizedContent,
      textContent: article.textContent || '',
      byline: article.byline || undefined,
      publishedTime: article.publishedTime || undefined,
      images,
      pageType: detectPageType(location.href, doc),
      confidence: 0.8
    };
  } catch (err) {
    console.error('Readability extraction failed:', err);
    return null;
  }
}

// Fallback extraction for pages where Readability fails
function extractFallback(doc: Document): ExtractedContent {
  const title = doc.title || 'Untitled Page';

  // Try to find main content area
  const mainElement = doc.querySelector('main, article, [role="main"], .content, #content, .post, .entry') ||
    doc.body;

  // Get text content
  const textContent = mainElement.textContent?.trim() || '';

  // Simple HTML cleanup
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = mainElement.innerHTML;

  // Remove scripts, styles, nav, footer, aside
  const toRemove = tempDiv.querySelectorAll('script, style, nav, footer, aside, header, .ad, .advertisement, .sidebar');
  toRemove.forEach(el => el.remove());

  const sanitizedContent = DOMPurify.sanitize(tempDiv.innerHTML, {
    ALLOWED_TAGS: ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote', 'a', 'strong', 'em', 'img', 'figure', 'figcaption', 'br', 'hr', 'div', 'span'],
    ALLOWED_ATTR: ['href', 'src', 'alt', 'title']
  });

  return {
    title,
    content: sanitizedContent,
    textContent: textContent.slice(0, 50000), // Limit text length
    images: [],
    pageType: detectPageType(location.href, doc),
    confidence: 0.4
  };
}

// Main extraction function
function extractContent(strategy: ExtractionStrategy): ExtractedContent {
  const doc = document;

  // Try Readability first
  const readabilityResult = extractWithReadability(doc);

  if (readabilityResult && readabilityResult.confidence > 0.5) {
    return readabilityResult;
  }

  // For heuristic strategy or if Readability fails, use fallback
  if (strategy === 'heuristic' || !readabilityResult) {
    const fallbackResult = extractFallback(doc);

    // If we have partial Readability result, merge with fallback
    if (readabilityResult) {
      return {
        ...fallbackResult,
        title: readabilityResult.title || fallbackResult.title,
        byline: readabilityResult.byline,
        publishedTime: readabilityResult.publishedTime,
        confidence: Math.max(readabilityResult.confidence, fallbackResult.confidence)
      };
    }

    return fallbackResult;
  }

  return readabilityResult;
}

// Full-page screenshot via scroll-stitching
async function captureFullPage(): Promise<string> {
  const viewportHeight = window.innerHeight;
  const viewportWidth = window.innerWidth;
  const dpr = window.devicePixelRatio || 1;
  const totalHeight = Math.max(
    document.body.scrollHeight,
    document.documentElement.scrollHeight
  );

  // Limit to configurable max (avoid memory issues on very long/infinite pages)
  const maxHeight = Math.min(totalHeight, CAPTURE_CONFIG.maxPageHeight);
  const numCaptures = Math.ceil(maxHeight / viewportHeight);

  // Store original scroll position
  const originalScrollY = window.scrollY;

  // Create canvas at device pixel ratio scale
  const canvas = document.createElement('canvas');
  canvas.width = viewportWidth * dpr;
  canvas.height = maxHeight * dpr;
  const ctx = canvas.getContext('2d')!;

  // Capture each viewport
  let lastCaptureTime = performance.now();
  for (let i = 0; i < numCaptures; i++) {
    const scrollY = i * viewportHeight;

    // Scroll to position
    window.scrollTo(0, scrollY);

    // Wait minimally for scroll settle and respect Chrome capture rate limits
    // Respect Chrome capture rate (~2/s). If min delay is lower, wait the remainder.
    const now = performance.now();
    const elapsed = now - lastCaptureTime;
    const wait = Math.max(CAPTURE_CONFIG.minCaptureDelay, CAPTURE_CONFIG.rateLimitMs - elapsed);
    await new Promise(r => setTimeout(r, Math.max(wait, 0)));

    // Request viewport capture from service worker
    const dataUrl = await new Promise<string>((resolve, reject) => {
      chrome.runtime.sendMessage({ type: 'CAPTURE_VIEWPORT' }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else if (response?.error) {
          reject(new Error(response.error));
        } else if (typeof response === 'string') {
          resolve(response);
        } else {
          reject(new Error('Invalid response from service worker'));
        }
      });
    });

    // Update timestamp for next iteration's rate limit calculation
    lastCaptureTime = performance.now();

    // Draw on canvas - captureVisibleTab returns image at device pixel ratio
    await new Promise<void>((resolve) => {
      const img = new Image();
      img.onload = () => {
        // The image is already at dpr scale, draw directly at the scaled position
        const destY = scrollY * dpr;
        const destHeight = Math.min(img.height, canvas.height - destY);
        ctx.drawImage(
          img,
          0, 0, img.width, destHeight,
          0, destY, img.width, destHeight
        );
        resolve();
      };
      img.src = dataUrl;
    });
  }

  // Restore scroll position
  window.scrollTo(0, originalScrollY);

  // Return as JPEG for smaller size
  return canvas.toDataURL('image/jpeg', 0.9);
}

// Listen for messages
chrome.runtime.onMessage.addListener((message: ExtractContentMessage & { type: string }, sender, sendResponse) => {
  if (message.type === 'EXTRACT_CONTENT') {
    console.log('Content script: extracting with strategy:', message.strategy);

    try {
      const content = extractContent(message.strategy);

      const response: ExtractionCompleteMessage = {
        type: 'EXTRACTION_COMPLETE',
        content,
        url: location.href,
        title: document.title
      };

      sendResponse(response);
    } catch (err) {
      console.error('Content extraction error:', err);
      // Send minimal fallback response
      const response: ExtractionCompleteMessage = {
        type: 'EXTRACTION_COMPLETE',
        content: {
          title: document.title || 'Unknown Page',
          content: '<p>Content extraction failed</p>',
          textContent: 'Content extraction failed',
          images: [],
          pageType: 'generic',
          confidence: 0
        },
        url: location.href,
        title: document.title
      };
      sendResponse(response);
    }

    return true; // Keep channel open for async response
  }

  if (message.type === 'CAPTURE_FULL_PAGE') {
    console.log('Content script: capturing full page');
    captureFullPage().then(dataUrl => {
      sendResponse({ type: 'FULL_PAGE_CAPTURED', dataUrl });
    }).catch(err => {
      console.error('Full page capture failed:', err);
      sendResponse({ type: 'FULL_PAGE_ERROR', error: String(err) });
    });
    return true; // Keep channel open for async response
  }

  if (message.type === 'GET_DIMENSIONS') {
    const response: DimensionsResponseMessage = {
      type: 'DIMENSIONS_RESPONSE',
      width: window.innerWidth,
      height: window.innerHeight
    };
    sendResponse(response);
    return true;
  }
});

console.log('Evidence Screenshotter content script loaded');
