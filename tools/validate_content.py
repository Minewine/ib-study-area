"""Validate all quiz banks, flashcard decks and manifests before use.

Run:  python3 -I tools/validate_content.py
Exits non-zero on any FAIL so it can be used as a pre-commit gate.
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
fails, warns = [], []


def load(path):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8")), None
    except Exception as e:
        return None, f"{e}"


# ---------- quiz banks ----------
quiz_ids_per_file = {}
bank_files = sorted((ROOT / "library/questions").glob("*.json"))
total_q = 0
for b in bank_files:
    if b.name == "manifest.json":
        continue
    d, err = load(b)
    if err:
        fails.append(f"quiz bank {b.name}: not valid JSON ({err})")
        continue
    for key in ("subject", "topic", "topicLabel", "items"):
        if key not in d:
            fails.append(f"quiz bank {b.name}: missing key '{key}'")
    ids = [it.get("id") for it in d.get("items", [])]
    if len(ids) != len(set(ids)):
        fails.append(f"quiz bank {b.name}: duplicate ids")
    for it in d.get("items", []):
        if it.get("format") == "mcq":
            if not isinstance(it.get("answer"), int) or not (
                0 <= it["answer"] < len(it.get("choices", []))
            ):
                fails.append(
                    f"quiz bank {b.name} item {it.get('id')}: bad answer index"
                )
            if len(it.get("choices", [])) < 2:
                fails.append(f"quiz bank {b.name} item {it.get('id')}: too few choices")
        elif it.get("format") == "written":
            if not it.get("marks") or not it.get("markscheme"):
                fails.append(
                    f"quiz bank {b.name} item {it.get('id')}: written item needs marks + markscheme"
                )
        else:
            fails.append(
                f"quiz bank {b.name} item {it.get('id')}: unknown format '{it.get('format')}'"
            )
        if not it.get("stem"):
            fails.append(f"quiz bank {b.name} item {it.get('id')}: missing stem")
    quiz_ids_per_file[b.name] = set(ids)
    total_q += len(d.get("items", []))

# ---------- flashcard decks (ids unique GLOBALLY — SRS state is keyed by id) ----------
fc_ids = {}
deck_files = sorted((ROOT / "library/flashcards").glob("*.json"))
total_f = 0
for d in deck_files:
    if d.name == "manifest.json":
        continue
    data, err = load(d)
    if err:
        fails.append(f"deck {d.name}: not valid JSON ({err})")
        continue
    for key in ("subject", "topic", "topicLabel", "cards"):
        if key not in data:
            fails.append(f"deck {d.name}: missing key '{key}'")
    for c in data.get("cards", []):
        cid = c.get("id")
        if not cid:
            fails.append(f"deck {d.name}: card missing id")
        elif cid in fc_ids:
            fails.append(f"deck {d.name}: id '{cid}' already used in {fc_ids[cid]}")
        fc_ids[cid] = d.name
        if not c.get("front") or not c.get("back"):
            fails.append(f"deck {d.name} card {cid}: front and back are both required")
        if c.get("type") not in ("qa", "term"):
            fails.append(f"deck {d.name} card {cid}: type must be 'qa' or 'term'")
    total_f += len(data.get("cards", []))

# ---------- manifests ----------
for name, folder, key in [
    ("questions/manifest.json", "questions", "banks"),
    ("flashcards/manifest.json", "flashcards", "decks"),
]:
    m, err = load(ROOT / "library" / name)
    if err:
        fails.append(f"{name}: not valid JSON ({err})")
        continue
    for e in m:
        if not (ROOT / e.get("file", "")).exists():
            fails.append(f"{name}: manifest points to missing file {e.get('file')}")

# ---------- report ----------
print(f"quiz banks: {total_q} items in {len(bank_files) - 1} files")
print(f"flashcard decks: {total_f} cards in {len(deck_files) - 1} files")
for w in warns:
    print("WARN:", w)
if fails:
    print("\nFAIL:")
    for f in fails:
        print("  -", f)
    sys.exit(1)
print("\nALL CHECKS PASSED")
