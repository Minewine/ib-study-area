"""Assemble the ready-to-upload nevaib/ folder for rametic.com.

Run:  python3 -I tools/build_deploy.py
Output: deploy/nevaib/  (upload this to public_html/nevaib/ via cPanel/SFTP)

Contents: the practice app pages, engines, style, ORIGINAL quiz banks +
flashcard decks + manifests + authoring doc + api.php. The copyrighted PDF
folders (library/official|school|notes|papers) are NOT included — they stay
local-only. Study-site links are stripped (the deployed app is standalone).
"""
import json
import re
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "deploy" / "nevaib"
if OUT.exists():
    shutil.rmtree(OUT)

def copy_tree(src: Path, dst: Path):
    dst.mkdir(parents=True, exist_ok=True)
    for f in src.rglob("*"):
        if f.is_file():
            (dst / f.relative_to(src)).parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(f, dst / f.relative_to(src))

# pages (rewrite paths for the standalone layout)
(OUT).mkdir(parents=True, exist_ok=True)
for page in ["index.html", "quiz.html", "cards.html", "author.html"]:
    t = (ROOT / "app" / page).read_text(encoding="utf-8")
    t = t.replace("../assets/", "assets/").replace("../library/", "library/")
    t = t.replace("../docs/AUTHORING.md", "docs/AUTHORING.md")
    t = t.replace("../index.html", "index.html")
    t = t.replace('<a href="index.html" style="margin-left:auto">← Study site</a>', "")
    t = t.replace('<a href="../plan.html">← How sessions fit the weekly plan</a>', "")
    t = t.replace('<p><a href="../plan.html">', "<p>")
    (OUT / page).write_text(t, encoding="utf-8")

# assets (engines + style) — keep the version query working
copy_tree(ROOT / "assets", OUT / "assets")

# original content only
copy_tree(ROOT / "library/questions", OUT / "library/questions")
copy_tree(ROOT / "library/flashcards", OUT / "library/flashcards")
(OUT / "docs").mkdir(parents=True, exist_ok=True)
shutil.copy2(ROOT / "docs/AUTHORING.md", OUT / "docs/AUTHORING.md")

# backend
(OUT / "api").mkdir(parents=True, exist_ok=True)
shutil.copy2(ROOT / "server/api.php", OUT / "api/api.php")

print("deployed folder ready:", OUT)
