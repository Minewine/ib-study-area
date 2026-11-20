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


def test_topic_note_with_unknown_linked_id_fails(tmp_path):
    root = copy_library(tmp_path)
    shutil.copytree(ROOT / "library" / "topic-notes", root / "library" / "topic-notes")
    assert run(root).returncode == 0
    f = root / "library" / "topic-notes" / "biology-hl" / "c1-1.json"
    note = json.loads(f.read_text(encoding="utf-8"))
    note["links"]["quizBanks"] = [{"file": "library/questions/bio-c1-1-enzymes-metabolism.json", "itemIds": ["e01", "no-such-id"]}]
    note["links"]["decks"].append({"file": "library/flashcards/missing.json", "cardIds": None})
    f.write_text(json.dumps(note), encoding="utf-8")
    r = run(root)
    assert r.returncode == 1
    assert "linked id 'no-such-id' not found" in r.stdout
    assert "linked file 'library/flashcards/missing.json' does not exist" in r.stdout


def test_topic_note_missing_required_field_fails(tmp_path):
    root = copy_library(tmp_path)
    shutil.copytree(ROOT / "library" / "topic-notes", root / "library" / "topic-notes")
    f = root / "library" / "topic-notes" / "chemistry-hl" / "s1-4.json"
    note = json.loads(f.read_text(encoding="utf-8"))
    del note["code"]
    note["paper1A"][0]["answer"] = 9
    f.write_text(json.dumps(note), encoding="utf-8")
    r = run(root)
    assert r.returncode == 1
    assert "'code' missing" in r.stdout and "paper1A[0] answer index out of range" in r.stdout


def write_bank_extra(root, name, subject, items, **extra):
    bank = {"subject": subject, "topic": "t", "topicLabel": "T", "items": items}
    bank.update(extra)
    (root / "library" / "questions" / name).write_text(json.dumps(bank), encoding="utf-8")


def test_item_difficulty_vocabulary(tmp_path):
    root = copy_library(tmp_path)
    write_bank(root, "zz-bad.json", "subj-d", [dict(mcq("q1", "t"), difficulty="brutal"), mcq("q2", "t")])
    write_bank(root, "zz-unrated.json", "subj-d", [dict(mcq("q5", "t"), difficulty="unrated")])
    write_bank(root, "zz-good.json", "subj-d", [dict(mcq("q3", "t"), difficulty="hard"),
                                                dict(mcq("q4", "t"), difficulty="standard")])
    r = run(root)
    assert r.returncode == 1
    assert "zz-bad.json item q1: difficulty must be easy, standard or hard (got 'brutal')" in r.stdout
    assert "zz-unrated.json item q5: difficulty 'unrated' must be omitted (absent means unrated)" in r.stdout
    assert "zz-good.json" not in r.stdout.split("FAIL")[-1]  # valid values raise nothing


def test_bank_set_setorder_codes_fields(tmp_path):
    root = copy_library(tmp_path)
    write_bank_extra(root, "zz-bad.json", "subj-s", [mcq("q1", "t")],
                     set="", setOrder="3", codes=["S11", 7])
    write_bank_extra(root, "zz-good.json", "subj-s", [mcq("q2", "t")],
                     set="Paper 1A — Structure 1", setOrder=2, codes=["S1.1", "2.1"])
    r = run(root)
    assert r.returncode == 1
    out = r.stdout
    assert "zz-bad.json: 'set' must be a non-empty string" in out
    assert "zz-bad.json: 'setOrder' must be an integer" in out
    assert "zz-bad.json: 'codes' must be IB codes like \"S1.1\", \"A1.1\" or \"2.1\"" in out
    assert "zz-good.json: 'set'" not in out and "zz-good.json: 'codes'" not in out


