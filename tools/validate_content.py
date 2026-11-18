"""Validate all quiz banks, flashcard decks, topic notes and manifests before use.

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
        if "retired" in it and (it["retired"] is not True or not it.get("retiredReason")):
            fails.append(f"quiz bank {b.name} item {it.get('id')}: 'retired' must be true and come with a 'retiredReason'")
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
        if "retired" in c and (c["retired"] is not True or not c.get("retiredReason")):
            fails.append(f"deck {d.name} card {cid}: 'retired' must be true and come with a 'retiredReason'")
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

# ---------- topic notes (library/topic-notes) ----------
NOTE_REQUIRED = {"schemaVersion": int, "id": str, "subject": str, "code": str, "title": str,
                 "theme": str, "keyIdeas": list, "links": dict}
NOTE_LISTS = {"keyIdeas": ("cue", "answer"), "keyTerms": ("term", "def"), "misconceptions": ("wrong", "right"),
              "practice": ("prompt",), "workedExamples": ("prompt",), "linkingQuestions": ("to", "prompt"),
              "paper1A": ("stem", "choices"), "paper1B": ("prompt",)}
PRIVATE_PATH = re.compile(r"/workspace/|/home/[a-z]|/Users/")


def ids_in(path, key):
    data, err = load(path)
    if err or not isinstance(data, dict):
        return None
    return {x.get("id") for x in data.get(key, []) if isinstance(x, dict)}


_retired_cache = {}


def retired_ids(path, key):
    if path not in _retired_cache:
        data, err = load(path)
        items = data.get(key, []) if not err and isinstance(data, dict) else []
        _retired_cache[path] = {x.get("id") for x in items if isinstance(x, dict) and x.get("retired") is True}
    return _retired_cache[path]


notes_dir = ROOT / "library" / "topic-notes"
note_files = sorted(notes_dir.glob("*/*.json")) if notes_dir.exists() else []
id_cache, note_ids, total_n = {}, {}, 0
for f in note_files:
    rel = f.relative_to(ROOT).as_posix()
    n, err = load(f)
    if err or not isinstance(n, dict):
        fails.append(f"note {rel}: not valid JSON ({err})")
        continue
    total_n += 1
    for key, typ in NOTE_REQUIRED.items():
        if not isinstance(n.get(key), typ):
            fails.append(f"note {rel}: '{key}' missing or not {typ.__name__}")
    if n.get("schemaVersion") not in (1,):
        fails.append(f"note {rel}: unsupported schemaVersion {n.get('schemaVersion')!r}")
    if n.get("subject") and f.parent.name != n["subject"]:
        fails.append(f"note {rel}: subject '{n['subject']}' does not match its folder")
    if n.get("id") in note_ids:
        fails.append(f"note {rel}: id '{n['id']}' already used in {note_ids[n['id']]}")
    note_ids[n.get("id")] = rel
    for key, fields in NOTE_LISTS.items():
        for i, x in enumerate(n.get(key) or []):
            if not isinstance(x, dict) or any(not x.get(fl) for fl in fields):
                fails.append(f"note {rel}: {key}[{i}] needs {', '.join(fields)}")
    for i, q in enumerate(n.get("paper1A") or []):
        if isinstance(q, dict) and not (isinstance(q.get("answer"), int) and 0 <= q["answer"] < len(q.get("choices") or [])):
            fails.append(f"note {rel}: paper1A[{i}] answer index out of range")
    links = n.get("links") if isinstance(n.get("links"), dict) else {}
    for kind, idkey, listkey in (("quizBanks", "itemIds", "items"), ("decks", "cardIds", "cards")):
        for ln in links.get(kind) or []:
            path = ROOT / str(ln.get("file", ""))
            if not ln.get("file") or not path.is_file():
                fails.append(f"note {rel}: linked file {ln.get('file')!r} does not exist")
                continue
            if path not in id_cache:
                id_cache[path] = ids_in(path, listkey) or set()
            for x in ln.get(idkey) or []:
                if x not in id_cache[path]:
                    fails.append(f"note {rel}: linked id '{x}' not found in {ln['file']}")
                elif x in retired_ids(path, listkey):
                    warns.append(f"note {rel}: links retired id '{x}' in {ln['file']} (it is never served)")
    for text in strings_in(n):
        if PRIVATE_PATH.search(text):
            fails.append(f"note {rel}: mentions a local path: {text[:60]!r}")
            break
    if n.get("practice") is not None and not n.get("practice"):
        warns.append(f"note {rel}: no practice prompts")
if note_files:
    m, err = load(notes_dir / "manifest.json")
    if err:
        fails.append(f"topic-notes/manifest.json: missing or invalid ({err}); run tools/import_topic_notes.py")
    else:
        listed = {e.get("file") for e in m.get("notes", [])}
        on_disk = {f.relative_to(ROOT).as_posix() for f in note_files}
        for x in sorted(listed - on_disk):
            fails.append(f"topic-notes/manifest.json: lists missing file {x}")
        for x in sorted(on_disk - listed):
            fails.append(f"topic-notes/manifest.json: does not list {x}; run tools/import_topic_notes.py")

# ---------- coursework planner (library/coursework/coursework.json) ----------
# Progress is keyed "<track>.<stage>.<check>" in the synced "cw-progress" key, so ids
# must be unique and must never be renamed once she has ticked them.
ID_RE = re.compile(r"^[a-z0-9-]+$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
total_cw = 0
cw_path = ROOT / "library/coursework/coursework.json"
if cw_path.exists():
    cw, err = load(cw_path)
    if err:
        fails.append(f"coursework.json: not valid JSON ({err})")
        cw = {}
    if cw.get("schemaVersion") != 1:
        fails.append("coursework.json: schemaVersion must be 1")
    if not cw.get("disclaimer"):
        fails.append("coursework.json: missing disclaimer")
    track_ids = set()
    for t in cw.get("tracks", []):
        tid = t.get("id")
        if not isinstance(tid, str) or not ID_RE.match(tid) or tid in track_ids:
            fails.append(f"coursework.json: bad or duplicate track id {tid!r}")
        track_ids.add(tid)
        for key in ("label", "facts", "criteria", "stages"):
            if not t.get(key):
                fails.append(f"coursework.json track {tid}: missing '{key}'")
        for c in t.get("criteria", []):
            if not c.get("name") or not isinstance(c.get("max"), int) or not c.get("focus"):
                fails.append(f"coursework.json track {tid}: criterion needs name, integer max and focus")
        stage_ids = set()
        for st in t.get("stages", []):
            sid = st.get("id")
            if not isinstance(sid, str) or not ID_RE.match(sid) or sid in stage_ids:
                fails.append(f"coursework.json track {tid}: bad or duplicate stage id {sid!r}")
            stage_ids.add(sid)
            if not st.get("title") or not st.get("checks"):
                fails.append(f"coursework.json {tid}.{sid}: needs a title and checks")
            check_ids = set()
            for c in st.get("checks", []):
                cid = c.get("id")
                if not isinstance(cid, str) or not ID_RE.match(cid) or cid in check_ids or not c.get("text"):
                    fails.append(f"coursework.json {tid}.{sid}: bad, duplicate or empty check {cid!r}")
                check_ids.add(cid)
                total_cw += 1
            for d in st.get("dates", []):
                if not DATE_RE.match(str(d.get("date", ""))) or not d.get("label") or not d.get("source"):
                    fails.append(f"coursework.json {tid}.{sid}: each date needs YYYY-MM-DD date, label and source")
    for text in strings_in(cw):
        if re.search(r"(/home/|/workspace/|library/school/|\.pdf\b)", text):
            fails.append(f"coursework.json: mentions a local path or private file: {text[:60]!r}")

# ---------- report ----------
print(f"quiz banks: {total_q} items in {len(bank_files) - 1} files")
print(f"flashcard decks: {total_f} cards in {len(deck_files) - 1} files")
print(f"topic notes: {total_n} files")
print(f"coursework planner: {total_cw} self-check items")
for w in warns:
    print("WARN:", w)
if fails:
    print("\nFAIL:")
    for f in fails:
        print("  -", f)
    sys.exit(1)
print("\nALL CHECKS PASSED")
