import sys
import json
import re
import unicodedata
import numpy as np
from pathlib import Path
from sentence_transformers import SentenceTransformer, util

try:
    import fitz  # PyMuPDF
except ImportError:
    print("Install PyMuPDF: pip install pymupdf")
    sys.exit(1)


# ─────────────────────────────────────────────────────────────────────────────
#  1. CANONICAL FIELD DEFINITIONS
#     Each field has a list of descriptive phrases.
#     The model encodes these — the richer the phrases, the better the match.
# ─────────────────────────────────────────────────────────────────────────────

CANONICAL_FIELDS = {
    "name": [
        "full name", "name of the student", "applicant name",
        "respondent name", "candidate name", "participant name",
        "name of the applicant", "your name", "legal name",
        "name of person", "complete name", "employee name"
    ],
    "first_name": [
        "first name", "given name", "forename", "first"
    ],
    "last_name": [
        "last name", "surname", "family name", "second name"
    ],
    "age": [
        "age", "age in years", "your age", "current age",
        "age of the student", "respondent age", "how old are you",
        "age of applicant", "present age"
    ],
    "dob": [
        "date of birth", "birth date", "dob", "born on",
        "date of birth dd mm yyyy"
    ],
    "gender": [
        "gender", "sex", "gender or sex", "your gender", "gender identity"
    ],
    "email": [
        "email address", "e-mail", "email id", "your email",
        "contact email", "electronic mail", "mail id"
    ],
    "phone": [
        "phone number", "mobile number", "contact number", "telephone",
        "cell number", "mobile no", "whatsapp number", "contact no"
    ],
    "address": [
        "full address", "home address", "residential address",
        "mailing address", "current address", "permanent address",
        "street address", "postal address"
    ],
    "city": [
        "city", "town", "locality", "city or town"
    ],
    "state": [
        "state", "province", "region", "state or province"
    ],
    "pincode": [
        "pin code", "postal code", "zip code", "postcode", "zipcode"
    ],
    "country": [
        "country", "nationality", "country of residence", "nation"
    ],
    "occupation": [
        "occupation", "profession", "job title", "designation",
        "position", "role", "employment"
    ],
    "organization": [
        "organization name", "company name", "employer",
        "institution name", "school", "college", "university"
    ],
    "qualification": [
        "educational qualification", "highest degree", "education level",
        "qualification", "degree"
    ],
    "income": [
        "annual income", "monthly income", "salary", "earnings",
        "monthly salary", "annual salary"
    ],
    "date": [
        "date", "today's date", "submission date", "current date", "form date"
    ],
    "signature": [
        "signature", "your signature", "applicant signature", "sign here"
    ],
}


# ─────────────────────────────────────────────────────────────────────────────
#  2. ML MODEL — loads once, reused for all matches
# ─────────────────────────────────────────────────────────────────────────────

class SemanticMatcher:
    def __init__(self, model_name: str = "all-MiniLM-L6-v2", threshold: float = 0.45):
        print(f"🔄 Loading model '{model_name}' (cached after first download)...")
        self.model = SentenceTransformer(model_name)
        self.threshold = threshold

        # Pre-encode all canonical phrases — done once at startup
        self.canonical_keys = []
        self.canonical_embeddings = []

        for key, phrases in CANONICAL_FIELDS.items():
            for phrase in phrases:
                self.canonical_keys.append(key)
                self.canonical_embeddings.append(phrase)

        self.embeddings = self.model.encode(
            self.canonical_embeddings,
            convert_to_tensor=True,
            show_progress_bar=False
        )
        print(f"✅ Model ready. {len(self.canonical_embeddings)} canonical phrases indexed.\n")

    def resolve(self, raw_label: str) -> tuple[str | None, float]:
        """
        Returns (canonical_key, confidence_score) or (None, 0.0) if no match.
        """
        label_embedding = self.model.encode(raw_label, convert_to_tensor=True)
        scores = util.cos_sim(label_embedding, self.embeddings)[0]

        best_idx = int(scores.argmax())
        best_score = float(scores[best_idx])

        if best_score >= self.threshold:
            return self.canonical_keys[best_idx], best_score
        return None, best_score


# ─────────────────────────────────────────────────────────────────────────────
#  3. LOAD SOURCE JSON → CANONICAL MAP
# ─────────────────────────────────────────────────────────────────────────────

def load_source_values(json_path: str, matcher: SemanticMatcher) -> dict[str, str]:
    """
    Accepts any JSON with human-readable keys:
        { "Full Name": "Ravi Kumar", "Age (in years)": "22", ... }
    Returns:
        { "name": "Ravi Kumar", "age": "22", ... }
    """
    with open(json_path, encoding="utf-8") as f:
        raw: dict = json.load(f)

    canonical_map: dict[str, str] = {}
    unresolved: list[str] = []

    for label, value in raw.items():
        key, score = matcher.resolve(label)
        if key:
            if key not in canonical_map:  # first match wins
                canonical_map[key] = str(value)
                print(f"  ✓  '{label}' → [{key}]  (score: {score:.2f})")
        else:
            unresolved.append(f"'{label}' (best score: {score:.2f})")

    if unresolved:
        print(f"\n⚠  Unresolved source labels:")
        for u in unresolved:
            print(f"   • {u}")

    return canonical_map


