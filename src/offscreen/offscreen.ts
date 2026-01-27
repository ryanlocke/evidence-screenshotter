import html2pdf from 'html2pdf.js';
import type { EvidenceData } from '../shared/types';
import type { GeneratePDFMessage, PDFReadyMessage } from '../shared/messages';
import { PDF_CONFIG } from '../shared/constants';

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

// Escape HTML special characters
function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Build the evidence PDF HTML template
function buildEvidenceHTML(data: EvidenceData): string {
  const capturedAt = new Date(data.metadata.capturedAt);

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: Georgia, 'Times New Roman', serif;
      font-size: 11pt;
      line-height: 1.5;
      color: #1a1a1a;
      padding: 0;
    }

    .evidence-header {
      background: #f8f9fa;
      border: 2px solid #1a1a1a;
      padding: 20px;
      margin-bottom: 30px;
    }

    .evidence-header .meta-row {
      margin-bottom: 8px;
      font-size: 10pt;
    }

    .evidence-header .meta-label {
      font-weight: bold;
      display: inline-block;
      width: 120px;
    }

    .evidence-header .meta-value {
      word-break: break-all;
    }

    .section-title {
      font-size: 14pt;
      font-weight: bold;
      color: #1a1a1a;
      margin: 30px 0 15px 0;
      padding-bottom: 8px;
      border-bottom: 2px solid #1a1a1a;
    }

    .screenshot-section {
      margin-bottom: 30px;
    }

    .screenshot-container {
      border: 1px solid #ccc;
      padding: 10px;
      background: #fff;
    }

    .screenshot-container img {
      width: 100%;
      height: auto;
      display: block;
    }

    .screenshot-caption {
      font-size: 9pt;
      color: #666;
      font-style: italic;
      margin-top: 10px;
      text-align: center;
    }

    .extraction-info {
      background: #f0f0f0;
      padding: 10px 15px;
      margin-bottom: 20px;
      font-size: 9pt;
      border-left: 3px solid #666;
    }

    .extraction-info span {
      margin-right: 20px;
    }

    .extracted-content {
      background: #fff;
      padding: 20px;
      border: 1px solid #ddd;
    }

    .extracted-content h1 {
      font-size: 16pt;
      margin-bottom: 15px;
      color: #1a1a1a;
    }

    .extracted-content .byline {
      font-size: 10pt;
      color: #666;
      margin-bottom: 20px;
      font-style: italic;
    }

    .extracted-content .article-body {
      font-size: 11pt;
      line-height: 1.7;
    }

    .extracted-content .article-body p {
      margin-bottom: 1em;
    }

    .extracted-content .article-body h2,
    .extracted-content .article-body h3 {
      margin: 1.5em 0 0.5em 0;
      font-weight: bold;
    }

    .extracted-content .article-body img {
      max-width: 100%;
      height: auto;
      margin: 1em 0;
    }

    .extracted-content .article-body blockquote {
      border-left: 3px solid #ccc;
      padding-left: 15px;
      margin: 1em 0;
      font-style: italic;
      color: #555;
    }

    .extracted-content .article-body ul,
    .extracted-content .article-body ol {
      margin: 1em 0;
      padding-left: 30px;
    }

    .extracted-content .article-body li {
      margin-bottom: 0.5em;
    }

    .footer {
      margin-top: 40px;
      padding-top: 20px;
      border-top: 1px solid #ccc;
      font-size: 8pt;
      color: #888;
      text-align: center;
    }

    .page-break {
      page-break-before: always;
    }
  </style>
</head>
<body>
  <div class="evidence-header">
    <div class="meta-row">
      <span class="meta-label">URL:</span>
      <span class="meta-value">${escapeHtml(data.metadata.url)}</span>
    </div>
    <div class="meta-row">
      <span class="meta-label">Captured:</span>
      <span class="meta-value">${formatDate(capturedAt)}</span>
    </div>
    <div class="meta-row">
      <span class="meta-label">Page Title:</span>
      <span class="meta-value">${escapeHtml(data.metadata.pageTitle)}</span>
    </div>
  </div>

  <div class="screenshot-section">
    <h2 class="section-title">PART 1: ORIGINAL SCREENSHOT</h2>
    <div class="screenshot-container">
      <img src="${data.screenshot.dataUrl}" alt="Original webpage screenshot">
    </div>
    <p class="screenshot-caption">
      Original webpage screenshot (${data.screenshot.captureType}) captured at ${formatDate(capturedAt)}
    </p>
  </div>

  <div class="page-break"></div>

  <div class="content-section">
    <h2 class="section-title">PART 2: EXTRACTED CONTENT</h2>

    <div class="extraction-info">
      <span><strong>Page Type:</strong> ${data.extractedContent.pageType}</span>
      <span><strong>Confidence:</strong> ${Math.round(data.extractedContent.confidence * 100)}%</span>
    </div>

    <div class="extracted-content">
      <h1>${escapeHtml(data.extractedContent.title)}</h1>

      ${data.extractedContent.byline ? `<p class="byline">By: ${escapeHtml(data.extractedContent.byline)}</p>` : ''}
      ${data.extractedContent.publishedTime ? `<p class="byline">Published: ${data.extractedContent.publishedTime}</p>` : ''}

      <div class="article-body">
        ${data.extractedContent.content}
      </div>
    </div>
  </div>

  <div class="footer">
    <p>This document contains both the original screenshot and extracted content.</p>
  </div>
</body>
</html>
  `;
}

// Generate PDF from evidence data
async function generatePDF(data: EvidenceData): Promise<string> {
  const html = buildEvidenceHTML(data);

  // Create temporary container
  const container = document.getElementById('pdf-container')!;
  container.innerHTML = html;
  container.style.display = 'block';

  // Wait for images to load
  const images = container.querySelectorAll('img');
  await Promise.all(
    Array.from(images).map(img =>
      img.complete
        ? Promise.resolve()
        : new Promise(resolve => {
            img.onload = resolve;
            img.onerror = resolve;
          })
    )
  );

  // Generate PDF
  const options = {
    margin: PDF_CONFIG.margin,
    filename: 'evidence.pdf',
    image: PDF_CONFIG.image,
    html2canvas: PDF_CONFIG.html2canvas,
    jsPDF: PDF_CONFIG.jsPDF,
    pagebreak: { mode: ['css', 'legacy'] }
  };

  const pdfBlob = await html2pdf()
    .set(options)
    .from(container)
    .outputPdf('blob');

  // Convert blob to data URL
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(pdfBlob);
  });
}

// Listen for PDF generation requests
chrome.runtime.onMessage.addListener((message: GeneratePDFMessage, sender, sendResponse) => {
  if (message.type === 'GENERATE_PDF') {
    console.log('Offscreen: generating PDF');

    generatePDF(message.data)
      .then(pdfDataUrl => {
        const response: PDFReadyMessage = {
          type: 'PDF_READY',
          pdfDataUrl
        };
        sendResponse(response);
      })
      .catch(err => {
        console.error('PDF generation failed:', err);
        sendResponse({ type: 'PDF_READY', pdfDataUrl: '' });
      });

    return true; // Keep channel open for async response
  }
});

console.log('Evidence Screenshotter offscreen document loaded');
