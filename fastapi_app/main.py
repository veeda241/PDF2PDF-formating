from __future__ import annotations

from collections import defaultdict, deque
from copy import deepcopy
from difflib import SequenceMatcher
import json
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any
from urllib.parse import unquote

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

from pdf_detail_mapper import fill_styled_pdf_from_detail_pdf
from semantic_field_matcher import fill_pdf_from_json
from styled_pdf_converter import convert_pdf_to_styled_pdf

REPO_ROOT = Path(__file__).resolve().parents[1]
NODE_BINARY = os.getenv("NODE_BINARY", "node")
PDF_TO_JSON_SCRIPT = REPO_ROOT / "bin" / "pdf2json.js"
JSON_TO_PDF_SCRIPT = REPO_ROOT / "json_to_pdf.mjs"

app = FastAPI(
    title="PDF2PDF FastAPI Test API",
    version="4.1.0",
    description="FastAPI test server for PDF to JSON parsing, JSON to PDF rendering, and PDF-driven form filling.",
)


def get_node_binary() -> str:
    node_binary = shutil.which(NODE_BINARY)
    if node_binary is None:
        raise HTTPException(status_code=500, detail="Node.js was not found in PATH.")
    return node_binary


async def save_upload_file(upload_file: UploadFile, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    with destination.open("wb") as output_file:
        while True:
            chunk = await upload_file.read(1024 * 1024)
            if not chunk:
                break
            output_file.write(chunk)


def run_command(command: list[str]) -> None:
    completed = subprocess.run(
        command,
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
    )
    if completed.returncode != 0:
        stderr = completed.stderr.strip()
        stdout = completed.stdout.strip()
        detail = {
            "command": command,
            "stdout": stdout,
            "stderr": stderr,
        }
        raise HTTPException(status_code=500, detail=detail)


def load_json_file(json_path: Path) -> dict[str, Any]:
    return json.loads(json_path.read_text(encoding="utf-8"))


def normalize_pdf_data(pdf_data: dict[str, Any]) -> dict[str, Any]:
    form_image = pdf_data.get("formImage")
    if isinstance(form_image, dict):
        return form_image
    return pdf_data


def normalize_question_text(value: Any) -> str:
    if value is None:
        return ""

    normalized = str(value).strip().lower()
    normalized = re.sub(r"[^a-z0-9]+", " ", normalized)
    return re.sub(r"\s+", " ", normalized).strip()


QUESTION_TEXT_REPLACEMENTS: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"\bfullname\b"), "full name"),
    (re.compile(r"\bfirstname\b"), "first name"),
    (re.compile(r"\blastname\b"), "last name"),
    (re.compile(r"\bmiddlename\b"), "middle name"),
    (re.compile(r"\bphonenumber\b"), "phone number"),
    (re.compile(r"\bmobilenumber\b"), "mobile number"),
    (re.compile(r"\btelephone number\b"), "phone number"),
    (re.compile(r"\bemailaddress\b"), "email address"),
    (re.compile(r"\be[- ]?mail\b"), "email"),
    (re.compile(r"\bdateofbirth\b"), "date of birth"),
    (re.compile(r"\bdob\b"), "date of birth"),
    (re.compile(r"\bpostalcode\b"), "postal code"),
    (re.compile(r"\bzipcode\b"), "zip code"),
    (re.compile(r"\bwhat s\b"), "what is"),
    (re.compile(r"\bwhats\b"), "what is"),
)

QUESTION_FILLER_WORDS: set[str] = {
    "a",
    "an",
    "are",
    "could",
    "enter",
    "for",
    "give",
    "in",
    "is",
    "kindly",
    "me",
    "of",
    "please",
    "provide",
    "s",
    "select",
    "state",
    "tell",
    "the",
    "this",
    "that",
    "to",
    "type",
    "us",
    "was",
    "were",
    "what",
    "would",
    "write",
    "you",
    "your",
}

