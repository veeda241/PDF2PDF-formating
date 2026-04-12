"""Semantic field matching helpers for PDF form filling.

This module maps arbitrary question labels to canonical field keys and can
fill a target AcroForm PDF from pdf2json-style source JSON.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from difflib import SequenceMatcher
import json
import re
from pathlib import Path
from typing import Any, Optional


CANONICAL_FIELDS: dict[str, list[str]] = {
    "name": [
        "name",
        "full name",
        "fullname",
        "your name",
        "what is your name",
        "enter your name",
        "applicant name",
        "candidate name",
        "customer name",
        "first and last name",
        "complete name",
        "legal name",
    ],
    "first_name": [
        "first name",
        "firstname",
        "given name",
        "forename",
        "fname",
        "first",
        "given",
    ],
    "last_name": [
        "last name",
        "lastname",
        "surname",
        "family name",
        "lname",
        "last",
        "family",
    ],
    "email": [
        "email",
        "email address",
        "e-mail",
        "mail",
        "email id",
        "your email",
        "contact email",
        "e mail",
        "electronic mail",
    ],
    "phone": [
        "phone",
        "phone number",
        "mobile",
        "mobile number",
        "mobile no",
        "contact number",
        "telephone",
        "tel",
        "cell",
        "phone no",
        "contact no",
        "ph no",
        "ph number",
        "cell number",
        "cell phone",
    ],
    "address": [
        "address",
        "full address",
        "current address",
        "home address",
        "mailing address",
        "residential address",
        "street address",
        "postal address",
        "your address",
        "permanent address",
    ],
    "city": ["city", "town", "city name", "place"],
    "state": ["state", "province", "region", "state name", "county"],
    "zip": [
        "zip",
        "zip code",
        "postal code",
        "pincode",
        "pin code",
        "post code",
        "zip/postal code",
    ],
    "country": ["country", "nation", "country name", "nationality"],
    "dob": [
        "dob",
        "date of birth",
        "birth date",
        "birthday",
        "born on",
        "date of birth (dd/mm/yyyy)",
        "birth day",
        "date of birth (mm/dd/yyyy)",
        "d.o.b",
    ],
    "age": [
        "age",
        "your age",
        "how old",
        "age in years",
        "current age",
        "age (years)",
    ],
    "gender": [
        "gender",
        "sex",
        "gender identity",
        "male/female",
        "m/f",
        "sex (m/f)",
    ],
    "occupation": [
        "occupation",
        "job",
        "profession",
        "job title",
        "designation",
        "current job",
        "work",
        "employment",
        "position",
        "role",
        "current occupation",
    ],
    "company": [
        "company",
        "organization",
        "organisation",
        "employer",
        "company name",
        "firm",
        "workplace",
        "business name",
        "name of company",
        "name of organization",
    ],
    "salary": [
        "salary",
        "income",
        "annual income",
        "monthly salary",
        "pay",
        "compensation",
        "ctc",
        "wage",
        "earnings",
        "annual salary",
        "gross salary",
    ],
    "id_number": [
        "id number",
        "identification number",
        "id no",
        "national id",
        "gov id",
        "identification",
        "id",
        "id#",
    ],
    "ssn": [
        "ssn",
        "social security",
        "social security number",
        "social security no",
    ],
    "passport": [
        "passport",
        "passport number",
        "passport no",
        "passport #",
    ],
    "signature": [
        "signature",
        "sign",
        "sign here",
        "applicant signature",
        "authorized signature",
        "your signature",
    ],
    "date": [
        "date",
        "today's date",
        "current date",
        "submission date",
        "form date",
        "today date",
    ],
    "remarks": [
        "remarks",
        "comments",
        "notes",
        "additional comments",
        "any other info",
        "message",
        "description",
        "additional information",
        "other details",
    ],
}

_STOP_WORDS = frozenset(
    {
        "what",
        "is",
        "your",
        "the",
        "a",
        "an",
        "please",
        "enter",
        "provide",
        "give",
        "write",
        "fill",
        "current",
        "full",
        "complete",
        "of",
        "in",
        "for",
        "and",
        "or",
        "with",
        "any",
        "do",
        "you",
        "are",
        "have",
        "this",
        "that",
        "my",
        "our",
        "their",
    }
)


@dataclass
class MatchResult:
    key: str
    method: str
    score: float


def _normalize(text: str) -> str:
    text = text.lower()
    text = re.sub(r"[^a-z0-9 ]", " ", text)
    tokens = [token for token in text.split() if token not in _STOP_WORDS]
    return " ".join(tokens).strip()


def _token_jaccard(left: str, right: str) -> float:
    left_tokens = set(left.split())
    right_tokens = set(right.split())
    if not left_tokens or not right_tokens:
        return 0.0
    return len(left_tokens & right_tokens) / len(left_tokens | right_tokens)


def _edit_distance(left: str, right: str) -> int:
    left_length = len(left)
    right_length = len(right)
    if left_length == 0:
        return right_length
    if right_length == 0:
        return left_length

    previous_row = list(range(right_length + 1))
    for left_index in range(1, left_length + 1):
        current_row = [left_index] + [0] * right_length
        for right_index in range(1, right_length + 1):
            cost = 0 if left[left_index - 1] == right[right_index - 1] else 1
            current_row[right_index] = min(
                previous_row[right_index] + 1,
                current_row[right_index - 1] + 1,
                previous_row[right_index - 1] + cost,
            )
        previous_row = current_row

    return previous_row[right_length]


def _edit_sim(left: str, right: str) -> float:
    max_length = max(len(left), len(right), 1)
    return 1.0 - _edit_distance(left, right) / max_length


def _first_text(*values: Any) -> str:
    for value in values:
        if value is None:
            continue
        if isinstance(value, str):
            candidate = value.strip()
            if candidate:
                return candidate
            continue
        if isinstance(value, dict):
            for key in ("Name", "Label", "Text", "TU", "T", "Id", "id", "V", "value"):
                candidate = _first_text(value.get(key))
                if candidate:
                    return candidate
            continue
        if isinstance(value, bool):
            continue
        candidate = str(value).strip()
        if candidate:
            return candidate
    return ""


def _pdf_root(pdf_data: dict[str, Any]) -> dict[str, Any]:
    form_image = pdf_data.get("formImage")
    if isinstance(form_image, dict):
        return form_image
    return pdf_data


def _extract_source_label(item: dict[str, Any]) -> str:
    return _first_text(
        item.get("TU"),
        item.get("T"),
        item.get("label"),
        item.get("Label"),
        item.get("name"),
        item.get("id"),
        (item.get("id") or {}).get("Id") if isinstance(item.get("id"), dict) else None,
    )


def _extract_source_value(item: dict[str, Any]) -> str:
    value = _first_text(item.get("V"), item.get("value"))
    if value:
        return value

    if item.get("checked"):
        return _first_text(item.get("value"), item.get("V")) or "Yes"

    return ""


def _collect_source_fields(pdf_data: dict[str, Any]) -> dict[str, str]:
    source_fields: dict[str, str] = {}
    pdf_root = _pdf_root(pdf_data)

    for page in pdf_root.get("Pages") or []:
        for field in page.get("Fields") or []:
            if not isinstance(field, dict):
                continue

            label = _extract_source_label(field)
            value = _extract_source_value(field)
            if label and value:
                source_fields[label] = value

        for boxset in page.get("Boxsets") or []:
            if not isinstance(boxset, dict):
                continue

            label = _extract_source_label(boxset)
            if not label:
                continue

            for box in boxset.get("boxes") or []:
                if not isinstance(box, dict) or not box.get("checked"):
                    continue
                value = _extract_source_value(box) or "Yes"
                source_fields[label] = value

    return source_fields


class FieldMatcher:
    def __init__(
        self,
        fuzzy_threshold: float = 0.45,
        token_weight: float = 0.65,
        extra_fields: Optional[dict[str, list[str]]] = None,
    ) -> None:
        self.threshold = fuzzy_threshold
        self.tw = token_weight
        self.ew = 1.0 - token_weight

        self._registry: dict[str, list[str]] = {key: list(values) for key, values in CANONICAL_FIELDS.items()}
        if extra_fields:
            for key, variants in extra_fields.items():
                existing = self._registry.setdefault(key, [])
                for variant in variants:
                    if variant not in existing:
                        existing.append(variant)

        self._exact_map: dict[str, str] = {}
        self._norm_map: dict[str, str] = {}
        self._norm_variants: list[tuple[str, str]] = []

        for key, variants in self._registry.items():
            for variant in variants:
                raw_variant = variant.lower().strip()
                if raw_variant:
                    self._exact_map[raw_variant] = key
                normalized_variant = _normalize(raw_variant)
                if normalized_variant:
                    self._norm_map[normalized_variant] = key
                    self._norm_variants.append((normalized_variant, key))

    def _resolve_key(self, label: str) -> str:
        match = self.match(label)
        if match:
            return match.key

        normalized = _normalize(label)
        if normalized:
            return normalized

        return label.strip().lower()

    def match(self, label: str) -> Optional[MatchResult]:
        if not label or not label.strip():
            return None

        raw = label.strip().lower()

        if raw in self._exact_map:
            return MatchResult(self._exact_map[raw], "exact", 1.0)

        normalized = _normalize(raw)
        if normalized in self._norm_map:
            return MatchResult(self._norm_map[normalized], "normalized", 0.9)

        best_score = 0.0
        best_key: str | None = None
        for normalized_variant, key in self._norm_variants:
            score = self.tw * _token_jaccard(normalized, normalized_variant) + self.ew * _edit_sim(normalized, normalized_variant)
            if score > best_score:
                best_score = score
                best_key = key

        if best_key and best_score >= self.threshold:
            return MatchResult(best_key, "fuzzy", round(best_score, 4))

        return None

    def match_fields(self, source_fields: dict[str, str], target_labels: list[str]) -> dict[str, str]:
        canonical_to_value: dict[str, str] = {}

        for raw_key, value in source_fields.items():
            resolved_key = self._resolve_key(raw_key)
            if resolved_key:
                canonical_to_value[resolved_key] = value

        output: dict[str, str] = {}
        for label in target_labels:
            resolved_key = self._resolve_key(label)
            if resolved_key and resolved_key in canonical_to_value:
                output[label] = canonical_to_value[resolved_key]

        return output

    def add_variants(self, key: str, *variants: str) -> None:
        existing = self._registry.setdefault(key, [])
        for variant in variants:
            if variant not in existing:
                existing.append(variant)
            raw_variant = variant.lower().strip()
            if raw_variant:
                self._exact_map[raw_variant] = key
            normalized_variant = _normalize(raw_variant)
            if normalized_variant:
                self._norm_map[normalized_variant] = key
                self._norm_variants.append((normalized_variant, key))


def fill_pdf_from_json(
    source_json_path: str,
    target_pdf_path: str,
    output_pdf_path: str,
    *,
    matcher: Optional[FieldMatcher] = None,
    fuzzy_threshold: float = 0.45,
) -> dict[str, str]:
    try:
        from pypdf import PdfReader, PdfWriter
    except ImportError as exc:
        raise ImportError("Install pypdf: pip install pypdf") from exc

    if matcher is None:
        matcher = FieldMatcher(fuzzy_threshold=fuzzy_threshold)

    with open(source_json_path, "r", encoding="utf-8") as source_file:
        source_data = json.load(source_file)

    source_fields = _collect_source_fields(source_data)
    if not source_fields:
        print("[FieldMatcher] Warning: no field values found in source JSON.")

    reader = PdfReader(target_pdf_path)
    target_labels = list((reader.get_fields() or {}).keys())
    filled_values = matcher.match_fields(source_fields, target_labels)

    writer = PdfWriter()
    writer.append(reader)

    if hasattr(writer, "set_need_appearances_writer"):
        try:
            writer.set_need_appearances_writer()
        except Exception:
            pass

    for field_name, value in filled_values.items():
        for page in writer.pages:
            try:
                writer.update_page_form_field_values(page, {field_name: value})
            except Exception:
                continue

    Path(output_pdf_path).parent.mkdir(parents=True, exist_ok=True)
    with open(output_pdf_path, "wb") as output_file:
        writer.write(output_file)

    print(f"[FieldMatcher] Filled {len(filled_values)} / {len(target_labels)} fields.")
    print(f"[FieldMatcher] Saved -> {output_pdf_path}")
    return filled_values


if __name__ == "__main__":
    import sys

    matcher = FieldMatcher()

    if len(sys.argv) >= 4:
        result = fill_pdf_from_json(sys.argv[1], sys.argv[2], sys.argv[3], matcher=matcher)
        print("Filled fields:")
        for key, value in result.items():
            print(f"  {key!r:40s} -> {value!r}")
    else:
        print("Semantic Field Matcher test mode")
        print("Type a question label to see how it maps. Ctrl+C to exit.\n")
        while True:
            try:
                label = input("Label: ").strip()
                if not label:
                    continue
                result = matcher.match(label)
                if result:
                    print(f"  -> [{result.method}] key='{result.key}' score={result.score:.2f}\n")
                else:
                    print("  -> No match found.\n")
            except KeyboardInterrupt:
                print("\nBye.")
                break