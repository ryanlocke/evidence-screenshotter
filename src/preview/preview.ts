import type { EvidenceData } from '../shared/types';
import { PDF_CONFIG } from '../shared/constants';

// html2pdf is loaded lazily when user clicks save (it's 1.2MB!)
let html2pdfModule: typeof import('html2pdf.js') | null = null;

// Storage keys
const CAPTURE_STORAGE_KEY = 'evidence_capture_data';
const SETTINGS_STORAGE_KEY = 'evidence_settings';
const RECENT_CAPTURES_KEY = 'evidence_recent_captures';
const CAPTURE_DATA_PREFIX = 'evidence_capture_data:';
const MAX_RECENT_CAPTURES = 10;

// Track removed elements for undo
const removedElements: { element: HTMLElement; parent: HTMLElement; nextSibling: Node | null }[] = [];

// Track deleted annotations for undo
const deletedAnnotations: SVGElement[] = [];

// Current evidence data
let currentData: EvidenceData | null = null;

// Annotation state
type AnnotationTool = 'none' | 'highlight' | 'arrow' | 'box';
let currentTool: AnnotationTool = 'none';
let isDrawing = false;
let drawStart: { x: number; y: number } | null = null;
const annotations: SVGElement[] = [];

// Track whether AI enhance triggered the settings modal
let pendingAIEnhance = false;

// DOM Elements
const loadingState = document.getElementById('loadingState')!;
const previewContent = document.getElementById('previewContent')!;
const previewExportContainer = document.getElementById('previewExportContainer')!;
const includeScreenshot = document.getElementById('includeScreenshot') as HTMLInputElement;
const includeContent = document.getElementById('includeContent') as HTMLInputElement;
const fontSize = document.getElementById('fontSize') as HTMLInputElement;
const fontSizeValue = document.getElementById('fontSizeValue')!;
const lineHeight = document.getElementById('lineHeight') as HTMLInputElement;
const lineHeightValue = document.getElementById('lineHeightValue')!;
const aiEnhanceBtn = document.getElementById('aiEnhanceBtn') as HTMLButtonElement;
const aiHint = document.getElementById('aiHint')!;
const undoBtn = document.getElementById('undoBtn') as HTMLButtonElement;
const settingsBtn = document.getElementById('settingsBtn') as HTMLButtonElement;
const savePdfBtn = document.getElementById('savePdfBtn') as HTMLButtonElement;
const settingsModal = document.getElementById('settingsModal')!;
const closeSettingsBtn = document.getElementById('closeSettingsBtn')!;
const apiKeyInput = document.getElementById('apiKey') as HTMLInputElement;
const saveSettingsBtn = document.getElementById('saveSettingsBtn') as HTMLButtonElement;
const statusMessage = document.getElementById('statusMessage')!;

const metaUrl = document.getElementById('metaUrl')!;
const metaCaptured = document.getElementById('metaCaptured')!;
const metaTitle = document.getElementById('metaTitle')!;
const screenshotSection = document.getElementById('screenshotSection')!;
const screenshotContainer = document.getElementById('screenshotContainer')!;
const contentSection = document.getElementById('contentSection')!;
const extractedContent = document.getElementById('extractedContent')!;

// Store screenshot sections for management
let screenshotSections: { dataUrl: string; element: HTMLElement }[] = [];

// Cache sliced screenshots per full image to avoid recomputing on toggles
const sectionCache = new Map<string, string[]>();

// New feature elements
const copyTextBtn = document.getElementById('copyTextBtn') as HTMLButtonElement;
const highlightBtn = document.getElementById('highlightBtn') as HTMLButtonElement;
const arrowBtn = document.getElementById('arrowBtn') as HTMLButtonElement;
const boxBtn = document.getElementById('boxBtn') as HTMLButtonElement;
const clearAnnotationsBtn = document.getElementById('clearAnnotationsBtn') as HTMLButtonElement;
const toolHint = document.getElementById('toolHint')!;
const recentCapturesBtn = document.getElementById('recentCapturesBtn') as HTMLButtonElement;
const recentModal = document.getElementById('recentModal')!;
const closeRecentBtn = document.getElementById('closeRecentBtn')!;
const recentList = document.getElementById('recentList')!;
const annotationOverlay = document.getElementById('annotationOverlay') as unknown as SVGSVGElement;
const screenshotFirstPageOnly = document.getElementById('screenshotFirstPageOnly') as HTMLInputElement;
const boxFillOption = document.getElementById('boxFillOption')!;
const boxFilledCheckbox = document.getElementById('boxFilled') as HTMLInputElement;
const previewArea = document.querySelector('.preview-area') as HTMLElement;