QUESTION_CANONICAL_PATTERNS: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"^name$"), "name"),
    (re.compile(r"^full name$"), "name"),
    (re.compile(r"^your name$"), "name"),
    (re.compile(r"^what(?: is| s|s)?(?: your| the)?(?: full)? name$"), "name"),
    (re.compile(r"^(?:please|kindly)?\s*(?:enter|provide|state|write|type|give)(?:\s+your)?(?:\s+full)?\s+name$"), "name"),
    (re.compile(r"^full name please$"), "name"),
    (re.compile(r"^first name$"), "first name"),
    (re.compile(r"^given name$"), "first name"),
    (re.compile(r"^last name$"), "last name"),
    (re.compile(r"^surname$"), "last name"),
    (re.compile(r"^family name$"), "last name"),
    (re.compile(r"^middle name$"), "middle name"),
    (re.compile(r"^email$"), "email"),
    (re.compile(r"^e mail$"), "email"),
    (re.compile(r"^email address$"), "email"),
    (re.compile(r"^phone$"), "phone"),
    (re.compile(r"^phone number$"), "phone"),
    (re.compile(r"^telephone$"), "phone"),
    (re.compile(r"^telephone number$"), "phone"),
    (re.compile(r"^mobile$"), "phone"),
    (re.compile(r"^mobile number$"), "phone"),
    (re.compile(r"^cell phone$"), "phone"),
    (re.compile(r"^cell number$"), "phone"),
    (re.compile(r"^address$"), "address"),
    (re.compile(r"^mailing address$"), "address"),
    (re.compile(r"^home address$"), "address"),
    (re.compile(r"^street address$"), "address"),
    (re.compile(r"^date of birth$"), "dob"),
    (re.compile(r"^birth date$"), "dob"),
    (re.compile(r"^dob$"), "dob"),
    (re.compile(r"^age$"), "age"),
    (re.compile(r"^city$"), "city"),
    (re.compile(r"^state$"), "state"),
    (re.compile(r"^zip code$"), "zip code"),
    (re.compile(r"^postal code$"), "zip code"),
    (re.compile(r"^postcode$"), "zip code"),
    (re.compile(r"^current address$"), "address"),
    (re.compile(r"^present address$"), "address"),
    (re.compile(r"^permanent address$"), "address"),
    (re.compile(r"^contact number$"), "phone"),
    (re.compile(r"^contact phone$"), "phone"),
    (re.compile(r"^phone no$"), "phone"),
    (re.compile(r"^phone no\.?$"), "phone"),
    (re.compile(r"^tel no$"), "phone"),
    (re.compile(r"^tel no\.?$"), "phone"),
    (re.compile(r"^sex$"), "gender"),
    (re.compile(r"^gender$"), "gender"),
    (re.compile(r"^marital status$"), "marital status"),
    (re.compile(r"^martial status$"), "marital status"),
    (re.compile(r"^occupation$"), "occupation"),
    (re.compile(r"^job title$"), "occupation"),
    (re.compile(r"^profession$"), "occupation"),
)

QUESTION_FUZZY_MATCH_THRESHOLD = 0.82


def canonicalize_question_text(value: Any) -> str:
    normalized = normalize_question_text(value)
    if not normalized:
        return ""

    for pattern, replacement in QUESTION_TEXT_REPLACEMENTS:
        normalized = pattern.sub(replacement, normalized)

    collapsed = " ".join(
        token for token in normalized.split() if token not in QUESTION_FILLER_WORDS
    ).strip()
    if not collapsed:
        return ""

    for candidate in (collapsed, normalized):
        for pattern, canonical in QUESTION_CANONICAL_PATTERNS:
            if pattern.fullmatch(candidate):
                return canonical

    return collapsed


def question_key_similarity(left: str, right: str) -> float:
    if not left or not right:
        return 0.0
    if left == right:
        return 1.0

    left_tokens = set(left.split())
    right_tokens = set(right.split())
    if not left_tokens or not right_tokens:
        return 0.0

    token_overlap = len(left_tokens & right_tokens) / len(left_tokens | right_tokens)
    char_ratio = SequenceMatcher(None, left, right).ratio()
    if left in right or right in left:
        length_ratio = min(len(left), len(right)) / max(len(left), len(right))
        char_ratio = max(char_ratio, length_ratio)

    return max(token_overlap, char_ratio)


