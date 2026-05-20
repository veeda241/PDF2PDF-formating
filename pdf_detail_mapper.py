"""Move details from one PDF into matching questions on another PDF.

The source PDF can contain simple pairs such as:
    Name - Vyas
    Email: vyas@example.com

The target PDF may be an AcroForm or a flat styled/template PDF. The matcher
uses the existing FieldMatcher canonical labels plus fuzzy matching, then writes
the values into the right places.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import argparse
import re
from typing import Iterable

import fitz

from semantic_field_matcher import FieldMatcher


VALUE_SEPARATORS = (" - ", " – ", " — ", ": ", "\t", "|")
IGNORED_LABELS = {"page", "date printed", "printed"}


@dataclass
class TargetLabel:
    text: str
    page_index: int
    rect: fitz.Rect
    font_size: float


@dataclass
class FillResult:
    source_fields: dict[str, str]
    matched_values: dict[str, str]
    output_pdf: str


def _clean(value: str) -> str:
    return " ".join(str(value).replace("\u00a0", " ").split()).strip()


def _strip_question_noise(value: str) -> str:
    value = _clean(value)
    value = re.sub(r"[_\.]{3,}.*$", "", value).strip()
    value = re.sub(r"\s+(yes|no)\s*$", "", value, flags=re.IGNORECASE).strip()
    return value.strip(" :-")


def _text_lines(pdf_path: str | Path) -> list[str]:
    lines: list[str] = []
    with fitz.open(pdf_path) as doc:
        for page in doc:
            text = page.get_text("text", sort=True)
            for line in text.splitlines():
                cleaned = _clean(line)
                if cleaned:
                    lines.append(cleaned)
    return lines


def _split_pair(line: str) -> tuple[str, str] | None:
    for separator in VALUE_SEPARATORS:
        if separator not in line:
            continue
        left, right = line.split(separator, 1)
        label = _strip_question_noise(left)
        value = _clean(right)
        if _valid_pair(label, value):
            return label, value

    compact_match = re.match(r"^([A-Za-z][A-Za-z0-9 /().,#'&-]{1,45})\s{2,}(.{1,120})$", line)
    if compact_match:
        label = _strip_question_noise(compact_match.group(1))
        value = _clean(compact_match.group(2))
        if _valid_pair(label, value):
            return label, value

    return None


def _valid_pair(label: str, value: str) -> bool:
    if not label or not value:
        return False
    if len(label) > 60 or len(value) > 180:
        return False
    if label.lower() in IGNORED_LABELS:
        return False
    if len(label.split()) > 8:
        return False
    return True


def extract_detail_fields(source_pdf: str | Path) -> dict[str, str]:
    lines = _text_lines(source_pdf)
    fields: dict[str, str] = {}

    for line in lines:
        pair = _split_pair(line)
        if pair:
            label, value = pair
            fields.setdefault(label, value)

    for index, line in enumerate(lines[:-1]):
        if _split_pair(line):
            continue
        label = _strip_question_noise(line)
        next_line = _clean(lines[index + 1])
        if _valid_pair(label, next_line) and not _split_pair(next_line):
            fields.setdefault(label, next_line)

    return fields


def _widget_label(widget: fitz.Widget) -> str:
    label = _clean(getattr(widget, "field_label", "") or "")
    if label:
        return label
    return _clean(getattr(widget, "field_name", "") or "")


def _extract_target_labels(doc: fitz.Document) -> list[TargetLabel]:
    labels: list[TargetLabel] = []

    for page_index, page in enumerate(doc):
        data = page.get_text("dict", sort=True)
        for block in data.get("blocks", []):
            if block.get("type") != 0:
                continue
            for line in block.get("lines", []):
                spans = line.get("spans") or []
                text = _strip_question_noise(" ".join(_clean(span.get("text") or "") for span in spans))
                if not text or len(text) < 2:
                    continue
                rect = fitz.Rect(line.get("bbox") or [0, 0, 0, 0])
                font_size = max((float(span.get("size") or 10) for span in spans), default=10.0)
                labels.append(TargetLabel(text=text, page_index=page_index, rect=rect, font_size=font_size))

    return labels


def _build_matches(source_fields: dict[str, str], target_labels: list[str], matcher: FieldMatcher) -> dict[str, str]:
    matches = matcher.match_fields(source_fields, target_labels)

    # Preserve direct label matches that are too project-specific for the canonical registry.
    lowered_source = {key.lower().strip(): value for key, value in source_fields.items()}
    for label in target_labels:
        normalized_label = label.lower().strip()
        if normalized_label in lowered_source:
            matches.setdefault(label, lowered_source[normalized_label])

    return matches


def _fill_widgets(doc: fitz.Document, source_fields: dict[str, str], matcher: FieldMatcher) -> dict[str, str]:
    labels: list[str] = []
    widgets: list[fitz.Widget] = []
    for page in doc:
        for widget in page.widgets() or []:
            label = _widget_label(widget)
            if not label:
                continue
            labels.append(label)
            widgets.append(widget)

    matches = _build_matches(source_fields, labels, matcher)
    for widget in widgets:
        label = _widget_label(widget)
        value = matches.get(label)
        if value is None:
            continue
        try:
            widget.field_value = value
            widget.update()
        except Exception:
            continue

    return matches


def _overlay_flat_labels(doc: fitz.Document, source_fields: dict[str, str], matcher: FieldMatcher) -> dict[str, str]:
    labels = _extract_target_labels(doc)
    label_texts = [label.text for label in labels]
    matches = _build_matches(source_fields, label_texts, matcher)
    used_keys: set[str] = set()

    for label in labels:
        value = matches.get(label.text)
        if value is None:
            continue

        usage_key = f"{label.page_index}:{label.text.lower()}:{value}"
        if usage_key in used_keys:
            continue
        used_keys.add(usage_key)

        page = doc[label.page_index]
        font_size = max(8.5, min(label.font_size, 12.0))
        x = label.rect.x1 + 10
        y = label.rect.y1 - 2
        text_width = fitz.get_text_length(value, fontname="helv", fontsize=font_size)

        if x + text_width > page.rect.width - 36:
            x = label.rect.x0
            y = label.rect.y1 + font_size + 5

        page.insert_text(
            fitz.Point(x, y),
            value,
            fontsize=font_size,
            fontname="helv",
            color=(0.05, 0.18, 0.55),
            overlay=True,
        )

    return matches


def fill_styled_pdf_from_detail_pdf(
    detail_pdf: str | Path,
    styled_pdf: str | Path,
    output_pdf: str | Path,
    *,
    fuzzy_threshold: float = 0.45,
) -> FillResult:
    source_fields = extract_detail_fields(detail_pdf)
    if not source_fields:
        raise ValueError("No detail pairs were found in the source PDF. Use lines like 'Name - Vyas' or 'Email: value'.")

    matcher = FieldMatcher(fuzzy_threshold=fuzzy_threshold)
    output_path = Path(output_pdf)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    doc = fitz.open(styled_pdf)
    try:
        widget_matches = _fill_widgets(doc, source_fields, matcher)
        flat_matches = _overlay_flat_labels(doc, source_fields, matcher)
        matched_values = {**flat_matches, **widget_matches}
        doc.save(output_path, garbage=4, deflate=True)
    finally:
        doc.close()

    return FillResult(source_fields=source_fields, matched_values=matched_values, output_pdf=str(output_path))


def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Fill a styled/template PDF using details extracted from another PDF.")
    parser.add_argument("detail_pdf", help="PDF containing values, e.g. 'Name - Vyas'")
    parser.add_argument("styled_pdf", help="Styled/template PDF containing questions")
    parser.add_argument("output_pdf", nargs="?", help="Output filled PDF")
    args = parser.parse_args(list(argv) if argv is not None else None)

    detail_path = Path(args.detail_pdf)
    styled_path = Path(args.styled_pdf)
    if not detail_path.exists():
        parser.error(f"Detail PDF not found: {detail_path}")
    if not styled_path.exists():
        parser.error(f"Styled PDF not found: {styled_path}")

    output_path = Path(args.output_pdf) if args.output_pdf else styled_path.with_name(f"{styled_path.stem}_filled.pdf")
    result = fill_styled_pdf_from_detail_pdf(detail_path, styled_path, output_path)

    print(f"Output: {result.output_pdf}")
    print(f"Source fields: {len(result.source_fields)}")
    print(f"Matched questions: {len(result.matched_values)}")
    for label, value in result.matched_values.items():
        print(f"  {label} -> {value}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