// Store original full screenshot for toggling
let fullScreenshotDataUrl: string = '';

// Format date for display
function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short'
  }).format(date);
}

// Show status message
function showStatus(message: string, type: 'success' | 'error' | 'info' = 'info') {
  statusMessage.textContent = message;
  statusMessage.className = `status-message ${type}`;
  statusMessage.classList.remove('hidden');

  setTimeout(() => {
    statusMessage.classList.add('hidden');
  }, 3000);
}

// Load captured data from storage
async function loadCapturedData(): Promise<EvidenceData | null> {
  console.time('storage.get');
  return new Promise((resolve) => {
    chrome.storage.local.get(CAPTURE_STORAGE_KEY, (result) => {
      console.timeEnd('storage.get');
      if (result[CAPTURE_STORAGE_KEY]) {
        const data = result[CAPTURE_STORAGE_KEY];
        // Handle date parsing - storage serializes Date objects
        const capturedAt = data.metadata.capturedAt;
        if (capturedAt instanceof Date) {
          // Already a Date object
        } else if (typeof capturedAt === 'string') {
          data.metadata.capturedAt = new Date(capturedAt);
        } else if (typeof capturedAt === 'number') {
          data.metadata.capturedAt = new Date(capturedAt);
        } else {
          // Fallback to current time if date is invalid
          console.warn('Invalid capturedAt value, using current time:', capturedAt);
          data.metadata.capturedAt = new Date();
        }

        // Verify the date is valid
        if (isNaN(data.metadata.capturedAt.getTime())) {
          console.warn('Date parsing failed, using current time');
          data.metadata.capturedAt = new Date();
        }

        console.log('Data loaded, screenshot size:', data.screenshot?.dataUrl?.length || 0, 'chars');
        resolve(data);
      } else {
        resolve(null);
      }
    });
  });
}

// Load settings
async function loadSettings(): Promise<{ apiKey?: string }> {
  return new Promise((resolve) => {
    chrome.storage.local.get(SETTINGS_STORAGE_KEY, (result) => {
      resolve(result[SETTINGS_STORAGE_KEY] || {});
    });
  });
}

// Save settings
async function saveSettings(settings: { apiKey?: string }): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [SETTINGS_STORAGE_KEY]: settings }, resolve);
  });
}

// Make elements removable
function makeElementsRemovable() {
  const removableElements = extractedContent.querySelectorAll('p, img, blockquote, h2, h3, h4, ul, ol, figure');

  removableElements.forEach((el) => {
    let targetElement = el as HTMLElement;

    // Void elements (img, br, hr, input) can't have children appended
    // Wrap them in a container div for the delete button
    if (el.tagName === 'IMG') {
      const wrapper = document.createElement('div');
      wrapper.className = 'img-wrapper removable';
      wrapper.style.position = 'relative';
      wrapper.style.display = 'inline-block';
      el.parentNode?.insertBefore(wrapper, el);
      wrapper.appendChild(el);
      targetElement = wrapper;
    } else {
      el.classList.add('removable');
      targetElement.style.position = 'relative';
    }

    // Create delete button
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'remove-btn';
    deleteBtn.innerHTML = '×';
    deleteBtn.title = 'Remove this element';
    targetElement.appendChild(deleteBtn);

    // Only delete when clicking the button
    deleteBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();

      const parent = targetElement.parentElement!;
      const nextSibling = targetElement.nextSibling;

      // Store for undo
      undoStack.push({ type: 'element', data: { element: targetElement, parent, nextSibling } });
      undoBtn.disabled = false;

      // Remove element (wrapper or element itself)
      targetElement.classList.add('removed');
    });
  });
}

// Track what type of action to undo
type UndoAction = { type: 'element'; data: typeof removedElements[0] } | { type: 'annotation'; data: SVGElement };
const undoStack: UndoAction[] = [];

// Undo last action (element removal or annotation deletion)
function undoLastAction() {
  const last = undoStack.pop();
  if (!last) return;

  if (last.type === 'element') {
    last.data.element.classList.remove('removed');
  } else if (last.type === 'annotation') {
    // Restore the annotation
    annotationOverlay.appendChild(last.data);
    annotations.push(last.data);
    makeAnnotationDeletable(last.data);
    updateAnnotationCount();
  }

  undoBtn.disabled = undoStack.length === 0;
}

