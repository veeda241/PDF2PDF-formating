#!/usr/bin/env node
// =============================================================
//  JSON → PDF Converter
//  Takes a pdf2json JSON file and recreates the PDF exactly
//  Usage: node json_to_pdf.mjs <input.json> [output.pdf]
// =============================================================

import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';

// ── Args ──
const args = process.argv.slice(2);
if (args.length === 0) {
  console.log(`
  JSON to PDF Converter
  ─────────────────────
  Usage:   node json_to_pdf.mjs <input.json> [output.pdf]

  Examples:
    node json_to_pdf.mjs document.json
    node json_to_pdf.mjs document.json output/result.pdf
    node json_to_pdf.mjs "C:\\path\\to\\file.json"

  The input must be a pdf2json-format JSON file.
  If output path is omitted, PDF is saved next to the input JSON.
  `);
  process.exit(1);
}

const jsonPath = args[0];
if (!fs.existsSync(jsonPath)) {
  console.error(`Error: File not found → ${jsonPath}`);
  process.exit(1);
}

const jsonName = path.basename(jsonPath, path.extname(jsonPath));
const outputPath = args[1] || path.join(path.dirname(jsonPath), `${jsonName}.pdf`);

// Ensure output directory exists
const outDir = path.dirname(outputPath);
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

// ── Load JSON ──
console.log(`\n  Loading: ${path.basename(jsonPath)}`);
let pdfData;
try {
  pdfData = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
} catch (err) {
  console.error(`  Error: Invalid JSON → ${err.message}`);
  process.exit(1);
}

if (!pdfData.Pages || !Array.isArray(pdfData.Pages)) {
  console.error('  Error: JSON does not contain a valid Pages array (not a pdf2json format)');
  process.exit(1);
}

console.log(`  Pages:   ${pdfData.Pages.length}`);

// ── Color dictionary (matches pdf2json's kColors) ──
const kColors = [
  '#000000','#ffffff','#4c4c4c','#808080','#999999','#c0c0c0','#cccccc',
  '#e5e5e5','#f2f2f2','#008000','#00ff00','#bfffa0','#ffd629','#ff99cc',
  '#004080','#9fc0e1','#5580ff','#a9c9fa','#ff0080','#800080','#ffbfff',
  '#e45b21','#ffbfaa','#008080','#ff0000','#fdc59f','#808000','#bfbf00',
  '#824100','#007256','#008000','#000080','#008080','#800080','#ff0000',
  '#0000ff','#008000'
];

// ── Font face mapping ──
const kFontFaces = [
  "Arial, Helvetica, sans-serif",
  "Arial Narrow, Arial, Helvetica, sans-serif",
  "Symbol, serif",
  "Courier New, Courier, monospace",
  "Courier New, Courier, monospace",
  "Courier New, Courier, monospace",
];

// ── Constants ──
const GRID_TO_PX = 24;
const GRID_PER_INCH = 4;

// ── Helper functions ──
function getColor(obj) {
  if (obj.oc) return obj.oc;
  if (obj.clr !== undefined && obj.clr >= 0 && obj.clr < kColors.length) return kColors[obj.clr];
  return '#000000';
}

