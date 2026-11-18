"""Assemble the ready-to-upload nevaib/ folder for rametric.com.

Run:  python3 -I tools/build_deploy.py
Output: deploy/nevaib/  +  deploy/nevaib.zip  (push with tools/push_deploy.py,
or upload manually via cPanel/SFTP)

Contents: the practice app pages, engines, style, ORIGINAL quiz banks +
flashcard decks + topic notes + manifests + authoring doc + api.php (+ summary.php,
weekly_email.php). The copyrighted PDF
folders (library/official|school|notes|papers) are NOT included — they stay
local-only. Study-site links are stripped (the deployed app is standalone).

If deploy/.setup-key exists it is baked into the built api.php, enabling
one-time account creation. After accounts exist and the server key is blanked,
DELETE deploy/.setup-key so rebuilds ship the blank-key api.php (the push
script refuses to upload an armed api.php unless forced). See
server/deploy-notes.md.
"""

import re
import shutil
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "deploy" / "nevaib"
KEY_FILE = ROOT / "deploy" / ".setup-key"
ZIP_FILE = ROOT / "deploy" / "nevaib.zip"

PAGES = ["index.html", "notes.html", "quiz.html", "cards.html", "author.html", "summary.html"]

EMPTY_KEY_LINE = (
    '$SETUP_KEY = "";  // e.g. "paste-a-long-random-string"; empty = setup disabled'
)
ARMED_KEY_LINE = '$SETUP_KEY = "{key}";  // one-time account creation; BLANK AFTER SETUP (see server/deploy-notes.md)'


def copy_tree(src: Path, dst: Path) -> None:
    dst.mkdir(parents=True, exist_ok=True)
    for f in src.rglob("*"):
        if f.is_file():
            (dst / f.relative_to(src)).parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(f, dst / f.relative_to(src))


def apply_setup_key(text: str, key: str) -> str:
    """Arm the setup endpoint in api.php text. No-op if the line is absent."""
    armed = ARMED_KEY_LINE.format(key=key)
    return text.replace(EMPTY_KEY_LINE, armed)


def build_pages(out: Path) -> None:
    out.mkdir(parents=True, exist_ok=True)
    for page in PAGES:
        t = (ROOT / "app" / page).read_text(encoding="utf-8")
        t = t.replace("../assets/", "assets/").replace("../library/", "library/")
        t = t.replace("../docs/AUTHORING.md", "docs/AUTHORING.md")
        t = t.replace("../index.html", "index.html")
        t = t.replace(
            '<a href="index.html" style="margin-left:auto">← Study site</a>', ""
        )
        t = t.replace(
            '<a href="../plan.html">← How sessions fit the weekly plan</a>', ""
        )
        t = t.replace('<p><a href="../plan.html">', "<p>")
        # blocks that only make sense next to the local study site (e.g. the
        # "Study site →" launcher card, which would link the app to itself)
        t = re.sub(r"<!-- study-site-only -->.*?<!-- /study-site-only -->", "", t, flags=re.S)
        (out / page).write_text(t, encoding="utf-8")


def build(out: Path = OUT, apply_key: bool = True) -> Path:
    if out.exists():
        shutil.rmtree(out)
    build_pages(out)
    # assets (engines + style) — keep the version query working
    copy_tree(ROOT / "assets", out / "assets")
    # original content only
    copy_tree(ROOT / "library/questions", out / "library/questions")
    copy_tree(ROOT / "library/flashcards", out / "library/flashcards")
    copy_tree(ROOT / "library/topic-notes", out / "library/topic-notes")
    (out / "docs").mkdir(parents=True, exist_ok=True)
    shutil.copy2(ROOT / "docs/AUTHORING.md", out / "docs/AUTHORING.md")
    # backend
    (out / "api").mkdir(parents=True, exist_ok=True)
    api_text = (ROOT / "server/api.php").read_text(encoding="utf-8")
    if apply_key and KEY_FILE.exists():
        api_text = apply_setup_key(
            api_text, KEY_FILE.read_text(encoding="utf-8").strip()
        )
    (out / "api/api.php").write_text(api_text, encoding="utf-8")
    # weekly summary: library used by api.php + the cron-only e-mail script (refuses web requests)
    for extra in ("summary.php", "weekly_email.php"):
        shutil.copy2(ROOT / "server" / extra, out / "api" / extra)
    return out


def make_zip(out: Path = OUT, zip_file: Path = ZIP_FILE) -> Path:
    zip_file.parent.mkdir(parents=True, exist_ok=True)
    if zip_file.exists():
        zip_file.unlink()
    with zipfile.ZipFile(zip_file, "w", zipfile.ZIP_DEFLATED) as zf:
        for f in sorted(out.rglob("*")):
            if f.is_file():
                zf.write(f, Path(out.name) / f.relative_to(out))
    return zip_file


def main() -> None:
    build()
    make_zip()
    print("deployed folder ready:", OUT, "+", ZIP_FILE)


if __name__ == "__main__":
    main()