// Make an annotation clickable to delete
function makeAnnotationDeletable(elem: SVGElement) {
  elem.classList.add('annotation-deletable');

  elem.addEventListener('click', (e) => {
    // Only delete when no tool is active
    if (currentTool !== 'none') return;

    e.stopPropagation();

    // Remove from DOM and annotations array
    const index = annotations.indexOf(elem);
    if (index > -1) {
      annotations.splice(index, 1);
    }
    elem.remove();

    // Add to undo stack
    undoStack.push({ type: 'annotation', data: elem });
    undoBtn.disabled = false;

    updateAnnotationCount();
    showStatus('Annotation deleted (Ctrl+Z to undo)', 'info');
  });
}

// Update annotation count in hint
function updateAnnotationCount() {
  const count = annotations.length;
  if (currentTool === 'none' && count > 0) {
    toolHint.textContent = `${count} annotation${count !== 1 ? 's' : ''} - click to delete`;
  } else if (currentTool === 'none') {
    toolHint.textContent = 'Select a tool to annotate';
  }
}

// Apply text formatting
function applyTextFormatting() {
  const size = fontSize.value;
  const height = lineHeight.value;

  extractedContent.style.fontSize = `${size}pt`;
  extractedContent.style.lineHeight = height;

  fontSizeValue.textContent = `${size}pt`;
  lineHeightValue.textContent = height;
}

// Toggle sections
function toggleSections() {
  screenshotSection.style.display = includeScreenshot.checked ? 'block' : 'none';
  contentSection.style.display = includeContent.checked ? 'block' : 'none';
}

// Slice a full-page screenshot into viewport-sized sections
async function sliceScreenshotIntoSections(fullDataUrl: string): Promise<string[]> {
  if (sectionCache.has(fullDataUrl)) {
    return sectionCache.get(fullDataUrl)!;
  }

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const sections: string[] = [];

      // Use 16:9 aspect ratio for viewport sections (common screen ratio)
      const aspectRatio = 16 / 9;
      const sectionHeight = Math.round(img.width / aspectRatio);

      // Calculate number of sections needed
      const numSections = Math.ceil(img.height / sectionHeight);

      for (let i = 0; i < numSections; i++) {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d')!;

        const startY = i * sectionHeight;
        const height = Math.min(sectionHeight, img.height - startY);

        canvas.width = img.width;
        canvas.height = height;

        ctx.drawImage(
          img,
          0, startY, img.width, height,
          0, 0, img.width, height
        );

        sections.push(canvas.toDataURL('image/jpeg', 0.9));
      }

      sectionCache.set(fullDataUrl, sections);
      resolve(sections);
    };
    img.src = fullDataUrl;
  });
}

// Create a deletable screenshot section element
function createScreenshotSection(dataUrl: string, index: number): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'screenshot-section-item';
  wrapper.dataset.index = index.toString();

  const img = document.createElement('img');
  img.src = dataUrl;
  img.alt = `Screenshot section ${index + 1}`;
  wrapper.appendChild(img);

  // Add delete button
  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'remove-btn';
  deleteBtn.innerHTML = '×';
  deleteBtn.title = 'Remove this screenshot section';
  wrapper.appendChild(deleteBtn);

  // Handle delete
  deleteBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();

    // Store for undo
    const sectionData = screenshotSections.find(s => s.element === wrapper);
    if (sectionData) {
      undoStack.push({
        type: 'element',
        data: {
          element: wrapper,
          parent: screenshotContainer,
          nextSibling: wrapper.nextSibling
        }
      });
      undoBtn.disabled = false;

      // Remove from array and DOM
      const idx = screenshotSections.indexOf(sectionData);
      if (idx > -1) screenshotSections.splice(idx, 1);
      wrapper.classList.add('removed');

      showStatus('Screenshot section removed (Ctrl+Z to undo)', 'info');
    }
  });

  return wrapper;
}

// Render screenshot sections
async function renderScreenshotSections(fullDataUrl: string) {
  screenshotContainer.innerHTML = '';
  screenshotSections = [];

  if (screenshotFirstPageOnly.checked) {
    // Just show first section
    const sections = await sliceScreenshotIntoSections(fullDataUrl);
    if (sections.length > 0) {
      const element = createScreenshotSection(sections[0], 0);
      screenshotContainer.appendChild(element);
      screenshotSections.push({ dataUrl: sections[0], element });
    }
  } else {
    // Show all sections
    const sections = await sliceScreenshotIntoSections(fullDataUrl);
    sections.forEach((dataUrl, index) => {
      const element = createScreenshotSection(dataUrl, index);
      screenshotContainer.appendChild(element);
      screenshotSections.push({ dataUrl, element });
    });
  }
}

