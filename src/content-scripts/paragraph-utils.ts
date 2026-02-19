// Threshold for detecting fragmented paragraphs (chars)
export const SHORT_PARAGRAPH_THRESHOLD = 80;

// Collapse runs of consecutive short <p> elements into single paragraphs.
export function collapseFragmentedParagraphs(
  container: HTMLElement,
  threshold = SHORT_PARAGRAPH_THRESHOLD
): void {
  const children = Array.from(container.children);
  let i = 0;

  while (i < children.length) {
    const child = children[i];

    if (child.tagName !== 'P') {
      i++;
      continue;
    }

    const childTextLength = (child.textContent || '').trim().length;
    if (childTextLength > threshold) {
      i++;
      continue;
    }

    const run: Element[] = [child];
    let j = i + 1;
    while (j < children.length) {
      const next = children[j];
      if (next.tagName !== 'P') break;
      if ((next.textContent || '').trim().length > threshold) break;
      run.push(next);
      j++;
    }

    if (run.length >= 3) {
      const target = run[0];
      const ownerDoc = target.ownerDocument;
      for (let k = 1; k < run.length; k++) {
        target.appendChild(ownerDoc.createTextNode(' '));
        while (run[k].firstChild) {
          target.appendChild(run[k].firstChild);
        }
        run[k].remove();
      }
      i = i + 1;
    } else {
      i = j;
    }
  }
}
