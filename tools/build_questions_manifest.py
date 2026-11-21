"""Build library/questions/manifest.json from the question banks.

Each manifest entry keeps the hand-maintained `file`/`subject`/`subjectLabel`/`label`
fields exactly as they are today (order and label strings are preserved) and gains
computed metadata read from the bank JSON itself (topic, practice-set fields, item
counts and a per-topic breakdown), so the quiz picker can build a Subject -> syllabus
topic -> practice-set hierarchy without fetching every bank file.

Run:  python3 -I tools/build_questions_manifest.py           # rewrite the manifest
      python3 -I tools/build_questions_manifest.py --check   # exit 1 if it would change

Deterministic, stdlib-only. The aggregation mirrors bankItems() in assets/quiz-engine.js:
an item is active unless `retired` is exactly true, and its effective topic is
`item.topic || bank.topic || <filename stem>` with `item.topicLabel || bank.topicLabel`.
"""

import argparse
import json
import os
import sys
from pathlib import Path

ROOT = Path(os.environ.get("NEVAIB_ROOT") or Path(__file__).resolve().parent.parent)
QUESTIONS = ROOT / "library" / "questions"
MANIFEST = QUESTIONS / "manifest.json"

# Bank fields passed through to the manifest only when the bank actually has them
OPTIONAL_BANK_FIELDS = ("set", "setOrder", "codes", "paperStyle", "calculatorFree")
# Item difficulties; anything else (or absent) pools as "unrated" — never invent a rating
DIFFICULTIES = ("unrated", "easy", "standard", "hard")


def load(path):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8")), None
    except (OSError, ValueError) as e:
        return None, f"{e}"


def bank_id(bank_path):
    # file name without folder/extension, mirroring bankIdFor() in the quiz engine
    return bank_path.stem


def bank_metadata(bank, bid):
    """Computed per-bank manifest fields: pass-through metadata, counts, topic breakdown.

    Aggregates ACTIVE items only (an item is active unless `retired` is exactly true).
    Topics appear in first-appearance order; the first active item of a topic also donates
    its label, like `byTopic[r.topic] = ... || {label: r.topicLabel || r.topic}` in the engine.
    """
    meta = {}
    for field in ("topic", "topicLabel"):
        if field in bank:
            meta[field] = bank[field]
    for field in OPTIONAL_BANK_FIELDS:
        if field in bank:
            meta[field] = bank[field]
    items = [it for it in bank.get("items", []) if it.get("retired") is not True]
    meta["counts"] = {
        "mcq": sum(1 for it in items if it.get("format") == "mcq"),
        "written": sum(1 for it in items if it.get("format") == "written"),
        "total": len(items),
    }
    topics, by_topic = [], {}
    for it in items:
        topic = it.get("topic") or bank.get("topic") or bid
        entry = by_topic.get(topic)
        if entry is None:
            entry = {
                "topic": topic,
                "topicLabel": it.get("topicLabel") or bank.get("topicLabel") or topic,
                "count": 0,
                "difficulty": {d: 0 for d in DIFFICULTIES},
            }
            by_topic[topic] = entry
            topics.append(entry)
        entry["count"] += 1
        difficulty = it.get("difficulty")
        entry["difficulty"][
            difficulty if difficulty in DIFFICULTIES else "unrated"
        ] += 1
    meta["topics"] = topics
    return meta


def fresh_entry(bank, bank_path):
    """Manifest entry for a bank that is not listed yet (label falls back to the stem)."""
    subject = bank.get("subject")
    entry = {
        "file": f"library/questions/{bank_path.name}",
        "subject": subject,
        "subjectLabel": subject,  # placeholder a human can polish later
        "label": bank.get("topicLabel") or bank_id(bank_path),
    }
    entry.update(bank_metadata(bank, bank_id(bank_path)))
    return entry


