"""Validate all quiz banks, flashcard decks and manifests before use.

Run:  python3 -I tools/validate_content.py
Exits non-zero on any FAIL so it can be used as a pre-commit gate.
"""

import json
import os
import re
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(os.environ.get("NEVAIB_ROOT") or Path(__file__).resolve().parent.parent)
fails, warns = [], []

# Answer-cue thresholds (warnings, not failures). The quiz engine shuffles options at
# render time, so authored key position only matters for printouts/exports, but the
# "correct answer is the longest option" cue survives shuffling and needs content edits.
POSITION_WARN = 0.40  # one position holding more than 40% of a bank's keys
LONGEST_WARN = 0.40  # correct option strictly longest in more than 40% of a bank's MCQs
MIN_MCQ_FOR_CUE_CHECK = 8
# U+00B4 (acute accent) has replaced superscript-4 in generated content before ("10²´")
CORRUPT_CHARS = {"\u00b4": "acute accent (corrupted superscript?)"}


def norm(text):
    return re.sub(r"\s+", " ", str(text).strip().lower())


def strings_in(obj):
    if isinstance(obj, str):
        yield obj
    elif isinstance(obj, list):
        for v in obj:
            yield from strings_in(v)
    elif isinstance(obj, dict):
        for v in obj.values():
            yield from strings_in(v)


def load(path):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8")), None
    except Exception as e:
        return None, f"{e}"


# ---------- quiz banks ----------
quiz_ids_per_file = {}
ids_by_subject = {}  # subject -> {id: [bank files]}
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
    # exact duplicates (same stem, choices and key) inflate counts and topic stats
    seen_items = {}
    for it in d.get("items", []):
        k = (norm(it.get("stem")), json.dumps(it.get("choices")), it.get("answer"))
        if k in seen_items:
            fails.append(
                f"quiz bank {b.name} item {it.get('id')}: exact duplicate of {seen_items[k]}"
            )
        else:
            seen_items[k] = it.get("id")
    # answer-cue checks
    mcqs = [
        it for it in d.get("items", [])
        if it.get("format") == "mcq" and isinstance(it.get("answer"), int)
        and 0 <= it["answer"] < len(it.get("choices", []))
    ]
    if len(mcqs) >= MIN_MCQ_FOR_CUE_CHECK:
        pos = Counter(it["answer"] for it in mcqs)
        top_pos, top_n = pos.most_common(1)[0]
        if top_n / len(mcqs) > POSITION_WARN:
            dist = "/".join(str(pos.get(i, 0)) for i in range(4))
            warns.append(
                f"quiz bank {b.name}: key position {'ABCD'[top_pos] if top_pos < 4 else top_pos} "
                f"holds {top_n}/{len(mcqs)} MCQ keys (A/B/C/D = {dist}; display is shuffled at runtime)"
            )
        longest = 0
        for it in mcqs:
            lens = [len(str(c)) for c in it["choices"]]
            if lens[it["answer"]] == max(lens) and lens.count(max(lens)) == 1:
                longest += 1
        if longest / len(mcqs) > LONGEST_WARN:
            warns.append(
                f"quiz bank {b.name}: correct option is the longest in {longest}/{len(mcqs)} MCQs "
                f"(length cue — balance option lengths)"
            )
    for text in strings_in(d):
        for ch, why in CORRUPT_CHARS.items():
            if ch in text:
                fails.append(f"quiz bank {b.name}: contains {why}: {text[:60]!r}")
    # untagged items inherit the bank topic in the quiz (fine), but tag them so the
    # topic breakdown and any future per-topic stats don't depend on the file they sit in
    untagged = [it.get("id") for it in d.get("items", []) if not it.get("topic")]
    if untagged:
        warns.append(f"quiz bank {b.name}: {len(untagged)} item(s) without a topic (inherit '{d.get('topic')}')")
    no_id = [it for it in d.get("items", []) if not it.get("id")]
    if no_id:
        warns.append(f"quiz bank {b.name}: {len(no_id)} item(s) without an id (missed-question tracking falls back to the stem)")
    for i in ids:
        if i:
            ids_by_subject.setdefault(d.get("subject"), {}).setdefault(i, []).append(b.name)
    quiz_ids_per_file[b.name] = set(ids)
    total_q += len(d.get("items", []))

# ids only need to be unique per file (missed questions are keyed <bank>#<id>), but a
# reused id within a subject makes logs and reports ambiguous — report it
for subj, by_id in sorted(ids_by_subject.items(), key=lambda kv: str(kv[0])):
    dup = {i: f for i, f in by_id.items() if len(f) > 1}
    if dup:
        sample = ", ".join(f"{i} ({' / '.join(sorted(f))})" for i, f in sorted(dup.items())[:5])
        warns.append(f"subject {subj}: {len(dup)} question id(s) reused across banks, e.g. {sample}")

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
    for text in strings_in(data):
        for ch, why in CORRUPT_CHARS.items():
            if ch in text:
                fails.append(f"deck {d.name}: contains {why}: {text[:60]!r}")
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
