// Lightweight content extractor - no heavy dependencies
// This is ~5KB vs 131KB for the full extractor

import type { ExtractedContent, PageType } from '../shared/types';
import type { ExtractContentMessage, ExtractionCompleteMessage } from '../shared/messages';
import { collapseFragmentedParagraphs } from './paragraph-utils';

// Simple page type detection
function detectPageType(url: string): PageType {
  const hostname = new URL(url).hostname.toLowerCase();

  const socialDomains = ['twitter.com', 'x.com', 'facebook.com', 'instagram.com', 'linkedin.com', 'tiktok.com'];
  if (socialDomains.some(d => hostname.includes(d))) return 'social-media';

  const forumIndicators = ['reddit.com', 'forum', 'community', 'discuss'];
  if (forumIndicators.some(i => hostname.includes(i) || url.includes(i))) return 'forum';

  if (document.querySelector('article') || document.querySelector('meta[property="og:type"][content="article"]')) {
    return 'article';
  }

  return 'generic';
}

// Simple content extraction without Readability
function extractContent(): ExtractedContent {
  const title = document.title || 'Untitled Page';

  // Try to find main content area
  const mainSelectors = [
    'article',
    'main',
    '[role="main"]',
    '.post-content',
    '.article-content',
    '.entry-content',
    '.content',
    '#content'
  ];

  let mainElement: Element | null = null;
  for (const selector of mainSelectors) {
    mainElement = document.querySelector(selector);
    if (mainElement) break;
  }

  if (!mainElement) {
    mainElement = document.body;
  }

  // Clone and clean up
  const clone = mainElement.cloneNode(true) as HTMLElement;

  // Remove unwanted elements
  const removeSelectors = 'script, style, nav, footer, aside, header, .ad, .advertisement, .sidebar, .comments, .social-share, [aria-hidden="true"]';
  clone.querySelectorAll(removeSelectors).forEach(el => el.remove());

  // Get text content
  const textContent = clone.textContent?.trim() || '';

  // Build simple HTML with basic allowed tags (including tables)
  const allowedTags = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'A', 'STRONG', 'EM', 'IMG', 'FIGURE', 'FIGCAPTION', 'BR', 'HR', 'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TH', 'TD', 'CAPTION']);

  function cleanHtml(element: Element): string {
    let html = '';

    for (const child of Array.from(element.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        const text = child.textContent?.trim();
        if (text) html += escapeHtml(text) + ' ';
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const el = child as Element;
        const tagName = el.tagName;

        if (allowedTags.has(tagName)) {
          if (tagName === 'IMG') {
            const src = el.getAttribute('src');
            const alt = el.getAttribute('alt') || '';
            if (src) html += `<img src="${escapeAttr(src)}" alt="${escapeAttr(alt)}">`;
          } else if (tagName === 'A') {
            const href = el.getAttribute('href');
            const innerHtml = cleanHtml(el);
            if (href && innerHtml) {
              html += `<a href="${escapeAttr(href)}">${innerHtml}</a>`;
            } else {
              html += innerHtml;
            }
          } else if (tagName === 'TD' || tagName === 'TH') {
            // Preserve colspan/rowspan attributes on table cells
            const attrs: string[] = [];
            const colspan = el.getAttribute('colspan');
            const rowspan = el.getAttribute('rowspan');
            if (colspan) attrs.push(`colspan="${escapeAttr(colspan)}"`);
            if (rowspan) attrs.push(`rowspan="${escapeAttr(rowspan)}"`);
            const attrStr = attrs.length > 0 ? ' ' + attrs.join(' ') : '';
            const innerHtml = cleanHtml(el);
            html += `<${tagName.toLowerCase()}${attrStr}>${innerHtml}</${tagName.toLowerCase()}>`;
          } else {
            const innerHtml = cleanHtml(el);
            if (innerHtml.trim()) {
              html += `<${tagName.toLowerCase()}>${innerHtml}</${tagName.toLowerCase()}>`;
            }
          }
        } else {
          // Recurse into non-allowed tags but don't keep the tag
          html += cleanHtml(el);
        }
      }
    }

    return html;
  }

  function escapeHtml(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function escapeAttr(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  let content = cleanHtml(clone);

  // Wrap loose text in paragraphs
  content = content.replace(/([^<>]+)(?=<|$)/g, (match) => {
    const trimmed = match.trim();
    if (trimmed && !trimmed.startsWith('<')) {
      return `<p>${trimmed}</p>`;
    }
    return match;
  });

  // Collapse fragmented paragraphs
  const collapseDiv = document.createElement('div');
  collapseDiv.innerHTML = content;
  collapseFragmentedParagraphs(collapseDiv);
  content = collapseDiv.innerHTML;

  // Try to get author/byline
  const bylineSelectors = ['.author', '.byline', '[rel="author"]', '.post-author'];
  let byline: string | undefined;
  for (const selector of bylineSelectors) {
    const el = document.querySelector(selector);
    if (el?.textContent) {
      byline = el.textContent.trim();
      break;
    }
  }

  return {
    title,
    content: content || '<p>No content could be extracted.</p>',
    textContent: textContent.slice(0, 50000),
    byline,
    images: [],
    pageType: detectPageType(location.href),
    confidence: 0.5 // Lower confidence since this is simpler extraction
  };
}

// Listen for extraction requests
chrome.runtime.onMessage.addListener((message: ExtractContentMessage, _sender, sendResponse) => {
  if (message.type === 'EXTRACT_CONTENT') {
    console.log('Content script (lite): extracting content');

    try {
      const content = extractContent();

      const response: ExtractionCompleteMessage = {
        type: 'EXTRACTION_COMPLETE',
        content,
        url: location.href,
        title: document.title
      };

      sendResponse(response);
    } catch (err) {
      console.error('Content extraction error:', err);
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

    return true;
  }
});

console.log('Evidence Screenshotter content script (lite) loaded');
