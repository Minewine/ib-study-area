"""Tests for tools/build_library_manifest.py (scan, labels, symlink safety).

All tests inject a tmp library root — the real library/ is never touched.
"""

import importlib.util
import json
import os
import time
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
TOOLS = ROOT / "tools"

spec = importlib.util.spec_from_file_location(
    "build_library_manifest", TOOLS / "build_library_manifest.py"
)
build_library_manifest = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build_library_manifest)  # safe: writes happen in main()


@pytest.fixture
def libroot(tmp_path):
    """Empty library skeleton in tmp (notes/official/school/papers)."""
    root = tmp_path / "library"
    root.mkdir()
    for type_name in build_library_manifest.TYPES:
        (root / type_name).mkdir()
    return root


def make_pdf(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"%PDF-1.4 test stub\n")


# ---------- empty library ----------


def test_empty_library_yields_empty_items(libroot):
    manifest = build_library_manifest.build_manifest(libroot)
    assert manifest["items"] == []
    assert set(manifest) == {"generated", "items"}
    assert manifest["generated"].endswith("Z")


def test_empty_papers_dir_produces_no_items(libroot):
    make_pdf(libroot / "notes" / "biology-hl" / "tools" / "sampling.pdf")
    items = build_library_manifest.scan_library(libroot)
    assert [it["type"] for it in items] == ["notes"]


def test_missing_type_dir_is_skipped(libroot):
    (libroot / "papers").rmdir()
    make_pdf(libroot / "school" / "letter.pdf")
    items = build_library_manifest.scan_library(libroot)
    assert len(items) == 1
    assert items[0]["type"] == "school"


# ---------- per-type derivation ----------


def test_notes_item_matches_schema_example(libroot):
    make_pdf(
        libroot
        / "notes"
        / "biology-hl"
        / "continuity-change"
        / "cell-nuclear-division.pdf"
    )
    items = build_library_manifest.scan_library(libroot)
    assert items == [
        {
            "file": "library/notes/biology-hl/continuity-change/cell-nuclear-division.pdf",
            "subject": "biology-hl",
            "subjectLabel": "Biology HL",
            "type": "notes",
            "section": "continuity-change",
            "label": "Cell nuclear division",
        }
    ]


def test_official_school_papers_derivation(libroot):
    make_pdf(libroot / "official" / "math-aa-sl" / "math-aa-formula-booklet-fa2021.pdf")
    make_pdf(libroot / "school" / "bio-course-outline-2026-28.pdf")
    make_pdf(libroot / "papers" / "math-aa-sl" / "may-2026-paper-1-tz2.pdf")
    items = build_library_manifest.scan_library(libroot)
    by_type = {it["type"]: it for it in items}
    assert by_type["official"] == {
        "file": "library/official/math-aa-sl/math-aa-formula-booklet-fa2021.pdf",
        "subject": "math-aa-sl",
        "subjectLabel": "Math AA SL",
        "type": "official",
        "section": "",
        "label": "Math aa formula booklet fa2021",
    }
    assert by_type["school"] == {
        "file": "library/school/bio-course-outline-2026-28.pdf",
        "subject": "school",
        "subjectLabel": "School documents",
        "type": "school",
        "section": "",
        "label": "Bio course outline 2026 28",
    }
    assert by_type["papers"] == {
        "file": "library/papers/math-aa-sl/may-2026-paper-1-tz2.pdf",
        "subject": "math-aa-sl",
        "subjectLabel": "Math AA SL",
        "type": "papers",
        "section": "",
        "label": "May 2026 paper 1 tz2",
    }


# ---------- labels match build_site.py pretty() (hub pages) ----------


def test_math_numbered_stem_labels_match_hub_pages(libroot):
    # pretty() turns "2-4-..." into "2.4 ..." exactly like the math hub page.
    make_pdf(
        libroot
        / "notes"
        / "math-aa-sl"
        / "2-functions"
        / "2-4-further-functions-graphs.pdf"
    )
    make_pdf(
        libroot
        / "notes"
        / "math-aa-sl"
        / "2-functions"
        / "2-1-linear-functions-graphs.pdf"
    )
    items = build_library_manifest.scan_library(libroot)
    labels = [it["label"] for it in items]
    assert labels == [
        "2.1 linear functions graphs",
        "2.4 further functions graphs",
    ]
    # the same strings the generated hub pages show
    math_hub = (ROOT / "math-aa-sl.html").read_text(encoding="utf-8")
    for label in labels:
        assert label in math_hub


# ---------- notes/tsm special case (mirrors ia.html / core.html links) ----------


