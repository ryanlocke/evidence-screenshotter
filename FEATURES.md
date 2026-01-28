# Evidence Screenshotter — Features Guide

Detailed documentation of all features in the Evidence Screenshotter extension.

## Table of Contents

- [Capture Modes](#capture-modes)
- [Content Extraction](#content-extraction)
- [Preview & Editing](#preview--editing)
- [Annotation Tools](#annotation-tools)
- [AI Enhancement](#ai-enhancement-optional)
- [PDF Generation](#pdf-generation)
- [Recent Captures](#recent-captures)
- [Keyboard Shortcuts](#keyboard-shortcuts)
- [Technical Limits](#technical-limits)

---

## Capture Modes

### Visible Area (Viewport)

Captures exactly what's currently visible in the browser window.

- **Speed**: Fast, single-shot capture
- **Output**: One screenshot matching your viewport size
- **Best for**: Single-screen content, specific visible elements, quick captures

### Full Page

Automatically scrolls through the entire page and stitches multiple screenshots into one complete image.

- **Speed**: Slower (depends on page length)
- **Output**: One tall screenshot of the entire page
- **Best for**: Long articles, full social media threads, complete webpages

| Feature | Visible Area | Full Page |
|---------|--------------|-----------|
| Capture time | ~1 second | 5-30 seconds |
| Scrolling required | No | Automatic |
| Page coverage | Current viewport only | Entire page |
| Max height | Viewport | 120,000px |

---

## Content Extraction

Evidence Screenshotter uses Mozilla Readability (the same engine behind Firefox Reader View) to intelligently extract article content.

### How It Works

1. Readability analyzes the page structure
2. Main content is identified and extracted
3. Ads, navigation, and clutter are removed
4. HTML is sanitized with DOMPurify for security
5. Metadata (title, author, date) is preserved

### Page Type Detection

The extension automatically detects and labels page types:

| Type | Detection Method | Examples |
|------|-----------------|----------|
| **Article** | `<article>` tag, og:type metadata, author/date presence | News sites, blogs |
| **Social Media** | Domain matching | Twitter/X, Facebook, Instagram, LinkedIn, Threads |
| **Forum** | URL and domain patterns | Reddit, Hacker News, Discourse |
| **Generic** | Fallback | Any other page |

### Extraction Confidence

Each extraction includes a confidence score (0-1):

- **0.8+** — High confidence. Readability successfully identified article content.
- **0.4-0.8** — Medium. Partial extraction or complex page structure.
- **Below 0.4** — Low. Fallback extraction was used.

---

## Preview & Editing

After capture, a preview page opens with editing tools.

### Element Removal

Remove unwanted content from the extracted text:

1. Hover over any paragraph, heading, image, or blockquote
2. A red X button appears
3. Click to remove the element
4. Use Ctrl/Cmd+Z to undo

### Screenshot Sections

For full-page captures, the screenshot is divided into viewport-sized sections:

- Each section can be individually removed
- "First page only" checkbox to keep just the top
- Useful for very long pages where you only need part of the content

### Typography Controls

Adjust how extracted content appears:

- **Font size**: 10pt to 18pt
- **Line spacing**: 1.2 to 2.2

These settings affect both the preview and the generated PDF.

---

## Annotation Tools

Add visual annotations to your screenshot.

### Highlight Tool

- Click and drag to highlight areas in yellow
- Works as an overlay on the screenshot
- Useful for drawing attention to specific content

### Arrow Tool

- Click and drag to draw a red arrow
- Arrow points from start to end position
- Great for pointing out specific elements

### Box Tool

- Click and drag to draw a rectangle
- Toggle between outline and filled style
- Use to frame or emphasize areas

### Managing Annotations

- **Delete**: Click any annotation (when no tool is selected) to remove it
- **Clear All**: Button in the sidebar removes all annotations
- **Undo**: Ctrl/Cmd+Z undoes the last annotation action

---

## AI Enhancement (Optional)

Optionally use Claude AI to improve content formatting.

### Setup

1. Click "Settings" in the preview sidebar
2. Enter your Anthropic API key
3. Click "Save"

### What It Does

- Reformats extracted content for better readability
- Preserves all factual information exactly
- Uses Claude 3 Haiku for fast processing

### Privacy Note

- Your API key is stored locally only
- Content is sent to Anthropic's API when you click "Enhance"
- No other data collection or telemetry

---

## PDF Generation

Generate a professional evidence document.

### Document Format

- **Size**: A4 portrait
- **Margins**: 15mm
- **Font**: Georgia serif, 11pt body text

### Document Structure

**Header**
- Source URL
- Capture timestamp
- Page title

**Part 1: Original Screenshot**
- Full screenshot with all annotations
- Section label and caption

**Part 2: Extracted Content**
- Page metadata (title, author, date if available)
- Cleaned article content
- Section label

### What's Included

Use the checkboxes to control what appears in the PDF:
- Include Screenshot — Toggle the screenshot section
- Include Extracted Text — Toggle the text section

---

## Recent Captures

Access your previous captures without recapturing.

### How It Works

- Last 10 captures are stored locally
- Thumbnails generated for quick identification
- Full capture data preserved for re-editing

### Accessing Recent Captures

1. Click "Recent" in the preview sidebar
2. Click any thumbnail to load that capture
3. Edit and generate PDF as normal

### Storage Details

- Uses Chrome's local extension storage
- Thumbnails are resized to ~240x160px
- Full-resolution screenshots stored separately

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Z` / `Cmd+Z` | Undo last action |
| `Escape` | Deselect current tool |

---

## Technical Limits

| Limit | Value | Reason |
|-------|-------|--------|
| Max page height | 120,000px | Browser memory constraints |
| Capture rate | ~2/second | Chrome API rate limiting |
| Recent captures stored | 10 | Storage efficiency |
| Screenshot format | JPEG 90% | Balance of quality and size |

### Supported Sites

Works on most websites. Exceptions:

- `chrome://` pages (browser internal pages)
- `chrome-extension://` pages
- Sites with aggressive content script blocking

### Chrome Permissions Used

| Permission | Why It's Needed |
|------------|----------------|
| `activeTab` | Access current tab content |
| `scripting` | Inject content extraction script |
| `storage` | Save captures and settings |
| `downloads` | Save generated PDFs |
| `offscreen` | Run PDF generation in background |
| `<all_urls>` | Extract content from any webpage |
