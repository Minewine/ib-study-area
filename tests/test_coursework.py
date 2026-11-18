"""Coursework planner content (library/coursework/coursework.json), the practical/IA
skills quiz bank, and their place in the deploy build."""

import datetime
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CW = ROOT / "library" / "coursework" / "coursework.json"
BANK = "library/questions/ia-practical-skills.json"


def load(p):
    return json.loads(Path(p).read_text(encoding="utf-8"))


def strings(o):
    if isinstance(o, str):
        yield o
    elif isinstance(o, list):
        for v in o:
            yield from strings(v)
    elif isinstance(o, dict):
        for v in o.values():
            yield from strings(v)


def test_coursework_json_structure_and_unique_progress_ids():
    d = load(CW)
    assert d["schemaVersion"] == 1 and d["disclaimer"]
    assert [t["id"] for t in d["tracks"]] == ["bio", "chem", "math"]
    seen = set()
    for t in d["tracks"]:
        assert t["facts"] and t["criteria"] and len(t["stages"]) >= 8
        for s in t["stages"]:
            assert s["title"] and s["summary"] and s["checks"] and s["pitfalls"]
            for c in s["checks"]:
                key = f"{t['id']}.{s['id']}.{c['id']}"
                assert key not in seen, key
                seen.add(key)
            for dt in s.get("dates", []):
                datetime.date.fromisoformat(dt["date"])  # a real calendar date
                assert dt["label"] and dt["source"] and dt["when"]
    assert len(seen) >= 100


def test_criteria_totals_match_the_public_mark_schemes():
    d = load(CW)
    tracks = {t["id"]: t for t in d["tracks"]}
    for sci in ("bio", "chem"):
        names = [c["name"] for c in tracks[sci]["criteria"]]
        assert names == ["Research design", "Data analysis", "Conclusion", "Evaluation"]
        assert sum(c["max"] for c in tracks[sci]["criteria"]) == 24
    assert [c["max"] for c in tracks["math"]["criteria"]] == [4, 4, 3, 3, 6]
    assert [c["name"][0] for c in tracks["math"]["criteria"]] == list("ABCDE")


def test_school_dates_are_marked_approximate_and_sourced():
    d = load(CW)
    assert "approximate" in d["disclaimer"].lower()
    for t in d["tracks"]:
        for s in t["stages"]:
            for dt in s.get("dates", []):
                assert dt["source"].startswith("ISL "), dt


def test_no_private_paths_or_files_in_content():
    for text in strings(load(CW)):
        assert not re.search(r"/home/|/workspace/|library/school/|\.pdf\b", text), text


def test_practical_skills_bank_registered_and_valid():
    bank = load(ROOT / BANK)
    assert 20 <= len(bank["items"]) <= 30
    ids = [it["id"] for it in bank["items"]]
    assert len(ids) == len(set(ids))
    for it in bank["items"]:
        assert it["stem"] and it["topic"] and it.get("note")
        if it["format"] == "mcq":
            assert 0 <= it["answer"] < len(it["choices"]) and len(it["choices"]) == 4
        else:
            assert it["format"] == "written" and it["marks"] and it["markscheme"]
    manifest = load(ROOT / "library/questions/manifest.json")
    entry = [m for m in manifest if m["file"] == BANK]
    assert len(entry) == 1 and entry[0]["subject"] == "ia-skills"


def test_validator_passes():
    r = subprocess.run([sys.executable, "-I", "tools/validate_content.py"], cwd=ROOT, capture_output=True, text=True)
    assert r.returncode == 0, r.stdout + r.stderr
    assert "coursework planner:" in r.stdout


def test_deploy_build_ships_the_planner(tmp_path):
    import importlib.util
    spec = importlib.util.spec_from_file_location("build_deploy", ROOT / "tools" / "build_deploy.py")
    bd = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(bd)
    out = bd.build(tmp_path / "nevaib", apply_key=False)
    page = (out / "coursework.html").read_text(encoding="utf-8")
    assert 'src="assets/coursework.js' in page and "../" not in page
    assert "Study site" not in page
    assert (out / "library/coursework/coursework.json").is_file()
    assert (out / BANK).is_file()
    for p in bd.PAGES:
        assert 'href="coursework.html"' in (out / p).read_text(encoding="utf-8"), p
    assert not (out / "library/school").exists()
