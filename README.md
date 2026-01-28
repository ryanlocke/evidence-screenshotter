# Evidence Screenshotter

![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue)
![Manifest V3](https://img.shields.io/badge/Chrome-Manifest%20V3-green)
![License](https://img.shields.io/badge/License-MIT-yellow)

> Capture webpages as legal evidence with original screenshots and extracted readable content.

## Overview

Evidence Screenshotter is a Chrome extension designed for capturing webpages as legal evidence. It combines pixel-perfect screenshots with intelligent content extraction to create comprehensive PDF documents suitable for legal, compliance, or archival purposes.

**Why both screenshot and extracted text?**
- Screenshots provide visual proof of exactly what appeared on screen
- Extracted text is searchable, quotable, and preserves content even if the page changes
- Together they create a complete evidentiary record

## Key Features

- **Dual Capture** — Original screenshot + extracted readable content in one PDF
- **Two Capture Modes** — Visible area (viewport) or full page (auto-stitched)
- **Smart Content Extraction** — Mozilla Readability-powered article detection
- **Preview & Edit** — Remove elements, adjust typography, add annotations
- **Annotation Tools** — Highlight text, draw arrows, add boxes
- **PDF Export** — Professional legal-style document format

## Quick Start

1. Install the extension (see [Installation](#installation))
2. Navigate to any webpage you want to capture
3. Click the extension icon → Select capture mode → Click "Capture Page"

The preview page opens automatically where you can edit and download your PDF.

## Installation

### Manual Installation (Development)

1. Clone this repository:
   ```bash
   git clone https://github.com/yourusername/evidence-screenshotter.git
   cd evidence-screenshotter
   ```

2. Install dependencies and build:
   ```bash
   npm install
   npm run build
   ```

3. Load the extension in Chrome:
   - Open `chrome://extensions`
   - Enable "Developer mode" (toggle in top right)
   - Click "Load unpacked"
   - Select the `dist` directory

## Usage

### Capture Modes

| Mode | Description | Best For |
|------|-------------|----------|
| **Visible Area** | Captures exactly what's visible in the browser | Single-screen content, specific sections |
| **Full Page** | Scrolls and stitches multiple screenshots | Long articles, full conversations |

### Preview Page

After capture, a preview page opens where you can:

- **Remove elements** — Hover over paragraphs/images and click X to remove
- **Adjust typography** — Change font size and line spacing
- **Add annotations** — Use highlight, arrow, and box tools
- **Toggle sections** — Include/exclude screenshot or extracted content
- **Download PDF** — Generate the final evidence document

See [FEATURES.md](FEATURES.md) for detailed documentation of all features.

## Development

### Prerequisites

- Node.js 18+
- npm

### Build Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Watch mode for development |
| `npm run build` | Production build |

### Project Structure

```
src/
├── popup/           # Extension popup UI
├── preview/         # Capture preview and editor page
├── service-worker/  # Background service worker
├── content-scripts/ # Page content extraction
├── offscreen/       # PDF generation (offscreen document)
└── shared/          # Shared types, messages, and constants
```

### Architecture

```
Popup (User clicks capture)
    ↓
Service Worker (Orchestrates capture)
    ↓
Content Script (Extracts content + captures screenshot)
    ↓
Preview Page (User edits and annotates)
    ↓
Offscreen Document (Generates PDF)
    ↓
Browser Download
```

## Tech Stack

- **[Mozilla Readability](https://github.com/mozilla/readability)** — Article content extraction
- **[DOMPurify](https://github.com/cure53/DOMPurify)** — HTML sanitization
- **[html2pdf.js](https://github.com/eKoopmans/html2pdf.js)** — PDF generation
- **TypeScript** — Type-safe development
- **Vite** — Fast builds and HMR

## Privacy

- All processing happens locally in your browser
- No data is sent to external servers (except optional AI enhancement)
- API keys are stored locally in Chrome's extension storage
- No analytics or tracking

## License

MIT License — see [LICENSE](LICENSE) for details.