def pop_matching_value(values_by_key: dict[str, deque[str]], key: str) -> str | None:
    exact_value = pop_next_value(values_by_key, key)
    if exact_value is not None:
        return exact_value

    if not key:
        return None

    best_key = ""
    best_score = 0.0
    for candidate_key in values_by_key.keys():
        score = question_key_similarity(key, candidate_key)
        if score > best_score:
            best_key = candidate_key
            best_score = score

    if best_key and best_score >= QUESTION_FUZZY_MATCH_THRESHOLD:
        return pop_next_value(values_by_key, best_key)

    return None


def build_pdf_text_lines(page: dict[str, Any]) -> list[dict[str, Any]]:
    text_items: list[dict[str, Any]] = []
    for text_item in page.get("Texts") or []:
        if not isinstance(text_item, dict):
            continue
        text = decode_pdf_text_item(text_item)
        if text == "":
            continue
        text_items.append(
            {
                "x": float(text_item.get("x") or 0),
                "y": float(text_item.get("y") or 0),
                "w": float(text_item.get("w") or 0),
                "text": text,
                "source": text_item,
            }
        )

    text_items.sort(key=lambda item: (item["y"], item["x"]))

    grouped_lines: list[dict[str, Any]] = []
    current_line: dict[str, Any] | None = None
    current_y_key: float | None = None

    for item in text_items:
        y_key = round(item["y"], 2)
        if current_line is None or current_y_key is None or abs(y_key - current_y_key) > 0.05:
            current_line = {
                "x": item["x"],
                "y": item["y"],
                "w": item["w"],
                "text": item["text"],
                "source": item["source"],
            }
            grouped_lines.append(current_line)
            current_y_key = y_key
            continue

        previous_text = current_line["text"]
        previous_right = float(current_line["x"]) + float(current_line["w"])
        gap = item["x"] - previous_right
        if gap > 0.18 and not previous_text.endswith(" ") and not item["text"].startswith(" "):
            current_line["text"] += " "

        current_line["text"] += item["text"]
        current_line["w"] = max(float(current_line["w"]), item["x"] + item["w"] - float(current_line["x"]))

    return grouped_lines


def decode_pdf_text_item(text_item: dict[str, Any]) -> str:
    runs = text_item.get("R") or []
    if not isinstance(runs, list):
        return ""

    decoded_runs: list[str] = []
    for run in runs:
        if not isinstance(run, dict):
            continue
        raw_value = run.get("T")
        if raw_value is None:
            continue
        decoded_runs.append(unquote(str(raw_value)))

    return "".join(decoded_runs)


def is_text_inside_field(text_item: dict[str, Any], field: dict[str, Any]) -> bool:
    text_x = float(text_item.get("x") or 0)
    text_y = float(text_item.get("y") or 0)
    text_w = float(text_item.get("w") or 0)
    field_x = float(field.get("x") or 0)
    field_y = float(field.get("y") or 0)
    field_w = float(field.get("w") or 0)
    field_h = float(field.get("h") or 0)

    text_right = text_x + max(text_w, 0)
    field_right = field_x + max(field_w, 0)
    return not (
        text_right < field_x - 0.15
        or text_x > field_right + 0.75
        or text_y < field_y - 0.35
        or text_y > field_y + max(field_h, 0.5) + 0.75
    )


def extract_field_text_value(page: dict[str, Any], field: dict[str, Any]) -> str:
    candidates: list[tuple[float, str]] = []
    field_x = float(field.get("x") or 0)
    field_y = float(field.get("y") or 0)
    field_w = float(field.get("w") or 0)
    field_h = float(field.get("h") or 0)

    for line_item in build_pdf_text_lines(page):
        line_text = str(line_item.get("text") or "").strip()
        if not line_text:
            continue

        line_x = float(line_item.get("x") or 0)
        line_y = float(line_item.get("y") or 0)
        line_w = float(line_item.get("w") or 0)
        line_right = line_x + max(line_w, 0)
        field_right = field_x + max(field_w, 0)

        if (
            line_right < field_x - 0.15
            or line_x > field_right + 0.75
            or line_y < field_y - 0.35
            or line_y > field_y + max(field_h, 0.5) + 0.75
        ):
            continue

        candidates.append((line_x, line_text))

    if not candidates:
        return ""

    candidates.sort(key=lambda item: item[0])
    return " ".join(text for _, text in candidates).strip()