function esc(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function decodeText(t) {
  try { return decodeURIComponent(t); } catch { return t; }
}

// ═══════════════════════════════════════════════════════════════
//  Build HTML — pixel-perfect recreation from JSON
// ═══════════════════════════════════════════════════════════════
console.log(`  Building HTML...`);

let html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { margin: 0; padding: 0; background: #fff; }
  .page {
    position: relative;
    overflow: hidden;
    background: #fff;
    page-break-after: always;
    page-break-inside: avoid;
  }
  .page:last-child { page-break-after: avoid; }
  .fill { position: absolute; pointer-events: none; }
  .txt { position: absolute; white-space: nowrap; pointer-events: none; line-height: 1.2; }
  .hline, .vline { position: absolute; pointer-events: none; }
  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style>
</head>
<body>
`;

for (let pIdx = 0; pIdx < pdfData.Pages.length; pIdx++) {
  const page = pdfData.Pages[pIdx];
  const pw = page.Width * GRID_TO_PX;
  const ph = page.Height * GRID_TO_PX;

  html += `<div class="page" style="width:${pw}px;height:${ph}px;">\n`;

  // ── Fills (background rectangles) ──
  if (page.Fills) {
    for (const f of page.Fills) {
      const fx = f.x * GRID_TO_PX;
      const fy = f.y * GRID_TO_PX;
      const fw = f.w * GRID_TO_PX;
      const fh = f.h * GRID_TO_PX;
      if (fw <= 0 || fh <= 0) continue;
      html += `<div class="fill" style="left:${fx}px;top:${fy}px;width:${fw}px;height:${fh}px;background:${getColor(f)};"></div>\n`;
    }
  }

  // ── Horizontal Lines ──
  if (page.HLines) {
    for (const ln of page.HLines) {
      const lx = ln.x * GRID_TO_PX;
      const ly = ln.y * GRID_TO_PX;
      const lw = ln.w * GRID_TO_PX;
      const lh = Math.max(ln.l || 1, 1);
      html += `<div class="hline" style="left:${lx}px;top:${ly}px;width:${lw}px;height:${lh}px;background:${getColor(ln)};"></div>\n`;
    }
  }

  // ── Vertical Lines ──
  if (page.VLines) {
    for (const ln of page.VLines) {
      const lx = ln.x * GRID_TO_PX;
      const ly = ln.y * GRID_TO_PX;
      const lw = Math.max(ln.l || 1, 1);
      const lh = ln.h * GRID_TO_PX;
      html += `<div class="vline" style="left:${lx}px;top:${ly}px;width:${lw}px;height:${lh}px;background:${getColor(ln)};"></div>\n`;
    }
  }

  // ── Texts ──
  if (page.Texts) {
    for (const t of page.Texts) {
      if (!t.R || !t.R[0]) continue;
      const r = t.R[0];
      const text = decodeText(r.T);
      if (!text.trim()) continue;

      const tx = t.x * GRID_TO_PX;
      const ty = t.y * GRID_TO_PX;
      const tc = getColor(t);

      const ts = r.TS || [0, 12, 0, 0];
      const fontFamily = kFontFaces[ts[0] || 0] || kFontFaces[0];
      const fontSize = ts[1] || 12;
      const fontWeight = ts[2] === 1 ? 'bold' : 'normal';
      const fontStyle = ts[3] === 1 ? 'italic' : 'normal';

      let transform = '';
      if (r.RA) transform = `transform:rotate(${r.RA}deg);transform-origin:0 0;`;

      html += `<div class="txt" style="left:${tx}px;top:${ty}px;font-family:${fontFamily};font-size:${fontSize}pt;font-weight:${fontWeight};font-style:${fontStyle};color:${tc};${transform}">${esc(text)}</div>\n`;
    }
  }

  html += `</div>\n`;
}

html += `</body>\n</html>`;

// ═══════════════════════════════════════════════════════════════
//  Convert HTML → PDF with Puppeteer
// ═══════════════════════════════════════════════════════════════
console.log(`  Rendering PDF...`);

const browser = await puppeteer.launch({ headless: true });
const pg = await browser.newPage();
await pg.setContent(html, { waitUntil: 'networkidle0' });

const paperWidthIn = pdfData.Pages[0].Width / GRID_PER_INCH;
const paperHeightIn = pdfData.Pages[0].Height / GRID_PER_INCH;

// Handle file lock gracefully
let finalPath = outputPath;
for (let attempt = 0; attempt < 10; attempt++) {
  try {
    await pg.pdf({
      path: finalPath,
      width: `${paperWidthIn}in`,
      height: `${paperHeightIn}in`,
      printBackground: true,
      margin: { top: '0', bottom: '0', left: '0', right: '0' },
    });
    break;
  } catch (err) {
    if (err.code === 'EBUSY' || (err.message && err.message.includes('EBUSY'))) {
      const ext = path.extname(outputPath);
      const base = outputPath.slice(0, -ext.length);
      finalPath = `${base}_${attempt + 2}${ext}`;
      console.log(`  File locked, saving as: ${path.basename(finalPath)}`);
    } else throw err;
  }
}

await browser.close();

const stats = fs.statSync(finalPath);
console.log(`  ─────────────────────────────`);
console.log(`  Output:  ${finalPath}`);
console.log(`  Size:    ${(stats.size / 1024).toFixed(1)} KB`);
console.log(`  Pages:   ${pdfData.Pages.length}`);
console.log(`  Done ✓\n`);
