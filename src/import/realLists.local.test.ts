/**
 * LOCAL-ONLY tests against the real army lists in reference/ (never committed).
 * Skipped automatically when reference/ is missing (e.g. in CI).
 * Snapshots are written under reference/snapshots/, which is git-ignored.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { linesFromItems, type PdfTextItem } from './pdfLines';
import { allEntries, parseArmyList } from './parseList';

const REF = path.resolve(__dirname, '../../reference');
const pdfs = fs.existsSync(REF) ? fs.readdirSync(REF).filter((f) => /\.pdf$/i.test(f) && !/RULES|SCENARIO|PACK|TLAOK-2026|UPDATE/i.test(f)) : [];
const txts = fs.existsSync(REF) ? fs.readdirSync(REF).filter((f) => /\.txt$/i.test(f)) : [];

async function pdfText(file: string): Promise<string> {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await getDocument({ data: new Uint8Array(fs.readFileSync(file)) }).promise;
  const lines: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const tc = await (await doc.getPage(p)).getTextContent();
    lines.push(...linesFromItems(tc.items as PdfTextItem[]));
  }
  return lines.join('\n');
}

describe.skipIf(pdfs.length + txts.length === 0)('real army lists in reference/ (local only)', () => {
  for (const f of [...pdfs, ...txts]) {
    it(`parses ${f} without warnings`, async () => {
      const full = path.join(REF, f);
      const text = /\.pdf$/i.test(f) ? await pdfText(full) : fs.readFileSync(full, 'utf8');
      const list = parseArmyList(text);
      const entries = allEntries(list);
      const warnings = [...list.warnings, ...entries.flatMap((e) => e.warnings.map((w) => `${e.name}: ${w}`))];
      expect(warnings).toEqual([]);
      expect(list.warbands.length).toBeGreaterThan(0);
      // Every referenced special rule should have a glossary entry.
      const missing = entries.flatMap((e) => e.specialRules.map((r) => r.name)).filter((n) => !(n in list.glossary));
      expect([...new Set(missing)]).toEqual([]);
      await expect(JSON.stringify(list, null, 2)).toMatchFileSnapshot(path.join(REF, 'snapshots', `${f}.json`));
    });
  }
});