def build_manifest(warn):
    """Return the regenerated manifest: existing entries in place, unlisted banks appended."""
    existing, err = load(MANIFEST)
    if err:
        warn(f"{MANIFEST.name}: cannot read it ({err}); rebuilding from scratch")
        existing = []
    if not isinstance(existing, list):
        warn(f"{MANIFEST.name}: not a JSON array; rebuilding from scratch")
        existing = []

    manifest = []
    listed = set()
    for entry in existing:
        file_id = entry.get("file") if isinstance(entry, dict) else None
        bank_path = ROOT / os.path.normpath(str(file_id)) if file_id else None
        if not file_id or not bank_path.is_file():
            warn(
                f"{MANIFEST.name}: entry for {file_id!r} kept unchanged (bank missing or malformed)"
            )
            manifest.append(entry)
            continue
        listed.add(os.path.normpath(str(file_id)))
        bank, err = load(bank_path)
        if err:
            warn(f"{file_id}: not valid JSON ({err}); entry kept unchanged")
            manifest.append(entry)
            continue
        # identity fields first, byte-identical to today, then the computed metadata
        new_entry = {
            k: entry[k]
            for k in ("file", "subject", "subjectLabel", "label")
            if k in entry
        }
        new_entry.update(bank_metadata(bank, bank_id(bank_path)))
        for k, v in entry.items():  # keep any other hand-maintained fields
            new_entry.setdefault(k, v)
        manifest.append(new_entry)

    for bank_path in sorted(QUESTIONS.glob("*.json")):
        if (
            bank_path.name == MANIFEST.name
            or os.path.normpath(f"library/questions/{bank_path.name}") in listed
        ):
            continue
        bank, err = load(bank_path)
        if err:
            warn(
                f"library/questions/{bank_path.name}: not valid JSON ({err}); not appended"
            )
            continue
        if not bank.get("subject"):
            warn(
                f"library/questions/{bank_path.name}: no bank 'subject'; not appended (add it to the manifest by hand)"
            )
            continue
        manifest.append(fresh_entry(bank, bank_path))
    return manifest


def diff_summary(old_text, new_text):
    """Short line-per-change summary of what would change (for --check on stderr)."""
    try:
        old = json.loads(old_text) if old_text.strip() else []
    except ValueError:
        return [f"{MANIFEST.name}: on-disk file is not valid JSON"]
    try:
        new = json.loads(new_text)
    except ValueError:
        return [f"{MANIFEST.name}: regenerated manifest is not valid JSON (bug?)"]

    def key(entry):
        return (
            os.path.normpath(str(entry.get("file")))
            if isinstance(entry, dict)
            else None
        )

    old_by = {key(e): e for e in old}
    new_by = {key(e): e for e in new}
    lines = [f"  + {k} (appended)" for k in new_by if k not in old_by]
    lines += [
        f"  ~ {k} (metadata updated)"
        for k in new_by
        if k in old_by and old_by[k] != new_by[k]
    ]
    lines += [f"  - {k} (dropped)" for k in old_by if k not in new_by]
    if not lines:
        lines = ["  entry contents unchanged but formatting/order differs"]
    if len(lines) > 12:
        lines = lines[:12] + [f"  ... and {len(lines) - 12} more"]
    return lines


def main():
    ap = argparse.ArgumentParser(
        description="Regenerate library/questions/manifest.json from the question banks."
    )
    ap.add_argument(
        "--check",
        action="store_true",
        help="exit 1 with a diff summary on stderr if the manifest would change",
    )
    args = ap.parse_args()

    warns = []
    manifest = build_manifest(warns.append)
    for w in warns:
        print(f"WARN: {w}", file=sys.stderr)

    out = json.dumps(manifest, ensure_ascii=False, indent=1) + "\n"
    if args.check:
        current = MANIFEST.read_text(encoding="utf-8") if MANIFEST.is_file() else ""
        if out == current:
            return 0
        print(
            f"{MANIFEST.relative_to(ROOT)} is out of date — run tools/build_questions_manifest.py",
            file=sys.stderr,
        )
        for line in diff_summary(current, out):
            print(line, file=sys.stderr)
        return 1
    MANIFEST.write_text(out, encoding="utf-8")
    print(f"wrote {MANIFEST.relative_to(ROOT)} ({len(manifest)} entries)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