def find_nearby_label_text(page: dict[str, Any], field: dict[str, Any]) -> str:
    field_x = float(field.get("x") or 0)
    field_y = float(field.get("y") or 0)
    field_w = float(field.get("w") or 0)
    field_h = float(field.get("h") or 0)

    best_text = ""
    best_score: float | None = None

    for line_item in build_pdf_text_lines(page):
        text = str(line_item.get("text") or "").strip()
        if not text:
            continue

        text_x = float(line_item.get("x") or 0)
        text_y = float(line_item.get("y") or 0)
        text_w = float(line_item.get("w") or 0)
        text_right = text_x + max(text_w, 0)

        horizontal_gap = max(field_x - text_right, 0)
        vertical_gap = abs(text_y - field_y)

        if horizontal_gap > max(field_w, 0.5) + 8:
            continue
        if vertical_gap > max(field_h, 0.75) + 2:
            continue

        score = horizontal_gap + vertical_gap * 1.5
        if best_score is None or score < best_score or (score == best_score and len(text) > len(best_text)):
            best_text = text
            best_score = score

    return best_text


def build_field_question_key(page: dict[str, Any], field: dict[str, Any]) -> str:
    question_text = canonicalize_question_text(field.get("TU"))
    if not question_text:
        question_text = canonicalize_question_text(find_nearby_label_text(page, field))
    if not question_text:
        return ""
    return question_text


def pop_next_value(values_by_key: dict[str, deque[str]], key: str) -> str | None:
    queue = values_by_key.get(key)
    if not queue:
        return None

    value = queue.popleft()
    if not queue:
        values_by_key.pop(key, None)
    return value


def convert_pdf_to_json(node_binary: str, input_pdf: Path, output_dir: Path) -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    run_command([
        node_binary,
        str(PDF_TO_JSON_SCRIPT),
        "-f",
        str(input_pdf),
        "-o",
        str(output_dir),
        "-s",
    ])

    json_path = output_dir / f"{input_pdf.stem}.json"
    if not json_path.exists():
        raise HTTPException(status_code=500, detail="Parser finished but JSON output was not created.")
    return json_path


def collect_form_state(pdf_data: dict[str, Any]) -> tuple[dict[str, deque[str]], dict[str, deque[str]], dict[str, set[str]], set[str]]:
    field_values_by_id: dict[str, deque[str]] = defaultdict(deque)
    field_values_by_question: dict[str, deque[str]] = defaultdict(deque)
    selected_boxes_by_group: dict[str, set[str]] = {}
    checked_boxes: set[str] = set()

    pdf_body = normalize_pdf_data(pdf_data)

    for page in pdf_body.get("Pages") or []:
        for field in page.get("Fields") or []:
            if not isinstance(field, dict):
                continue

            field_id = (field.get("id") or {}).get("Id")
            if not field_id:
                continue

            field_type = (field.get("T") or {}).get("Name") if isinstance(field.get("T"), dict) else ""

            field_value = field.get("V")
            if (field_value is None or str(field_value).strip() == "") and field_type not in {"box", "link"}:
                field_value = extract_field_text_value(page, field)

            if field_value is None:
                continue

            if isinstance(field_value, str):
                cleaned_value = field_value.strip()
                if cleaned_value == "":
                    continue
                field_values_by_id[field_id].append(cleaned_value)
                question_key = build_field_question_key(page, field)
                if question_key:
                    field_values_by_question[question_key].append(cleaned_value)
            else:
                string_value = str(field_value)
                if string_value.strip() == "":
                    continue
                field_values_by_id[field_id].append(string_value)
                question_key = build_field_question_key(page, field)
                if question_key:
                    field_values_by_question[question_key].append(string_value)

        for boxset in page.get("Boxsets") or []:
            if not isinstance(boxset, dict):
                continue

            group_id = (boxset.get("id") or {}).get("Id")
            selected_ids: set[str] = set()

            for box in boxset.get("boxes") or []:
                if not isinstance(box, dict):
                    continue

                box_id = (box.get("id") or {}).get("Id")
                if not box_id:
                    continue

                if box.get("checked"):
                    checked_boxes.add(box_id)
                    selected_ids.add(box_id)

            if group_id and selected_ids:
                selected_boxes_by_group.setdefault(group_id, set()).update(selected_ids)

    return field_values_by_id, field_values_by_question, selected_boxes_by_group, checked_boxes