// Toggle first page only screenshot
async function toggleFirstPageOnly() {
  if (!fullScreenshotDataUrl) return;
  await renderScreenshotSections(fullScreenshotDataUrl);
}

// Render preview
async function renderPreview(data: EvidenceData) {
  currentData = data;

  // Set metadata
  metaUrl.textContent = data.metadata.url;
  metaCaptured.textContent = formatDate(data.metadata.capturedAt);
  metaTitle.textContent = data.metadata.pageTitle;

  // Store full screenshot and render sections
  fullScreenshotDataUrl = data.screenshot.dataUrl;
  await renderScreenshotSections(data.screenshot.dataUrl);

  // Set extracted content
  extractedContent.innerHTML = `
    <h1>${escapeHtml(data.extractedContent.title)}</h1>
    ${data.extractedContent.byline ? `<p class="byline"><em>By: ${escapeHtml(data.extractedContent.byline)}</em></p>` : ''}
    ${data.extractedContent.content}
  `;

  // Make elements removable
  makeElementsRemovable();

  // Apply initial formatting
  applyTextFormatting();

  // Show content
  loadingState.classList.add('hidden');
  previewContent.classList.remove('hidden');

  // Update overlay size after content is rendered
  requestAnimationFrame(() => updateOverlaySize());

  // Save to recent captures
  saveToRecentCaptures(data);
}

// Escape HTML
function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Add invisible text layer to PDF for searchability
function addSearchableTextLayer(pdf: any, data: EvidenceData) {
  const margin = PDF_CONFIG.margin;
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const textWidth = pageWidth - margin * 2;

  // Add metadata as searchable text on page 1
  pdf.setPage(1);
  pdf.setFontSize(8);

  // URL and title (searchable but invisible)
  const metaText = `${data.metadata.url}\n${data.metadata.pageTitle}`;
  pdf.text(metaText, margin, margin + 5, {
    maxWidth: textWidth,
    renderingMode: 'invisible'
  });

  // Add extracted content as searchable text
  if (includeContent.checked && data.extractedContent.textContent) {
    const textContent = data.extractedContent.textContent;
    const lines = pdf.splitTextToSize(textContent, textWidth);

    // Use jsPDF-aware line height instead of a magic number
    const lineHeight = typeof pdf.getLineHeight === 'function'
      ? pdf.getLineHeight()
      : pdf.getFontSize() * (pdf.getLineHeightFactor?.() || 1.15);

    const textTop = margin + 10; // leave space below metadata
    const usableHeight = pageHeight - margin - textTop;
    const linesPerPage = Math.max(1, Math.floor(usableHeight / lineHeight));

    let currentLine = 0;
    let page = 1;
    while (currentLine < lines.length) {
      // Ensure the page exists (html2pdf may only create as many as rendered content)
      if (page > pdf.internal.getNumberOfPages()) {
        pdf.addPage();
      }

      pdf.setPage(page);
      const pageLines = lines.slice(currentLine, currentLine + linesPerPage);
      pdf.text(pageLines, margin, textTop, {
        renderingMode: 'invisible'
      });

      currentLine += linesPerPage;
      page += 1;
    }
  }
}

