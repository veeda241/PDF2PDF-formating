#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════
 *   PDF → Beautiful PDF Converter
 *   Parses a PDF using pdf2json, generates a richly styled
 *   HTML document, then converts it to a professional PDF.
 *
 *   Usage:  node pdf_to_pdf.mjs  <input.pdf>  [output.pdf]
 * ═══════════════════════════════════════════════════════════════
 */

import PDFParser from "./dist/pdfparser.js";
import puppeteer from "puppeteer";
import fs from "fs";
import path from "path";

// ── Arg handling ──
const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("Usage:  node pdf_to_pdf.mjs <input.pdf> [output.pdf]");
  process.exit(1);
}
const pdfPath = args[0];
if (!fs.existsSync(pdfPath)) {
  console.error(`❌ File not found: ${pdfPath}`);
  process.exit(1);
}
const pdfName = path.basename(pdfPath, path.extname(pdfPath));
const outputPath = args[1] || path.join(path.dirname(pdfPath), `${pdfName}_formatted.pdf`);

// ═════════════════════════════════════════════════════════════
//  STEP 1 : Parse the PDF
// ═════════════════════════════════════════════════════════════
console.log(`📄 Parsing PDF: ${pdfPath}`);

const pdfData = await new Promise((resolve, reject) => {
  const parser = new PDFParser(null, true);
  parser.on("pdfParser_dataReady", (data) => resolve(data));
  parser.on("pdfParser_dataError", (err) => reject(err));
  parser.loadPDF(pdfPath);
});

console.log(`✅ Parsed ${pdfData.Pages.length} pages, extracting content...`);

// ═════════════════════════════════════════════════════════════
//  STEP 2 : Extract text with font info
// ═════════════════════════════════════════════════════════════

function decodeText(t) {
  try { return decodeURIComponent(t); } catch { return t; }
}

function classifyRun(textObj) {
  const r = textObj.R[0];
  const text = decodeText(r.T);
  const ts = r.TS || [0, 12, 0, 0];
  return {
    text,
    fontSize: ts[1],
    isBold: ts[2] === 1,
    isItalic: ts[3] === 1,
    color: textObj.oc || null,
    x: textObj.x,
    y: textObj.y,
    w: textObj.w,
  };
}

function groupIntoLines(texts, threshold = 0.4) {
  const runs = texts.map(classifyRun).filter(r => r.text.trim());
  runs.sort((a, b) => a.y - b.y || a.x - b.x);
  const lines = [];
  let currentLine = null;
  for (const r of runs) {
    if (!currentLine || Math.abs(r.y - currentLine.y) > threshold) {
      currentLine = { y: r.y, runs: [r] };
      lines.push(currentLine);
    } else {
      currentLine.runs.push(r);
    }
  }
  return lines;
}

function isHeading(line) {
  const maxFS = Math.max(...line.runs.map(r => r.fontSize));
  const allBold = line.runs.every(r => r.isBold);
  if (maxFS >= 16 && allBold) return 1;
  if (maxFS >= 14 && allBold) return 2;
  if (allBold && line.runs.map(r => r.text).join("").trim().length < 80) return 3;
  return 0;
}

function detectTableBlock(lines, startIdx) {
  if (startIdx >= lines.length) return null;
  const colThreshold = 0.8;
  const candidateLines = [];
  for (let i = startIdx; i < lines.length; i++) {
    if (lines[i].runs.length >= 2) candidateLines.push(lines[i]);
    else break;
  }
  if (candidateLines.length < 2) return null;
  const firstXs = candidateLines[0].runs.map(r => r.x);
  let aligned = 0;
  for (let i = 1; i < candidateLines.length; i++) {
    const xs = candidateLines[i].runs.map(r => r.x);
    let matched = 0;
    for (const fx of firstXs) {
      if (xs.some(x => Math.abs(x - fx) < colThreshold)) matched++;
    }
    if (matched >= Math.min(2, firstXs.length)) aligned++;
  }
  if (aligned >= Math.min(2, candidateLines.length - 1)) {
    return { lines: candidateLines, colCount: firstXs.length };
  }
  return null;
}