def merge_form_values(source_data: dict[str, Any], target_data: dict[str, Any]) -> dict[str, Any]:
    field_values_by_id, field_values_by_question, selected_boxes_by_group, checked_boxes = collect_form_state(source_data)
    merged_data = deepcopy(target_data)
    target_body = normalize_pdf_data(merged_data)

    for page in target_body.get("Pages") or []:
        page_overlays: list[dict[str, Any]] = []
        for field in page.get("Fields") or []:
            if not isinstance(field, dict):
                continue

            field_id = (field.get("id") or {}).get("Id")
            if not field_id:
                continue

            field_type = (field.get("T") or {}).get("Name") if isinstance(field.get("T"), dict) else ""
            if field_type == "box":
                if field_id in checked_boxes:
                    field["checked"] = True
                    field["V"] = "X"
                continue

            if field_type == "link":
                continue

            value = pop_next_value(field_values_by_id, field_id)
            if value is None:
                question_key = build_field_question_key(page, field)
                if question_key:
                    value = pop_matching_value(field_values_by_question, question_key)

            if value is not None and value != "":
                field["V"] = value

        if not page.get("Fields"):
            for line_item in build_pdf_text_lines(page):
                label_text = str(line_item.get("text") or "").strip()
                if not label_text:
                    continue

                question_key = canonicalize_question_text(label_text)
                if not question_key:
                    continue

                value = pop_matching_value(field_values_by_question, question_key)
                if value is None or value == "":
                    continue

                text_x = float(line_item.get("x") or 0)
                text_y = float(line_item.get("y") or 0)
                text_w = float(line_item.get("w") or 0)
                source_item = line_item.get("source") if isinstance(line_item.get("source"), dict) else {}
                text_style = (source_item.get("R") or [{}])[0].get("TS") if isinstance((source_item.get("R") or [{}])[0], dict) else None
                font_size = 12
                if isinstance(text_style, list) and len(text_style) > 1 and isinstance(text_style[1], (int, float)):
                    font_size = max(10, min(int(text_style[1]), 18))

                page_overlays.append(
                    {
                        "x": text_x + text_w + 0.2,
                        "y": text_y,
                        "text": value,
                        "fontSize": font_size,
                        "color": "#111111",
                    }
                )

        if page_overlays:
            page["ValueOverlays"] = page_overlays

        for boxset in page.get("Boxsets") or []:
            if not isinstance(boxset, dict):
                continue

            group_id = (boxset.get("id") or {}).get("Id")
            selected_ids = selected_boxes_by_group.get(group_id) if group_id else None

            for box in boxset.get("boxes") or []:
                if not isinstance(box, dict):
                    continue

                box_id = (box.get("id") or {}).get("Id")
                if not box_id:
                    continue

                if selected_ids is not None:
                    box["checked"] = box_id in selected_ids
                elif box_id in checked_boxes:
                    box["checked"] = True

    return merged_data


def summarize_pdf_data(pdf_data: dict[str, Any]) -> dict[str, Any]:
    pdf_body = normalize_pdf_data(pdf_data)
    pages = pdf_body.get("Pages") or []
    summary: dict[str, Any] = {
        "pageCount": len(pages),
        "totalTexts": 0,
        "totalFills": 0,
        "totalImages": 0,
        "width": pdf_body.get("Width", 0),
        "height": pdf_body.get("Height", 0),
        "pagesDetail": [],
    }

    for index, page in enumerate(pages, start=1):
        texts = len(page.get("Texts") or [])
        fills = len(page.get("Fills") or [])
        images = len(page.get("Images") or [])
        summary["totalTexts"] += texts
        summary["totalFills"] += fills
        summary["totalImages"] += images
        summary["pagesDetail"].append(
            {
                "page": index,
                "texts": texts,
                "fills": fills,
                "images": images,
                "hasFields": bool(page.get("Fields")),
            }
        )

    return summary