// Generate and save PDF
async function generatePDF() {
  if (!currentData) return;

  savePdfBtn.disabled = true;
  savePdfBtn.textContent = 'Loading PDF library...';

  try {
    // Lazy load html2pdf.js (1.2MB) only when needed
    if (!html2pdfModule) {
      html2pdfModule = await import('html2pdf.js');
    }
    const html2pdf = html2pdfModule.default;

    savePdfBtn.textContent = 'Generating PDF...';

    // Get the preview container for PDF generation
    // Export overlay + content together so annotations appear in the PDF
    const container = previewExportContainer;

    // Temporarily hide removed elements completely
    const removedEls = container.querySelectorAll('.removed');
    removedEls.forEach(el => (el as HTMLElement).style.display = 'none');

    // Hide sections if not included
    const originalScreenshotDisplay = screenshotSection.style.display;
    const originalContentDisplay = contentSection.style.display;

    // Create safe filename from page title
    const safeTitle = currentData.metadata.pageTitle
      .replace(/[^a-zA-Z0-9\s-]/g, '') // Remove special characters
      .trim()
      .replace(/\s+/g, '-') // Replace spaces with hyphens
      .slice(0, 60) || 'evidence'; // Limit length, fallback if empty
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

    const options = {
      margin: PDF_CONFIG.margin,
      filename: `${safeTitle}-${timestamp}.pdf`,
      image: PDF_CONFIG.image,
      html2canvas: { ...PDF_CONFIG.html2canvas, scrollY: 0 },
      jsPDF: PDF_CONFIG.jsPDF,
      pagebreak: { mode: ['css', 'legacy'] }
    };

    // Generate PDF and add invisible text layer for searchability
    const capturedData = currentData;
    await html2pdf()
      .set(options)
      .from(container)
      .toPdf()
      .get('pdf')
      .then((pdf: any) => {
        addSearchableTextLayer(pdf, capturedData);
        return pdf;
      })
      .save();

    // Restore removed elements visibility (still hidden via .removed class)
    removedEls.forEach(el => (el as HTMLElement).style.display = '');
    screenshotSection.style.display = originalScreenshotDisplay;
    contentSection.style.display = originalContentDisplay;

    showStatus('PDF saved successfully!', 'success');
  } catch (err) {
    console.error('PDF generation failed:', err);
    showStatus('Failed to generate PDF', 'error');
  } finally {
    savePdfBtn.disabled = false;
    savePdfBtn.textContent = 'Save as PDF';
  }
}

// AI Enhancement
async function enhanceWithAI() {
  const settings = await loadSettings();

  if (!settings.apiKey) {
    pendingAIEnhance = true;
    showStatus('Please add your API key in Settings', 'error');
    settingsModal.classList.remove('hidden');
    return;
  }

  if (!currentData) return;

  aiEnhanceBtn.disabled = true;
  aiEnhanceBtn.innerHTML = '<span class="btn-icon">⏳</span> Enhancing...';

  try {
    // Build payload only when user confirms to reduce unnecessary work
    const textContent = currentData.extractedContent.textContent;

    const payload = {
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      messages: [{
        role: 'user',
        content: `You are reformatting web content for a legal evidence document. The content should be clean, readable, and preserve all factual information exactly.

Original page title: ${currentData.extractedContent.title}
${currentData.extractedContent.byline ? `Author: ${currentData.extractedContent.byline}` : ''}

Original content:
${textContent.slice(0, 8000)}

Please reformat this content into clean, well-structured HTML. Use semantic tags (h1, h2, p, ul, blockquote). Preserve all factual information exactly - do not add, remove, or modify any facts. Focus on improving readability and organization.

Return ONLY the HTML content, no explanations.`
      }]
    } as const;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': settings.apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const status = response.status;
      if (status === 401) {
        throw new Error('Invalid API key. Check your key in Settings.');
      } else if (status === 429) {
        throw new Error('Rate limited — try again in a moment.');
      } else {
        throw new Error(`API error (HTTP ${status})`);
      }
    }

    const result = await response.json();
    const enhancedContent = result.content[0].text;

    // Update the extracted content
    extractedContent.innerHTML = enhancedContent;
    makeElementsRemovable();
    applyTextFormatting();

    showStatus('Content enhanced with AI!', 'success');
  } catch (err) {
    console.error('AI enhancement failed:', err);
    const message = err instanceof Error ? err.message : 'AI enhancement failed';
    showStatus(message, 'error');
  } finally {
    aiEnhanceBtn.disabled = false;
    aiEnhanceBtn.innerHTML = '<span class="btn-icon">✨</span> Enhance with AI';
  }
}

// Copy text to clipboard
async function copyText() {
  if (!currentData) return;

  try {
    const text = extractedContent.innerText;
    await navigator.clipboard.writeText(text);
    showStatus('Text copied to clipboard!', 'success');
  } catch {
    showStatus('Failed to copy text', 'error');
  }
}

// Recent captures management
interface RecentCapture {
  id: string;
  url: string;
  title: string;
  capturedAt: string;
  thumbnail: string; // small, resized image
  captureKey: string; // points to full data in storage
}

async function loadRecentCaptures(): Promise<RecentCapture[]> {
  return new Promise((resolve) => {
    chrome.storage.local.get(RECENT_CAPTURES_KEY, (result) => {
      resolve(result[RECENT_CAPTURES_KEY] || []);
    });
  });
}

