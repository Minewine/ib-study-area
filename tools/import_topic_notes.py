"""Import topic-note drafts into library/topic-notes/ and rebuild the manifest.

Run:  python3 -I tools/import_topic_notes.py [DRAFT_DIR]     (default /workspace/notes-draft)

Copies DRAFT_DIR/<folder>/*.json (one note per topic, schema v1 — see docs/DEVELOPMENT.md
"Topic notes") into library/topic-notes/<note.subject>/<file>, and
syllabus-*.json into library/syllabus/<subject>.json. Never reads DRAFT_DIR/sources/
or any _build/ folder (private guides and build scripts stay out of the repo).
Refuses a file that mentions a local path. Safe to re-run: it overwrites drafts it
copied before and regenerates library/topic-notes/manifest.json from what is on disk.
"""

import json
import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
NOTES = ROOT / "library" / "topic-notes"
SYLL = ROOT / "library" / "syllabus"
PRIVATE = re.compile(r"/workspace/|/home/[a-z]|[A-Za-z]:\\\\|/Users/")
SKIP_DIRS = {"sources", "_build"}
LABELS = {"biology-hl": "Biology HL", "chemistry-hl": "Chemistry HL", "maths-aa-sl": "Maths AA SL"}


def code_key(code: str):
    return [int(p) if p.isdigit() else p for p in re.split(r"[.\-]", code)]


def build_manifest() -> list:
    rows = []
    for f in sorted(NOTES.glob("*/*.json")):
        n = json.loads(f.read_text(encoding="utf-8"))
        rows.append({
            "file": f.relative_to(ROOT).as_posix(), "id": n["id"], "subject": n["subject"],
            "code": n["code"], "title": n["title"], "theme": n.get("theme", ""),
            "themeLabel": n.get("themeLabel", ""), "hlOnly": bool(n.get("hlOnly")),
            "status": n.get("status", "draft"),
        })
    rows.sort(key=lambda r: (r["subject"], code_key(r["code"])))
    subjects = {}
    for f in sorted(SYLL.glob("*.json")):
        s = json.loads(f.read_text(encoding="utf-8"))
        subjects[s["subject"]] = {"label": s.get("subjectLabel") or LABELS.get(s["subject"], s["subject"]),
                                  "syllabus": f.relative_to(ROOT).as_posix(),
                                  "themes": s.get("themes", [])}
    for r in rows:
        subjects.setdefault(r["subject"], {"label": LABELS.get(r["subject"], r["subject"]), "syllabus": None, "themes": []})
    out = {"schemaVersion": 1, "subjects": subjects, "notes": rows}
    (NOTES / "manifest.json").write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    return rows


def main(draft: Path) -> None:
    copied = 0
    for folder in sorted(p for p in draft.iterdir() if p.is_dir() and p.name not in SKIP_DIRS):
        for f in sorted(folder.glob("*.json")):  # top level only: never _build/
            text = f.read_text(encoding="utf-8")
            if PRIVATE.search(text):
                sys.exit(f"refusing {f}: it mentions a local path")
            data = json.loads(text)
            if f.name.startswith("syllabus-"):
                SYLL.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(f, SYLL / f"{data['subject']}.json")
            else:
                dest = NOTES / data["subject"] / f.name
                dest.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(f, dest)
            copied += 1
    rows = build_manifest()
    print(f"copied {copied} files; manifest lists {len(rows)} notes")


if __name__ == "__main__":
    main(Path(sys.argv[1] if len(sys.argv) > 1 else "/workspace/notes-draft"))
