import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import PDFParser from './dist/pdfparser.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${file.originalname}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (path.extname(file.originalname).toLowerCase() === '.pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'));
    }
  },
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
});

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Store converted results in memory (for demo purposes)
const conversions = new Map();

// API: Upload and parse PDF
app.post('/api/upload', upload.single('pdf'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No PDF file uploaded' });
  }

  const filePath = req.file.path;
  const originalName = req.file.originalname;

  try {
    const pdfParser = new PDFParser(null, true); // true = raw text

    const pdfData = await new Promise((resolve, reject) => {
      pdfParser.on('pdfParser_dataError', errData => reject(errData.parserError));
      pdfParser.on('pdfParser_dataReady', pdfData => resolve(pdfData));
      pdfParser.loadPDF(filePath);
    });

    // Save JSON to disk
    const jsonDir = path.join(__dirname, 'json_output');
    if (!fs.existsSync(jsonDir)) fs.mkdirSync(jsonDir, { recursive: true });
    const jsonFileName = path.basename(originalName, '.pdf') + '.json';
    const jsonPath = path.join(jsonDir, jsonFileName);
    fs.writeFileSync(jsonPath, JSON.stringify(pdfData, null, 2), 'utf8');

    // Store in memory map
    const id = Date.now().toString();
    conversions.set(id, {
      id,
      originalName,
      jsonFileName,
      jsonPath,
      pdfPath: filePath,
      timestamp: new Date().toISOString(),
      pageCount: pdfData.Pages ? pdfData.Pages.length : 0,
      data: pdfData
    });

    res.json({
      success: true,
      id,
      originalName,
      jsonFileName,
      pageCount: pdfData.Pages ? pdfData.Pages.length : 0,
      jsonSize: JSON.stringify(pdfData).length,
      message: `Parsed ${originalName} → ${jsonFileName}`
    });
  } catch (err) {
    res.status(500).json({ error: `Failed to parse PDF: ${err.message}` });
  }
});

// API: Get JSON data for a conversion
app.get('/api/json/:id', (req, res) => {
  const conversion = conversions.get(req.params.id);
  if (!conversion) {
    return res.status(404).json({ error: 'Conversion not found' });
  }
  res.json(conversion.data);
});

// API: Download JSON file
app.get('/api/download/:id', (req, res) => {
  const conversion = conversions.get(req.params.id);
  if (!conversion) {
    return res.status(404).json({ error: 'Conversion not found' });
  }
  res.download(conversion.jsonPath, conversion.jsonFileName);
});

// API: List all conversions
app.get('/api/conversions', (req, res) => {
  const list = [];
  for (const [id, conv] of conversions) {
    list.push({
      id: conv.id,
      originalName: conv.originalName,
      jsonFileName: conv.jsonFileName,
      pageCount: conv.pageCount,
      timestamp: conv.timestamp
    });
  }
  res.json(list);
});

// API: Get summary/stats of a parsed PDF
app.get('/api/summary/:id', (req, res) => {
  const conversion = conversions.get(req.params.id);
  if (!conversion) {
    return res.status(404).json({ error: 'Conversion not found' });
  }
  const data = conversion.data;
  const pages = data.Pages || [];

  const summary = {
    originalName: conversion.originalName,
    pageCount: pages.length,
    totalTexts: 0,
    totalFills: 0,
    totalImages: 0,
    width: data.Width || 0,
    height: data.Height || 0,
    pagesDetail: []
  };

  pages.forEach((page, idx) => {
    const texts = page.Texts ? page.Texts.length : 0;
    const fills = page.Fills ? page.Fills.length : 0;
    const images = page.Images ? page.Images.length : 0;
    summary.totalTexts += texts;
    summary.totalFills += fills;
    summary.totalImages += images;
    summary.pagesDetail.push({
      page: idx + 1,
      texts,
      fills,
      images,
      hasFields: page.Fields ? page.Fields.length > 0 : false
    });
  });

  res.json(summary);
});

app.listen(PORT, () => {
  console.log(`\n  PDF2JSON Web Interface`);
  console.log(`  ──────────────────────`);
  console.log(`  Server running at: http://localhost:${PORT}`);
  console.log(`  Upload PDFs and view parsed JSON data\n`);
});