// Create a small thumbnail to keep storage light
async function createThumbnail(dataUrl: string, maxWidth = 240, maxHeight = 160): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(maxWidth / img.width, maxHeight / img.height, 1);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.7));
    };
    img.src = dataUrl;
  });
}

async function saveToRecentCaptures(data: EvidenceData) {
  const recent = await loadRecentCaptures();

  const thumbnail = await createThumbnail(data.screenshot.dataUrl);
  const captureKey = `${CAPTURE_DATA_PREFIX}${Date.now()}`;

  // Store the full data under a separate key to avoid duplicating large blobs in recents
  await chrome.storage.local.set({ [captureKey]: data });

  const newCapture: RecentCapture = {
    id: Date.now().toString(),
    url: data.metadata.url,
    title: data.metadata.pageTitle,
    capturedAt: data.metadata.capturedAt.toISOString(),
    thumbnail,
    captureKey
  };

  // Add to front, remove duplicates by URL
  const filtered = recent.filter(r => r.url !== data.metadata.url);
  const updated = [newCapture, ...filtered].slice(0, MAX_RECENT_CAPTURES);

  await chrome.storage.local.set({ [RECENT_CAPTURES_KEY]: updated });
}

async function deleteRecentCapture(id: string) {
  const recent = await loadRecentCaptures();
  const removed = recent.find(r => r.id === id);
  const updated = recent.filter(r => r.id !== id);
  await chrome.storage.local.set({ [RECENT_CAPTURES_KEY]: updated });
  if (removed) {
    chrome.storage.local.remove(removed.captureKey);
  }
  renderRecentCaptures();
}

async function renderRecentCaptures() {
  const recent = await loadRecentCaptures();

  if (recent.length === 0) {
    recentList.innerHTML = '<p class="hint">No recent captures found.</p>';
    return;
  }

  recentList.innerHTML = recent.map(capture => `
    <div class="recent-item" data-id="${capture.id}">
      <img class="recent-thumbnail" src="${capture.thumbnail}" alt="">
      <div class="recent-info">
        <div class="recent-title">${escapeHtml(capture.title)}</div>
        <div class="recent-url">${escapeHtml(capture.url)}</div>
        <div class="recent-date">${new Date(capture.capturedAt).toLocaleString()}</div>
      </div>
      <button class="recent-delete" data-id="${capture.id}" title="Delete">&times;</button>
    </div>
  `).join('');

  // Add click handlers
  recentList.querySelectorAll('.recent-item').forEach(item => {
    item.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.classList.contains('recent-delete')) {
        e.stopPropagation();
        const id = target.dataset.id!;
        deleteRecentCapture(id);
        return;
      }
      // Attempt to load stored capture by key if available
      const id = (item as HTMLElement).dataset.id!;
      const capture = recent.find(r => r.id === id);
      if (capture?.captureKey) {
        chrome.storage.local.get(capture.captureKey, (result) => {
          const data = result[capture.captureKey];
          if (data) {
            // Rehydrate date
            data.metadata.capturedAt = new Date(data.metadata.capturedAt);
            renderPreview(data);
            recentModal.classList.add('hidden');
            showStatus('Capture loaded', 'success');
          } else {
            showStatus('Capture not found', 'error');
          }
        });
      } else {
        showStatus('Capture not found', 'error');
      }
    });
  });
}

// Update annotation overlay size to match scrollable content
function updateOverlaySize() {
  // Get the full scrollable dimensions of the preview area
  const scrollWidth = previewArea.scrollWidth;
  const scrollHeight = previewArea.scrollHeight;
  annotationOverlay.style.width = `${scrollWidth}px`;
  annotationOverlay.style.height = `${scrollHeight}px`;
}

