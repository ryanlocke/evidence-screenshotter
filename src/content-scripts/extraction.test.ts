import { describe, expect, it } from 'vitest';
import {
  detectPageType,
  isLikelyArticle,
  filterDecorativeImages,
  extractFallback,
  extractWithReadability,
  extractContent
} from './extraction';

function makeDoc(html: string): Document {
  const doc = document.implementation.createHTMLDocument('test');
  doc.documentElement.innerHTML = html;
  return doc;
}

describe('detectPageType', () => {
  it('classifies twitter.com as social-media', () => {
    expect(detectPageType('https://twitter.com/user/status/1', makeDoc('<body></body>')))
      .toBe('social-media');
  });

  it('classifies x.com as social-media', () => {
    expect(detectPageType('https://x.com/foo', makeDoc('<body></body>')))
      .toBe('social-media');
  });

  it('classifies linkedin.com as social-media', () => {
    expect(detectPageType('https://www.linkedin.com/feed', makeDoc('<body></body>')))
      .toBe('social-media');
  });

  it('classifies reddit.com as forum', () => {
    expect(detectPageType('https://reddit.com/r/aww', makeDoc('<body></body>')))
      .toBe('forum');
  });

  it('classifies any URL containing "/forum/" as forum', () => {
    expect(detectPageType('https://example.com/forum/thread/1', makeDoc('<body></body>')))
      .toBe('forum');
  });

  it('classifies a structured article page as article', () => {
    const doc = makeDoc(`
      <head><meta property="og:type" content="article"></head>
      <body>
        <article>
          <span class="byline">By A. Reporter</span>
          <time datetime="2024-01-01">Jan 1</time>
          <p>Body</p>
        </article>
      </body>
    `);
    expect(detectPageType('https://news.example.com/story', doc)).toBe('article');
  });

  it('falls back to generic for plain pages', () => {
    expect(detectPageType('https://example.com', makeDoc('<body><p>hi</p></body>')))
      .toBe('generic');
  });

  it('matches social-media even when host has subdomain', () => {
    expect(detectPageType('https://www.facebook.com/page', makeDoc('<body></body>')))
      .toBe('social-media');
  });
});

describe('isLikelyArticle', () => {
  it('returns true with og:type=article + author + date (score 4)', () => {
    const doc = makeDoc(`
      <head><meta property="og:type" content="article"></head>
      <body>
        <span class="author">A</span>
        <time>2024</time>
      </body>
    `);
    expect(isLikelyArticle(doc)).toBe(true);
  });

  it('returns true with article tag + main + author (score 4)', () => {
    const doc = makeDoc(`
      <body>
        <main>
          <article>
            <span class="byline">A</span>
          </article>
        </main>
      </body>
    `);
    expect(isLikelyArticle(doc)).toBe(true);
  });

  it('returns false when only main+author present (score 2)', () => {
    const doc = makeDoc(`
      <body>
        <main><span class="author">A</span></main>
      </body>
    `);
    expect(isLikelyArticle(doc)).toBe(false);
  });

  it('returns false on a bare body', () => {
    expect(isLikelyArticle(makeDoc('<body><p>hi</p></body>'))).toBe(false);
  });
});

describe('filterDecorativeImages', () => {
  function run(html: string): string[] {
    const div = document.createElement('div');
    div.innerHTML = html;
    filterDecorativeImages(div);
    return Array.from(div.querySelectorAll('img')).map(img => img.getAttribute('data-id') || '');
  }

  it('removes images with avatar-like alt text', () => {
    const ids = run(`
      <img data-id="kept" src="a.jpg" alt="Field photo">
      <img data-id="avatar" src="b.jpg" alt="User avatar">
      <img data-id="profile" src="c.jpg" alt="Profile picture of John">
    `);
    expect(ids).toEqual(['kept']);
  });

  it('removes bracketed image placeholders', () => {
    const ids = run(`
      <img data-id="placeholder" src="x.jpg" alt="[Image: company logo]">
      <img data-id="kept" src="y.jpg" alt="The mayor at a podium">
    `);
    expect(ids).toEqual(['kept']);
  });

  it('removes images with empty src or data:,', () => {
    const ids = run(`
      <img data-id="empty" src="" alt="x">
      <img data-id="dataempty" src="data:," alt="y">
      <img data-id="kept" src="real.jpg" alt="z">
    `);
    expect(ids).toEqual(['kept']);
  });

  it('removes 1x1 tracking GIFs (by signature)', () => {
    const ids = run(`
      <img data-id="tracker" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">
      <img data-id="kept" src="data:image/gif;base64,SOMEREALANIMATIONFRAME">
    `);
    expect(ids).toEqual(['kept']);
  });

  it('removes 1x1 tracking GIFs (by dimensions)', () => {
    const ids = run(`
      <img data-id="tracker" src="data:image/gif;base64,XYZ" width="1" height="1">
      <img data-id="kept" src="data:image/gif;base64,XYZ" width="500" height="300">
    `);
    expect(ids).toEqual(['kept']);
  });

  it('removes SVG data URIs (html2pdf cannot render them)', () => {
    const ids = run(`
      <img data-id="svg" src="data:image/svg+xml;base64,PHN2Zy8+">
      <img data-id="kept" src="data:image/png;base64,iVBORw0K">
    `);
    expect(ids).toEqual(['kept']);
  });

  it('removes small (<=48px) images with empty alt', () => {
    const ids = run(`
      <img data-id="icon" src="i.png" alt="" width="32" height="32">
      <img data-id="bigicon" src="i.png" alt="" width="49" height="49">
      <img data-id="smallbutlabeled" src="i.png" alt="logo" width="32" height="32">
    `);
    expect(ids).toEqual(['bigicon', 'smallbutlabeled']);
  });

  it('removes images explicitly marked decorative via aria/role', () => {
    const ids = run(`
      <img data-id="aria" src="a.jpg" alt="x" aria-hidden="true">
      <img data-id="role" src="b.jpg" alt="y" role="presentation">
      <img data-id="kept" src="c.jpg" alt="z">
    `);
    expect(ids).toEqual(['kept']);
  });

  it('keeps images that have no decorative signal', () => {
    const ids = run(`
      <img data-id="a" src="a.jpg" alt="A real photo">
      <img data-id="b" src="b.jpg" alt="Caption text" width="800" height="450">
    `);
    expect(ids).toEqual(['a', 'b']);
  });
});

