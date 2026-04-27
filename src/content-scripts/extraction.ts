import { Readability } from '@mozilla/readability';
import DOMPurify from 'dompurify';
import type { ExtractedContent, PageType, ExtractionStrategy } from '../shared/types';
import { SOCIAL_MEDIA_DOMAINS, FORUM_INDICATORS } from '../shared/constants';
import { collapseFragmentedParagraphs } from './paragraph-utils';

// Detect page type based on URL and DOM structure
export function detectPageType(url: string, doc: Document): PageType {
  const hostname = new URL(url).hostname.toLowerCase();

  if (SOCIAL_MEDIA_DOMAINS.some(domain => hostname.includes(domain))) {
    return 'social-media';
  }

  if (FORUM_INDICATORS.some(indicator => hostname.includes(indicator) || url.toLowerCase().includes(indicator))) {
    return 'forum';
  }

  if (isLikelyArticle(doc)) {
    return 'article';
  }

  return 'generic';
}

// Check if page looks like an article
export function isLikelyArticle(doc: Document): boolean {
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

// Heuristic filter that strips decorative/tracking images from a container.
// Mutates the container in place.
export function filterDecorativeImages(container: HTMLElement): void {
  container.querySelectorAll('img').forEach(img => {
    const alt = (img.alt || '').toLowerCase();
    const src = img.getAttribute('src') || '';
    const width = parseInt(img.getAttribute('width') || '0', 10);
    const height = parseInt(img.getAttribute('height') || '0', 10);

    const decorativeKeywords = [
      'profile image', 'profile photo', 'profile picture',
      'user avatar', 'avatar', 'headshot', 'mugshot', 'thumbnail'
    ];
    const isDecorativeAlt = decorativeKeywords.some(keyword => alt.includes(keyword));
    const isBracketedPlaceholder = /^\[.*image.*\]$/i.test(img.alt || '');

    const isEmptySrc = !src || src === 'data:,';

    // 1x1 tracking GIF signatures (keep non-pixel GIF data URIs)
    const pixelGifSignatures = ['R0lGODlhAQAB', 'R0lGODdhAQAB'];
    const isLikelyTrackingGif = src.startsWith('data:image/gif;base64,') &&
      (pixelGifSignatures.some(sig => src.includes(sig)) || (width === 1 && height === 1));

    // SVG data URIs fail to render in html2pdf
    const isSvgDataUri = src.startsWith('data:image/svg');

    const isSmallIcon = width > 0 && height > 0 && width <= 48 && height <= 48 && alt === '';

    const isAriaDecorative = img.getAttribute('aria-hidden') === 'true' ||
      img.getAttribute('role') === 'presentation';

    if (isDecorativeAlt || isBracketedPlaceholder || isEmptySrc || isLikelyTrackingGif ||
        isSvgDataUri || isSmallIcon || isAriaDecorative) {
      img.remove();
    }
  });
}

const ALLOWED_TAGS_READABILITY = [
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li',
  'blockquote', 'a', 'strong', 'em', 'img', 'figure', 'figcaption', 'br', 'hr',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption'
];

const ALLOWED_TAGS_FALLBACK = [
  ...ALLOWED_TAGS_READABILITY,
  'div', 'span'
];

const ALLOWED_ATTR = ['href', 'src', 'alt', 'title', 'colspan', 'rowspan', 'scope'];

// Extract content using Readability.js
export function extractWithReadability(doc: Document, currentUrl: string): ExtractedContent | null {
  try {
    // Clone without serialize/parse round-trip to reduce CPU/memory
    const docClone = document.implementation.createHTMLDocument('reader');
    docClone.documentElement.innerHTML = doc.documentElement.innerHTML;

    const reader = new Readability(docClone);
    const article = reader.parse();

    if (!article) {
      return null;
    }

    // Pre-sanitization: filter images while original attributes are still present
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = article.content;

    filterDecorativeImages(tempDiv);

    const sanitizedContent = DOMPurify.sanitize(tempDiv.innerHTML, {
      ALLOWED_TAGS: ALLOWED_TAGS_READABILITY,
      ALLOWED_ATTR
    });

    tempDiv.innerHTML = sanitizedContent;

    // Collapse fragmented paragraphs from Readability's div-to-p conversion
    collapseFragmentedParagraphs(tempDiv);

    const cleanedContent = tempDiv.innerHTML;

    const images = Array.from(tempDiv.querySelectorAll('img')).map(img => ({
      src: img.src,
      alt: img.alt || '',
      caption: img.closest('figure')?.querySelector('figcaption')?.textContent || undefined
    }));

    return {
      title: article.title,
      content: cleanedContent,
      textContent: article.textContent || '',
      byline: article.byline || undefined,
      publishedTime: article.publishedTime || undefined,
      images,
      pageType: detectPageType(currentUrl, doc),
      confidence: 0.8
    };
  } catch (err) {
    console.error('Readability extraction failed:', err);
    return null;
  }
}

// Fallback extraction for pages where Readability fails
export function extractFallback(doc: Document, currentUrl: string): ExtractedContent {
  const title = doc.title || 'Untitled Page';

  const mainElement = doc.querySelector('main, article, [role="main"], .content, #content, .post, .entry') ||
    doc.body;

  const textContent = mainElement.textContent?.trim() || '';

  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = mainElement.innerHTML;

  const toRemove = tempDiv.querySelectorAll('script, style, nav, footer, aside, header, .ad, .advertisement, .sidebar');
  toRemove.forEach(el => el.remove());

  const sanitizedContent = DOMPurify.sanitize(tempDiv.innerHTML, {
    ALLOWED_TAGS: ALLOWED_TAGS_FALLBACK,
    ALLOWED_ATTR
  });

  return {
    title,
    content: sanitizedContent,
    textContent: textContent.slice(0, 50000),
    images: [],
    pageType: detectPageType(currentUrl, doc),
    confidence: 0.4
  };
}

// Main extraction function
export function extractContent(doc: Document, strategy: ExtractionStrategy, currentUrl: string): ExtractedContent {
  const readabilityResult = extractWithReadability(doc, currentUrl);

  if (readabilityResult && readabilityResult.confidence > 0.5) {
    return readabilityResult;
  }

  if (strategy === 'heuristic' || !readabilityResult) {
    const fallbackResult = extractFallback(doc, currentUrl);

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
