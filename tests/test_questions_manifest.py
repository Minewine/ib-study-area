"""tools/build_questions_manifest.py: keeps manifest labels/order intact, appends
unlisted banks with a label fallback, computes counts/topics metadata, and --check
detects drift. Aggregation mirrors bankItems() in assets/quiz-engine.js."""

import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TOOL = ROOT / "tools" / "build_questions_manifest.py"


def run(root, *args):
    env = dict(os.environ, NEVAIB_ROOT=str(root))
    return subprocess.run(
        [sys.executable, "-I", str(TOOL), *args],
        capture_output=True,
        text=True,
        env=env,
    )


def write_manifest(root, entries):
    f = root / "library" / "questions" / "manifest.json"
    f.write_text(
        json.dumps(entries, ensure_ascii=False, indent=1) + "\n", encoding="utf-8"
    )


def read_manifest(root):
    return json.loads(
        (root / "library" / "questions" / "manifest.json").read_text(encoding="utf-8")
    )


def write_bank(root, name, subject, items, **extra):
    (root / "library" / "questions").mkdir(parents=True, exist_ok=True)
    bank = {"subject": subject, "items": items}
    bank.update(extra)
    (root / "library" / "questions" / name).write_text(
        json.dumps(bank, ensure_ascii=False, indent=1) + "\n", encoding="utf-8"
    )


def mcq(i, **extra):
    it = {
        "id": i,
        "format": "mcq",
        "stem": f"Stem {i}?",
        "choices": ["a", "b"],
        "answer": 0,
    }
    it.update(extra)
    return it


def written(i, **extra):
    it = {
        "id": i,
        "format": "written",
        "stem": f"Stem {i}?",
        "marks": 2,
        "markscheme": ["x"],
    }
    it.update(extra)
    return it


def make_root(tmp_path):
    (tmp_path / "library" / "questions").mkdir(parents=True)
    return tmp_path


def test_preserves_labels_order_and_identity_fields(tmp_path):
    root = make_root(tmp_path)
    write_bank(root, "za-a.json", "subj-one", [mcq("q1")], topic="ta", topicLabel="TA")
    write_bank(
        root, "za-b.json", "subj-two", [mcq("q1")], topic="tb"
    )  # subject differs from manifest
    write_manifest(
        root,
        [
            {
                "file": "library/questions/za-a.json",
                "subject": "subj-one",
                "subjectLabel": "Subject One",
                "label": "Label A",
            },
            {
                "file": "library/questions/za-b.json",
                "subject": "subj-one",
                "subjectLabel": "Subject One",
                "label": "Label B",
            },
        ],
    )
    r = run(root)
    assert r.returncode == 0, r.stdout + r.stderr
    entries = read_manifest(root)
    assert [(e["file"], e["label"], e["subjectLabel"]) for e in entries] == [
        ("library/questions/za-a.json", "Label A", "Subject One"),
        ("library/questions/za-b.json", "Label B", "Subject One"),
    ]
    assert entries[1]["subject"] == "subj-one"  # manifest identity wins over the bank's


def test_appends_unlisted_bank_with_label_fallback(tmp_path):
    root = make_root(tmp_path)
    write_bank(root, "za-a.json", "subj-one", [mcq("q1")], topic="ta")
    write_bank(
        root,
        "zz-titled.json",
        "subj-two",
        [mcq("q1")],
        topic="tb",
        topicLabel="Titled bank",
    )
    write_bank(root, "zz-bare.json", "subj-two", [mcq("q1")], topic="tc")
    write_manifest(
        root,
        [
            {
                "file": "library/questions/za-a.json",
                "subject": "subj-one",
                "subjectLabel": "Subject One",
                "label": "Label A",
            }
        ],
    )
    r = run(root)
    assert r.returncode == 0, r.stdout + r.stderr
    entries = read_manifest(root)
    assert [e["file"] for e in entries] == [
        "library/questions/za-a.json",
        "library/questions/zz-bare.json",
        "library/questions/zz-titled.json",
    ]
    assert entries[2]["label"] == "Titled bank"  # bank topicLabel
    assert entries[1]["label"] == "zz-bare"  # filename-stem fallback
    assert entries[2]["subject"] == entries[2]["subjectLabel"] == "subj-two"
    assert entries[2]["topic"] == "tb" and "topicLabel" not in entries[1]


