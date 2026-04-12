#!/usr/bin/env node
/**
 * JSON -> PDF converter.
 * Rebuilds a PDF from a pdf2json JSON file by rendering the page layout into HTML
 * and printing it through Puppeteer.
 */

import puppeteer from "puppeteer";
import fs from "fs";
import path from "path";

const args = process.argv.slice(2);
if (args.length === 0) {
	console.log(`
  JSON to PDF Converter
  ---------------------
  Usage:   node json_to_pdf.mjs <input.json> [output.pdf]

  Examples:
    node json_to_pdf.mjs document.json
    node json_to_pdf.mjs document.json output/result.pdf
    node json_to_pdf.mjs "C:\path\to\file.json"

  The input must be a pdf2json-format JSON file.
  If output path is omitted, PDF is saved next to the input JSON.
  `);

	process.exit(1);
}

const jsonPath = args[0];
if (!fs.existsSync(jsonPath)) {
	console.error(`Error: File not found -> ${jsonPath}`);
	process.exit(1);
}

const jsonName = path.basename(jsonPath, path.extname(jsonPath));
const outputPath = args[1] || path.join(path.dirname(jsonPath), `${jsonName}.pdf`);
const htmlPath = outputPath.replace(/\.pdf$/i, ".html");

const outDir = path.dirname(outputPath);
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

let pdfData;
try {
	pdfData = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
} catch (err) {
	console.error(`Error: Invalid JSON -> ${err.message}`);
	process.exit(1);
}

const pdfRoot = pdfData.formImage && typeof pdfData.formImage === "object" ? pdfData.formImage : pdfData;

if (!pdfRoot.Pages || !Array.isArray(pdfRoot.Pages) || pdfRoot.Pages.length === 0) {
	console.error("Error: JSON does not contain a valid Pages array (not a pdf2json format)");
	process.exit(1);
}

const kColors = [
	"#000000", "#ffffff", "#4c4c4c", "#808080", "#999999", "#c0c0c0", "#cccccc",
	"#e5e5e5", "#f2f2f2", "#008000", "#00ff00", "#bfffa0", "#ffd629", "#ff99cc",
	"#004080", "#9fc0e1", "#5580ff", "#a9c9fa", "#ff0080", "#800080", "#ffbfff",
	"#e45b21", "#ffbfaa", "#008080", "#ff0000", "#fdc59f", "#808000", "#bfbf00",
	"#824100", "#007256", "#008000", "#000080", "#008080", "#800080", "#ff0000",
	"#0000ff", "#008000"
];

const kFontFaces = [
	"Arial, Helvetica, sans-serif",
	"Arial Narrow, Arial, Helvetica, sans-serif",
	"Arial, Helvetica, sans-serif",
	"Courier New, Courier, monospace",
	"Courier New, Courier, monospace",
	"Courier New, Courier, monospace"
];

const GRID_TO_PX = 24;
const GRID_PER_INCH = 4;

function getColor(obj) {
	if (obj.oc) return obj.oc;
	if (obj.clr !== undefined && obj.clr >= 0 && obj.clr < kColors.length) return kColors[obj.clr];
	return "#000000";
}