def test_duplicate_set_name_in_same_subject_topic_warns(tmp_path):
    root = copy_library(tmp_path)
    # no item-level topics: the effective topic is the bank's, so this is the
    # bank-level special case of the effective-topic collision check
    write_bank_extra(root, "zz-a.json", "subj-x", [mcq("q1")], topic="dup-topic", set="Set X")
    write_bank_extra(root, "zz-b.json", "subj-x", [mcq("q2")], topic="dup-topic", set="Set X")
    write_bank_extra(root, "zz-c.json", "subj-x", [mcq("q3")], topic="dup-topic", set="Set Y")
    r = run(root)
    assert r.returncode == 0, r.stdout
    assert "subject subj-x topic dup-topic: set name 'Set X' used by 2 banks (zz-a.json / zz-b.json) — set names must be unique within a topic" in r.stdout
    assert "Set Y" not in r.stdout  # unique names don't warn


def test_duplicate_set_name_at_shared_item_topic_warns(tmp_path):
    root = copy_library(tmp_path)
    # different bank-level topics, but the items share one effective topic: the picker
    # lists both sets under that shared topic, so identical names collide there
    write_bank_extra(root, "zz-a.json", "subj-x", [mcq("q1", "shared")], topic="topic-a", set="Set X")
    write_bank_extra(root, "zz-b.json", "subj-x", [mcq("q2", "shared")], topic="topic-b", set="Set X")
    r = run(root)
    assert r.returncode == 0, r.stdout
    assert "subject subj-x topic shared: set name 'Set X' used by 2 banks (zz-a.json / zz-b.json) — set names must be unique within a topic" in r.stdout


def test_multi_topic_bank_reusing_its_set_name_does_not_warn(tmp_path):
    root = copy_library(tmp_path)
    # one bank spread over several effective topics carries the same set name into
    # each — that is legitimate and must not warn
    write_bank_extra(root, "zz-a.json", "subj-x", [mcq("q1", "ta"), mcq("q2", "tb")],
                     topic="topic-a", set="Set X")
    r = run(root)
    assert r.returncode == 0, r.stdout
    assert "set name" not in r.stdout


def test_duplicate_set_name_falls_back_to_manifest_label(tmp_path):
    root = copy_library(tmp_path)
    write_bank(root, "zz-a.json", "subj-x", [mcq("q1", "t")], topic="dup-topic")
    write_bank(root, "zz-b.json", "subj-x", [mcq("q2", "t")], topic="dup-topic")
    f = root / "library" / "questions" / "manifest.json"
    m = json.loads(f.read_text(encoding="utf-8"))
    m += [{"file": "library/questions/zz-a.json", "label": "Same name"},
          {"file": "library/questions/zz-b.json", "label": "Same name"}]
    f.write_text(json.dumps(m, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    r = run(root)
    assert r.returncode == 0, r.stdout
    assert "set name 'Same name' used by 2 banks (zz-a.json / zz-b.json)" in r.stdout


def manifest_entry(root, suffix):
    f = root / "library" / "questions" / "manifest.json"
    m = json.loads(f.read_text(encoding="utf-8"))
    entry = next(e for e in m if e["file"].endswith(suffix))
    f.write_text(json.dumps(m, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    return f, m, entry


def test_manifest_metadata_mismatch_fails(tmp_path):
    root = copy_library(tmp_path)
    f, m, e = manifest_entry(root, "bio-unity-diversity-cells.json")
    e["counts"]["total"] += 1
    f.write_text(json.dumps(m, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    r = run(root)
    assert r.returncode == 1
    assert "metadata for library/questions/bio-unity-diversity-cells.json doesn't match the bank (counts)" in r.stdout


def test_manifest_topics_and_passthrough_mismatch_fails(tmp_path):
    root = copy_library(tmp_path)
    f, m, e = manifest_entry(root, "bio-c1-1-enzymes-metabolism.json")
    e["topics"][0]["count"] += 1
    del e["codes"]  # bank has codes, manifest entry lost them
    f.write_text(json.dumps(m, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    r = run(root)
    assert r.returncode == 1
    assert "doesn't match the bank (codes, topics)" in r.stdout


def test_manifest_entry_without_metadata_is_not_checked(tmp_path):
    root = copy_library(tmp_path)
    f, m, e = manifest_entry(root, "bio-unity-diversity-cells.json")
    del e["counts"], e["topics"]  # pre-metadata manifest: nothing to verify
    f.write_text(json.dumps(m, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    r = run(root)
    assert r.returncode == 0, r.stdout