@app.get("/")
def root() -> dict[str, str]:
    return {
        "service": "PDF2PDF FastAPI Test API",
        "docs": "/docs",
        "health": "/health",
        "pdfToJson": "/api/upload",
        "jsonToPdf": "/api/json-to-pdf",
        "pdfToStyledPdf": "/api/pdf-to-styled-pdf",
        "jsonToFilledPdf": "/api/json-to-filled-pdf",
        "pdfToFilledPdf": "/api/pdf-to-filled-pdf",
    }


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/upload")
async def upload_pdf(pdf: UploadFile = File(...)) -> dict[str, Any]:
    if not pdf.filename:
        raise HTTPException(status_code=400, detail="No PDF filename provided.")
    if not pdf.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are allowed.")

    node_binary = get_node_binary()
    original_name = Path(pdf.filename).name

    with tempfile.TemporaryDirectory(prefix="pdf2json_") as temp_dir_name:
        temp_dir = Path(temp_dir_name)
        input_pdf = temp_dir / original_name
        output_dir = temp_dir / "json_output"

        await save_upload_file(pdf, input_pdf)
        json_path = convert_pdf_to_json(node_binary, input_pdf, output_dir)
        pdf_data = load_json_file(json_path)
        summary = summarize_pdf_data(pdf_data)

        return {
            "success": True,
            "originalName": original_name,
            "jsonFileName": json_path.name,
            "summary": summary,
            "data": pdf_data,
        }


@app.post("/api/json-to-pdf")
async def json_to_pdf(
    json_file: UploadFile = File(...),
    output_name: str | None = Form(default=None),
) -> FileResponse:
    if not json_file.filename:
        raise HTTPException(status_code=400, detail="No JSON filename provided.")
    if not json_file.filename.lower().endswith(".json"):
        raise HTTPException(status_code=400, detail="Only JSON files are allowed.")

    node_binary = get_node_binary()
    temp_dir = Path(tempfile.mkdtemp(prefix="json2pdf_"))

    try:
        input_json = temp_dir / Path(json_file.filename).name
        await save_upload_file(json_file, input_json)

        if output_name:
            desired_name = Path(output_name).name
        else:
            desired_name = f"{input_json.stem}.pdf"

        if not desired_name.lower().endswith(".pdf"):
            desired_name = f"{Path(desired_name).stem}.pdf"

        output_pdf = temp_dir / desired_name
        run_command([
            node_binary,
            str(JSON_TO_PDF_SCRIPT),
            str(input_json),
            str(output_pdf),
        ])

        if not output_pdf.exists():
            raise HTTPException(status_code=500, detail="PDF output was not created.")

        return FileResponse(
            path=str(output_pdf),
            media_type="application/pdf",
            filename=output_pdf.name,
            background=BackgroundTask(shutil.rmtree, temp_dir, ignore_errors=True),
        )
    except HTTPException:
        shutil.rmtree(temp_dir, ignore_errors=True)
        raise
    except Exception as exc:
        shutil.rmtree(temp_dir, ignore_errors=True)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/pdf-to-styled-pdf")
async def pdf_to_styled_pdf(
    pdf: UploadFile = File(...),
    output_name: str | None = Form(default=None),
) -> FileResponse:
    if not pdf.filename:
        raise HTTPException(status_code=400, detail="No PDF filename provided.")
    if not pdf.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are allowed.")

    temp_dir = Path(tempfile.mkdtemp(prefix="styled_pdf_"))

    try:
        input_pdf = temp_dir / Path(pdf.filename).name
        await save_upload_file(pdf, input_pdf)

        if output_name:
            desired_name = Path(output_name).name
        else:
            desired_name = f"{input_pdf.stem}_styled.pdf"

        if not desired_name.lower().endswith(".pdf"):
            desired_name = f"{Path(desired_name).stem}.pdf"

        output_pdf = temp_dir / desired_name
        convert_pdf_to_styled_pdf(input_pdf, output_pdf)

        if not output_pdf.exists():
            raise HTTPException(status_code=500, detail="Styled PDF output was not created.")

        return FileResponse(
            path=str(output_pdf),
            media_type="application/pdf",
            filename=output_pdf.name,
            background=BackgroundTask(shutil.rmtree, temp_dir, ignore_errors=True),
        )
    except HTTPException:
        shutil.rmtree(temp_dir, ignore_errors=True)
        raise
    except Exception as exc:
        shutil.rmtree(temp_dir, ignore_errors=True)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/json-to-filled-pdf")