function esc(value) {
	return String(value)
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

function decodeText(value) {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}

function isFilledValue(value) {
	return value !== undefined && value !== null && String(value).trim() !== "";
}

function isTruthyValue(value) {
	if (value === true) return true;
	if (value === false || value === null || value === undefined) return false;
	if (typeof value === "number") return value !== 0;
	const normalized = String(value).trim().toLowerCase();
	return normalized !== "" && normalized !== "0" && normalized !== "false" && normalized !== "no" && normalized !== "off";
}

function getFieldJustify(fieldType) {
	switch (fieldType) {
		case "number":
		case "mask":
		case "ssn":
		case "phone":
		case "zip":
		case "date":
			return "flex-end";
		case "alpha":
		default:
			return "flex-start";
	}
}

function getFieldFontSize(field, value) {
	const fieldWidthPx = Math.max((field.w || 0) * GRID_TO_PX, 1);
	const fieldHeightPx = Math.max((field.h || 0) * GRID_TO_PX, 1);
	const textLength = Math.max(String(value).length, 1);
	const widthBased = (fieldWidthPx / textLength) * 1.35;
	const heightBased = fieldHeightPx * 0.72;
	return Math.max(7, Math.min(widthBased, heightBased));
}

function renderFieldValue(field, rawValue) {
	const fieldType = field?.T?.Name || "";
	const value = String(rawValue);
	const left = (field.x || 0) * GRID_TO_PX;
	const top = (field.y || 0) * GRID_TO_PX;
	const width = Math.max((field.w || 0) * GRID_TO_PX, 1);
	const height = Math.max((field.h || 0) * GRID_TO_PX, 1);
	const fontSize = getFieldFontSize(field, value);
	const justifyContent = getFieldJustify(fieldType);

	return `<div class="field-value" style="left:${left}px;top:${top}px;width:${width}px;height:${height}px;justify-content:${justifyContent};font-size:${fontSize}px;">${esc(value)}</div>\n`;
}

function renderCheckedBox(box) {
	const left = (box.x || 0) * GRID_TO_PX;
	const top = (box.y || 0) * GRID_TO_PX;
	const width = Math.max((box.w || 0) * GRID_TO_PX, 1);
	const height = Math.max((box.h || 0) * GRID_TO_PX, 1);
	const fontSize = Math.max(8, Math.min(width, height) * 0.85);

	return `<div class="box-value" style="left:${left}px;top:${top}px;width:${width}px;height:${height}px;font-size:${fontSize}px;">X</div>\n`;
}

console.log(`Loading: ${path.basename(jsonPath)}`);
console.log(`Pages:   ${pdfRoot.Pages.length}`);

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
	.value-overlay {
		position: absolute;
		pointer-events: none;
		white-space: nowrap;
		color: #111;
		font-family: Arial, Helvetica, sans-serif;
		line-height: 1;
		z-index: 4;
	}
	.field-value {
		position: absolute;
		pointer-events: none;
		display: flex;
		align-items: center;
		overflow: hidden;
		white-space: nowrap;
		padding: 0 2px;
		color: #111;
		font-family: Arial, Helvetica, sans-serif;
		line-height: 1;
		z-index: 3;
	}
	.box-value {
		position: absolute;
		pointer-events: none;
		display: flex;
		align-items: center;
		justify-content: center;
		color: #111;
		font-family: Arial, Helvetica, sans-serif;
		font-weight: 700;
		line-height: 1;
		z-index: 3;
	}
  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style>
</head>
<body>
`;

for (let pageIndex = 0; pageIndex < pdfRoot.Pages.length; pageIndex++) {
	const page = pdfRoot.Pages[pageIndex];
	const pageWidth = (page.Width || pdfRoot.Width || 0) * GRID_TO_PX;
	const pageHeight = (page.Height || pdfRoot.Height || 0) * GRID_TO_PX;

	html += `<div class="page" style="width:${pageWidth}px;height:${pageHeight}px;">\n`;

	if (page.Fills) {
		for (const fill of page.Fills) {
			const fillWidth = fill.w * GRID_TO_PX;
			const fillHeight = fill.h * GRID_TO_PX;
			if (fillWidth <= 0 || fillHeight <= 0) continue;
			html += `<div class="fill" style="left:${fill.x * GRID_TO_PX}px;top:${fill.y * GRID_TO_PX}px;width:${fillWidth}px;height:${fillHeight}px;background:${getColor(fill)};"></div>\n`;
		}
	}

	if (page.HLines) {
		for (const line of page.HLines) {
			html += `<div class="hline" style="left:${line.x * GRID_TO_PX}px;top:${line.y * GRID_TO_PX}px;width:${line.w * GRID_TO_PX}px;height:${Math.max(line.l || 1, 1)}px;background:${getColor(line)};"></div>\n`;
		}
	}

	if (page.VLines) {
		for (const line of page.VLines) {
			html += `<div class="vline" style="left:${line.x * GRID_TO_PX}px;top:${line.y * GRID_TO_PX}px;width:${Math.max(line.l || 1, 1)}px;height:${line.h * GRID_TO_PX}px;background:${getColor(line)};"></div>\n`;
		}
	}

	if (page.Texts) {
		for (const textItem of page.Texts) {
			if (!textItem.R || !textItem.R[0]) continue;
			const runs = Array.isArray(textItem.R) ? textItem.R : [];
			const primaryRun = runs[0] || {};
			const text = decodeText(runs.map(run => run.T || "").join(""));
			if (!text.trim()) continue;

			const textStyle = primaryRun.TS || [0, 12, 0, 0];
			const fontFamily = kFontFaces[textStyle[0] || 0] || kFontFaces[0];
			const fontSize = textStyle[1] || 12;
			const fontWeight = textStyle[2] === 1 ? "bold" : "normal";
			const fontStyle = textStyle[3] === 1 ? "italic" : "normal";
			const rotation = primaryRun.RA ? `transform:rotate(${primaryRun.RA}deg);transform-origin:0 0;` : "";

			html += `<div class="txt" style="left:${textItem.x * GRID_TO_PX}px;top:${textItem.y * GRID_TO_PX}px;font-family:${fontFamily};font-size:${fontSize}pt;font-weight:${fontWeight};font-style:${fontStyle};color:${getColor(textItem)};${rotation}">${esc(text)}</div>\n`;
		}
	}

	if (page.Fields) {
		for (const field of page.Fields) {
			if (!field || !field.id || !field.id.Id) continue;
			const fieldType = field.T && field.T.Name ? field.T.Name : "";
			const fieldValue = field.V;

			if (fieldType === "box") {
				if (field.checked || isTruthyValue(fieldValue)) {
					html += renderCheckedBox(field);
				}
				continue;
			}

			if (!isFilledValue(fieldValue)) continue;
			html += renderFieldValue(field, decodeText(String(fieldValue)));
		}
	}

	if (page.Boxsets) {
		for (const boxset of page.Boxsets) {
			if (!boxset || !boxset.boxes) continue;
			for (const box of boxset.boxes) {
				if (!box || !box.id || !box.id.Id) continue;
				if (!box.checked) continue;
				html += renderCheckedBox(box);
			}
		}
	}

	if (page.ValueOverlays) {
		for (const overlay of page.ValueOverlays) {
			if (!overlay || !overlay.text) continue;
			const left = (overlay.x || 0) * GRID_TO_PX;
			const top = (overlay.y || 0) * GRID_TO_PX;
			const fontSize = overlay.fontSize || 12;
			const color = overlay.color || "#111111";
			html += `<div class="value-overlay" style="left:${left}px;top:${top}px;font-size:${fontSize}px;color:${color};">${esc(overlay.text)}</div>\n`;
		}
	}

	html += `</div>\n`;
}

html += `</body>\n</html>`;
fs.writeFileSync(htmlPath, html);
console.log(`HTML saved: ${htmlPath}`);

console.log("Rendering PDF...");

const browser = await puppeteer.launch({ headless: true });
const page = await browser.newPage();
await page.setContent(html, { waitUntil: "domcontentloaded", timeout: 0 });

const firstPage = pdfRoot.Pages[0];
const paperWidthIn = (firstPage.Width || pdfRoot.Width || 0) / GRID_PER_INCH;
const paperHeightIn = (firstPage.Height || pdfRoot.Height || 0) / GRID_PER_INCH;

let finalPath = outputPath;
for (let attempt = 0; attempt < 10; attempt++) {
	try {
		await page.pdf({
			path: finalPath,
			width: `${paperWidthIn}in`,
			height: `${paperHeightIn}in`,
			printBackground: true,
			margin: { top: "0", bottom: "0", left: "0", right: "0" }
		});
		break;
	} catch (err) {
		if (err.code === "EBUSY" || (err.message && err.message.includes("EBUSY"))) {
			const ext = path.extname(outputPath);
			const base = outputPath.slice(0, -ext.length);
			finalPath = `${base}_${attempt + 2}${ext}`;
			console.log(`File locked, saving as: ${path.basename(finalPath)}`);
		} else {
			throw err;
		}
	}
}

await browser.close();

const stats = fs.statSync(finalPath);
console.log(`Output:  ${finalPath}`);
console.log(`Size:    ${(stats.size / 1024).toFixed(1)} KB`);
console.log(`Pages:   ${pdfRoot.Pages.length}`);
console.log("Done");