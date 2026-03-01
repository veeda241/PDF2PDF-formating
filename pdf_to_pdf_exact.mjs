#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════
 *   PDF → PDF  EXACT FORMAT REPRODUCER
 *   Parses a PDF with pdf2json and reproduces it pixel-perfectly
 *   preserving all positions, fonts, colors, fills, and layout.
 *
 *   Usage:  node pdf_to_pdf_exact.mjs  <input.pdf>  [output.pdf]
 * ═══════════════════════════════════════════════════════════════
 */

import PDFParser from "./dist/pdfparser.js";
import puppeteer from "puppeteer";
import fs from "fs";
import path from "path";

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
const GRID_TO_PX = 24;  // 1 grid unit = 24 pixels at 96 DPI
const GRID_PER_INCH = 4; // 4 grid units per inch

// ── Arg handling ──
const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("Usage:  node pdf_to_pdf_exact.mjs <input.pdf> [output.pdf]");
  process.exit(1);
}
const pdfPath = args[0];
if (!fs.existsSync(pdfPath)) {
  console.error(`File not found: ${pdfPath}`);
  process.exit(1);
}
const pdfName = path.basename(pdfPath, path.extname(pdfPath));
const outputPath = args[1] || path.join(path.dirname(pdfPath), `${pdfName}_exact.pdf`);

// ═══════════════════════════════════════════════════════════════
//  STEP 1 : Parse the PDF
// ═══════════════════════════════════════════════════════════════
console.log(`Parsing PDF: ${pdfPath}`);

const pdfData = await new Promise((resolve, reject) => {
  const parser = new PDFParser(null, true);
  parser.on("pdfParser_dataReady", (data) => resolve(data));
  parser.on("pdfParser_dataError", (err) => reject(err));
  parser.loadPDF(pdfPath);
});

console.log(`Parsed ${pdfData.Pages.length} pages`);

// ═══════════════════════════════════════════════════════════════
//  STEP 2 : Helper functions
// ═══════════════════════════════════════════════════════════════

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
//  STEP 3 : Build HTML — one page container per PDF page
// ═══════════════════════════════════════════════════════════════

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
  .fill {
    position: absolute;
    pointer-events: none;
  }
  .txt {
    position: absolute;
    white-space: nowrap;
    pointer-events: none;
    line-height: 1.2;
  }
  .hline, .vline {
    position: absolute;
    pointer-events: none;
  }
  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style>
</head>
<body>
`;

// Track all page dimensions for puppeteer (use first page as reference)
const pageWidths = [];
const pageHeights = [];

for (let pIdx = 0; pIdx < pdfData.Pages.length; pIdx++) {
  const page = pdfData.Pages[pIdx];
  const pw = page.Width * GRID_TO_PX;
  const ph = page.Height * GRID_TO_PX;
  pageWidths.push(pw);
  pageHeights.push(ph);

  html += `<div class="page" style="width:${pw}px;height:${ph}px;">\n`;

  // ── Render Fills (background rectangles) ──
  if (page.Fills) {
    for (const f of page.Fills) {
      const fx = f.x * GRID_TO_PX;
      const fy = f.y * GRID_TO_PX;
      const fw = f.w * GRID_TO_PX;
      const fh = f.h * GRID_TO_PX;
      const fc = getColor(f);
      // Skip fills that are invisible (white on white background, or zero dimension)
      if (fw <= 0 || fh <= 0) continue;
      html += `<div class="fill" style="left:${fx}px;top:${fy}px;width:${fw}px;height:${fh}px;background:${fc};"></div>\n`;
    }
  }

  // ── Render HLines ──
  if (page.HLines) {
    for (const ln of page.HLines) {
      const lx = ln.x * GRID_TO_PX;
      const ly = ln.y * GRID_TO_PX;
      const lw = ln.w * GRID_TO_PX;
      const lh = Math.max(ln.l || 1, 1);
      const lc = getColor(ln);
      html += `<div class="hline" style="left:${lx}px;top:${ly}px;width:${lw}px;height:${lh}px;background:${lc};"></div>\n`;
    }
  }

  // ── Render VLines ──
  if (page.VLines) {
    for (const ln of page.VLines) {
      const lx = ln.x * GRID_TO_PX;
      const ly = ln.y * GRID_TO_PX;
      const lw = Math.max(ln.l || 1, 1);
      const lh = ln.h * GRID_TO_PX;
      const lc = getColor(ln);
      html += `<div class="vline" style="left:${lx}px;top:${ly}px;width:${lw}px;height:${lh}px;background:${lc};"></div>\n`;
    }
  }

  // ── Render Texts ──
  if (page.Texts) {
    for (const t of page.Texts) {
      if (!t.R || !t.R[0]) continue;
      const r = t.R[0];
      const text = decodeText(r.T);
      if (!text.trim()) continue;

      const tx = t.x * GRID_TO_PX;
      const ty = t.y * GRID_TO_PX;
      const tc = getColor(t);

      // TS = [fontFaceIdx, fontSize, bold(0/1), italic(0/1)]
      const ts = r.TS || [0, 12, 0, 0];
      const fontFaceIdx = ts[0] || 0;
      const fontSize = ts[1] || 12;
      const isBold = ts[2] === 1;
      const isItalic = ts[3] === 1;

      const fontFamily = kFontFaces[fontFaceIdx] || kFontFaces[0];
      const fontWeight = isBold ? 'bold' : 'normal';
      const fontStyle = isItalic ? 'italic' : 'normal';

      // Handle text rotation if present
      let transform = '';
      if (r.RA) {
        transform = `transform:rotate(${r.RA}deg);transform-origin:0 0;`;
      }

      html += `<div class="txt" style="left:${tx}px;top:${ty}px;font-family:${fontFamily};font-size:${fontSize}pt;font-weight:${fontWeight};font-style:${fontStyle};color:${tc};${transform}">${esc(text)}</div>\n`;
    }
  }

  html += `</div>\n`;
}

html += `</body>\n</html>`;

console.log(`Generated HTML (${(html.length / 1024).toFixed(1)} KB)`);

// Save HTML for debugging
const htmlPath = outputPath.replace(/\.pdf$/i, ".html");
fs.writeFileSync(htmlPath, html);
console.log(`HTML saved: ${htmlPath}`);

// ═══════════════════════════════════════════════════════════════
//  STEP 4 : Convert HTML → PDF with Puppeteer (exact dimensions)
// ═══════════════════════════════════════════════════════════════
console.log(`Converting to PDF...`);

const browser = await puppeteer.launch({ headless: true });
const pg = await browser.newPage();
await pg.setContent(html, { waitUntil: "networkidle0" });

// Use first page dimensions as the paper size
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
    if (err.code === "EBUSY" || (err.message && err.message.includes("EBUSY"))) {
      const ext = path.extname(outputPath);
      const base = outputPath.slice(0, -ext.length);
      finalPath = `${base}_${attempt + 2}${ext}`;
      console.log(`File locked, saving as: ${path.basename(finalPath)}`);
    } else throw err;
  }
}

await browser.close();

const stats = fs.statSync(finalPath);
console.log(`\nPDF generated: ${finalPath}`);
console.log(`Size: ${(stats.size / 1024).toFixed(1)} KB | ${pdfData.Pages.length} pages`);