# ─────────────────────────────────────────────────────────────────────────────
#  4. PDF FORM FILLER
# ─────────────────────────────────────────────────────────────────────────────

def fill_pdf(source_json: str, target_pdf: str, output_pdf: str,
             matcher: SemanticMatcher) -> None:

    canonical_map = load_source_values(source_json, matcher)
    print(f"\n📋 {len(canonical_map)} values ready to fill.\n")

    doc = fitz.open(target_pdf)
    filled, skipped = 0, []

    for page in doc:
        for widget in page.widgets():
            if widget.field_type not in (
                fitz.PDF_WIDGET_TYPE_TEXT,
                fitz.PDF_WIDGET_TYPE_COMBOBOX,
                fitz.PDF_WIDGET_TYPE_LISTBOX,
            ):
                continue

            raw_label = (widget.field_label or widget.field_name or "").strip()
            if not raw_label:
                continue

            key, score = matcher.resolve(raw_label)
            if key and key in canonical_map:
                widget.field_value = canonical_map[key]
                widget.update()
                filled += 1
                print(f"  ✓  '{raw_label}' → [{key}] = '{canonical_map[key]}'  ({score:.2f})")
            else:
                skipped.append((raw_label, key, score))

    # Visual overlay for flat (non-interactive) PDFs
    _visual_overlay(doc, canonical_map, matcher)

    doc.save(output_pdf, garbage=4, deflate=True)
    doc.close()

    print(f"\n📄 Saved → {output_pdf}")
    print(f"   Filled : {filled} field(s)")
    if skipped:
        print(f"   Skipped: {len(skipped)} field(s)")
        for lbl, key, score in skipped:
            print(f"      • '{lbl}' — resolved={key}, score={score:.2f}")


# ─────────────────────────────────────────────────────────────────────────────
#  5. VISUAL OVERLAY (flat / non-interactive PDFs)
# ─────────────────────────────────────────────────────────────────────────────

def _visual_overlay(doc: fitz.Document, canonical_map: dict,
                    matcher: SemanticMatcher) -> None:
    for page in doc:
        if list(page.widgets()):
            continue  # skip pages that already have interactive fields

        text_data = page.get_text("dict", flags=fitz.TEXT_PRESERVE_WHITESPACE)
        for block in text_data.get("blocks", []):
            for line in block.get("lines", []):
                for span in line.get("spans", []):
                    raw = span.get("text", "").strip()
                    if not raw:
                        continue
                    key, score = matcher.resolve(raw)
                    if key and key in canonical_map:
                        bbox = fitz.Rect(span["bbox"])
                        point = fitz.Point(bbox.x1 + 4, bbox.y1 + span["size"] * 0.85)
                        page.insert_text(
                            point,
                            canonical_map[key],
                            fontsize=span["size"],
                            color=(0.1, 0.1, 0.8),
                        )


# ─────────────────────────────────────────────────────────────────────────────
#  6. ENTRY POINT
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    args = sys.argv[1:]
    matcher = SemanticMatcher()  # model loads once here

    if len(args) == 1 and args[0] == "--test":
        TEST_CASES = [
            ("Full Name",                "name"),
            ("name of the student",      "name"),
            ("Applicant Name",           "name"),
            ("Name of Respondent",       "name"),
            ("Age",                      "age"),
            ("Age (in years)",           "age"),
            ("Respondent Age",           "age"),
            ("Age of the Student",       "age"),
            ("Date of Birth",            "dob"),
            ("DOB (dd/mm/yyyy)",         "dob"),
            ("E-mail Address",           "email"),
            ("Contact No",               "phone"),
            ("Mobile Number",            "phone"),
            ("Pin Code",                 "pincode"),
            ("Postal Code",              "pincode"),
            ("Educational Qualification","qualification"),
            ("Company Name",             "organization"),
        ]
        passed = failed = 0
        for label, expected in TEST_CASES:
            got, score = matcher.resolve(label)
            ok = got == expected
            passed += ok; failed += not ok
            icon = "✓" if ok else "✗"
            print(f"  {icon}  '{label}' → {got} ({score:.2f})  expected: {expected}")
        print(f"\n{passed} passed, {failed} failed out of {len(TEST_CASES)}")

    elif len(args) == 1:
        # Diagnose a single label
        key, score = matcher.resolve(args[0])
        print(f"Label     : '{args[0]}'")
        print(f"Resolved  : {key or '(no match)'}")
        print(f"Confidence: {score:.2f}")

    elif len(args) == 3:
        fill_pdf(args[0], args[1], args[2], matcher)

    else:
        print("Usage:")
        print("  Fill PDF   : python semantic_field_matcher_ml.py source.json form.pdf out.pdf")
        print("  Test       : python semantic_field_matcher_ml.py --test")
        print("  Diagnose   : python semantic_field_matcher_ml.py 'Name of Student'")
