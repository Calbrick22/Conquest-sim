/**
 * Rebuilds text lines from pdf.js text items. Pure, so it is testable in Node.
 * Items arrive in content-stream order; hasEOL marks line ends. A vertical jump
 * of more than LINE_GAP points also starts a new line (labels such as
 * "Special Rules" sit beside wrapped text at a slightly different height).
 */
export interface PdfTextItem {
  str: string;
  hasEOL?: boolean;
  transform: number[];
}

const LINE_GAP = 10;

export function linesFromItems(items: readonly PdfTextItem[]): string[] {
  const out: string[] = [];
  let cur = '';
  let lastY: number | null = null;
  const push = () => {
    if (cur.trim()) out.push(cur.replace(/\s+/g, ' ').trim());
    cur = '';
  };
  for (const it of items) {
    const y = it.transform[5] ?? 0;
    if (it.str !== '' && lastY !== null && Math.abs(y - lastY) > LINE_GAP && cur.trim()) push();
    cur += it.str;
    if (it.str !== '') lastY = y;
    if (it.hasEOL) push();
  }
  push();
  return out;
}
