"""Scan the PDF library and write library/library-manifest.json.

Run:  python3 -I tools/build_library_manifest.py
Walks library/{notes,official,school,papers} (questions/ and flashcards keep
their own manifests and are NOT scanned) and emits one entry per PDF with
file/subject/subjectLabel/type/section/label, sorted by
(type, subject, section, label) so re-runs diff cleanly — identical scans
differ only in the "generated" timestamp. Symlinks are never followed (a link
could escape the library tree) and non-PDF files are skipped.
"""

import json
import re
from collections import Counter
from collections.abc import Iterator
from datetime import UTC, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LIBRARY = ROOT / "library"

# Top-level folders scanned, in output order (questions/flashcards excluded).
TYPES = ("notes", "official", "school", "papers")

# Hub-page labels, mirroring build_site.py (SUBJECTS titles / dashboard cards).
SUBJECT_LABELS = {
    "math-aa-sl": "Math AA SL",
    "biology-hl": "Biology HL",
    "chemistry-hl": "Chemistry HL",
    "history-sl": "History SL",
    "french-a-langlit": "French A LangLit",
    "english-lit-hl": "English A Lit HL",
    "core-tok-ee": "Core — TOK · EE · CAS",
}

# Folders that are not subjects: school/ is flat, notes/tsm/ is the IA/TSM
# pile the ia.html and core.html pages link directly.
SPECIAL_LABELS = {
    "school": "School documents",
    "tsm": "TSM & IA exemplars",
}


def pretty(s: str) -> str:
    """Filename stem → display label; mirrors pretty() in build_site.py so
    manifest labels match the hub pages (including 2.4-style math prefixes)."""
    s = s.replace("-", " ").replace("&", "&amp;")
    s = re.sub(r"^(\d) (\d) ", r"\1.\2 ", s)
    return s[0].upper() + s[1:]


def subject_label(subject: str) -> str:
    """Known subjects keep their hub-page label; unknown slugs get pretty()."""
    if subject in SPECIAL_LABELS:
        return SPECIAL_LABELS[subject]
    if subject in SUBJECT_LABELS:
        return SUBJECT_LABELS[subject]
    return pretty(subject)


def iter_pdfs(base: Path) -> Iterator[Path]:
    """Yield PDFs under base, sorted. Symlinks are skipped outright (one could
    point outside the library tree), as are non-PDF files."""
    for entry in sorted(base.iterdir()):
        if entry.is_symlink():
            continue
        if entry.is_dir():
            yield from iter_pdfs(entry)
        elif entry.is_file() and entry.suffix.lower() == ".pdf":
            yield entry


def scan_library(root: Path = LIBRARY) -> list[dict[str, str]]:
    """One manifest item per PDF under root/<type>/..., sorted by
    (type, subject, section, label)."""
    items: list[dict[str, str]] = []
    for type_name in TYPES:
        base = root / type_name
        if base.is_symlink() or not base.is_dir():
            continue
        for pdf in iter_pdfs(base):
            parts = pdf.relative_to(base).parts
            if type_name == "school" or len(parts) == 1:
                # school/ is flat; a stray file directly under a type dir
                # belongs to the type itself.
                subject, section = type_name, ""
            else:
                subject, section = parts[0], "/".join(parts[1:-1])
            items.append(
                {
                    "file": f"{root.name}/{pdf.relative_to(root).as_posix()}",
                    "subject": subject,
                    "subjectLabel": subject_label(subject),
                    "type": type_name,
                    "section": section,
                    "label": pretty(pdf.stem),
                }
            )
    items.sort(key=lambda it: (it["type"], it["subject"], it["section"], it["label"]))
    return items


def build_manifest(root: Path = LIBRARY) -> dict[str, object]:
    """Full manifest document: generated timestamp + sorted items."""
    return {
        "generated": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "items": scan_library(root),
    }


def write_manifest(root: Path, manifest: dict[str, object]) -> Path:
    """Write the manifest to <root>/library-manifest.json; return its path."""
    out = root / "library-manifest.json"
    out.write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    return out


def main() -> None:
    manifest = build_manifest(LIBRARY)
    out = write_manifest(LIBRARY, manifest)
    counts = Counter(it["type"] for it in manifest["items"])
    print(f"library manifest: {out}")
    for type_name in TYPES:
        print(f"  {type_name}: {counts.get(type_name, 0)}")
    print(f"  total: {sum(counts.values())}")


if __name__ == "__main__":
    main()
