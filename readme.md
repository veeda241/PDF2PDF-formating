# 📄 PDF2PDF-Formating

### The Ultimate PDF Transformation & Reproduction Toolkit

**PDF2PDF-Formating** is a professional-grade Node.js engine designed for high-fidelity PDF parsing, reconstruction, and cross-format conversion. Built on an optimized port of [pdf.js](https://github.com/mozilla/pdf.js/), it allows you to extract every nuance of a document—positions, fonts, colors, and interactive fields—and faithfully reproduce them as **exact-replica PDFs**, **structured Word documents**, or **styled HTML reports**.

[![GitHub stars](https://img.shields.io/github/stars/veeda241/PDF2PDF-formating?style=for-the-badge&logo=github)](https://github.com/veeda241/PDF2PDF-formating)
[![Node.js](https://img.shields.io/badge/Node.js-v20.18+-339933?style=for-the-badge&logo=node.js&logoColor=white)](http://nodejs.org/)
[![License](https://img.shields.io/badge/License-Apache--2.0-blue?style=for-the-badge)](https://github.com/veeda241/PDF2PDF-formating/blob/master/license.txt)

---

## ✨ Core Features

| Feature | Description |
| :--- | :--- |
| **🎯 Exact Reproduction** | Pixel-perfect PDF → PDF reconstruction preserving original layout, fonts, and colors. |
| **📝 Word Intelligence** | Automated PDF → DOCX conversion with semantic heading and table detection. |
| **🧩 Semantic Field Matching** | Intelligent data transfer between PDFs using fuzzy label matching and question normalization. |
| **📊 JSON Extraction** | Full document structure extraction (text, fills, images, form fields) for data pipelines. |
| **⚡ Multi-Runtime** | Seamless execution on **Node.js**, **Deno**, and **Bun**. |
| **🚀 Zero Core Deps** | The primary parsing engine is pure, dependency-free JavaScript. |

---

## 🛠️ Installation

```bash
# Clone the powerhouse
git clone https://github.com/veeda241/PDF2PDF-formating.git
cd PDF2PDF-formating

# Install dependencies for conversion tools
npm install

# Build the production bundles
npm run build
```

---

## 🚀 Quick Start: Conversion Suite

### 1. The "Magic" Exact Replica (PDF → PDF)
Reproduces any PDF with 100% layout fidelity. Perfect for cleaning up or flattening complex documents.
```bash
node pdf_to_pdf_exact.mjs "input.pdf"
```

### 2. Intelligent Word Export (PDF → DOCX)
Converts PDFs into editable Word documents while preserving headers, tables, and lists.
```bash
node pdf_to_docx.mjs "input.pdf"
```

### 3. Data Extraction (PDF → JSON)
Extracts every element as a structured JSON object for programmatic analysis.
```bash
node pdf_to_json.mjs "input.pdf"
```

### 4. Styled Reconstruction (PDF → PDF)
Transforms a raw PDF into a modern, professionally styled report with banners and branded headers.
```bash
node pdf_to_pdf.mjs "input.pdf"
```

---

## 🧠 Semantic Field Matcher (Latest Feature)

The new **Semantic Matcher** suite allows you to fill a target PDF form using data from a source PDF or JSON, even if the field IDs don't match perfectly.

### 🧠 ML-Based Matcher (Offline)
The high-accuracy version uses **Sentence Transformers** (`all-MiniLM-L6-v2`) to resolve field labels semantically. It handles complex variations (e.g., "Applicant Name" vs "Respondent Name") with ease.

**Key Benefits:**
- **Zero Internet**: After the first run, the model (~80MB) works fully offline.
- **Deep Understanding**: Uses cosine similarity to find the best match across 20+ canonical field types.
- **Visual Overlay**: Works on flat PDFs by placing text precisely next to identified labels.

**Usage:**
```bash
python semantic_field_matcher_ml.py source_values.json form.pdf out.pdf
```

### 🧪 Standard Matcher
A lightweight, regex-based matcher for simpler form variations.
```bash
python semantic_field_matcher.py source_values.json target_form.pdf filled_output.pdf
```

---

## 🏗️ Project Structure

```text
├── pdf_to_pdf_exact.mjs    # 🎯 Exact layout reproducer
├── pdf_to_docx.mjs         # 📝 Word automated converter
├── pdf_to_json.mjs         # 📊 High-fidelity JSON extractor
├── semantic_field_matcher_ml.py # 🧠 ML-based semantic form filler
├── semantic_field_matcher.py    # 🧪 Standard intelligent form filler
├── fastapi_app/            # 🌐 REST API for conversion services
├── dist/                   # 📦 Production JS bundles (ESM/CJS)
├── lib/                    # 📚 Core library modules (Fonts, Fills, Fields)
└── test/                   # 🧪 Massive test suite (260+ PDF forms)
```

---

## 🌐 API & Web Testing

Test the conversion engine via the built-in FastAPI Swagger UI:

1. **Start the API:**
   ```bash
   npm run fastapi
   ```
2. **Access the Docs:**
   Navigate to `http://localhost:8000/docs` to test routes like `/api/pdf-to-filled-pdf`.

---

## 📄 License

Licensed under the **Apache License 2.0**. See [license.txt](license.txt) for details.

---
<p align="center">Made with precision for the PDF era.</p>
