"""Tests for tools/build_deploy.py (unit + one real-build integration)."""

import importlib.util
import subprocess
import sys
import zipfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
TOOLS = ROOT / "tools"

spec = importlib.util.spec_from_file_location("build_deploy", TOOLS / "build_deploy.py")
build_deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build_deploy)  # safe: heavy work lives under main()


# ---------- apply_setup_key ----------


def test_apply_setup_key_arms_endpoint():
    src = build_deploy.EMPTY_KEY_LINE
    out = build_deploy.apply_setup_key(src, "s3cret-key")
    assert '"s3cret-key"' in out
    assert '$SETUP_KEY = "s3cret-key"' in out
    assert "BLANK AFTER SETUP" in out


def test_apply_setup_key_noop_when_line_absent():
    out = build_deploy.apply_setup_key("no key line here", "k")
    assert out == "no key line here"


# ---------- real build (integration) ----------


@pytest.fixture(scope="module")
def built():
    subprocess.run(
        [sys.executable, "-I", str(TOOLS / "build_deploy.py")],
        check=True,
        capture_output=True,
        cwd=ROOT,
    )
    return build_deploy.OUT, build_deploy.ZIP_FILE


def test_build_outputs_exist(built):
    out, zip_file = built
    assert out.is_dir()
    assert zip_file.is_file()


def test_built_folder_structure(built):
    out, _ = built
    for rel in [
        "index.html",
        "quiz.html",
        "cards.html",
        "author.html",
        "assets/app.js",
        "assets/auth.js",
        "assets/quiz-engine.js",
        "api/api.php",
        "docs/AUTHORING.md",
        "library/questions/manifest.json",
        "library/flashcards/manifest.json",
        "library/class-schedule.json",
        "library/ai-prompts.json",
        "assets/today.js",
        "assets/ai-prompt.js",
    ]:
        assert (out / rel).is_file(), rel


def test_built_pages_are_rewritten(built):
    out, _ = built
    for page in ("index.html", "quiz.html", "cards.html", "author.html"):
        t = (out / page).read_text(encoding="utf-8")
        assert "../assets/" not in t, page
        assert "← Study site" not in t, page


def test_built_pages_drop_study_site_only_blocks(built):
    out, _ = built
    home = (out / "index.html").read_text(encoding="utf-8")
    # the launcher card would otherwise link the deployed home page to itself
    assert "Study site →" not in home
    assert "study-site-only" not in home
    for page in build_deploy.PAGES:
        t = (out / page).read_text(encoding="utf-8")
        assert "\\uFF0B" not in t, page  # literal escape must not reach the page
        assert "stored per device" not in t, page


def test_built_api_setup_key_state(built):
    out, _ = built
    api = (out / "api/api.php").read_text(encoding="utf-8")
    if build_deploy.KEY_FILE.exists():
        assert '$SETUP_KEY = "";' not in api  # armed on purpose
    else:
        assert '$SETUP_KEY = "";' in api  # blank — setup disabled


def test_zip_matches_folder(built):
    out, zip_file = built
    local = sorted(f.relative_to(out).as_posix() for f in out.rglob("*") if f.is_file())
    with zipfile.ZipFile(zip_file) as zf:
        names = sorted(n for n in zf.namelist() if not n.endswith("/"))
    assert names == [f"nevaib/{rel}" for rel in local]


def test_zip_has_no_library_pdfs(built):
    _, zip_file = built
    with zipfile.ZipFile(zip_file) as zf:
        names = zf.namelist()
    assert not any(n.startswith("nevaib/library/official") for n in names)
    assert not any(n.startswith("nevaib/library/school") for n in names)
    assert not any(n.startswith("nevaib/library/notes") for n in names)
    assert not any(n.startswith("nevaib/library/papers") for n in names)
