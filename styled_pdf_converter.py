"""MVP PDF-to-styled-PDF converter.

This module uses PyMuPDF end to end: it extracts readable text blocks from an
input PDF, detects simple headings and table-like rows, then writes a clean
styled report PDF without depending on a browser renderer.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import argparse
import statistics
import textwrap
from typing import Iterable

import fitz


PAGE_WIDTH = 595
PAGE_HEIGHT = 842
MARGIN_X = 52
MARGIN_TOP = 54
MARGIN_BOTTOM = 52
CONTENT_WIDTH = PAGE_WIDTH - MARGIN_X * 2

INK = (0.12, 0.13, 0.16)
MUTED = (0.42, 0.45, 0.5)
ACCENT = (0.10, 0.32, 0.72)
ACCENT_DARK = (0.07, 0.20, 0.45)
PANEL = (0.94, 0.96, 0.99)
RULE = (0.80, 0.84, 0.90)
WHITE = (1, 1, 1)


@dataclass
class TextLine:
    text: str
    page: int
    x: float
    y: float
    size: float
    bold: bool


@dataclass
class RenderStats:
    pages_in: int
    pages_out: int
    lines: int
    title: str


def _clean_text(value: str) -> str:
    return " ".join(value.replace("\u00a0", " ").split())


def _is_bold(span: dict) -> bool:
    font = str(span.get("font") or "").lower()
    flags = int(span.get("flags") or 0)
    return "bold" in font or bool(flags & 16)


def extract_lines(input_pdf: str | Path) -> list[TextLine]:
    lines: list[TextLine] = []
    with fitz.open(input_pdf) as doc:
        for page_index, page in enumerate(doc, start=1):
            data = page.get_text("dict", sort=True)
            for block in data.get("blocks", []):
                if block.get("type") != 0:
                    continue
                for raw_line in block.get("lines", []):
                    spans = raw_line.get("spans") or []
                    parts = [_clean_text(str(span.get("text") or "")) for span in spans]
                    text = _clean_text(" ".join(part for part in parts if part))
                    if not text:
                        continue

                    bbox = raw_line.get("bbox") or [0, 0, 0, 0]
                    sizes = [float(span.get("size") or 10) for span in spans if span.get("text")]
                    line_size = statistics.median(sizes) if sizes else 10.0
                    bold = any(_is_bold(span) for span in spans)
                    lines.append(
                        TextLine(
                            text=text,
                            page=page_index,
                            x=float(bbox[0]),
                            y=float(bbox[1]),
                            size=line_size,
                            bold=bold,
                        )
                    )
    return lines


def _document_title(lines: list[TextLine], fallback: str) -> str:
    candidates = [line for line in lines[:40] if len(line.text) >= 4]
    if not candidates:
        return fallback
    candidates.sort(key=lambda line: (line.size, line.bold, -len(line.text)), reverse=True)
    title = candidates[0].text.strip(" :-")
    return title[:90] or fallback


def _line_kind(line: TextLine, body_size: float) -> str:
    text = line.text
    if line.size >= body_size + 4 or (line.bold and len(text) <= 90 and line.size >= body_size + 1):
        return "heading"
    if _looks_like_table_row(text):
        return "table"
    if len(text) <= 70 and text.endswith(":"):
        return "heading"
    return "body"


def _looks_like_table_row(text: str) -> bool:
    if "|" in text or "\t" in text:
        return True
    chunks = [chunk for chunk in text.split("  ") if chunk.strip()]
    if len(chunks) >= 3:
        return True
    tokens = text.split()
    numeric_tokens = sum(token.replace(",", "").replace(".", "").isdigit() for token in tokens)
    return len(tokens) >= 4 and numeric_tokens >= 2


def _wrap(text: str, width: int) -> list[str]:
    return textwrap.wrap(text, width=width, break_long_words=False, break_on_hyphens=False) or [""]


class StyledPdfWriter:
    def __init__(self, title: str, source_name: str) -> None:
        self.doc = fitz.open()
        self.title = title
        self.source_name = source_name
        self.page: fitz.Page | None = None
        self.y = MARGIN_TOP
        self.page_count = 0

    def new_page(self) -> None:
        self.page = self.doc.new_page(width=PAGE_WIDTH, height=PAGE_HEIGHT)
        self.page_count += 1
        self.y = MARGIN_TOP
        self._draw_header()

    def _draw_header(self) -> None:
        assert self.page is not None
        header = fitz.Rect(0, 0, PAGE_WIDTH, 74)
        self.page.draw_rect(header, color=ACCENT_DARK, fill=ACCENT_DARK)
        self.page.draw_rect(fitz.Rect(0, 70, PAGE_WIDTH, 74), color=ACCENT, fill=ACCENT)
        self.page.insert_text(
            fitz.Point(MARGIN_X, 31),
            self.title[:82],
            fontsize=16,
            fontname="helv",
            color=WHITE,
        )
        self.page.insert_text(
            fitz.Point(MARGIN_X, 54),
            f"Styled from {self.source_name}",
            fontsize=8.5,
            fontname="helv",
            color=(0.82, 0.88, 0.98),
        )
        self.y = 101

    def ensure_space(self, needed: float) -> None:
        if self.page is None:
            self.new_page()
            return
        if self.y + needed > PAGE_HEIGHT - MARGIN_BOTTOM:
            self._draw_footer()
            self.new_page()

    def _draw_footer(self) -> None:
        if self.page is None:
            return
        self.page.draw_line(
            fitz.Point(MARGIN_X, PAGE_HEIGHT - 36),
            fitz.Point(PAGE_WIDTH - MARGIN_X, PAGE_HEIGHT - 36),
            color=RULE,
            width=0.7,
        )
        self.page.insert_text(
            fitz.Point(PAGE_WIDTH - MARGIN_X - 46, PAGE_HEIGHT - 20),
            f"Page {self.page_count}",
            fontsize=8,
            color=MUTED,
        )

    def heading(self, text: str) -> None:
        wrapped = _wrap(text, 58)
        needed = 26 + (len(wrapped) - 1) * 15
        self.ensure_space(needed)
        assert self.page is not None
        self.y += 7
        self.page.draw_line(fitz.Point(MARGIN_X, self.y - 5), fitz.Point(MARGIN_X + 34, self.y - 5), color=ACCENT, width=2)
        for line in wrapped:
            self.page.insert_text(fitz.Point(MARGIN_X, self.y + 8), line, fontsize=13.5, fontname="helv", color=ACCENT_DARK)
            self.y += 16
        self.y += 3

    def paragraph(self, text: str) -> None:
        wrapped = _wrap(text, 92)
        self.ensure_space(10 + len(wrapped) * 12)
        assert self.page is not None
        for line in wrapped:
            self.page.insert_text(fitz.Point(MARGIN_X, self.y), line, fontsize=9.8, fontname="helv", color=INK)
            self.y += 12
        self.y += 4

    def table_row(self, text: str) -> None:
        wrapped = _wrap(text, 86)
        height = 16 + len(wrapped) * 11
        self.ensure_space(height + 4)
        assert self.page is not None
        rect = fitz.Rect(MARGIN_X - 7, self.y - 10, PAGE_WIDTH - MARGIN_X + 7, self.y + height - 8)
        self.page.draw_rect(rect, color=RULE, fill=PANEL, width=0.6)
        y = self.y
        for line in wrapped:
            self.page.insert_text(fitz.Point(MARGIN_X, y), line, fontsize=8.7, fontname="cour", color=INK)
            y += 11
        self.y += height

    def save(self, output_pdf: str | Path) -> None:
        self._draw_footer()
        self.doc.set_metadata({"title": self.title, "producer": "PDF2PDF MVP Styled Converter"})
        self.doc.save(output_pdf, garbage=4, deflate=True)
        self.doc.close()


def convert_pdf_to_styled_pdf(input_pdf: str | Path, output_pdf: str | Path) -> RenderStats:
    input_path = Path(input_pdf)
    output_path = Path(output_pdf)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    lines = extract_lines(input_path)
    title = _document_title(lines, input_path.stem)
    body_sizes = [line.size for line in lines if line.text]
    body_size = statistics.median(body_sizes) if body_sizes else 10.0

    writer = StyledPdfWriter(title=title, source_name=input_path.name)
    writer.new_page()

    last_page = 1
    for line in lines:
        if line.page != last_page:
            writer.heading(f"Source page {line.page}")
            last_page = line.page

        kind = _line_kind(line, body_size)
        if kind == "heading":
            writer.heading(line.text)
        elif kind == "table":
            writer.table_row(line.text)
        else:
            writer.paragraph(line.text)

    if not lines:
        writer.paragraph("No extractable text was found in this PDF. The source may be scanned or image-only.")

    writer.save(output_path)
    return RenderStats(pages_in=max((line.page for line in lines), default=0), pages_out=writer.page_count, lines=len(lines), title=title)


def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Convert a PDF into a clean styled PDF MVP output.")
    parser.add_argument("input_pdf", help="Path to the source PDF")
    parser.add_argument("output_pdf", nargs="?", help="Path for the styled PDF output")
    args = parser.parse_args(list(argv) if argv is not None else None)

    input_path = Path(args.input_pdf)
    if not input_path.exists():
        parser.error(f"Input PDF not found: {input_path}")
    if input_path.suffix.lower() != ".pdf":
        parser.error("Input file must be a PDF.")

    output_path = Path(args.output_pdf) if args.output_pdf else input_path.with_name(f"{input_path.stem}_styled.pdf")
    stats = convert_pdf_to_styled_pdf(input_path, output_path)
    print(f"Output: {output_path}")
    print(f"Title: {stats.title}")
    print(f"Input pages: {stats.pages_in}")
    print(f"Output pages: {stats.pages_out}")
    print(f"Text lines: {stats.lines}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
