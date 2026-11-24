import { linesFromItems, type PdfTextItem } from './pdfLines';

/** Browser-side: extracts the text of an Army Builder PDF, one line per PDF line. */
export async function pdfToText(data: ArrayBuffer): Promise<string> {
  const pdfjs = await import('pdfjs-dist');
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(data) }).promise;
  const lines: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    lines.push(...linesFromItems(tc.items.filter((i): i is PdfTextItem & typeof i => 'str' in i)));
  }
  await doc.cleanup();
  return lines.join('\n');
}