function esc(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ═════════════════════════════════════════════════════════════
//  STEP 3 : Build rich HTML
// ═════════════════════════════════════════════════════════════

function buildTableHTML(tableLines) {
  const allX = [];
  for (const ln of tableLines) for (const r of ln.runs) allX.push(r.x);
  allX.sort((a, b) => a - b);
  const cols = [allX[0]];
  for (let i = 1; i < allX.length; i++) {
    if (allX[i] - cols[cols.length - 1] > 2.0) cols.push(allX[i]);
  }
  function getCol(x) {
    let best = 0, bestDist = Math.abs(x - cols[0]);
    for (let i = 1; i < cols.length; i++) {
      const d = Math.abs(x - cols[i]);
      if (d < bestDist) { best = i; bestDist = d; }
    }
    return best;
  }

  let html = '<table>';
  tableLines.forEach((ln, ri) => {
    const cellTexts = new Array(cols.length).fill("");
    const cellBold = new Array(cols.length).fill(false);
    for (const r of ln.runs) {
      const ci = getCol(r.x);
      cellTexts[ci] += (cellTexts[ci] ? " " : "") + r.text;
      if (r.isBold) cellBold[ci] = true;
    }
    const firstAllBold = tableLines[0].runs.every(r => r.isBold);
    const isHeader = ri === 0 && firstAllBold;
    const tag = isHeader ? "th" : "td";
    const rowClass = isHeader ? ' class="tbl-header"' : (ri % 2 === 0 ? '' : ' class="tbl-alt"');
    html += `<tr${rowClass}>`;
    for (let ci = 0; ci < cols.length; ci++) {
      const val = esc(cellTexts[ci].trim() || " ");
      const bold = cellBold[ci] && !isHeader ? `<strong>${val}</strong>` : val;
      html += `<${tag}>${bold}</${tag}>`;
    }
    html += '</tr>';
  });
  html += '</table>';
  return html;
}

function buildLineHTML(line) {
  return line.runs.map(r => {
    let t = esc(r.text);
    if (r.isBold) t = `<strong>${t}</strong>`;
    if (r.isItalic) t = `<em>${t}</em>`;
    if (r.color) t = `<span style="color:${r.color}">${t}</span>`;
    return t;
  }).join(" ");
}

let html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
  @page {
    size: Letter;
    margin: 0.6in 0.7in;
    @bottom-center {
      content: "Page " counter(page) " of " counter(pages);
      font-size: 9px;
      color: #888;
      font-family: 'Segoe UI', Arial, sans-serif;
    }
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    color: #1a1a2e;
    font-size: 11px;
    line-height: 1.55;
    background: #fff;
  }

  /* ── Title Banner ── */
  .title-banner {
    background: linear-gradient(135deg, #2B3990 0%, #5166EB 100%);
    color: #fff;
    padding: 28px 32px;
    border-radius: 10px;
    margin-bottom: 24px;
    text-align: center;
    page-break-inside: avoid;
  }
  .title-banner h1 {
    font-size: 26px;
    letter-spacing: 2px;
    margin-bottom: 6px;
    text-transform: uppercase;
  }
  .title-banner .subtitle {
    font-size: 12px;
    opacity: 0.85;
    font-style: italic;
  }
  .title-banner .meta {
    font-size: 10px;
    opacity: 0.7;
    margin-top: 8px;
  }

  /* ── Section headings ── */
  h2 {
    font-size: 18px;
    color: #2B3990;
    margin: 28px 0 10px;
    padding-bottom: 6px;
    border-bottom: 3px solid #2B3990;
    letter-spacing: 0.5px;
  }
  h3 {
    font-size: 14px;
    color: #5166EB;
    margin: 18px 0 8px;
    padding-left: 8px;
    border-left: 4px solid #5166EB;
  }
  h4 {
    font-size: 12px;
    color: #2B3990;
    margin: 14px 0 6px;
    font-weight: 700;
  }

  /* ── Page indicator ── */
  .page-indicator {
    background: #f0f1fa;
    border-left: 5px solid #2B3990;
    padding: 6px 14px;
    font-size: 10px;
    color: #5166EB;
    font-weight: 700;
    margin: 20px 0 14px;
    letter-spacing: 1px;
    text-transform: uppercase;
  }

  /* ── Paragraphs ── */
  p { margin: 4px 0 6px; }
  .indent-1 { margin-left: 20px; }
  .indent-2 { margin-left: 40px; }

  /* ── Bullet points ── */
  .bullet {
    margin: 3px 0 3px 24px;
    padding-left: 12px;
    position: relative;
  }
  .bullet::before {
    content: "●";
    color: #5166EB;
    font-size: 7px;
    position: absolute;
    left: -2px;
    top: 3px;
  }

  /* ── Tables ── */
  table {
    width: 100%;
    border-collapse: collapse;
    margin: 10px 0 16px;
    font-size: 10px;
    page-break-inside: auto;
  }
  table tr { page-break-inside: avoid; }
  .tbl-header th {
    background: linear-gradient(135deg, #2B3990, #3d4fa8);
    color: #fff;
    padding: 8px 10px;
    text-align: left;
    font-weight: 700;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.3px;
    border: 1px solid #1e2a6e;
  }
  td {
    padding: 6px 10px;
    border: 1px solid #c5c9e8;
    vertical-align: top;
  }
  .tbl-alt td { background: #f4f5fd; }
  tr:hover td { background: #e8eafc; }

  /* ── Interpretation boxes ── */
  .interp-box {
    background: #f0f4ff;
    border-left: 4px solid #5166EB;
    padding: 8px 14px;
    margin: 6px 0 14px;
    font-size: 10px;
    color: #555;
    border-radius: 0 6px 6px 0;
    font-style: italic;
  }

  /* ── Quote box ── */
  .quote-box {
    background: #f8f9fe;
    border-left: 4px solid #2B3990;
    padding: 10px 16px;
    margin: 10px 0;
    font-style: italic;
    color: #555;
    border-radius: 0 8px 8px 0;
  }

  /* ── Action cards ── */
  .action-card {
    border: 1px solid #d0d4ef;
    border-left: 5px solid #5166EB;
    background: #fafaff;
    padding: 10px 14px;
    margin: 8px 0;
    border-radius: 0 8px 8px 0;
    page-break-inside: avoid;
  }
  .action-card h4 { margin: 0 0 4px; color: #2B3990; }

  /* ── Badges ── */
  .badge {
    display: inline-block;
    padding: 1px 8px;
    border-radius: 10px;
    font-size: 9px;
    font-weight: 600;
    vertical-align: middle;
  }
  .badge-normal  { background: #c3e6cb; color: #155724; }
  .badge-caution { background: #ffe8a1; color: #7a6200; }
  .badge-high    { background: #f5c6cb; color: #721c24; }
  .badge-info    { background: #b8daff; color: #004085; }

  /* ── Footer ── */
  .footer-banner {
    background: linear-gradient(135deg, #2B3990 0%, #5166EB 100%);
    color: #fff;
    padding: 18px 24px;
    border-radius: 10px;
    text-align: center;
    margin-top: 30px;
    page-break-inside: avoid;
  }
  .footer-banner p { color: #fff; font-size: 11px; margin: 3px 0; }
  .footer-banner .small { font-size: 9px; opacity: 0.8; margin-top: 8px; }

  /* ── Separator ── */
  .page-sep {
    border: none;
    border-top: 2px solid #2B3990;
    margin: 24px 0;
  }

  /* ── Print-specific ── */
  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style>
</head>
<body>
`;

// ── Title banner ──
html += `
<div class="title-banner">
  <h1>${esc(pdfName.replace(/[_-]/g, " "))}</h1>
  <div class="subtitle">Professionally formatted document</div>
  <div class="meta">Source: ${esc(path.basename(pdfPath))} &nbsp;•&nbsp; ${pdfData.Pages.length} pages &nbsp;•&nbsp; ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}</div>
</div>
`;

// ── Process each page ──
for (let pIdx = 0; pIdx < pdfData.Pages.length; pIdx++) {
  const page = pdfData.Pages[pIdx];
  const lines = groupIntoLines(page.Texts);

  if (pIdx > 0) html += '<hr class="page-sep">';
  html += `<div class="page-indicator">▎ Page ${pIdx + 1} of ${pdfData.Pages.length}</div>\n`;

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const hLevel = isHeading(line);
    const fullText = line.runs.map(r => r.text).join(" ").trim();
    const isBullet = /^[•\-–—►▪■●○◦]/.test(fullText);

    if (hLevel === 1) {
      html += `<h2>${buildLineHTML(line)}</h2>\n`;
      i++; continue;
    }
    if (hLevel === 2) {
      html += `<h3>${buildLineHTML(line)}</h3>\n`;
      i++; continue;
    }
    if (hLevel === 3) {
      html += `<h4>${buildLineHTML(line)}</h4>\n`;
      i++; continue;
    }

    // Table detection
    const tableBlock = detectTableBlock(lines, i);
    if (tableBlock && tableBlock.lines.length >= 3) {
      html += buildTableHTML(tableBlock.lines) + '\n';
      i += tableBlock.lines.length;
      continue;
    }

    // Bullet
    if (isBullet) {
      const cleanText = fullText.replace(/^[•\-–—►▪■●○◦]\s*/, "");
      html += `<div class="bullet">${esc(cleanText)}</div>\n`;
      i++; continue;
    }

    // Quote detection (italic + short + indented)
    const allItalic = line.runs.every(r => r.isItalic);
    if (allItalic && fullText.length > 20 && fullText.startsWith('"')) {
      let quoteText = fullText;
      // Merge consecutive italic lines
      while (i + 1 < lines.length && lines[i + 1].runs.every(r => r.isItalic)) {
        i++;
        quoteText += " " + lines[i].runs.map(r => r.text).join(" ").trim();
      }
      html += `<div class="quote-box">${esc(quoteText)}</div>\n`;
      i++; continue;
    }

    // Normal paragraph
    const indent = Math.max(0, Math.floor((line.runs[0].x - 1.5) / 5));
    const indentClass = indent > 0 ? ` class="indent-${Math.min(indent, 2)}"` : "";
    html += `<p${indentClass}>${buildLineHTML(line)}</p>\n`;
    i++;
  }
}

// ── Footer banner ──
html += `
<div class="footer-banner">
  <p><strong>Document generated by PDF Reformatter</strong></p>
  <p class="small">Converted from ${esc(path.basename(pdfPath))} on ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}</p>
</div>
</body>
</html>`;

console.log(`📝 Generated HTML (${(html.length / 1024).toFixed(1)} KB)`);

// Save HTML too (useful for debugging)
const htmlPath = outputPath.replace(/\.pdf$/i, ".html");
fs.writeFileSync(htmlPath, html);
console.log(`📄 HTML saved: ${htmlPath}`);

// ═════════════════════════════════════════════════════════════
//  STEP 4 : Convert HTML → PDF with Puppeteer
// ═════════════════════════════════════════════════════════════
console.log(`🖨️  Converting to PDF...`);

const browser = await puppeteer.launch({ headless: true });
const pg = await browser.newPage();
await pg.setContent(html, { waitUntil: "networkidle0" });

// Handle file lock gracefully
let finalPath = outputPath;
for (let attempt = 0; attempt < 10; attempt++) {
  try {
    await pg.pdf({
      path: finalPath,
      format: "Letter",
      printBackground: true,
      margin: { top: "0.5in", bottom: "0.6in", left: "0.6in", right: "0.6in" },
      displayHeaderFooter: true,
      headerTemplate: `<div style="width:100%;font-size:8px;color:#888;padding:0 0.6in;font-family:Calibri,Arial,sans-serif;text-align:right;"><span style="color:#2B3990;font-weight:bold;">${esc(pdfName.replace(/[_-]/g, " "))}</span> &nbsp;|&nbsp; Formatted Report</div>`,
      footerTemplate: `<div style="width:100%;font-size:8px;color:#888;padding:0 0.6in;font-family:Calibri,Arial,sans-serif;text-align:center;">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>`,
    });
    break;
  } catch (err) {
    if (err.code === "EBUSY" || err.message.includes("EBUSY")) {
      const ext = path.extname(outputPath);
      const base = outputPath.slice(0, -ext.length);
      finalPath = `${base}_${attempt + 2}${ext}`;
      console.log(`⚠️  File locked, saving as: ${path.basename(finalPath)}`);
    } else throw err;
  }
}

await browser.close();

console.log(`\n✅ PDF generated successfully!`);
console.log(`📁 Output: ${finalPath}`);
console.log(`📊 ${pdfData.Pages.length} source pages processed`);