// Annotation tool management
function setTool(tool: AnnotationTool) {
  currentTool = tool;

  // Update button states
  highlightBtn.classList.toggle('active', tool === 'highlight');
  arrowBtn.classList.toggle('active', tool === 'arrow');
  boxBtn.classList.toggle('active', tool === 'box');

  // Show/hide box fill option
  boxFillOption.style.display = tool === 'box' ? 'flex' : 'none';

  // Update hint text
  const hints: Record<AnnotationTool, string> = {
    'none': 'Select a tool to annotate',
    'highlight': 'Select text to highlight',
    'arrow': 'Click and drag to draw arrow',
    'box': 'Click and drag to draw box'
  };
  toolHint.textContent = hints[tool];

  // Update cursor and mode
  if (tool === 'highlight') {
    extractedContent.classList.add('highlight-mode');
    annotationOverlay.classList.remove('drawing');
    annotationOverlay.classList.remove('selectable');
  } else if (tool === 'arrow' || tool === 'box') {
    extractedContent.classList.remove('highlight-mode');
    annotationOverlay.classList.add('drawing');
    annotationOverlay.classList.remove('selectable');
    // Ensure overlay covers full content when drawing
    updateOverlaySize();
  } else {
    extractedContent.classList.remove('highlight-mode');
    annotationOverlay.classList.remove('drawing');
    // Enable clicking annotations to delete when no tool selected
    if (annotations.length > 0) {
      annotationOverlay.classList.add('selectable');
      updateOverlaySize();
    }
    updateAnnotationCount();
  }
}

// Get mouse coordinates relative to annotation overlay
function getRelativeCoords(e: MouseEvent): { x: number; y: number } {
  const rect = annotationOverlay.getBoundingClientRect();
  return {
    x: e.clientX - rect.left,
    y: e.clientY - rect.top
  };
}

function setupAnnotationOverlay() {
  // Add arrowhead marker definition
  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  defs.innerHTML = `
    <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
      <polygon points="0 0, 10 3.5, 0 7" fill="#ef4444" />
    </marker>
  `;
  annotationOverlay.appendChild(defs);

  // Mouse handlers for drawing
  annotationOverlay.addEventListener('mousedown', (e) => {
    if (currentTool !== 'arrow' && currentTool !== 'box') return;

    isDrawing = true;
    drawStart = getRelativeCoords(e);
  });

  annotationOverlay.addEventListener('mousemove', (e) => {
    if (!isDrawing || !drawStart) return;

    // Remove temp element if exists
    const temp = annotationOverlay.querySelector('.temp-annotation');
    if (temp) temp.remove();

    const coords = getRelativeCoords(e);
    const elem = createAnnotationElement(
      drawStart.x, drawStart.y,
      coords.x, coords.y,
      currentTool as 'arrow' | 'box'
    );
    elem.classList.add('temp-annotation');
    annotationOverlay.appendChild(elem);
  });

  annotationOverlay.addEventListener('mouseup', (e) => {
    if (!isDrawing || !drawStart) return;

    // Remove temp
    const temp = annotationOverlay.querySelector('.temp-annotation');
    if (temp) temp.remove();

    const coords = getRelativeCoords(e);

    // Create final element if drag was meaningful
    const dx = Math.abs(coords.x - drawStart.x);
    const dy = Math.abs(coords.y - drawStart.y);

    if (dx > 10 || dy > 10) {
      const elem = createAnnotationElement(
        drawStart.x, drawStart.y,
        coords.x, coords.y,
        currentTool as 'arrow' | 'box'
      );
      annotationOverlay.appendChild(elem);
      annotations.push(elem);
      makeAnnotationDeletable(elem);
      updateAnnotationCount();
    }

    isDrawing = false;
    drawStart = null;
  });
}

function createAnnotationElement(x1: number, y1: number, x2: number, y2: number, type: 'arrow' | 'box'): SVGElement {
  if (type === 'arrow') {
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', x1.toString());
    line.setAttribute('y1', y1.toString());
    line.setAttribute('x2', x2.toString());
    line.setAttribute('y2', y2.toString());
    line.setAttribute('class', 'annotation-arrow');
    return line;
  } else {
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    const minX = Math.min(x1, x2);
    const minY = Math.min(y1, y2);
    const width = Math.abs(x2 - x1);
    const height = Math.abs(y2 - y1);
    rect.setAttribute('x', minX.toString());
    rect.setAttribute('y', minY.toString());
    rect.setAttribute('width', width.toString());
    rect.setAttribute('height', height.toString());
    // Use filled or outline based on checkbox
    const isFilled = boxFilledCheckbox.checked;
    rect.setAttribute('class', isFilled ? 'annotation-box' : 'annotation-box-outline');
    return rect;
  }
}