def test_tsm_files_get_special_subject_label(libroot):
    make_pdf(libroot / "notes" / "tsm" / "math-aa-tsm-2023.pdf")
    items = build_library_manifest.scan_library(libroot)
    assert items == [
        {
            "file": "library/notes/tsm/math-aa-tsm-2023.pdf",
            "subject": "tsm",
            "subjectLabel": "TSM & IA exemplars",
            "type": "notes",
            "section": "",
            "label": "Math aa tsm 2023",
        }
    ]


# ---------- unknown subjects fall back to a prettified slug ----------


def test_unknown_subject_label_falls_back_to_pretty_slug(libroot):
    make_pdf(libroot / "notes" / "philosophy-sl" / "being-human" / "soul-mind.pdf")
    items = build_library_manifest.scan_library(libroot)
    assert items[0]["subject"] == "philosophy-sl"
    assert items[0]["subjectLabel"] == "Philosophy sl"  # pretty() of the slug
    assert items[0]["section"] == "being-human"
    assert items[0]["label"] == "Soul mind"


def test_known_subject_labels_come_from_hub_pages(libroot):
    make_pdf(
        libroot
        / "official"
        / "french-a-langlit"
        / "language-a-langlit-subject-brief.pdf"
    )
    items = build_library_manifest.scan_library(libroot)
    assert items[0]["subjectLabel"] == "French A LangLit"


# ---------- non-PDF files are skipped ----------


def test_non_pdf_files_are_skipped(libroot):
    (libroot / "papers" / ".gitkeep").write_text("")
    (libroot / "school" / "plan.txt").write_text("nope")
    make_pdf(libroot / "official" / "core-tok-ee" / "guide.PDF")  # case-insensitive
    items = build_library_manifest.scan_library(libroot)
    assert [it["file"] for it in items] == ["library/official/core-tok-ee/guide.PDF"]


# ---------- symlink safety: links are never followed ----------


def test_symlinks_escaping_the_tree_are_not_followed(libroot, tmp_path):
    outside = tmp_path / "outside"
    make_pdf(outside / "leaked.pdf")
    os.symlink(outside, libroot / "notes" / "escape-dir")  # directory link
    os.symlink(outside / "leaked.pdf", libroot / "school" / "escape.pdf")  # file link
    assert build_library_manifest.scan_library(libroot) == []


def test_symlinked_type_dir_is_skipped(libroot, tmp_path):
    outside = tmp_path / "outside"
    make_pdf(outside / "leaked.pdf")
    (libroot / "official").rmdir()
    os.symlink(outside, libroot / "official")
    assert build_library_manifest.scan_library(libroot) == []


# ---------- stable, sorted, idempotent output ----------


def test_output_is_sorted_by_type_subject_section_label(libroot):
    make_pdf(libroot / "notes" / "zeta-sub" / "sec" / "a.pdf")
    make_pdf(libroot / "notes" / "alpha-sub" / "sec" / "b.pdf")
    make_pdf(libroot / "official" / "alpha-sub" / "c.pdf")
    make_pdf(libroot / "school" / "d.pdf")
    items = build_library_manifest.scan_library(libroot)
    keys = [(it["type"], it["subject"], it["section"], it["label"]) for it in items]
    assert keys == sorted(keys)


def test_reruns_differ_only_in_generated_timestamp(libroot):
    make_pdf(libroot / "notes" / "biology-hl" / "form-function" / "enzymes.pdf")
    first = build_library_manifest.build_manifest(libroot)
    second = build_library_manifest.build_manifest(libroot)
    assert first["items"] == second["items"]

    p1 = build_library_manifest.write_manifest(libroot, first)
    one = json.loads(p1.read_text(encoding="utf-8"))
    time.sleep(1.1)  # timestamp has second resolution
    p2 = build_library_manifest.write_manifest(
        libroot, build_library_manifest.build_manifest(libroot)
    )
    two = json.loads(p2.read_text(encoding="utf-8"))
    assert one.pop("generated") != two.pop("generated")
    assert one == two


# ---------- main() wiring ----------


def test_main_writes_manifest_beside_library_and_prints_counts(
    libroot, monkeypatch, capsys
):
    make_pdf(
        libroot
        / "notes"
        / "biology-hl"
        / "continuity-change"
        / "cell-nuclear-division.pdf"
    )
    monkeypatch.setattr(build_library_manifest, "LIBRARY", libroot)
    build_library_manifest.main()
    out = libroot / "library-manifest.json"
    assert out.is_file()
    manifest = json.loads(out.read_text(encoding="utf-8"))
    assert len(manifest["items"]) == 1
    printed = capsys.readouterr().out
    assert "notes: 1" in printed
    assert "total: 1" in printed
