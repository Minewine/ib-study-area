"""tools/validate_content.py: passes on the repo; warns on untagged items and ids
reused across banks of one subject; fails on broken content."""

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TOOL = ROOT / "tools" / "validate_content.py"


def run(root):
    env = dict(os.environ, NEVAIB_ROOT=str(root))
    return subprocess.run([sys.executable, "-I", str(TOOL)], capture_output=True, text=True, env=env)


def copy_library(tmp_path):
    for sub in ("questions", "flashcards"):
        shutil.copytree(ROOT / "library" / sub, tmp_path / "library" / sub)
    return tmp_path


def test_repo_content_passes():
    r = run(ROOT)
    assert r.returncode == 0, r.stdout + r.stderr
    assert "ALL CHECKS PASSED" in r.stdout


def write_bank(root, name, subject, items, topic="t"):
    bank = {"subject": subject, "topic": topic, "topicLabel": "T", "items": items}
    (root / "library" / "questions" / name).write_text(json.dumps(bank), encoding="utf-8")


def mcq(i, topic=None):
    it = {"id": i, "format": "mcq", "stem": f"Stem {i}?", "choices": ["a", "b", "c", "d"], "answer": 0}
    if topic:
        it["topic"] = topic
    return it


def test_warns_on_reused_ids_and_untagged(tmp_path):
    root = copy_library(tmp_path)
    write_bank(root, "zz-a.json", "subj-x", [mcq("q1", "t"), mcq("q2")])
    write_bank(root, "zz-b.json", "subj-x", [mcq("q1", "t")])
    write_bank(root, "zz-c.json", "subj-y", [mcq("q1", "t")])
    r = run(root)
    assert r.returncode == 0, r.stdout
    assert "subject subj-x: 1 question id(s) reused across banks, e.g. q1 (zz-a.json / zz-b.json)" in r.stdout
    assert "subj-y" not in r.stdout.split("reused")[0].splitlines()[-1]
    assert "zz-a.json: 1 item(s) without a topic" in r.stdout


def test_fails_on_broken_content(tmp_path):
    root = copy_library(tmp_path)
    write_bank(root, "zz-bad.json", "subj-x", [mcq("q1", "t"), dict(mcq("q2", "t"), answer=7), mcq("q1", "t")])
    (root / "library" / "questions" / "zz-broken.json").write_text("{nope", encoding="utf-8")
    r = run(root)
    assert r.returncode == 1
    for msg in ("zz-bad.json: duplicate ids", "item q2: bad answer index", "zz-broken.json: not valid JSON"):
        assert msg in r.stdout, msg
