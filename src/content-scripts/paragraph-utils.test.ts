import { describe, expect, it } from 'vitest';
import { collapseFragmentedParagraphs } from './paragraph-utils';

function normalizeWhitespace(text: string | null): string {
  return (text || '').replace(/\s+/g, ' ').trim();
}

function makeContainer(html: string): HTMLDivElement {
  const container = document.createElement('div');
  container.innerHTML = html;
  return container;
}

describe('collapseFragmentedParagraphs', () => {
  it('merges 3+ short consecutive paragraphs', () => {
    const container = makeContainer('<p>Alpha</p><p>Beta</p><p>Gamma</p>');

    collapseFragmentedParagraphs(container);

    const paragraphs = container.querySelectorAll('p');
    expect(paragraphs).toHaveLength(1);
    expect(normalizeWhitespace(paragraphs[0].textContent)).toBe('Alpha Beta Gamma');
  });

  it('does not skip a short run after a long paragraph (regression)', () => {
    const longText = 'L'.repeat(120);
    const container = makeContainer(`<p>${longText}</p><p>A</p><p>B</p><p>C</p>`);

    collapseFragmentedParagraphs(container);

    const paragraphs = container.querySelectorAll('p');
    expect(paragraphs).toHaveLength(2);
    expect(normalizeWhitespace(paragraphs[0].textContent)).toBe(longText);
    expect(normalizeWhitespace(paragraphs[1].textContent)).toBe('A B C');
  });

  it('does not merge when fewer than 3 short paragraphs are consecutive', () => {
    const container = makeContainer('<p>Alpha</p><p>Beta</p>');

    collapseFragmentedParagraphs(container);

    const paragraphs = container.querySelectorAll('p');
    expect(paragraphs).toHaveLength(2);
    expect(normalizeWhitespace(paragraphs[0].textContent)).toBe('Alpha');
    expect(normalizeWhitespace(paragraphs[1].textContent)).toBe('Beta');
  });
});
