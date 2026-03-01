# PDF2PDF-Formating

![GitHub stars](https://img.shields.io/github/stars/veeda241/PDF2PDF-formating?style=social)
![GitHub forks](https://img.shields.io/github/forks/veeda241/PDF2PDF-formating?style=social)
![GitHub watchers](https://img.shields.io/github/watchers/veeda241/PDF2PDF-formating?style=social)
![GitHub repo size](https://img.shields.io/github/repo-size/veeda241/PDF2PDF-formating)
![GitHub language count](https://img.shields.io/github/languages/count/veeda241/PDF2PDF-formating)
![GitHub top language](https://img.shields.io/github/languages/top/veeda241/PDF2PDF-formating)
![GitHub last commit](https://img.shields.io/github/last-commit/veeda241/PDF2PDF-formating?color=red)

**PDF2PDF-Formating** is a powerful [Node.js](http://nodejs.org/) toolkit that parses PDF documents and reproduces them in multiple output formats — **PDF (exact replica)**, **DOCX (Microsoft Word)**, **HTML**, and **JSON**. Built on top of [pdf.js](https://github.com/mozilla/pdf.js/), it extracts text content, fills/backgrounds, fonts, colors, and interactive form elements, then faithfully reconstructs the document preserving the original layout.

---

## Key Features

| Feature | Description |
|---|---|
| **PDF → PDF (Exact Format)** | Pixel-perfect reproduction of any PDF — preserves all positions, fonts, colors, fills, and page dimensions |
| **PDF → DOCX** | Automated conversion to Microsoft Word with heading detection, table reconstruction, and bullet point formatting |
| **PDF → HTML** | Rich HTML output with professional styling, gradient banners, color-coded badges, and responsive tables |
| **PDF → JSON** | Structured JSON extraction of all textual content and interactive form fields |
| **Text Extraction** | Extracts raw text content from PDF documents |
| **Form Field Parsing** | Parses interactive form fields (checkboxes, dropdowns, text inputs) for data capture |
| **Zero Core Dependencies** | Core PDF parser is completely dependency-free (pure JavaScript) |
| **Multi-Runtime Support** | Works with Node.js (≥20.18), Deno, and Bun |
| **CLI & API** | Use as a command-line tool or integrate programmatically into your Node.js application |

---

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [Conversion Tools](#conversion-tools)
  - [PDF → PDF (Exact Format)](#pdf--pdf-exact-format)
  - [PDF → DOCX (Word)](#pdf--docx-word)
  - [PDF → PDF (Styled)](#pdf--pdf-styled)
- [Project Structure](#project-structure)
- [How It Works](#how-it-works)
- [API Reference](#api-reference)
- [Output Format Reference](#output-format-reference)
- [Testing](#testing)
- [Code Examples](#code-examples)
- [License](#license)

---

## Installation

```bash
# Clone the repository
git clone https://github.com/veeda241/PDF2PDF-formating.git
cd PDF2PDF-formating

# Install dependencies
npm install

# Build the project (generates dist/ bundles)
npm run build
```

### Dependencies

| Package | Purpose |
|---|---|
| `puppeteer` | Headless Chrome for HTML → PDF conversion |
| `docx` | Microsoft Word (.docx) file generation |
| `pdf2json` (core) | PDF parsing engine (built-in, based on pdf.js) |

---

## Quick Start

### 1. PDF → PDF (Exact Replica) — Preserves Original Format

```bash
node pdf_to_pdf_exact.mjs "path/to/input.pdf"
```

Output: `input_exact.pdf` (same directory as input)

### 2. PDF → DOCX (Word Document)

```bash
node pdf_to_docx.mjs "path/to/input.pdf"
```

Output: `input.docx` (same directory as input)

### 3. PDF → JSON (Structured Data)

```bash
npx pdf2json -f "path/to/input.pdf" -o "path/to/output/"
```

Output: `input.json` (in output directory)

---

## Conversion Tools

### PDF → PDF (Exact Format)

**Script:** `pdf_to_pdf_exact.mjs`

Parses any PDF and reproduces it **pixel-perfectly** as a new PDF file. Every element is placed at its exact original coordinates:

- **Fills/Backgrounds** — colored rectangles at exact x, y, width, height
- **Text** — positioned at exact coordinates with original font size, bold/italic, color, font family
- **Page Dimensions** — matched exactly from the source PDF
- **Rotated Text** — preserved via CSS transform rotation
- **Zero Margins** — no additional spacing added

```bash
# Basic usage
node pdf_to_pdf_exact.mjs "input.pdf"

# Custom output path
node pdf_to_pdf_exact.mjs "input.pdf" "output.pdf"
```

**How it works:**
1. Parses PDF with pdf2json → extracts all elements as JSON
2. Builds an HTML document with absolute positioning for every element
3. Uses Puppeteer (headless Chrome) to render HTML → PDF at exact page dimensions
4. Handles file lock conflicts (auto-renames if file is open)

Also generates an `.html` debug file alongside the PDF.

---

### PDF → DOCX (Word)

**Script:** `pdf_to_docx.mjs`

Converts any PDF to a Microsoft Word document with intelligent content detection:

- **Heading Detection** — identifies headings by font size and bold weight (H1: ≥16pt bold, H2: ≥14pt bold, H3: bold < 80 chars)
- **Table Reconstruction** — detects column-aligned text blocks and builds proper Word tables with styled headers
- **Bullet Points** — recognizes bullet characters (•, -, ►, ■, etc.) and formats as lists
- **Font Styling** — preserves bold, italic, font size, and text color
- **Auto-rename** — if the output file is locked (e.g., open in Word), automatically saves as `filename_2.docx`

```bash
# Basic usage
node pdf_to_docx.mjs "input.pdf"

# Custom output path
node pdf_to_docx.mjs "input.pdf" "output.docx"
```

---

### PDF → PDF (Styled)

**Script:** `pdf_to_pdf.mjs`

Converts any PDF into a **professionally styled** new PDF with modern formatting:

- Gradient title banner with document metadata
- Section headings with colored borders
- Tables with styled headers and alternating row colors
- Bullet points, blockquotes, and badges
- Page indicators and header/footer on each page
- Footer banner with generation info

```bash
node pdf_to_pdf.mjs "input.pdf"
```

---

## Project Structure

```
PDF2PDF-formating/
├── pdf_to_pdf_exact.mjs    # PDF → PDF exact format reproducer
├── pdf_to_docx.mjs         # PDF → DOCX automated converter
├── pdf_to_pdf.mjs          # PDF → PDF styled converter
├── pdfparser.js             # Main parser entry point
├── package.json             # Project config & scripts
│
├── bin/
│   └── pdf2json.js          # CLI entry point
│
├── dist/                    # Built bundles (after npm run build)
│   ├── pdfparser.js         # ES Module bundle
│   ├── pdfparser.cjs        # CommonJS bundle
│   └── pdfparser.d.ts       # TypeScript declarations
│
├── lib/                     # Core library modules
│   ├── pdfcanvas.js         # Canvas rendering → JSON conversion
│   ├── pdffont.js           # Font processing & text positioning
│   ├── pdffill.js           # Background fill extraction
│   ├── pdfunit.js           # Unit conversion (grid ↔ pixel ↔ point)
│   ├── pdfconst.js          # Color dictionary & font style definitions
│   ├── pdfline.js           # Line element processing
│   ├── pdfimage.js          # Image handling
│   ├── pdffield.js          # Form field extraction
│   ├── pdfanno.js           # Annotation processing
│   └── parserstream.js      # Streaming parser API
│
├── base/                    # pdf.js core (ported to Node.js)
│   ├── core/                # PDF parsing engine
│   ├── display/             # Rendering API
│   └── shared/              # Shared utilities
│
├── src/                     # TypeScript source
│   ├── cli/                 # CLI implementation
│   └── types/               # Type declarations
│
├── test/                    # Test suite
│   ├── _test_.cjs           # Jest test suite
│   ├── pdf/                 # Test PDF files (260+ forms)
│   ├── data/                # Expected JSON outputs
│   └── target/              # Generated test outputs
│
└── rollup/                  # Build configuration
    └── bundle-pdfjs-base.js # pdf.js bundler
```

---

## How It Works

### Coordinate System

pdf2json uses a grid-based coordinate system:

| Unit | Value |
|---|---|
| DPI | 96 |
| Grid units per inch | 4 |
| Pixels per grid unit | 24 (96 ÷ 4) |
| Points per pixel | 96 ÷ 72 = 1.333 |

**Conversion formulas:**
- Grid → Pixels: `gridValue × 24`
- Grid → Inches: `gridValue ÷ 4`
- Viewport → Grid: `viewportX ÷ 24`

### Text Object Structure

Each text element in the parsed JSON contains:

```json
{
  "x": 11.449,          // X position (grid units)
  "y": 7.511,           // Y position (grid units)
  "w": 220.668,         // Width (pixels)
  "clr": 0,             // Color index (see kColors) OR:
  "oc": "#5166eb",      // Original color (when not in dictionary)
  "sw": 0.361,          // Space width (for merging text blocks)
  "A": "left",          // Alignment
  "R": [{
    "T": "HELLO WORLD",  // Text content
    "S": 11,             // Style index (see kFontStyles)
    "TS": [0, 18, 1, 0]  // [fontFaceIdx, fontSize, bold(0/1), italic(0/1)]
  }]
}
```

### Fill Object Structure

```json
{
  "x": 0,              // X position (grid units)
  "y": 0,              // Y position (grid units)
  "w": 37.205,         // Width (grid units)
  "h": 5.315,          // Height (grid units)
  "oc": "#5166eb"      // Color
}
```

### Font Faces (TS[0])

| Index | Font Family |
|---|---|
| 0 | Arial, Helvetica, sans-serif |
| 1 | Arial Narrow, sans-serif |
| 2 | Symbol |
| 3 | Courier New, monospace |
| 4 | OCR-A, monospace |
| 5 | OCR-B MT, monospace |

### Color Dictionary

The parser uses a 37-color indexed dictionary. Colors not in the dictionary are stored as `oc` (original color) hex strings instead of `clr` (color index).

---

## API Reference

### Events

```javascript
import PDFParser from "pdf2pdf-formating";

const pdfParser = new PDFParser();

// Error handling
pdfParser.on("pdfParser_dataError", (errData) => console.error(errData.parserError));

// Success — full document parsed
pdfParser.on("pdfParser_dataReady", (pdfData) => {
  console.log(`Pages: ${pdfData.Pages.length}`);
});

// Alternative streaming events (v2.0.0+)
pdfParser.on("readable", (meta) => console.log("PDF Metadata", meta));
pdfParser.on("data", (page) => console.log(page ? "Page parsed" : "Done"));
pdfParser.on("error", (err) => console.error("Error", err));
```

### Methods

| Method | Description |
|---|---|
| `loadPDF(filePath)` | Parse a PDF file from disk |
| `parseBuffer(buffer)` | Parse a PDF from a Buffer |
| `createParserStream()` | Create a streaming parser (pipe-friendly) |
| `getRawTextContent()` | Get plain text content (after parse) |
| `getAllFieldsTypes()` | Get form field definitions (after parse) |
| `getMergedTextBlocksStream()` | Stream of merged text blocks |
| `getRawTextContentStream()` | Stream of raw text content |
| `getAllFieldsTypesStream()` | Stream of form field types |

### Constructor

```javascript
// Default: parse everything
const parser = new PDFParser();

// Text-only mode (verbosity level 1)
const parser = new PDFParser(null, 1);

// With custom context and verbosity
const parser = new PDFParser(context, verbosityLevel);
```

---

## Output Format Reference

### Root Structure

```json
{
  "Transcoder": "pdf2pdf-formating@4.0.2",
  "Meta": { /* PDF metadata */ },
  "Pages": [ /* array of Page objects */ ]
}
```

### Page Object

```json
{
  "Width": 37.205,
  "Height": 52.618,
  "HLines": [],
  "VLines": [],
  "Fills": [ /* colored rectangles */ ],
  "Texts": [ /* text blocks */ ],
  "Fields": [ /* interactive form fields */ ],
  "Boxsets": [ /* checkboxes & radio buttons */ ]
}
```

### Interactive Form Fields

The parser extracts interactive form elements including:
- **Text inputs** (`Name: "alpha"`) — with value in `V` field
- **Radio buttons** (`Name: "box"` in Boxsets) — grouped by parent ID
- **Checkboxes** (`Name: "box"` in Boxsets) — single box per set
- **Drop-down lists** (`Name: "alpha"` with `PL` property) — options in `PL.D` (labels) and `PL.V` (values)
- **Link buttons** (`Name: "link"`) — URL in `FL.form.Id`
- **Signatures** (`Name: "signature"`) — signer details in `Sig` property

---

## Testing

### Run All Tests

```bash
# Build + Jest + parse-r + parse-fd + Deno + Bun
npm test

# Jest only
npm run test:jest

# Parse 260+ PDF forms
npm run test:forms

# Exception handling tests
npm run test:misc

# Stream API test
npm run parse-r
```

### Test the Conversion Tools

```bash
# PDF → PDF (exact format)
node pdf_to_pdf_exact.mjs "test/pdf/fd/form/F1040.pdf"

# PDF → DOCX
node pdf_to_docx.mjs "test/pdf/fd/form/F1040.pdf"

# PDF → PDF (styled)
node pdf_to_pdf.mjs "test/pdf/fd/form/F1040.pdf"
```

### Disabling Test Logs

```bash
# Via environment variable
PDF2JSON_DISABLE_LOGS=1 npm test

# Via command line flag
npx pdf2json -f input.pdf -o output/ -s
```

---

## Code Examples

### Parse PDF to JSON

```javascript
import fs from "fs";
import PDFParser from "pdf2pdf-formating";

const pdfParser = new PDFParser();

pdfParser.on("pdfParser_dataError", (errData) =>
  console.error(errData.parserError)
);

pdfParser.on("pdfParser_dataReady", (pdfData) => {
  fs.writeFile("output.json", JSON.stringify(pdfData), () =>
    console.log("Done.")
  );
});

pdfParser.loadPDF("input.pdf");
```

### Parse from Buffer

```javascript
fs.readFile("input.pdf", (err, pdfBuffer) => {
  if (!err) pdfParser.parseBuffer(pdfBuffer);
});
```

### Extract Text Content

```javascript
const pdfParser = new PDFParser(null, 1);

pdfParser.on("pdfParser_dataReady", () => {
  fs.writeFile("output.txt", pdfParser.getRawTextContent(), () =>
    console.log("Done.")
  );
});

pdfParser.loadPDF("input.pdf");
```

### Extract Form Fields

```javascript
pdfParser.on("pdfParser_dataReady", () => {
  const fields = pdfParser.getAllFieldsTypes();
  fs.writeFile("fields.json", JSON.stringify(fields), () =>
    console.log("Done.")
  );
});
```

### Streaming API

```javascript
import PDFParser from "pdf2pdf-formating";

const inputStream = fs.createReadStream("input.pdf");
const outputStream = fs.createWriteStream("output.json");

inputStream
  .pipe(pdfParser.createParserStream())
  .pipe(new StringifyStream())
  .pipe(outputStream);
```

---

## CLI Usage

```bash
# Parse single PDF to JSON
npx pdf2json -f input.pdf -o output/

# Parse entire directory
npx pdf2json -f ./pdf-folder/ -o ./json-output/

# With additional outputs
npx pdf2json -f input.pdf -o output/ -t -c -m
#   -t  generate fields.json
#   -c  generate content.txt
#   -m  merge broken text blocks
#   -s  silent mode (suppress logs)
#   -r  use streaming parser

# Version info
npx pdf2json -v
```

---

## Requirements

| Requirement | Version |
|---|---|
| Node.js | ≥ 20.18.0 |
| npm | ≥ 10.2.3 |
| OS | Windows, macOS, Linux |

Optional runtimes: Deno, Bun

---

## Breaking Changes

### v4.0.0
- **Text encoding removed** — text in JSON output is no longer URI-encoded. Chinese/CJK/Unicode characters output as UTF-8 directly. Remove `decodeURIComponent()` calls.
- **Text block spacing** — calculated from fontMatrix for accuracy. Output may differ from v3.x.
- **Text coordinates** — corrected calculations, slightly different positioning values.
- **Node.js ≥ 20.18.0** required.

### v3.0.0
- Converted CommonJS to **ES Modules**. Update `tsconfig.json` with `"module": "ESNext"`.
- v3.1.0 added dual bundle output (ESM + CJS).

### v2.0.0
- `Agency` and `Id` replaced with `Meta` (full PDF metadata).
- `Width` moved from root to each Page object.
- `{clr:-1}` replaced with `{oc: "#xxxxxx"}`.

---

## License

Licensed under the [Apache License Version 2.0](https://github.com/veeda241/PDF2PDF-formating/blob/master/license.txt).

## Contributing

Participating in this project, you are expected to honor the [Contributor Covenant Code of Conduct](https://www.contributor-covenant.org/).

## Support

Thanks for your [stars](https://github.com/veeda241/PDF2PDF-formating/stargazers) and support!
