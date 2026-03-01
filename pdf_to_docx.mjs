#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════
 *   PDF → DOCX Converter
 *   Parses a PDF file using pdf2json, then generates a
 *   richly formatted Microsoft Word (.docx) document.
 *
 *   Usage:  node pdf_to_docx.mjs  <path-to-pdf>  [output.docx]
 * ═══════════════════════════════════════════════════════════════
 */

import PDFParser from "./dist/pdfparser.js";
import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  WidthType, AlignmentType, HeadingLevel, BorderStyle, ShadingType,
  Header, Footer, PageNumber, convertInchesToTwip,
} from "docx";
import fs from "fs";
import path from "path";

// ── Arg handling ──
const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("Usage:  node pdf_to_docx.mjs <path-to-pdf> [output.docx]");
  process.exit(1);
}
const pdfPath = args[0];
if (!fs.existsSync(pdfPath)) {
  console.error(`❌ File not found: ${pdfPath}`);
  process.exit(1);
}
const pdfName = path.basename(pdfPath, path.extname(pdfPath));
const outputPath = args[1] || path.join(path.dirname(pdfPath), `${pdfName}.docx`);

// ── Color palette ──
const C = {
  PRIMARY:   "2B3990",  // deep navy
  ACCENT:    "5166EB",  // bright blue
  DARK:      "1A1A2E",  // almost black
  WHITE:     "FFFFFF",
  LIGHT_BG:  "EEF0FB",
  HEADER_BG: "2B3990",
  ROW_ALT:   "F4F5FD",
  BORDER:    "8B92C5",
  GRAY:      "555555",
  LIGHT_GRAY:"999999",
  GREEN_BG:  "C3E6CB",
  GREEN_FG:  "155724",
  YELLOW_BG: "FFE8A1",
  YELLOW_FG: "7A6200",
  RED_BG:    "F5C6CB",
  RED_FG:    "721C24",
  BLUE_BG:   "B8DAFF",
  BLUE_FG:   "004085",
};

// ═════════════════════════════════════════════════════════════
//  STEP 1 : Parse the PDF
// ═════════════════════════════════════════════════════════════
console.log(`📄 Parsing PDF: ${pdfPath}`);

const pdfData = await new Promise((resolve, reject) => {
  const parser = new PDFParser(null, true);   // raw text mode
  parser.on("pdfParser_dataReady", (data) => resolve(data));
  parser.on("pdfParser_dataError", (err) => reject(err));
  parser.loadPDF(pdfPath);
});

console.log(`✅ Parsed ${pdfData.Pages.length} pages`);

// ═════════════════════════════════════════════════════════════
//  STEP 2 : Extract structured text from each page
// ═════════════════════════════════════════════════════════════

function decodeText(t) {
  try { return decodeURIComponent(t); }
  catch { return t; }
}

/**
 * Classify a text run based on its TS (TypeSpec) array and color
 * TS = [fontFaceId, fontSize, isBold, isItalic]
 */
function classifyRun(textObj) {
  const r = textObj.R[0];
  const text = decodeText(r.T);
  const ts = r.TS || [0, 12, 0, 0];
  const fontSize = ts[1];
  const isBold = ts[2] === 1;
  const isItalic = ts[3] === 1;
  const color = textObj.oc || null;        // original color if set
  const x = textObj.x;
  const y = textObj.y;
  const w = textObj.w;

  return { text, fontSize, isBold, isItalic, color, x, y, w };
}

/** Group text runs into lines based on y-coordinate proximity */
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

/** Detect if a line looks like a section heading */
function isHeading(line) {
  const maxFontSize = Math.max(...line.runs.map(r => r.fontSize));
  const allBold = line.runs.every(r => r.isBold);
  const fullText = line.runs.map(r => r.text).join("").trim();
  if (maxFontSize >= 16 && allBold) return 1;  // main heading
  if (maxFontSize >= 14 && allBold) return 2;   // sub heading
  if (allBold && fullText.length < 80) return 3; // minor heading
  return 0;
}