function clearAnnotations() {
  annotations.forEach(a => a.remove());
  annotations.length = 0;

  // Also remove highlights
  extractedContent.querySelectorAll('.evidence-highlight').forEach(h => {
    const parent = h.parentNode!;
    parent.replaceChild(document.createTextNode(h.textContent || ''), h);
    parent.normalize();
  });

  // Clear annotation-related undo entries
  for (let i = undoStack.length - 1; i >= 0; i--) {
    if (undoStack[i].type === 'annotation') {
      undoStack.splice(i, 1);
    }
  }
  undoBtn.disabled = undoStack.length === 0;

  updateAnnotationCount();
  showStatus('Annotations cleared', 'info');
}

// Highlight selected text
function setupHighlighting() {
  extractedContent.addEventListener('mouseup', () => {
    if (currentTool !== 'highlight') return;

    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return;

    const range = selection.getRangeAt(0);

    // Check if selection is within extractedContent
    if (!extractedContent.contains(range.commonAncestorContainer)) return;

    // Create highlight span
    const highlight = document.createElement('span');
    highlight.className = 'evidence-highlight';

    try {
      range.surroundContents(highlight);
      selection.removeAllRanges();
    } catch {
      // Selection spans multiple elements, handle gracefully
      console.log('Cannot highlight across elements');
    }
  });
}

// Initialize - non-blocking, progressive loading
function init() {
  // Set up event listeners FIRST (instant, no blocking)
  includeScreenshot.addEventListener('change', toggleSections);
  includeContent.addEventListener('change', toggleSections);
  screenshotFirstPageOnly.addEventListener('change', toggleFirstPageOnly);
  fontSize.addEventListener('input', applyTextFormatting);
  lineHeight.addEventListener('input', applyTextFormatting);
  undoBtn.addEventListener('click', undoLastAction);
  aiEnhanceBtn.addEventListener('click', enhanceWithAI);
  savePdfBtn.addEventListener('click', generatePDF);

  // New feature event listeners
  copyTextBtn.addEventListener('click', copyText);

  // Annotation tools
  highlightBtn.addEventListener('click', () => setTool(currentTool === 'highlight' ? 'none' : 'highlight'));
  arrowBtn.addEventListener('click', () => setTool(currentTool === 'arrow' ? 'none' : 'arrow'));
  boxBtn.addEventListener('click', () => setTool(currentTool === 'box' ? 'none' : 'box'));
  clearAnnotationsBtn.addEventListener('click', clearAnnotations);

  // Recent captures modal
  recentCapturesBtn.addEventListener('click', () => {
    renderRecentCaptures();
    recentModal.classList.remove('hidden');
  });

  closeRecentBtn.addEventListener('click', () => {
    recentModal.classList.add('hidden');
  });

  recentModal.addEventListener('click', (e) => {
    if (e.target === recentModal) {
      recentModal.classList.add('hidden');
    }
  });

  // Set up annotation overlay
  setupAnnotationOverlay();
  setupHighlighting();

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    // Ctrl+Z or Cmd+Z to undo
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
      e.preventDefault();
      undoLastAction();
    }
    // Escape to deselect tool
    if (e.key === 'Escape' && currentTool !== 'none') {
      setTool('none');
    }
  });

  // Settings modal
  settingsBtn.addEventListener('click', () => {
    settingsModal.classList.remove('hidden');
  });

  closeSettingsBtn.addEventListener('click', () => {
    settingsModal.classList.add('hidden');
    pendingAIEnhance = false;
  });

  settingsModal.addEventListener('click', (e) => {
    if (e.target === settingsModal) {
      settingsModal.classList.add('hidden');
      pendingAIEnhance = false;
    }
  });

  saveSettingsBtn.addEventListener('click', async () => {
    const apiKey = apiKeyInput.value.trim();
    await saveSettings({ apiKey });

    if (apiKey) {
      aiHint.textContent = 'API key configured';
    } else {
      aiHint.textContent = 'Requires API key in settings';
    }

    settingsModal.classList.add('hidden');
    showStatus('Settings saved!', 'success');

    // Auto-trigger AI enhancement if user was prompted for key
    if (pendingAIEnhance && apiKey) {
      pendingAIEnhance = false;
      enhanceWithAI();
    }
    pendingAIEnhance = false;
  });

  // Load settings async (non-blocking)
  loadSettings().then(settings => {
    if (settings.apiKey) {
      apiKeyInput.value = settings.apiKey;
      aiHint.textContent = 'API key configured';
    }
  });

  // Load captured data async (non-blocking)
  loadCapturedData().then(data => {
    if (data) {
      renderPreview(data);
    } else {
      loadingState.innerHTML = '<p>No capture data found. Please capture a page first.</p>';
    }
  });
}

// Start
init();