async def json_to_filled_pdf(
    source_json: UploadFile = File(...),
    target_pdf: UploadFile = File(...),
    output_name: str | None = Form(default=None),
) -> FileResponse:
    if not source_json.filename:
        raise HTTPException(status_code=400, detail="No source JSON filename provided.")
    if not source_json.filename.lower().endswith(".json"):
        raise HTTPException(status_code=400, detail="Only JSON files are allowed for the source JSON.")
    if not target_pdf.filename:
        raise HTTPException(status_code=400, detail="No target PDF filename provided.")
    if not target_pdf.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are allowed for the target PDF.")

    temp_dir = Path(tempfile.mkdtemp(prefix="json_fill_"))

    try:
        input_json = temp_dir / Path(source_json.filename).name
        input_pdf = temp_dir / Path(target_pdf.filename).name

        await save_upload_file(source_json, input_json)
        await save_upload_file(target_pdf, input_pdf)

        if output_name:
            desired_name = Path(output_name).name
        else:
            desired_name = f"{input_pdf.stem}_filled.pdf"

        if not desired_name.lower().endswith(".pdf"):
            desired_name = f"{Path(desired_name).stem}.pdf"

        output_pdf = temp_dir / desired_name
        fill_pdf_from_json(str(input_json), str(input_pdf), str(output_pdf))

        if not output_pdf.exists():
            raise HTTPException(status_code=500, detail="Filled PDF output was not created.")

        return FileResponse(
            path=str(output_pdf),
            media_type="application/pdf",
            filename=output_pdf.name,
            background=BackgroundTask(shutil.rmtree, temp_dir, ignore_errors=True),
        )
    except HTTPException:
        shutil.rmtree(temp_dir, ignore_errors=True)
        raise
    except Exception as exc:
        shutil.rmtree(temp_dir, ignore_errors=True)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/pdf-to-filled-pdf")
async def pdf_to_filled_pdf(
    detail_pdf: UploadFile = File(...),
    target_pdf: UploadFile = File(...),
    output_name: str | None = Form(default=None),
) -> FileResponse:
    if not detail_pdf.filename:
        raise HTTPException(status_code=400, detail="No detail PDF filename provided.")
    if not detail_pdf.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are allowed for the detail PDF.")
    if not target_pdf.filename:
        raise HTTPException(status_code=400, detail="No styled target PDF filename provided.")
    if not target_pdf.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are allowed for the styled target PDF.")

    temp_dir = Path(tempfile.mkdtemp(prefix="pdf_fill_"))

    try:
        detail_pdf_path = temp_dir / "detail" / Path(detail_pdf.filename).name
        target_pdf_path = temp_dir / "styled" / Path(target_pdf.filename).name

        await save_upload_file(detail_pdf, detail_pdf_path)
        await save_upload_file(target_pdf, target_pdf_path)

        if output_name:
            desired_name = Path(output_name).name
        else:
            desired_name = f"{target_pdf_path.stem}_filled.pdf"

        if not desired_name.lower().endswith(".pdf"):
            desired_name = f"{Path(desired_name).stem}.pdf"

        output_pdf = temp_dir / desired_name
        fill_styled_pdf_from_detail_pdf(detail_pdf_path, target_pdf_path, output_pdf)

        if not output_pdf.exists():
            raise HTTPException(status_code=500, detail="Filled PDF output was not created.")

        return FileResponse(
            path=str(output_pdf),
            media_type="application/pdf",
            filename=output_pdf.name,
            background=BackgroundTask(shutil.rmtree, temp_dir, ignore_errors=True),
        )
    except HTTPException:
        shutil.rmtree(temp_dir, ignore_errors=True)
        raise
    except Exception as exc:
        shutil.rmtree(temp_dir, ignore_errors=True)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("fastapi_app.main:app", host="0.0.0.0", port=8000, reload=False)