/** Detect if a set of consecutive lines form a table-like structure */
function detectTableBlock(lines, startIdx) {
  // A table block: 3+ consecutive lines where x-positions repeat (columns)
  if (startIdx >= lines.length) return null;

  const colThreshold = 0.8;
  const candidateLines = [];

  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i];
    if (line.runs.length >= 2) {
      candidateLines.push(line);
    } else {
      break;
    }
  }

  if (candidateLines.length < 2) return null;

  // Check if columns are aligned across rows
  const firstXPositions = candidateLines[0].runs.map(r => r.x);
  let alignedCount = 0;
  for (let i = 1; i < candidateLines.length; i++) {
    const xs = candidateLines[i].runs.map(r => r.x);
    let matched = 0;
    for (const fx of firstXPositions) {
      if (xs.some(x => Math.abs(x - fx) < colThreshold)) matched++;
    }
    if (matched >= Math.min(2, firstXPositions.length)) alignedCount++;
  }

  if (alignedCount >= Math.min(2, candidateLines.length - 1)) {
    return { lines: candidateLines, colCount: firstXPositions.length };
  }
  return null;
}

// ═════════════════════════════════════════════════════════════
//  STEP 3 : Build the DOCX elements
// ═════════════════════════════════════════════════════════════

const tableBorders = {
  top:    { style: BorderStyle.SINGLE, size: 2, color: C.BORDER },
  bottom: { style: BorderStyle.SINGLE, size: 2, color: C.BORDER },
  left:   { style: BorderStyle.SINGLE, size: 2, color: C.BORDER },
  right:  { style: BorderStyle.SINGLE, size: 2, color: C.BORDER },
  insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: C.BORDER },
  insideVertical:   { style: BorderStyle.SINGLE, size: 1, color: C.BORDER },
};

function makeTextRuns(lineRuns) {
  return lineRuns.map(r => {
    const opts = {
      text: r.text,
      font: "Calibri",
      size: Math.max(20, Math.round(r.fontSize * 1.6)),
      bold: r.isBold,
      italics: r.isItalic,
    };
    if (r.color) opts.color = r.color.replace("#", "");
    return new TextRun(opts);
  });
}

function headingParagraph(line, level) {
  const wordLevel = level === 1 ? HeadingLevel.HEADING_1
                  : level === 2 ? HeadingLevel.HEADING_2
                  : HeadingLevel.HEADING_3;
  const fontSize = level === 1 ? 36 : level === 2 ? 28 : 24;
  const hasPrimaryColor = line.runs.some(r => r.color && (r.color.includes("5166") || r.color.includes("2B39")));

  return new Paragraph({
    heading: wordLevel,
    spacing: { before: level === 1 ? 360 : 240, after: 120 },
    border: level <= 2 ? { bottom: { style: BorderStyle.SINGLE, size: 4, color: C.PRIMARY } } : undefined,
    children: line.runs.map(r => new TextRun({
      text: r.text,
      font: "Calibri",
      size: fontSize,
      bold: true,
      color: C.PRIMARY,
    })),
  });
}

function normalParagraph(line) {
  const indentLevel = Math.max(0, Math.floor((line.runs[0].x - 1.5) / 3));
  const fullText = line.runs.map(r => r.text).join("").trim();
  const isBulletLike = /^[•\-–—►▪■●○◦]/.test(fullText) || /^[\d]+[\.\)]/.test(fullText);

  if (isBulletLike) {
    // Remove bullet char from text
    const cleanRuns = [...line.runs];
    if (cleanRuns.length > 0) {
      cleanRuns[0] = { ...cleanRuns[0], text: cleanRuns[0].text.replace(/^[•\-–—►▪■●○◦]\s*/, "").replace(/^[\d]+[\.\)]\s*/, "") };
    }
    return new Paragraph({
      bullet: { level: Math.min(indentLevel, 2) },
      spacing: { after: 60 },
      children: makeTextRuns(cleanRuns),
    });
  }

  return new Paragraph({
    spacing: { after: 80 },
    indent: indentLevel > 0 ? { left: convertInchesToTwip(indentLevel * 0.3) } : undefined,
    children: makeTextRuns(line.runs),
  });
}