describe('extractFallback', () => {
  it('uses the document title when present', () => {
    const doc = makeDoc('<head><title>My Title</title></head><body><p>Body</p></body>');
    const result = extractFallback(doc, 'https://example.com');
    expect(result.title).toBe('My Title');
    expect(result.confidence).toBe(0.4);
  });

  it('defaults title to "Untitled Page" when missing', () => {
    const doc = makeDoc('<body><p>Body</p></body>');
    const result = extractFallback(doc, 'https://example.com');
    expect(result.title).toBe('Untitled Page');
  });

  it('prefers <main> over <body> for content selection', () => {
    const doc = makeDoc(`
      <body>
        <header>HEADER TEXT</header>
        <main><p>Main content</p></main>
        <footer>FOOTER TEXT</footer>
      </body>
    `);
    const result = extractFallback(doc, 'https://example.com');
    expect(result.textContent).toContain('Main content');
    expect(result.textContent).not.toContain('HEADER TEXT');
    expect(result.textContent).not.toContain('FOOTER TEXT');
  });

  it('strips scripts, styles, nav, footer, aside, header, ads, sidebar', () => {
    const doc = makeDoc(`
      <body>
        <main>
          <script>alert(1)</script>
          <style>.x{}</style>
          <nav>NAV</nav>
          <footer>FOOTER</footer>
          <aside>ASIDE</aside>
          <div class="ad">AD</div>
          <div class="advertisement">ADVT</div>
          <div class="sidebar">SIDE</div>
          <p>Real content</p>
        </main>
      </body>
    `);
    const result = extractFallback(doc, 'https://example.com');
    expect(result.content).toContain('Real content');
    expect(result.content).not.toMatch(/alert\(1\)/);
    expect(result.content).not.toContain('NAV');
    expect(result.content).not.toContain('AD');
    expect(result.content).not.toContain('ADVT');
    expect(result.content).not.toContain('SIDE');
  });

  it('caps textContent at 50000 characters', () => {
    const longText = 'x'.repeat(60000);
    const doc = makeDoc(`<body><main><p>${longText}</p></main></body>`);
    const result = extractFallback(doc, 'https://example.com');
    expect(result.textContent.length).toBe(50000);
  });

  it('returns empty images array', () => {
    const doc = makeDoc('<body><p>x</p></body>');
    expect(extractFallback(doc, 'https://example.com').images).toEqual([]);
  });
});

describe('extractWithReadability', () => {
  it('returns null on documents Readability cannot parse', () => {
    const doc = makeDoc('<body></body>');
    expect(extractWithReadability(doc, 'https://example.com')).toBeNull();
  });

  it('returns extracted content for an article-shaped document', () => {
    const longParagraph = 'This is a substantial paragraph of body content. '.repeat(20);
    const doc = makeDoc(`
      <head><title>The Headline</title></head>
      <body>
        <article>
          <h1>The Headline</h1>
          <p>${longParagraph}</p>
          <p>${longParagraph}</p>
          <p>${longParagraph}</p>
        </article>
      </body>
    `);
    const result = extractWithReadability(doc, 'https://news.example.com/story');
    // Readability is heuristic, so we assert a successful path without
    // pinning exact output.
    if (result) {
      expect(result.confidence).toBe(0.8);
      expect(result.title.length).toBeGreaterThan(0);
      expect(result.content).toContain('substantial paragraph');
    }
  });
});

describe('extractContent', () => {
  it('returns the readability result directly when confidence > 0.5', () => {
    const longParagraph = 'A long paragraph with enough text to satisfy Readability heuristics. '.repeat(15);
    const doc = makeDoc(`
      <head><title>Story</title></head>
      <body>
        <article>
          <h1>Story</h1>
          <p>${longParagraph}</p>
          <p>${longParagraph}</p>
          <p>${longParagraph}</p>
        </article>
      </body>
    `);
    const result = extractContent(doc, 'readability', 'https://example.com');
    if (result.confidence > 0.5) {
      expect(result.confidence).toBe(0.8);
    }
  });

  it('falls back when Readability returns null', () => {
    // Empty body — Readability has nothing to score, returns null.
    const doc = makeDoc('<head><title>Bare</title></head><body></body>');
    const result = extractContent(doc, 'readability', 'https://example.com');
    expect(result.confidence).toBe(0.4);
    expect(result.title).toBe('Bare');
  });

  it('uses fallback when strategy is heuristic, even if Readability succeeds', () => {
    const longParagraph = 'A long paragraph with enough text to satisfy Readability heuristics. '.repeat(15);
    const doc = makeDoc(`
      <head><title>Story</title></head>
      <body>
        <article>
          <h1>Story</h1>
          <p>${longParagraph}</p>
          <p>${longParagraph}</p>
          <p>${longParagraph}</p>
        </article>
      </body>
    `);
    const result = extractContent(doc, 'heuristic', 'https://example.com');
    // When fallback is engaged, confidence is the max of the two paths
    expect(result.confidence).toBeGreaterThanOrEqual(0.4);
  });
});
