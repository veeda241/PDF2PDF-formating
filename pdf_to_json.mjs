// =============================================================
//  PDF → JSON Converter
//  Usage: node pdf_to_json.mjs <input.pdf> [output.json]
// =============================================================

import fs from 'fs';
import path from 'path';
import PDFParser from './dist/pdfparser.js';

const inputPdf = process.argv[2];
const outputJson = process.argv[3];

if (!inputPdf) {
  console.log(`
  PDF to JSON Converter
  ─────────────────────
  Usage:   node pdf_to_json.mjs <input.pdf> [output.json]

  Examples:
    node pdf_to_json.mjs document.pdf
    node pdf_to_json.mjs document.pdf output/result.json
    node pdf_to_json.mjs "C:\\path\\to\\file.pdf"

  If output path is omitted, JSON is saved next to the input PDF.
  `);
  process.exit(1);
}

if (!fs.existsSync(inputPdf)) {
  console.error(`Error: File not found → ${inputPdf}`);
  process.exit(1);
}

// Determine output path
const resolvedOutput = outputJson
  || path.join(path.dirname(inputPdf), path.basename(inputPdf, '.pdf') + '.json');

// Ensure output directory exists
const outDir = path.dirname(resolvedOutput);
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

console.log(`\n  Parsing: ${path.basename(inputPdf)}`);

const pdfParser = new PDFParser(null, true);

pdfParser.on('pdfParser_dataError', errData => {
  console.error(`  Error: ${errData.parserError}`);
  process.exit(1);
});

pdfParser.on('pdfParser_dataReady', pdfData => {
  const jsonStr = JSON.stringify(pdfData, null, 2);
  fs.writeFileSync(resolvedOutput, jsonStr, 'utf8');

  const pages = pdfData.Pages || [];
  let totalTexts = 0, totalFills = 0, totalImages = 0;
  pages.forEach(p => {
    totalTexts += (p.Texts || []).length;
    totalFills += (p.Fills || []).length;
    totalImages += (p.Images || []).length;
  });

  console.log(`  Output:  ${resolvedOutput}`);
  console.log(`  ─────────────────────────────`);
  console.log(`  Pages:   ${pages.length}`);
  console.log(`  Texts:   ${totalTexts}`);
  console.log(`  Fills:   ${totalFills}`);
  console.log(`  Images:  ${totalImages}`);
  console.log(`  Size:    ${(jsonStr.length / 1024).toFixed(1)} KB`);
  console.log(`  Done ✓\n`);
});

pdfParser.loadPDF(inputPdf);