function buildTableFromLines(tableLines) {
  // Determine columns by clustering x-positions across all rows
  const allX = [];
  for (const ln of tableLines) {
    for (const r of ln.runs) {
      allX.push(r.x);
    }
  }
  allX.sort((a, b) => a - b);

  // Cluster x-positions
  const cols = [allX[0]];
  for (let i = 1; i < allX.length; i++) {
    if (allX[i] - cols[cols.length - 1] > 2.0) {
      cols.push(allX[i]);
    }
  }
  const colCount = cols.length;

  // Map each run to a column
  function getCol(x) {
    let best = 0;
    let bestDist = Math.abs(x - cols[0]);
    for (let i = 1; i < cols.length; i++) {
      const dist = Math.abs(x - cols[i]);
      if (dist < bestDist) { best = i; bestDist = dist; }
    }
    return best;
  }

  const rows = tableLines.map((ln, rowIdx) => {
    const cellTexts = new Array(colCount).fill("");
    const cellBold = new Array(colCount).fill(false);
    for (const r of ln.runs) {
      const ci = getCol(r.x);
      cellTexts[ci] += (cellTexts[ci] ? " " : "") + r.text;
      if (r.isBold) cellBold[ci] = true;
    }

    const isFirstRow = rowIdx === 0;
    // Detect if first row is header: all bold or has primary color
    const firstRowAllBold = tableLines[0].runs.every(r => r.isBold);
    const isHeader = isFirstRow && firstRowAllBold;

    return new TableRow({
      tableHeader: isHeader,
      children: cellTexts.map((txt, ci) => {
        const bg = isHeader ? C.HEADER_BG : (rowIdx % 2 === 0 ? C.WHITE : C.ROW_ALT);
        const fg = isHeader ? C.WHITE : C.DARK;
        return new TableCell({
          shading: { type: ShadingType.SOLID, color: bg },
          borders: tableBorders,
          children: [new Paragraph({
            spacing: { before: 40, after: 40 },
            children: [new TextRun({
              text: txt.trim() || " ",
              font: "Calibri",
              size: 20,
              bold: isHeader || cellBold[ci],
              color: fg,
            })]
          })],
        });
      }),
    });
  });

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows,
  });
}

// ═════════════════════════════════════════════════════════════
//  STEP 4 : Process each page into paragraphs
// ═════════════════════════════════════════════════════════════

const docChildren = [];

// ── Title block ──
docChildren.push(
  new Paragraph({ spacing: { before: 400, after: 20 }, alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: "━".repeat(40), color: C.PRIMARY, size: 16, font: "Calibri" })]
  }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 200, after: 60 },
    shading: { type: ShadingType.SOLID, color: C.PRIMARY },
    children: [new TextRun({ text: `  ${pdfName.toUpperCase().replace(/[_-]/g, " ")}  `, bold: true, size: 48, color: C.WHITE, font: "Calibri" })]
  }),
  new Paragraph({ spacing: { after: 20 }, alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: "━".repeat(40), color: C.PRIMARY, size: 16, font: "Calibri" })]
  }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 60 },
    children: [new TextRun({ text: `Generated from: ${path.basename(pdfPath)}`, size: 18, color: C.GRAY, italics: true, font: "Calibri" })]
  }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 300 },
    children: [new TextRun({ text: `${pdfData.Pages.length} pages  •  ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}`, size: 18, color: C.LIGHT_GRAY, font: "Calibri" })]
  }),
);

// ── Process each page ──
for (let pIdx = 0; pIdx < pdfData.Pages.length; pIdx++) {
  const page = pdfData.Pages[pIdx];
  const lines = groupIntoLines(page.Texts);

  // Page separator with heavy blue bar
  if (pIdx > 0) {
    docChildren.push(
      new Paragraph({ spacing: { before: 300, after: 60 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: C.PRIMARY } },
        children: []
      }),
    );
  }

  // Page number indicator  
  docChildren.push(
    new Paragraph({ spacing: { before: 120, after: 160 },
      children: [
        new TextRun({ text: `▎ PAGE ${pIdx + 1}`, bold: true, size: 18, color: C.ACCENT, font: "Calibri" }),
        new TextRun({ text: ` of ${pdfData.Pages.length}`, size: 18, color: C.LIGHT_GRAY, font: "Calibri" }),
      ]
    }),
  );

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const hLevel = isHeading(line);

    if (hLevel > 0) {
      docChildren.push(headingParagraph(line, hLevel));
      i++;
      continue;
    }

    // Try table detection
    const tableBlock = detectTableBlock(lines, i);
    if (tableBlock && tableBlock.lines.length >= 3) {
      docChildren.push(buildTableFromLines(tableBlock.lines));
      docChildren.push(new Paragraph({ spacing: { after: 120 }, children: [] }));
      i += tableBlock.lines.length;
      continue;
    }

    docChildren.push(normalParagraph(line));
    i++;
  }
}