def test_counts_topics_and_difficulty_aggregation(tmp_path):
    root = make_root(tmp_path)
    items = [
        mcq("q1", topic="sub-a", topicLabel="Sub A", difficulty="easy"),
        written("q2"),  # no item topic -> bank topic; no difficulty -> unrated
        mcq("q3", topic="sub-b", retired=True, retiredReason="off-syllabus"),
        mcq("q4", difficulty="brutal"),  # unknown vocabulary -> unrated, never invented
        mcq("q5", topic="sub-b", difficulty="hard"),
    ]
    write_bank(
        root,
        "za-a.json",
        "subj-one",
        items,
        topic="bank-topic",
        topicLabel="Bank topic label",
        set="Set X",
        setOrder=3,
        codes=["C1.1"],
        paperStyle="1A",
        calculatorFree=True,
    )
    write_manifest(
        root,
        [
            {
                "file": "library/questions/za-a.json",
                "subject": "subj-one",
                "subjectLabel": "Subject One",
                "label": "Label A",
            }
        ],
    )
    assert run(root).returncode == 0
    e = read_manifest(root)[0]
    assert e["counts"] == {"mcq": 3, "written": 1, "total": 4}  # retired q3 excluded
    assert e["set"] == "Set X" and e["setOrder"] == 3 and e["codes"] == ["C1.1"]
    assert e["paperStyle"] == "1A" and e["calculatorFree"] is True
    assert e["topics"] == [
        {
            "topic": "sub-a",
            "topicLabel": "Sub A",
            "count": 1,
            "difficulty": {"unrated": 0, "easy": 1, "standard": 0, "hard": 0},
        },
        {
            "topic": "bank-topic",
            "topicLabel": "Bank topic label",
            "count": 2,
            "difficulty": {"unrated": 2, "easy": 0, "standard": 0, "hard": 0},
        },
        {
            "topic": "sub-b",
            "topicLabel": "Bank topic label",
            "count": 1,
            "difficulty": {"unrated": 0, "easy": 0, "standard": 0, "hard": 1},
        },
    ]


def test_bank_without_topic_falls_back_to_filename_stem(tmp_path):
    root = make_root(tmp_path)
    write_bank(root, "zz-bare.json", "subj-one", [mcq("q1"), written("q2")])
    r = run(root)  # no manifest at all -> fresh one
    assert r.returncode == 0, r.stdout + r.stderr
    e = read_manifest(root)[0]
    assert e["label"] == "zz-bare"
    assert e["topics"][0]["topic"] == "zz-bare"
    assert (
        e["topics"][0]["topicLabel"] == "zz-bare"
    )  # label falls back to the topic key
    assert not any(
        k in e
        for k in (
            "topic",
            "topicLabel",
            "set",
            "setOrder",
            "codes",
            "paperStyle",
            "calculatorFree",
        )
    )


def test_keeps_entries_for_missing_banks_and_warns(tmp_path):
    root = make_root(tmp_path)
    write_manifest(
        root,
        [
            {
                "file": "library/questions/gone.json",
                "subject": "s",
                "subjectLabel": "S",
                "label": "Gone",
            }
        ],
    )
    r = run(root, "--check")
    assert r.returncode == 0, r.stdout + r.stderr
    assert "WARN" in r.stderr and "gone.json" in r.stderr
    assert read_manifest(root)[0]["label"] == "Gone"  # manifest stayed stable


def test_check_mode_detects_drift_and_passes_when_fresh(tmp_path):
    root = make_root(tmp_path)
    write_bank(root, "za-a.json", "subj-one", [mcq("q1")], topic="ta", topicLabel="TA")
    write_manifest(
        root,
        [
            {
                "file": "library/questions/za-a.json",
                "subject": "subj-one",
                "subjectLabel": "Subject One",
                "label": "Label A",
            }
        ],
    )
    r = run(root, "--check")
    assert r.returncode == 1
    assert "out of date" in r.stderr and "za-a.json" in r.stderr
    r = run(root)  # write mode
    assert r.returncode == 0, r.stdout + r.stderr
    r = run(root, "--check")  # fresh -> clean
    assert r.returncode == 0, r.stdout + r.stderr
    write_bank(
        root,
        "za-a.json",
        "subj-one",
        [mcq("q1"), mcq("q2")],
        topic="ta",
        topicLabel="TA",
    )
    r = run(root, "--check")  # bank drifted after the manifest was written
    assert r.returncode == 1
    assert "za-a.json" in r.stderr