// ── Footer contact block ──
docChildren.push(
  new Paragraph({ spacing: { before: 400 },
    border: { top: { style: BorderStyle.SINGLE, size: 6, color: C.PRIMARY } },
    children: []
  }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 100, after: 60 },
    shading: { type: ShadingType.SOLID, color: C.PRIMARY },
    children: [new TextRun({ text: "  Document generated by PDF-to-DOCX Converter  ", bold: true, color: C.WHITE, size: 22, font: "Calibri" })]
  }),
);

// ═════════════════════════════════════════════════════════════
//  STEP 5 : Build and write the document
// ═════════════════════════════════════════════════════════════

const doc = new Document({
  styles: {
    default: {
      document: { run: { font: "Calibri", size: 22 } },
      heading1: { run: { font: "Calibri", size: 36, bold: true, color: C.PRIMARY }, paragraph: { spacing: { before: 360, after: 120 } } },
      heading2: { run: { font: "Calibri", size: 28, bold: true, color: C.PRIMARY }, paragraph: { spacing: { before: 280, after: 100 } } },
      heading3: { run: { font: "Calibri", size: 24, bold: true, color: C.ACCENT }, paragraph: { spacing: { before: 200, after: 80 } } },
    }
  },
  sections: [{
    properties: {
      page: {
        margin: {
          top: convertInchesToTwip(0.7),
          bottom: convertInchesToTwip(0.7),
          left: convertInchesToTwip(0.8),
          right: convertInchesToTwip(0.8),
        }
      }
    },
    headers: {
      default: new Header({
        children: [new Paragraph({
          border: { bottom: { style: BorderStyle.SINGLE, size: 2, color: C.BORDER } },
          spacing: { after: 60 },
          children: [
            new TextRun({ text: `${pdfName.replace(/[_-]/g, " ")}`, size: 16, color: C.PRIMARY, bold: true, italics: true, font: "Calibri" }),
            new TextRun({ text: "  |  Converted to Word Format", size: 14, color: C.LIGHT_GRAY, font: "Calibri" }),
          ]
        })]
      })
    },
    footers: {
      default: new Footer({
        children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          border: { top: { style: BorderStyle.SINGLE, size: 1, color: C.BORDER } },
          spacing: { before: 60 },
          children: [
            new TextRun({ text: "Page ", size: 16, color: C.GRAY, font: "Calibri" }),
            new TextRun({ children: [PageNumber.CURRENT], size: 16, color: C.PRIMARY, bold: true, font: "Calibri" }),
            new TextRun({ text: " of ", size: 16, color: C.GRAY, font: "Calibri" }),
            new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 16, color: C.PRIMARY, bold: true, font: "Calibri" }),
          ]
        })]
      })
    },
    children: docChildren,
  }],
});

const buffer = await Packer.toBuffer(doc);

// Handle locked files gracefully — try alternate filenames if needed
let finalPath = outputPath;
for (let attempt = 0; attempt < 10; attempt++) {
  try {
    fs.writeFileSync(finalPath, buffer);
    break;
  } catch (err) {
    if (err.code === "EBUSY" || err.code === "EPERM") {
      const ext = path.extname(outputPath);
      const base = outputPath.slice(0, -ext.length);
      finalPath = `${base}_${attempt + 2}${ext}`;
      console.log(`⚠️  File locked, saving as: ${path.basename(finalPath)}`);
    } else {
      throw err;
    }
  }
}

console.log(`\n✅ Word document generated successfully!`);
console.log(`📁 Output: ${finalPath}`);
console.log(`📊 ${pdfData.Pages.length} pages processed, ${docChildren.length} elements created`);
