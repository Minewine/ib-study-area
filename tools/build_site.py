"""Generate the IB study-area static site in the repository this script lives in
(override with NEVAIB_ROOT=/path/to/checkout).

Reads the organized library (library/notes, library/official) and writes:
  index.html, per-subject hub pages, practice.html, ia.html,
  quick-reference.html, assets/style.css, assets/app.js
Every local href written into a page is verified to exist on disk
before the script finishes.
"""

import html
import json
import os
import re
from pathlib import Path

# Repo-relative by default (was hard-coded to /home/mick/Projects/ibsystem, which
# made a second checkout regenerate the main tree); NEVAIB_ROOT overrides.
ROOT = Path(os.environ.get("NEVAIB_ROOT") or Path(__file__).resolve().parent.parent).resolve()
LIB = ROOT / "library"
ASSETS = ROOT / "assets"

# The PDFs (library/notes, library/official, …) are private and git-ignored. On a
# checkout without them (CI, a fresh clone) the committed library-manifest.json —
# written by build_library_manifest.py from the real library — stands in for the
# disk scan, so the generated pages are identical either way.
def _manifest_files():
    try:
        data = json.loads((LIB / "library-manifest.json").read_text(encoding="utf-8"))
        return {it["file"] for it in data.get("items", []) if isinstance(it, dict) and "file" in it}
    except (OSError, ValueError):
        return set()


MANIFEST_FILES = _manifest_files()


def lib_exists(p):
    """True if the library file exists on disk or, without the private folders, in the manifest."""
    p = Path(p)
    if p.exists():
        return True
    try:
        rel = p.relative_to(ROOT).as_posix()
    except ValueError:
        return False
    top = rel.split("/")[1] if rel.startswith("library/") and rel.count("/") >= 2 else ""
    return bool(top) and not (LIB / top).is_dir() and rel in MANIFEST_FILES


def kebab(s):
    s = s.lower()
    s = re.sub(r"[^a-z0-9]+", "-", s)
    return s.strip("-")


def pretty(s):
    s = s.replace("-", " ").replace("&", "&amp;")
    s = re.sub(r"^(\d) (\d) ", r"\1.\2 ", s)
    return s[0].upper() + s[1:]


def gather_notes(subject):
    """Return [(section_key, [(relpath, display), ...]), ...] from notes dir."""
    base = LIB / "notes" / subject
    if (LIB / "notes").is_dir():
        if not base.exists():
            return []
        pdfs = sorted(base.rglob("*.pdf"))
    else:  # no private notes folder here — use the committed manifest
        prefix = "library/notes/" + subject + "/"
        pdfs = sorted(ROOT / f for f in MANIFEST_FILES if f.startswith(prefix) and f.endswith(".pdf"))
    sections = {}
    for pdf in pdfs:
        rel = pdf.relative_to(ROOT).as_posix()
        parts = pdf.relative_to(base).parts
        section = parts[0] if len(parts) > 1 else ""
        sections.setdefault(section, []).append((rel, pretty(pdf.stem)))
    return list(sections.items())


MATH_SECTIONS = {
    "1-number-algebra": "1. Number &amp; algebra",
    "2-functions": "2. Functions",
    "3-geometry-trigonometry": "3. Geometry &amp; trigonometry",
    "4-statistics-probability": "4. Statistics &amp; probability",
    "5-calculus": "5. Calculus",
    "": "Topics",
}
# ISL "Course Calendar 2026–2028" — Math AA SL teaching order, by school week.
# Weeks use the school's 2019/20-based numbering; the calendar sets no absolute
# dates, so none are invented here. Rows: (weeks, month, what, kind).
MATH_CALENDAR = [
    (
        "Y12 2026/27 (weeks 1–37, Aug–Jun)",
        [
            ("2", "Sep", "Prior learning", "teaching"),
            (
                "3",
                "Sep",
                "Functions &amp; quadratics — continues unlabelled through wk 8",
                "teaching",
            ),
            ("4", "Sep", "Trip week", "event"),
            ("5", "Sep", "Jeûne fédéral (public holiday)", "event"),
            ("9", "Oct", "Differentiation", "teaching"),
            ("13", "Nov", "Circular trig", "teaching"),
            ("after wk 16", "—", "Winter break", "event"),
            ("17", "Jan", "Exponentials &amp; logs", "teaching"),
            ("18", "Jan", "Revision", "revision"),
            ("19", "Jan", "Y12 exams", "exam"),
            ("22–25", "Feb–Mar", "Trig equations &amp; functions", "teaching"),
            ("28", "Apr", "Further differentiation", "teaching"),
            ("31", "May", "Revision", "revision"),
            ("32–34", "May–Jun", "Y12 exams", "exam"),
            ("36–37", "Jun", "Integration, first pass", "teaching"),
        ],
    ),
    (
        "Y13 2027/28 (weeks 1–37)",
        [
            ("1", "Sep", "Integration, continued", "teaching"),
            ("3", "Sep", "Trip week", "event"),
            ("4", "Sep", "Jeûne fédéral (public holiday)", "event"),
            ("5–6", "Oct", "Sequences &amp; binomial", "teaching"),
            ("9", "Nov", "IA first draft", "ia"),
            ("11–12", "Nov", "Probability", "teaching"),
            ("15", "Dec", "IA deadline", "ia"),
            ("16–18", "Jan", "Revision + Mock exams", "exam"),
            ("19–20", "Feb", "Statistics", "teaching"),
            ("23–24+", "Mar", "Revision", "revision"),
        ],
    ),
]
BIO_SECTIONS = {
    "unity-diversity": "Unity &amp; diversity",
    "form-function": "Form &amp; function",
    "interaction-interdependence": "Interaction &amp; interdependence",
    "continuity-change": "Continuity &amp; change",
    "tools": "Tools (skills)",
    "": "Topics",
}
CHEM_SECTIONS = {
    "models-of-the-particulate-nature-of-matter": "Structure 1 — Particulate nature of matter",
    "models-of-bonding-structure": "Structure 2 — Models of bonding &amp; structure",
    "classification-of-matter": "Structure 3 — Classification of matter",
    "what-drives-chemical-reactions": "Reactivity 1 — What drives chemical reactions?",
    "how-much-how-fast-how-far": "Reactivity 2 — How much, how fast &amp; how far?",
    "what-are-the-mechanisms-of-chemical-change": "Reactivity 3 — Mechanisms of chemical change",
    "tools": "Tools (skills)",
    "": "Topics",
}


def syllabus(fname):
    """Official syllabus JSON (library/syllabus/): {checklistKey: topic} plus the
    ordered theme/level labels used for the hub checklist grouping."""
    data = json.loads((LIB / "syllabus" / fname).read_text(encoding="utf-8"))
    return ({t["checklistKey"]: t for t in data["topics"]}, data["themes"], data["levels"])


BIO_SYLLABUS = syllabus("biology-hl.json")


def official_links():
    out = {}
    spec = {
        "math-aa-sl": [
            ("Formula booklet (FA2021)", "math-aa-formula-booklet-fa2021.pdf"),
            ("Specimen papers + MS (FA2021)", "math-aa-specimen-papers-fa2021.pdf"),
            ("Subject brief", "math-aa-subject-brief-fa2021.pdf"),
        ],
        "biology-hl": [
            (
                "Specimen papers HL/SL (FA2025)",
                "biology-hl-sl-specimen-papers-fa2025.pdf",
            ),
            ("Sample Paper 1B — HL", "biology-hl-sample-paper-1b-fa2025.pdf"),
            ("Sample Paper 1B — SL", "biology-sl-sample-paper-1b-fa2025.pdf"),
            ("Subject brief", "biology-subject-brief-fa2025.pdf"),
        ],
        "chemistry-hl": [
            (
                "Specimen papers HL/SL (FA2025)",
                "chemistry-hl-sl-specimen-papers-fa2025.pdf",
            ),
            ("Sample Paper 1B — HL", "chemistry-hl-sample-paper-1b-fa2025.pdf"),
            ("Sample Paper 1B — SL", "chemistry-sl-sample-paper-1b-fa2025.pdf"),
            ("Data booklet v1.1 (FA2025)", "chemistry-data-booklet-fa2025-v1.1.pdf"),
            ("Subject brief", "chemistry-subject-brief-fa2025.pdf"),
        ],
        "history-sl": [
            (
                "Subject brief (first assessment 2028)",
                "history-subject-brief-fa2028.pdf",
            )
        ],
        "french-a-langlit": [("Subject brief", "language-a-langlit-subject-brief.pdf")],
        "core": [
            ("Extended Essay guide (FA2027)", "extended-essay-guide-fa2027.pdf"),
            ("EE subject brief", "extended-essay-subject-brief-fa2027.pdf"),
            ("TOK subject brief", "tok-subject-brief.pdf"),
        ],
    }
    for subj, items in spec.items():
        rows = []
        for label, fname in items:
            p = LIB / "official" / (subj if subj != "core" else "core-tok-ee") / fname
            if lib_exists(p):
                rows.append((label, p.relative_to(ROOT).as_posix()))
        out[subj] = rows
    return out


OFF = official_links()


def topic_note_links():
    """checklist key -> app/notes.html deep link, from library/topic-notes (committed)."""
    out = {}
    for f in sorted((ROOT / "library" / "topic-notes").glob("*/*.json")):
        try:
            n = json.loads(f.read_text(encoding="utf-8"))
        except ValueError:
            continue
        key = (n.get("links") or {}).get("checklistKey")
        if key and key not in out:
            out[key] = f"app/notes.html?subject={n['subject']}&amp;topic={f.stem}"
    return out


NOTE_LINKS = topic_note_links()


def checklist(subject, section_names, syllabus_map=None):
    """Hub checklist rows. With syllabus_map (from syllabus()), rows join to the
    official topic codes via their checklistKey and group under sections A–D +
    unit sub-headings; rows with no code land in a final "Tools & other" group.
    Without it, rows group by notes directory (math/chem)."""
    blocks = []
    idx = 0

    def row_html(rel, disp, attrs=""):
        key = f"{subject}::{rel}"
        return (
            f'<div class="row" data-key="{html.escape(key)}"{attrs}>'
            f'<input type="checkbox" aria-label="done">'
            f'<span class="name">{disp}</span>'
            f'<select class="rag" aria-label="confidence">'
            f'<option value="">–</option><option value="r">red</option>'
            f'<option value="a">amber</option><option value="g">green</option></select>'
            + (f'<a href="{NOTE_LINKS[key]}">study&nbsp;notes</a>' if key in NOTE_LINKS else "")
            + f'<a href="{html.escape(rel)}" target="_blank">notes&nbsp;PDF</a></div>'
        )

    if syllabus_map:
        by_key, themes, levels = syllabus_map
        level_label = {lv["n"]: lv["label"] for lv in levels}
        units, other = {}, []  # (theme, level) -> [(code, rel, disp)]; rows with no code
        for _, rows in gather_notes(subject):
            for rel, disp in rows:
                t = by_key.get(f"{subject}::{rel}")
                if t:
                    units.setdefault((t["theme"], t["level"]), []).append((t["code"], rel, disp))
                else:
                    other.append((rel, disp))
        for th in themes:
            k = th["key"]
            present = sorted(lv for (tm, lv) in units if tm == k)
            if not present:
                continue
            n = sum(len(units[(k, lv)]) for lv in present)
            blocks.append(
                f'<h3 data-chk="{html.escape(k)}">{html.escape(k)} — {html.escape(th["label"])} '
                f'<span class="count">({n})</span></h3>'
            )
            for lv in present:
                gk = f"{k}{lv}"
                rows = sorted(units[(k, lv)])
                blocks.append(
                    f'<h4 class="lib-sec" data-chk="{html.escape(gk)}">{html.escape(gk)} · {html.escape(level_label[lv])} '
                    f'<span class="count">({len(rows)})</span></h4>'
                )
                for code, rel, disp in rows:
                    idx += 1
                    blocks.append(
                        row_html(rel, disp, f' data-code="{html.escape(code)}" data-chk="{html.escape(gk)}"')
                    )
        if other:  # e.g. tools PDFs — no syllabus code, so code search never shows them
            blocks.append(
                f'<h3 data-chk="tools">Tools &amp; other <span class="count">({len(other)})</span></h3>'
            )
            for rel, disp in other:
                idx += 1
                blocks.append(row_html(rel, disp, ' data-chk="tools"'))
    else:
        for section, rows in gather_notes(subject):
            label = section_names.get(section, pretty(section) if section else "Topics")
            items = []
            for rel, disp in rows:
                idx += 1
                items.append(row_html(rel, disp))
            blocks.append(
                f'<h3>{label} <span class="count">({len(rows)})</span></h3>'
                + "\n".join(items)
            )
    return "\n".join(blocks), idx


BASE = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>__TITLE__ — IB Study Area</title>
<link rel="icon" href="assets/favicon.svg" type="image/svg+xml">
<link rel="icon" type="image/png" sizes="32x32" href="assets/favicon-32.png">
<link rel="apple-touch-icon" href="assets/apple-touch-icon.png">
<link rel="stylesheet" href="assets/style.css">
</head>
<body>
<nav>
  <a href="index.html" class="brand">IB Study Area</a>
  <a href="math-aa-sl.html" data-subject="math-aa-sl">Math AA SL</a>
  <a href="biology-hl.html" data-subject="biology-hl">Biology HL</a>
  <a href="chemistry-hl.html" data-subject="chemistry-hl">Chemistry HL</a>
  <a href="history-sl.html" data-subject="history-sl">History SL</a>
  <a href="french-a-langlit.html" data-subject="french-a-langlit">French A</a>
  <a href="english-lit-hl.html" data-subject="english-lit-hl">English Lit HL</a>
  <a href="core.html">Core</a>
  <a href="practice.html">Practice</a>
  <a href="ia.html">IA &amp; EE</a>
  <a href="ee.html">EE</a>
  <a href="quiz.html">Quiz</a>
  <a href="plan.html">Plan</a>
  <a href="deadlines.html">Deadlines</a>
  <a href="flashcards.html">Cards</a><a href="app/notes.html">Notes</a><a href="quick-reference.html">Reference</a>
  <a href="library.html">Library</a>
</nav>
<main>
__CONTENT__
</main>
<footer>Private family study area · exams <strong>May 2028</strong> · keep this site and its library non-public</footer>
<script src="assets/store.js?v=8"></script>
<script src="assets/profile.js?v=1"></script>
<script src="assets/app.js?v=6"></script>
</body>
</html>
"""


# Post-generation patches (folded back in on 2026-11-14; keep in sync with the live pages)
CANONICAL_NAV = '<nav>\n  <a href="index.html" class="brand">IB Study Area</a>\n  <a href="math-aa-sl.html" data-subject="math-aa-sl">Math AA SL</a>\n  <a href="biology-hl.html" data-subject="biology-hl">Biology HL</a>\n  <a href="chemistry-hl.html" data-subject="chemistry-hl">Chemistry HL</a>\n  <a href="history-sl.html" data-subject="history-sl">History SL</a>\n  <a href="french-a-langlit.html" data-subject="french-a-langlit">French A</a>\n  <a href="english-lit-hl.html" data-subject="english-lit-hl">English Lit HL</a>\n  <a href="core.html">Core</a>\n  <a href="practice.html">Practice</a>\n  <a href="ia.html">IA &amp; EE</a>\n  <a href="ee.html">EE</a>\n  <a href="quiz.html">Quiz</a>\n  <a href="plan.html">Plan</a>\n  <a href="deadlines.html">Deadlines</a>\n  <a href="flashcards.html">Cards</a>\n  <a href="app/notes.html">Notes</a>\n  <a href="quick-reference.html">Reference</a>\n  <a href="library.html">Library</a>\n</nav>'

NEXTUP = (
    '<section class="card"><h3>Next school deadlines</h3><ul id="nextup" class="links"></ul>'
    '<p class="muted">From the ISL Year 12 calendar — <a href="deadlines.html">full timeline</a> · '
    '<a href="plan.html">the DP1 plan</a></p></section>'
)

CALLOUT = (
    '<section class="card"><h3>Quiz engine — 20-question sessions</h3>'
    "<p>Filtered by subject/topic/format, MCQs marked instantly, written answers self-marked against markschemes, "
    "weak-topic flags + tactics at the end.</p>"
    '<p><a class="btn-link" href="quiz.html">Start a session →</a> · <a href="plan.html">how sessions fit the week</a></p></section>'
)

# the biology checklist is built here (not in its section below) because n_bio feeds BIO_CHECKLIST_HEAD;
# named bio_topics_html so the math/chem calls below can keep reusing `topics_html`
bio_topics_html, n_bio = checklist("biology-hl", BIO_SECTIONS, syllabus_map=BIO_SYLLABUS)
MATH_ANCHOR = "<section class=\"card\" data-subject=\"math-aa-sl\"><h3>Syllabus checklist <span class='count'>(topics with notes PDFs)</span></h3>"
# one constant for the checklist card head so the patch anchor below can never drift from it
BIO_CHECKLIST_HEAD = f"<h3>Syllabus checklist <span class='count'>(official sections A–D + tools · {n_bio} rows)</span></h3>"
BIO_ANCHOR = '<section class="card" data-subject="biology-hl">' + BIO_CHECKLIST_HEAD
CHEM_ANCHOR = "<section class=\"card\" data-subject=\"chemistry-hl\"><h3>Syllabus checklist <span class='count'>(25 topics, Structure/Reactivity)</span></h3>"
MATH_PANEL = '<section class="card" data-subject="math-aa-sl">\n    <h3>Teaching hours (SL) <span class="count">(from the official syllabus content)</span></h3>\n    <table class="wt"><thead><tr><th>Topic</th><th>SL hours</th></tr></thead><tbody>\n      <tr><td>1. Number &amp; algebra</td><td>19</td></tr>\n      <tr><td>2. Functions</td><td>21</td></tr>\n      <tr><td>3. Geometry &amp; trigonometry</td><td>25</td></tr>\n      <tr><td>4. Statistics &amp; probability</td><td>27</td></tr>\n      <tr><td>5. Calculus</td><td>28</td></tr>\n    </tbody></table>\n    <p class="muted">Calculus carries the most hours and lands last — it is where steady DP1 pacing pays off. Full document: <a href="library/school/math-aa-syllabus-content.pdf" target="_blank">math-aa-syllabus-content.pdf</a>.</p>\n  </section>\n'
BIO_PANEL = '<section class="card" data-subject="biology-hl">\n    <h3>ISL teaching sequence 2026–28 <span class="count">(from the school course outline — timings approximate)</span></h3>\n    <table class="wt"><thead><tr><th>When</th><th>Units</th><th>Assessments</th></tr></thead><tbody>\n      <tr><td>DP1 Sep–Oct</td><td>Form &amp; function: A1.1 water · B1.1/B1.2 carbohydrates, lipids, proteins · A1.2 nucleic acids</td><td>unit tests</td></tr>\n      <tr><td>DP1 Nov</td><td>C1.1 enzymes &amp; metabolism</td><td><strong>IA practice</strong>: hydrogen peroxide (design · analysis · conclusion · evaluation)</td></tr>\n      <tr><td>DP1 Nov–Dec</td><td>Unity: A2.2 cell structure · B2.2 organelles · B2.3 specialization · A2.1 origin of cells</td><td><strong>January exam</strong> — everything to date</td></tr>\n      <tr><td>DP1 Jan–Feb</td><td>B2.1 membranes &amp; transport · D2.3 water potential</td><td><strong>IA practice</strong>: beetroot membranes (research design) · osmosis in potatoes (analysis/conclusion/evaluation)</td></tr>\n      <tr><td>DP1 Feb–Mar</td><td>C1.2 cell respiration · D1.2 protein synthesis · D2.2 gene expression · C3.2 defence against disease</td><td>tests</td></tr>\n      <tr><td>DP1 Apr–May</td><td>Flow: C1.3 photosynthesis · C4.2 transfer of energy &amp; matter · B3.1 gas exchange · B3.2 transport</td><td><strong>June exam</strong> — everything to date</td></tr>\n      <tr><td>DP1 June</td><td>B4.1/B4.2 niches · C4.1 populations · D1.1 DNA replication · A2.3 viruses</td><td><strong>IA experiments (late June)</strong></td></tr>\n      <tr><td>DP2 Sep–Nov</td><td>Continuity: D2.1 division · D3.1 reproduction · Diversity: A3.1/A3.2 · D1.3 mutation · D3.2 inheritance · A4.2 conservation</td><td><strong>IA draft (early Sept)</strong> → <strong>IA final (early Nov)</strong></td></tr>\n      <tr><td>DP2 Dec–Mar</td><td>Control &amp; coordination (C3.1, C2.2, B3.3, D3.3, C2.1) · Change (D4.1 selection, A4.1 evolution, D4.2, D4.3 climate)</td><td><strong>Mock exams (January)</strong></td></tr>\n    </tbody></table>\n    <p class="muted">Checklist rows below carry the same topic codes — keep the current unit green before its test. Official outline: <a href="library/school/bio-course-outline-2026-28.pdf" target="_blank">bio-course-outline-2026-28.pdf</a>.</p>\n  </section>\n'
CHEM_PANEL = '<section class="card" data-subject="chemistry-hl">\n    <h3>ISL timeline for the M28 cohort <span class="count">(from the school\'s "Chemistry at a glance")</span></h3>\n    <table class="wt"><thead><tr><th>When</th><th>ISL unit</th><th>Checklist section below</th></tr></thead><tbody>\n      <tr><td>DP1 Sep</td><td>Atomic theory &amp; kinetic theory</td><td>Structure 1 — particulate nature of matter</td></tr>\n      <tr><td>DP1 Oct–Nov</td><td>Periodicity · Stoichiometry</td><td>Structure 3 (classification) · Reactivity 2 — how much</td></tr>\n      <tr><td>DP1 Dec–Jan</td><td>Energetics</td><td>Reactivity 1 — what drives reactions</td></tr>\n      <tr><td>DP1 Feb–Mar</td><td>Kinetics · Equilibrium</td><td>Reactivity 2 — how fast · how far</td></tr>\n      <tr><td>DP1 Apr–May</td><td>Redox</td><td>Reactivity 3 — mechanisms of change</td></tr>\n      <tr><td>DP1 June</td><td>Acids and bases</td><td>Reactivity 3 — mechanisms of change</td></tr>\n      <tr><td>DP2 Sep–Oct</td><td>Acids &amp; bases (finish) · <strong>IA labwork</strong></td><td>—</td></tr>\n      <tr><td>DP2 Oct–Nov</td><td>Bonding</td><td>Structure 2 — models of bonding</td></tr>\n      <tr><td>DP2 Nov–Mar</td><td>Organic chemistry</td><td>Structure 3 — functional groups · Reactivity 3</td></tr>\n      <tr><td>DP2 Apr</td><td>Practical skills for Paper 1B</td><td>Tools (skills)</td></tr>\n    </tbody></table>\n    <p class="muted">School document: <a href="library/school/chem-at-a-glance-m28.pdf" target="_blank">chem-at-a-glance-m28.pdf</a> (subject to change — it does not replace the IB guide).</p>\n  </section>\n'

FRENCH_CARD = '<a class="subj-card" href="french-a-langlit.html" data-subject="french"><strong>French A LangLit</strong><span class="bar mini"></span><span class="pct">0%</span></a>'
ENGLISH_CARD = '<a class="subj-card" href="english-lit-hl.html" data-subject="english-lit"><strong>English A Lit HL</strong><span class="bar mini"></span><span class="pct">0%</span></a>'

IA_DATES = [
    (
        "IA idea log started (all subjects); TOK exhibition underway",
        "✓ done — CSP Sep 1/24, CAS interview Sep 30",
    ),
    (
        "EE subject choice; sciences IA topic shortlist",
        "EE launch Feb 17 · proposal due Mar 2 · TOK plan Mar 25",
    ),
    (
        "Draft IA research questions; IO global-issue bank solid",
        "EE session 1 Mar 12 · equipment order Mar 23 · French essay draft Mar 26",
    ),
    (
        "Sciences IA experiments + write-up; history IA; EE outline",
        "EE Phase 2 Apr 27 · TOK draft Apr 28 · exams late May · CAS portfolio Jun 7 · Bio IA experiments late June",
    ),
    (
        "IA final drafts; EE first draft; TOK essay (titles released)",
        "TOK exhibition final Jun 16 · English A Lit HL Essay final Jun 18 (draft May 11)",
    ),
    ("Full timed mocks; IO final; EE viva voce", "per school — see the deadlines page"),
]

PATCHES = [
    (MATH_ANCHOR, MATH_PANEL + MATH_ANCHOR),
    (BIO_ANCHOR, BIO_PANEL + BIO_ANCHOR),
    (CHEM_ANCHOR, CHEM_PANEL + CHEM_ANCHOR),
    (
        '<section class="card"><h3>Subjects</h3>',
        NEXTUP + '<section class="card"><h3>Subjects</h3>',
    ),
    (FRENCH_CARD, FRENCH_CARD + ENGLISH_CARD),
    (
        "<h2>Practice &amp; Past Papers</h2>",
        "<h2>Practice &amp; Past Papers</h2>" + CALLOUT,
    ),
]
for row2, dates in IA_DATES:
    PATCHES.append(
        (row2 + "</td><td></td></tr>", row2 + "</td><td>" + dates + "</td></tr>")
    )

# Pages that carry the login widget (auth-slot + auth.js); pages with synced
# lists/notes (core, ia, french, ee) need it too — they call Auth.queueSync().
AUTH_PAGES = (
    "index.html",
    "math-aa-sl.html",
    "biology-hl.html",
    "chemistry-hl.html",
    "history-sl.html",
    "french-a-langlit.html",
    "core.html",
    "ia.html",
)

# Per-page engine scripts injected before </body> (tracked lists + debrief
# notes; library.js on index/practice drives the pinned-resources card and the
# papers-intake list).
EXTRA_SCRIPTS = {
    "core.html": ["assets/lists.js?v=4"],
    "ia.html": ["assets/lists.js?v=4"],
    "french-a-langlit.html": ["assets/lists.js?v=4"],
    "index.html": ["assets/library.js?v=4"],
    "practice.html": ["assets/library.js?v=4"],
}


def page(fname, title, content_html, active):
    out = ROOT / fname
    h = BASE.replace("__TITLE__", title).replace("__CONTENT__", content_html)
    for old, new in PATCHES:
        h = h.replace(old, new)
    if fname in AUTH_PAGES:
        h = h.replace("</nav>", '  <span id="auth-slot"></span>\n</nav>', 1)
        h = h.replace(
            '<script src="assets/app.js?v=6"></script>',
            '<script src="assets/app.js?v=6"></script>\n<script src="assets/auth.js?v=10"></script>',
            1,
        )
    if fname in EXTRA_SCRIPTS:
        h = h.replace(
            "</body>",
            "".join(f'<script src="{s}"></script>\n' for s in EXTRA_SCRIPTS[fname])
            + "</body>",
            1,
        )
    if fname == "index.html":
        h = h.replace(
            '<script src="assets/app.js?v=6"></script>',
            '<script src="assets/deadlines.js?v=6"></script>\n<script src="assets/app.js?v=6"></script>',
            1,
        )
    out.write_text(h, encoding="utf-8")
    return fname


def h2(t):
    return f"<h2>{t}</h2>"


def card(inner):
    return f'<section class="card">{inner}</section>'


def subject_card(subj, inner):
    """A card tagged with its subject (assets/profile.js hides the whole block
    for accounts whose profile doesn't include it). The id matches the hub's
    own .bar data-subject value (chk keys use the same legacy short ids)."""
    return f'<section class="card" data-subject="{subj}">{inner}</section>'


def weighting_table(rows):
    trs = "".join(f"<tr><td>{a}</td><td>{b}</td></tr>" for a, b in rows)
    return f'<table class="wt"><thead><tr><th>Component</th><th>Weighting</th></tr></thead><tbody>{trs}</tbody></table>'


def currency_note(text):
    return f'<div class="currency">{text}</div>'


def rag_row(key, name):
    return (
        f'<div class="row" data-key="{key}"><input type="checkbox">'
        f'<span class="name">{name}</span>'
        f'<select class="rag" aria-label="confidence"><option value="">–</option>'
        f'<option value="r">red</option><option value="a">amber</option><option value="g">green</option></select></div>'
    )


SUBJECTS = {}

# ---------- MATH AA SL ----------
topics_html, n_math = checklist("math-aa-sl", MATH_SECTIONS)
math_calendar_html = ""
for year, rows in MATH_CALENDAR:
    trs = ""
    for wks, month, what, kind in rows:
        label = what if kind == "teaching" else f"<strong>{what}</strong>"
        trs += f"<tr><td>{wks}</td><td>{month}</td><td>{label}</td></tr>"
    math_calendar_html += (
        f"<p><strong>{year}</strong></p>"
        "<table class='wt'><thead><tr><th>Weeks</th><th>Month</th><th>What's happening</th></tr></thead>"
        f"<tbody>{trs}</tbody></table>"
    )
SUBJECTS["math-aa-sl.html"] = dict(
    title="Math AA SL",
    active="Math AA SL",
    content=(
        h2("Mathematics: Analysis &amp; Approaches SL")
        + currency_note(
            "Guide: Feb 2019 (updated Nov 2024) — current through <strong>the May 2028 exams</strong> (next guide first assesses May 2029). Aligned past papers: <strong>May 2021 → May 2028</strong>; skip May 2021 (COVID format). TZ2 is the European timezone."
        )
        + card(
            "<h3>Assessment</h3>"
            + weighting_table(
                [
                    ("Paper 1 — 1h30, no calculator, 80 marks", "40%"),
                    ("Paper 2 — 1h30, GDC required, 80 marks", "40%"),
                    ("Exploration (IA) — written investigation", "20%"),
                ]
            )
            + "<p>Paper 1 discipline: no calculator means exact values, factorising, mental algebra. Practise it that way from day one.</p>"
        )
        + subject_card(
            "math-aa-sl",
            "<h3>Two-year teaching plan (ISL 2026–28)</h3>"
            + "<div class='legend'>bold = non-teaching weeks (exams, IA, revision, trips &amp; breaks)</div>"
            + math_calendar_html
            + "<p class='muted'>Week numbering as published (source footnote: “based on 2019/2020 calendar”); "
            "no absolute dates are set yet — milestones as published in the “Course Calendar 2026–2028”.</p>"
        )
        + subject_card(
            "math-aa-sl",
            "<h3>Syllabus checklist <span class='count'>(topics with notes PDFs)</span></h3>"
            + "<div class='legend'>checkbox = revised · red/amber/green = confidence</div>"
            + "<div class='bar' data-subject='math-aa-sl'></div>"
            + topics_html
        )
        + card(
            "<h3>Official documents</h3><ul class='links'>"
            + "".join(
                f"<li><a href='{href}' target='_blank'>{label}</a></li>"
                for label, href in OFF["math-aa-sl"]
            )
            + "</ul><p class='muted'>Full subject guide + subject reports: via school (not published publicly).</p>"
        )
    ),
)

# ---------- BIOLOGY HL ----------
SUBJECTS["biology-hl.html"] = dict(
    title="Biology HL",
    active="Biology HL",
    content=(
        h2("Biology HL")
        + currency_note(
            "Guide: Feb 2023, first assessment <strong>May 2025</strong> — only <strong>May 2025, Nov 2025, May 2026</strong> papers match. Everything older in any archive is the dead 2016 syllabus: different structure, different IA."
        )
        + card(
            "<h3>Assessment</h3>"
            + weighting_table(
                [
                    (
                        "Paper 1 — 2h, 75 marks: 1A (40 MCQ) + 1B (data-based questions)",
                        "36%",
                    ),
                    (
                        "Paper 2 — 2h30, 80 marks: Section A data/short answer, Section B extended response",
                        "44%",
                    ),
                    (
                        "IA — scientific investigation (10 h, 24 marks, report ≤ 3000 words)",
                        "20%",
                    ),
                ]
            )
            + "<p>Paper 1B (data handling) is the new skill: read graphs, design tables, evaluate methods. No data booklet exists for biology — the skills must be automatic.</p>"
        )
        + subject_card(
            "biology-hl",
            BIO_CHECKLIST_HEAD
            + "<div class='legend'>checkbox = revised · red/amber/green = confidence</div>"
            + "<div class='bar' data-subject='biology-hl'></div>"
            + "<div class='lib-filter'><input id='chk-search' type='text' "
              "placeholder='search syllabus code or title…' aria-label='search'></div>"
            + "<p class='muted' id='chk-empty' hidden>No matches — clear the search to see every row.</p>"
            + bio_topics_html
        )
        + card(
            "<h3>Official documents</h3><ul class='links'>"
            + "".join(
                f"<li><a href='{href}' target='_blank'>{label}</a></li>"
                for label, href in OFF["biology-hl"]
            )
            + "</ul><p class='muted'>Full guide + TSM (marked IA samples): via school.</p>"
        )
    ),
)

# ---------- CHEMISTRY HL ----------
topics_html, n_chem = checklist("chemistry-hl", CHEM_SECTIONS)
SUBJECTS["chemistry-hl.html"] = dict(
    title="Chemistry HL",
    active="Chemistry HL",
    content=(
        h2("Chemistry HL")
        + currency_note(
            "Guide: Feb 2023, first assessment <strong>May 2025</strong> — only <strong>May 2025, Nov 2025, May 2026</strong> papers match. Use the <strong>v1.1 data booklet (FA2025)</strong> only; the old booklet has a different structure."
        )
        + card(
            "<h3>Assessment</h3>"
            + weighting_table(
                [
                    (
                        "Paper 1 — 2h, 75 marks: 1A (40 MCQ) + 1B (data-based questions)",
                        "36%",
                    ),
                    ("Paper 2 — 2h30, 90 marks: short + extended response", "44%"),
                    (
                        "IA — scientific investigation (10 h, 24 marks, report ≤ 3000 words)",
                        "20%",
                    ),
                ]
            )
            + "<p>Structure 1 (stoichiometry) is the classic DP1 grade-killer — go green on it before anything else.</p>"
        )
        + subject_card(
            "chemistry-hl",
            "<h3>Syllabus checklist <span class='count'>(25 topics, Structure/Reactivity)</span></h3>"
            + "<div class='legend'>checkbox = revised · red/amber/green = confidence</div>"
            + "<div class='bar' data-subject='chemistry-hl'></div>"
            + topics_html
        )
        + card(
            "<h3>Official documents</h3><ul class='links'>"
            + "".join(
                f"<li><a href='{href}' target='_blank'>{label}</a></li>"
                for label, href in OFF["chemistry-hl"]
            )
            + "</ul><p class='muted'>Full guide + TSM (marked IA samples): via school.</p>"
        )
    ),
)

# ---------- HISTORY SL ----------
SUBJECTS["history-sl.html"] = dict(
    title="History SL",
    active="History SL",
    content=(
        h2("History SL")
        + currency_note(
            "<strong>Cohort #1:</strong> the new guide (first teaching Aug 2026) assesses for the first time in <strong>the May 2028 session</strong>. No past papers exist anywhere; only specimen papers. Everything in archives is the old guide — different P1/P2 and a different IA (reflection removed, max 7 sources)."
        )
        + card(
            "<h3>Assessment</h3>"
            + weighting_table(
                [
                    ("Paper 1 — 1h15, source paper, 24 marks", "30%"),
                    (
                        "Paper 2 — 1h45, concepts question + thematic short responses + essay, 25 marks",
                        "40%",
                    ),
                    ("IA — historical investigation (20 h, 24 marks)", "30%"),
                ]
            )
            + "<p>Practice diet: the official specimen set (via school) + teacher-made source work + old-guide Paper 1 for source-evaluation technique only (content differs).</p>"
        )
        + subject_card(
            "history",
            "<h3>Skills checklist</h3>"
            + "<div class='legend'>checkbox = revised · red/amber/green = confidence</div>"
            + "<div class='bar' data-subject='history'></div>"
            + rag_row(
                "history::p1-source",
                "P1 source skills — comprehension, origin/value/limitation, corroboration, evaluation",
            )
            + rag_row("history::p2-concepts", "P2 concepts question (Section A)")
            + rag_row(
                "history::p2-essay", "P2 thematic short-response + essay (Section B)"
            )
            + rag_row(
                "history::ia-topic",
                "IA — topic chosen, 7-source cap planned, research underway",
            )
        )
        + card(
            "<h3>Official documents</h3><ul class='links'>"
            + "".join(
                f"<li><a href='{href}' target='_blank'>{label}</a></li>"
                for label, href in OFF["history-sl"]
            )
            + "</ul><p class='muted'>FA2028 guide + specimen papers: via school (not published publicly).</p>"
        )
    ),
)

# ---------- FRENCH A ----------
SUBJECTS["french-a-langlit.html"] = dict(
    title="French A: Language & Literature SL",
    active="French A",
    content=(
        h2("French A: Language &amp; Literature SL")
        + currency_note(
            "2021 guide, refreshed with <strong>first assessment 2026</strong>: May 2026+ papers align fully; May 2021–Nov 2025 usable with caveats (P2 was marked /30, now /25; P1 texts no longer carry line numbers). Small-candidature subject — French papers are scarce everywhere."
        )
        + card(
            "<h3>Assessment</h3>"
            + weighting_table(
                [
                    (
                        "Paper 1 — 1h15, guided textual analysis of one of two unseen texts",
                        "35%",
                    ),
                    ("Paper 2 — 1h30, comparative essay on works studied", "35%"),
                    (
                        "Individual Oral — 15 min (10 min analysis + 5 min questions) on a global issue",
                        "30%",
                    ),
                ]
            )
            + "<p>DP1 routine: one real francophone non-literary text per week (editorial, ad, speech, cartoon) analysed in French. Keep a running bank of global issues for the IO.</p>"
        )
        + card(
            "<h3>Individual oral — build the bank early <span class='count'>(feeds DP2, pays weekly)</span></h3>"
            "<p>A global issue is not a topic label (<em>« les inégalités »</em>) — it is a debatable statement, broad "
            "enough to be called global, narrow enough to anchor in the extract and one literary work. The weekly "
            "routine: every text analysed for P1 practice gets one candidate issue line in the bank below; an issue "
            "only becomes usable once it has (a) a non-literary text and (b) a literary work with a specific passage. "
            "Ten minutes a week now makes the IO choice calm in DP2.</p>"
            '<div data-list=\'io-issues\' data-list-fields=\'[{"k":"a","label":"Non-literary text","ph":"body of work · text · date"},{"k":"b","label":"Literary work + passage","ph":"work · passage"}]\'></div>'
            "<p>Marking vocabulary for P1 and the IO: the <a href='flashcards.html'>Cards page</a> has a French "
            "terminology deck (procédés stylistiques, registres, argumentation) — run it before each written analysis.</p>"
        )
        + subject_card(
            "french",
            "<h3>Skills checklist</h3>"
            + "<div class='legend'>checkbox = revised · red/amber/green = confidence</div>"
            + "<div class='bar' data-subject='french'></div>"
            + rag_row("french::p1-analysis", "P1 — textual analysis routine (weekly)")
            + rag_row(
                "french::p2-works", "P2 — works notes + comparative essay structure"
            )
            + rag_row(
                "french::io-bank", "IO — global-issue bank + extract choices building"
            )
        )
        + card(
            "<h3>Official documents</h3><ul class='links'>"
            + "".join(
                f"<li><a href='{href}' target='_blank'>{label}</a></li>"
                for label, href in OFF["french-a-langlit"]
            )
            + "</ul><p class='muted'>2026-refresh guide + specimen papers: via school.</p>"
        )
    ),
)

# ---------- CORE ----------
SUBJECTS["core.html"] = dict(
    title="Core — TOK · EE · CAS",
    active="Core",
    content=(
        h2("Core — TOK · Extended Essay · CAS")
        + card(
            "<h3>Theory of Knowledge</h3>"
            + weighting_table(
                [
                    ("Exhibition (DP1 — confirm timing with the TOK teacher)", "33%"),
                    ("Essay on prescribed title, 1600 words (DP2)", "67%"),
                ]
            )
            + "<p>Guide: Feb 2020, first assessment May 2022 — unchanged for this cohort. Start a weekly <em>TOK journal</em>: one real-world situation + one knowledge question each week. Prescribed titles for May 2028 release in DP2.</p>"
        )
        + card(
            "<h3>TOK exhibition — object shortlist <span class='count'>(plan due 25 March)</span></h3>"
            "<p>The exhibition: three objects, each anchored to one IA prompt, each justified in writing. Collect "
            "candidates all year — a strong object is specific (hers, or exactly dated and sourced), open to several "
            "perspectives, and personally connected. The prompt list comes from the TOK teacher (current list lives "
            "in the guide — never an old web copy).</p>"
            '<div data-list=\'tok-objects\' data-list-fields=\'[{"k":"a","label":"IA prompt","ph":"prompt number / short name"},{"k":"b","label":"Why this object","ph":"perspectives · personal link"}]\'></div>'
            "<p class='muted'>Tick = chosen for the final three. Saves on this device; syncs when logged in (key <code>tok-objects</code>).</p>"
        )
        + card(
            "<h3>Extended Essay</h3>"
            + weighting_table(
                [("Written essay, 4000 words", "TOK/EE matrix → up to 3 bonus points")]
            )
            + "<p><strong>This cohort uses the new guide (first assessment 2027)</strong>: 5 criteria / 30 marks (Framework 6, Knowledge &amp; understanding 6, Analysis &amp; argument 6, Discussion &amp; evaluation 8, Reflection 4); subject-focused or interdisciplinary pathway; three reflection sessions incl. viva voce on a form capped at 500 words; RRS optional.</p>"
            + "<p>DP1 actions: keep the idea log in the <a href='ee.html'>EE workspace</a> — shortlist ready at the Feb 17 launch, proposal 2 Mar — and read the official guide (linked below), not the old 2018 criteria.</p>"
        )
        + card(
            "<h3>CAS</h3><p>7 learning outcomes, evidence portfolio, unassessed but must be complete. Log activities as they happen — DP2 leaves no time to reconstruct two years.</p>"
        )
        + card(
            "<h3>Official documents &amp; forms</h3><ul class='links'>"
            + "".join(
                f"<li><a href='{href}' target='_blank'>{label}</a></li>"
                for label, href in OFF["core"]
            )
            + "<li><a href='library/notes/tsm/tok-tsm-2022.pdf' target='_blank'>TOK TSM 2022</a></li>"
            + "<li><a href='library/notes/tsm/ee-reflection-form.pdf' target='_blank'>EE reflection form (new guide)</a></li>"
            + "</ul>"
        )
    ),
)

# ---------- PRACTICE ----------
SUBJECTS["practice.html"] = dict(
    title="Practice & Past Papers",
    active="Practice",
    content=(
        h2("Practice &amp; Past Papers")
        + card(
            "<h3>The mock protocol (use every time)</h3><ol>"
            "<li>Paper printed, timed, closed-book — phone out of the room.</li>"
            "<li>Formula/data booklet on the desk from day 1 (math P1: nothing).</li>"
            "<li>Mark yourself with the markscheme in hand — award marks only as written.</li>"
            "<li>Log every lost mark in the error log below with a topic tag.</li>"
            "<li>Re-attempt logged error questions after 1 week, then after 1 month.</li></ol>"
        )
        + card(
            "<h3>Error log</h3>"
            "<table class='wt'><thead><tr><th>Session/Paper</th><th>Question</th><th>What I did</th><th>Why it was wrong</th><th>Topic tag</th><th>Retry date</th></tr></thead>"
            "<tbody>"
            + "".join("<tr>" + "<td>&nbsp;</td>" * 6 + "</tr>" for _ in range(8))
            + "</tbody></table>"
            "<p class='muted'>Print-friendly table — fill by hand.</p>"
        )
        + card(
            "<h3>Missed questions (auto-tracked by the Quiz)</h3>"
            "<div id='err-summary' class='muted'></div><div id='err-list'></div>"
            "<p class='muted'>Every wrong answer in a Quiz session is stored here until it's answered correctly in a "
            "Review session. Open the <a href='quiz.html'>Quiz</a> → “Review past errors” to re-attempt them, or browse "
            "the full log with error types and reflections on the <a href='app/mistakes.html'>Mistakes</a> page.</p>"
            "<script>\n"
            "(function () {\n"
            "  function render() {\n"
            "    let errs = [];\n"
            '    if (window.NB && window.NB.store) errs = window.NB.store.get("q-errors", []); // scoped per account\n'
            '    else { try { errs = JSON.parse(localStorage.getItem("q-errors") || "[]"); } catch (e) {} } // stale-cache fallback\n'
            "    const open = errs.filter(x => !x.resolved);\n"
            "    const done = errs.length - open.length;\n"
            '    const s = document.getElementById("err-summary");\n'
            '    if (s) s.textContent = open.length + " unanswered · " + done + " resolved · " + errs.length + " tracked in total.";\n'
            '    const l = document.getElementById("err-list");\n'
            "    if (l) l.innerHTML = open.length\n"
            '      ? ("<ul class=\'links\'>" + open.slice(0, 8).map(x => "<li>" + (x.topicLabel ? x.topicLabel + ": " : "") +\n'
            '          (x.stem || "").slice(0, 70) + " — missed " + (x.attempts || 1) + "×</li>").join("") + "</ul>")\n'
            "      : \"<p class='muted'>Nothing waiting — well done.</p>\";\n"
            "  }\n"
            "  render();\n"
            '  window.addEventListener("storage", render);\n'
            "})();\n"
            "</script>"
        )
        + card(
            "<h3>Which sessions actually match her exams</h3>"
            "<table class='wt'><thead><tr><th>Subject</th><th>Usable papers</th><th>Not usable</th></tr></thead><tbody>"
            "<tr><td>Math AA SL</td><td>May 2021 → May 2026 (TZ2), Nov sessions too</td><td>May 2021 (COVID format); pre-2021</td></tr>"
            "<tr><td>Biology HL</td><td>May 2025 · Nov 2025 · May 2026 (+ specimens)</td><td>Everything before May 2025</td></tr>"
            "<tr><td>Chemistry HL</td><td>May 2025 · Nov 2025 · May 2026 (+ specimens)</td><td>Everything before May 2025</td></tr>"
            "<tr><td>English A Lit HL</td><td>May 2021 → May 2028 (May 2026+ fully aligned) · 2 official specimens filed locally</td><td>Pre-2021</td></tr>"
            "<tr><td>History SL</td><td>Specimen papers only — none exist yet</td><td>All archive papers (old guide)</td></tr>"
            "<tr><td>French A LangLit</td><td>May 2026+ fully; May 2021–Nov 2025 with caveats</td><td>Pre-2021</td></tr>"
            "</tbody></table>"
            "<p class='muted'>Papers + markschemes come from school (teachers hold them legally) — drop files into <code>library/papers/&lt;subject&gt;/</code>, run <code>tools/build_library_manifest.py</code> and they surface below (and on the <a href='library.html'>Library</a> page) as they arrive.</p>"
            "<div id='papers-list'></div>"
        )
        + card(
            "<h3>Mock schedule — December → January</h3>"
            "<table class='wt'><thead><tr><th>When</th><th>Mock</th><th>Material</th></tr></thead><tbody>"
            "<tr><td>Mon 8 Dec 2026</td><td>English A Lit HL — Paper 1 rehearsal (timed, closed-book, two-passage format)</td><td>official specimen (linked on the <a href='english-lit-hl.html'>English hub</a>)</td></tr>"
            "<tr><td>Jan 12–22 window</td><td>Math AA SL — one full P1 (no calculator) + one full P2 (GDC)</td><td>teacher revision sets until school papers arrive</td></tr>"
            "<tr><td>Jan 12–22 window</td><td>Biology HL + Chemistry HL — one full timed mock each, per the school's exam format</td><td>teacher sets · quiz-bank written items as markscheme drills</td></tr>"
            "<tr><td>Night before each paper</td><td>Error-log review only — 15 minutes, no new content</td><td>this page → missed questions</td></tr>"
            "</tbody></table>"
            "<p class='muted'>Every mock runs the five-step protocol above. School papers (email ready on the <a href='plan.html'>plan page</a>) slot in as they arrive.</p>"
        )
    ),
)

# ---------- IA ----------
SUBJECTS["ia.html"] = dict(
    title="IA & EE Support",
    active="IA & EE",
    content=(
        h2("Internal Assessment &amp; Extended Essay")
        + card(
            "<h3>DP1 rule: collect, don't write</h3><p>Keep an <strong>idea log</strong> — every lab observation, curiosity or real-world question noted in 2 minutes. It becomes the IA/exploration/EE shortlist in DP2. Never start writing before the school timeline says so.</p>"
            "<p><a href='app/coursework.html'>Coursework planner →</a> stage-by-stage self-checks, pitfalls and school dates for the Bio/Chem investigations and the Maths exploration (ticks and notes sync when logged in).</p>"
        )
        + card(
            "<h3>Sciences IA — scientific investigation (Bio/Chem HL, 20%)</h3>"
            "<p>10 hours, 24 marks, report ≤ 3000 words. Four equally-weighted criteria: research design · data analysis "
            "· conclusion · evaluation (6 marks each). At ISL: the criteria are practised in DP1 (hydrogen peroxide in "
            "Nov, beetroot/osmosis in Jan — debriefs below), experiments late June, draft early Sept of DP2, final "
            "early Nov — per the <a href='library/school/bio-course-outline-2026-28.pdf' target='_blank'>course "
            "outline</a>. Calibrate against the official TSM marked samples (via school) — and read exemplars for the "
            "quality bar only, never to imitate: IB similarity screening is strict.</p>"
        )
        + card(
            "<h3>Practice IA debriefs — the criteria in the wild <span class='count'>(fill within a day of each session)</span></h3>"
            "<p>The DP1 practice sessions exist so the real IA (experiments late June) feels familiar. Right after "
            "each session, capture what each criterion actually looked like: where the marks were won, where they "
            "went, and which method step caused it. Short honest bullets beat essays — they feed straight into the "
            "June write-ups.</p>"
            "<p><strong>November · hydrogen peroxide</strong> <span class='count'>(all four criteria practised)</span></p>"
            "<table class='wt'><thead><tr><th>Criterion</th><th>What to capture (2–3 lines each)</th></tr></thead><tbody>"
            "<tr><td>Research design</td><td>Was the research question measurable and specific? Which variables were identified and controlled — and where did the method lose precision (range, repeats, confounders)?</td></tr>"
            "<tr><td>Data analysis</td><td>How were raw data processed (means, uncertainties, graphs)? Did the processing reveal the trend or smooth it away? What did outliers say about the method?</td></tr>"
            "<tr><td>Conclusion</td><td>Did the conclusion answer the research question using the data, with the trend stated at the right strength? Where did expectation and observation diverge?</td></tr>"
            "<tr><td>Evaluation</td><td>Which specific limitation moved the result most — and was the proposed improvement realistic and tied to the data, not generic?</td></tr>"
            "</tbody></table>"
            "<textarea class='tnote' data-note='ia-debriefs:nov.rd' placeholder='Research design — what it looked like in practice…'></textarea>"
            "<textarea class='tnote' data-note='ia-debriefs:nov.da' placeholder='Data analysis…'></textarea>"
            "<textarea class='tnote' data-note='ia-debriefs:nov.ce' placeholder='Conclusion · evaluation…'></textarea>"
            "<p><strong>January · beetroot membranes + osmosis</strong> <span class='count'>(the pair splits the criteria)</span></p>"
            "<p>Beetroot is the <strong>research-design</strong> rehearsal (variables, controls, dilution series); osmosis "
            "rehearses <strong>analysis → conclusion → evaluation</strong> (processing, trend, limitations).</p>"
            "<textarea class='tnote' data-note='ia-debriefs:jan.rd' placeholder='Beetroot — research design…'></textarea>"
            "<textarea class='tnote' data-note='ia-debriefs:jan.ace' placeholder='Osmosis — analysis, conclusion, evaluation…'></textarea>"
            "<p class='muted'>Text saves as you type and syncs when logged in (key <code>ia-debriefs</code>). The official "
            "criterion wording lives in the guide/TSM — this page is the practice view, not the rubric.</p>"
        )
        + card(
            "<h3>Math exploration (20%)</h3>"
            "<p>Choose something you can genuinely explore, not an impressive topic. Criteria and marked samples: <a href='library/notes/tsm/math-ia-exemplars-2020.pdf' target='_blank'>official Assessed Student Work 2020</a> · <a href='library/notes/tsm/math-aa-tsm-2023.pdf' target='_blank'>Math AA TSM 2023</a>. Idea sources: <a href='https://ibmathsresources.com' target='_blank'>IB Maths Resources</a>.</p>"
        )
        + card(
            "<h3>History investigation (30% at SL!)</h3>"
            "<p>20 hours, 24 marks, max 7 sources, no reflection section under the new guide. A third of the history grade — treat it like a mini-thesis. Start source-gathering early DP2.</p>"
        )
        + card(
            "<h3>EE (new guide)</h3>"
            "<p>Subject-focused or interdisciplinary pathway; 5 criteria / 30 marks; 4000 words; reflection form ≤ 500 words across three sessions. Read the official <a href='library/official/core-tok-ee/extended-essay-guide-fa2027.pdf' target='_blank'>EE guide (FA2027)</a> — old-guide criteria found anywhere else are obsolete.</p>"
        )
        + card(
            "<h3>Milestone timeline (fill in ISL's internal dates)</h3>"
            "<table class='wt'><thead><tr><th>When</th><th>What</th><th>School deadline</th></tr></thead><tbody>"
            + "".join(
                f"<tr><td>{a}</td><td>{b}</td><td></td></tr>"
                for a, b in [
                    (
                        "DP1 autumn",
                        "IA idea log started (all subjects); TOK exhibition underway",
                    ),
                    ("DP1 spring", "EE subject choice; sciences IA topic shortlist"),
                    (
                        "DP1 summer",
                        "Draft IA research questions; IO global-issue bank solid",
                    ),
                    (
                        "DP2 autumn",
                        "Sciences IA experiments + write-up; history IA; EE outline",
                    ),
                    (
                        "DP2 winter",
                        "IA final drafts; EE first draft; TOK essay (titles released)",
                    ),
                    ("DP2 spring", "Full timed mocks; IO final; EE viva voce"),
                ]
            )
            + "</tbody></table>"
        )
    ),
)

# ---------- QUICK REFERENCE ----------
SUBJECTS["quick-reference.html"] = dict(
    title="Quick Reference",
    active="Reference",
    content=(
        h2("Quick Reference")
        + card(
            "<h3>Booklets — use these editions only</h3><ul class='links'>"
            "<li><a href='library/official/math-aa-sl/math-aa-formula-booklet-fa2021.pdf' target='_blank'>Math AA/AI formula booklet (first assessment 2021)</a></li>"
            "<li><a href='library/official/chemistry-hl/chemistry-data-booklet-fa2025-v1.1.pdf' target='_blank'>Chemistry data booklet v1.1 (first assessment 2025)</a></li>"
            "</ul><p class='muted'>Biology has no data booklet — data skills are tested directly in Paper 1B.</p>"
        )
        + card(
            "<h3>Command terms that decide marks</h3>"
            "<table class='wt'><thead><tr><th>Term</th><th>What the examiner wants</th></tr></thead><tbody>"
            + "".join(
                f"<tr><td>{t}</td><td>{d}</td></tr>"
                for t, d in [
                    ("State", "one word/short phrase, no reasoning"),
                    ("Identify", "pick out from context"),
                    ("Define", "exact meaning"),
                    ("Outline", "brief structure, little detail"),
                    ("Describe", "give a detailed account"),
                    ("Distinguish", "differences between two things"),
                    ("Explain", "give reasons/causes — the 'why'"),
                    ("Calculate", "show method, units, significant figures"),
                    ("Determine", "usually needs data extraction + calculation"),
                    ("Predict", "give an expected result with justification"),
                    ("Sketch", "correct shape/labelled graph, not to scale"),
                    ("Draw", "precise labelled diagram"),
                    ("Compare", "both sides with explicit links"),
                    ("Discuss", "balanced review with range of arguments"),
                    ("Evaluate", "strengths AND weaknesses, weighed judgement"),
                    ("Justify", "give valid reasons with evidence"),
                    ("To what extent", "weigh the evidence, then conclude"),
                ]
            )
            + "</tbody></table>"
            "<p class='muted'>Matching the verb to the answer shape is the cheapest marks in bio/chem/history.</p>"
        )
        + card(
            "<h3>GDC exam mode</h3><p>Confirm the ISL-approved calculator model, clear memory / enter exam mode exactly as the school instructs, and rehearse: reset → exam mode → the 5 settings used most (radians/degrees, stats editor, tables).</p>"
        )
        + card(
            "<h3>Citation</h3><p>APA style for IA/EE: author · year · title · source · URL/access date. Keep the source list growing as you read — never reconstruct at the end.</p>"
        )
        + card(
            "<h3>Everything else</h3><p>Full subject guides, subject reports and the Questionbank: via ISL teachers. Mirror copies exist elsewhere, but the school channel is the clean one.</p>"
        )
    ),
)

# ---------- DASHBOARD ----------
cards_html = ""
for fname, meta in [
    ("math-aa-sl.html", ("Math AA SL", "math-aa-sl")),
    ("biology-hl.html", ("Biology HL", "biology-hl")),
    ("chemistry-hl.html", ("Chemistry HL", "chemistry-hl")),
    ("history-sl.html", ("History SL", "history")),
    ("french-a-langlit.html", ("French A LangLit", "french")),
]:
    label, subj = meta
    cards_html += f'<a class="subj-card" href="{fname}" data-subject="{subj}"><strong>{label}</strong><span class="bar mini"></span><span class="pct">0%</span></a>'
cards_html = cards_html  # noqa: keep template structure
SUBJECTS["index.html"] = dict(
    title="Dashboard",
    active="IB Study Area",
    content=(
        h2("Dashboard")
        + '<div class="dash-top"><div class="card countdown"><h3>May 2028 exams</h3><div id="countdown" class="big">—</div><p class="muted">first papers expected late April 2028</p></div>'
        + '<div class="card week"><h3>This week (set Monday, 5 items max)</h3><div id="weekrows">'
        + "".join(
            f'<input class="week" data-i="{i}" placeholder="…">' for i in range(5)
        )
        + "</div></div></div>"
        + '<section class="card" id="stats"><h3>Progress pulse</h3><div id="stats-body"></div></section>'
        + '<section class="card" id="res-pinned"><h3>Pinned library resources</h3><div id="res-pins"></div>'
        + "<p class='muted'>★ rows pinned from the <a href='library.html'>Library</a> — same checklist records as the hubs; pins, ticks and RAG sync when logged in.</p></section>"
        + card(
            "<h3>Subjects</h3><div class='grid'>" + cards_html + "</div>"
            "<p class='muted'>Progress = share of checklist topics marked done/green; updates as she works through the hubs.</p>"
        )
        + card(
            "<h3>Milestone strip</h3><ul>"
            "<li><strong>DP1 now:</strong> topic-by-topic mastery as units close · command-term fluency · IA idea log · TOK exhibition · weekly French textual analysis</li>"
            "<li><strong>End DP1:</strong> EE subject choice · sciences IA shortlist</li>"
            "<li><strong>DP2:</strong> IA write-ups · history IA · EE drafting · full timed mocks from spring</li></ul>"
        )
        + card(
            "<h3>New here?</h3><p>Three rules of this site: (1) trust only files whose guide edition matches the <em>currency notes</em> on each page; (2) log every practice session in the <a href='practice.html'>error log</a>; (3) keep this folder private.</p>"
        )
    ),
)

# ---------- CSS + JS ----------
CSS = """
:root{--ink:#1d2733;--muted:#5b6b7c;--bg:#f6f7f9;--card:#fff;--line:#dfe4ea;--accent:#2c5fa8}
*{box-sizing:border-box}
body{margin:0;font:16px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--ink);background:var(--bg)}
nav{display:flex;flex-wrap:wrap;gap:.35rem;align-items:center;padding:.6rem 1rem;background:#122033;position:sticky;top:0;z-index:2}
nav a{color:#cfe0f5;text-decoration:none;padding:.3rem .65rem;border-radius:999px;font-size:.92rem}
nav a:hover{background:#1e3350}
nav .brand{font-weight:700;color:#fff;margin-right:.6rem}
main{max-width:1080px;margin:0 auto;padding:1.2rem 1rem 3rem}
h2{margin:.4rem 0 .6rem}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:1rem 1.2rem;margin:.9rem 0;box-shadow:0 1px 2px rgba(15,25,40,.05)}
h3{margin:.1rem 0 .5rem}
h3:not(:first-child){margin-top:1rem}
.count{color:var(--muted);font-weight:400;font-size:.9rem}
.legend{color:var(--muted);font-size:.88rem;margin-bottom:.5rem}
.row{display:flex;align-items:center;gap:.55rem;padding:.28rem .35rem;border-bottom:1px solid #eef1f4}
.row:last-child{border-bottom:0}
.row[data-rag="g"]{background:#e9f6ee}
.row[data-rag="a"]{background:#fdf4e3}
.row[data-rag="r"]{background:#fdeaea}
.row .name{flex:1;font-size:.95rem}
.row a{font-size:.85rem;white-space:nowrap}
select.rag{border:1px solid var(--line);border-radius:8px;padding:.15rem .35rem;font-size:.85rem;background:#fff}
.row[hidden]{display:none} /* checklist search (chk-search) hides non-matching rows */
.bar{height:8px;border-radius:999px;background:#e7ebef;position:relative;margin:.4rem 0 .8rem;overflow:hidden}
.bar::after{content:"";position:absolute;inset:0;width:var(--pct,0%);border-radius:999px;background:var(--accent)}
table.wt{border-collapse:collapse;width:100%;font-size:.93rem}
table.wt th,table.wt td{border:1px solid var(--line);padding:.4rem .55rem;text-align:left;vertical-align:top}
table.wt th{background:#eef2f7}
.currency{background:#eef4fc;border:1px solid #c9dcf3;border-left:5px solid var(--accent);border-radius:10px;padding:.6rem .8rem;font-size:.92rem;margin:.6rem 0 .9rem}
.links{list-style:none;padding:0;margin:0}
.links li{padding:.15rem 0}
.links a{color:var(--accent);text-decoration:none}
.links a:hover{text-decoration:underline}
ul{margin:.4rem 0 .4rem 1.2rem}
.dash-top{display:grid;grid-template-columns:1fr 1.4fr;gap:.9rem}
.big{font-size:2.2rem;font-weight:700;color:var(--accent)}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:.7rem}
.subj-card{display:block;background:#f8fafc;border:1px solid var(--line);border-radius:10px;padding:.7rem .8rem;text-decoration:none;color:var(--ink)}
.subj-card strong{display:block;margin-bottom:.2rem}
.subj-card .bar.mini{margin:.5rem 0 .2rem}
.pct{font-size:.85rem;color:var(--muted)}
.subj-card:hover{border-color:var(--accent)}
/* dashboard progress pulse */
.stat-row{display:flex;align-items:center;gap:.55rem;font-size:.85rem;padding:.14rem 0}
.stat-row .stat-date{color:var(--muted);white-space:nowrap}
.stat-row .stat-label{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.stat-row .bar{flex:0 0 6rem;margin:0}
input.week{width:100%;border:0;border-bottom:1px dashed var(--line);padding:.3rem .1rem;font:inherit;margin:.15rem 0;background:transparent}
input.week:focus{outline:none;border-bottom-color:var(--accent)}
.muted{color:var(--muted);font-size:.88rem}
footer{max-width:1080px;margin:0 auto;padding:1rem;color:var(--muted);font-size:.85rem}
code{background:#eef1f4;border-radius:6px;padding:.05rem .3rem;font-size:.9em}
@media (max-width:760px){.dash-top{grid-template-columns:1fr}}
@media print{nav,footer{display:none}.card{box-shadow:none;break-inside:avoid}}

.chip{display:inline-block;border:1px solid;border-radius:999px;padding:.02rem .5rem;font-size:.78rem;white-space:nowrap}
.dl-date{display:inline-block;min-width:11.5rem;font-weight:600}
.past{opacity:.55;text-decoration:line-through}
.dl-in{font-size:.85rem}
li.future{padding:.3rem 0}
.btn-link{color:var(--accent);text-decoration:none;font-weight:600}

/* tracked lists + debrief notes (lists.js) */
.tlist{display:flex;flex-direction:column;gap:.45rem;margin:.5rem 0}
.titem{display:flex;flex-wrap:wrap;gap:.4rem;align-items:center;border:1px solid var(--line);border-radius:10px;padding:.4rem .55rem}
.titem.done{border-left:4px solid #2e8b57;background:#f2f9f4}
.titem input[type="text"],.tadd input[type="text"]{font:inherit;font-size:.9rem;border:1px solid var(--line);border-radius:8px;padding:.3rem .45rem;background:#fff;box-sizing:border-box}
.titem input[type="text"]:focus,.tadd input[type="text"]:focus,.tnote:focus{outline:none;border-color:var(--accent)}
.t-main{flex:2 1 230px;min-width:170px}
.t-field{flex:1 1 150px;min-width:130px}
.titem input[type="checkbox"]{width:auto;margin:0 .1rem}
.titem .t-tick{font-size:.75rem;color:var(--muted)}
.t-del{border:none;background:none;color:#c23b3b;cursor:pointer;font-size:1.05rem;padding:.05rem .3rem}
.tadd{display:flex;flex-wrap:wrap;gap:.4rem;margin:.55rem 0 .2rem}
.tadd button{font:inherit;font-size:.88rem;border:1px solid var(--accent);border-radius:8px;padding:.3rem .7rem;background:var(--accent);color:#fff;cursor:pointer}
.tadd button:hover{background:#234d8c}
.tcount{font-size:.82rem;color:var(--muted);margin:.2rem 0 0}
.tnote{display:block;width:100%;min-height:72px;margin:.4rem 0;font:inherit;font-size:.92rem;line-height:1.45;border:1px solid var(--line);border-radius:10px;padding:.5rem .6rem;background:#fff;resize:vertical;box-sizing:border-box}

/* auth widget — lives inside the dark nav (study pages + practice app) */
.auth-form{display:inline-flex;align-items:center;gap:.3rem}
.auth-form input{width:8.5rem;padding:.22rem .5rem;border:1px solid #3a4d63;border-radius:8px;background:#1e3350;color:#e8eef7;font:inherit;font-size:.85rem}
.auth-form input:focus{outline:none;border-color:#5b87c7}
.auth-user{display:inline-block;background:#1e3350;border:1px solid #3a4d63;border-radius:999px;padding:.12rem .6rem;font-size:.85rem;color:#cfe0f5;white-space:nowrap}
.auth-status{display:inline-block;font-size:.8rem;color:#9fb3c8;max-width:13rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.auth-status.good{color:#8fd6ab}
.auth-status.bad{color:#f0a5a5}
#auth-slot .btn{padding:.2rem .6rem;font-size:.82rem;border:1px solid #3a4d63;border-radius:8px;background:#1e3350;color:#e8eef7;cursor:pointer}
#auth-slot .btn:hover{background:#26415f}

/* library browser (library.js) */
nav a.active{background:#26415f;color:#fff}
.lib-filter{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center;margin:.4rem 0 .7rem}
.lib-filter select,.lib-filter input{font:inherit;font-size:.9rem;border:1px solid var(--line);border-radius:8px;padding:.3rem .5rem;background:#fff;color:var(--ink)}
.lib-filter select:focus,.lib-filter input:focus{outline:none;border-color:var(--accent)}
.lib-filter input{flex:1 1 200px;min-width:160px}
.lib-subj{font-size:1rem;margin:.8rem 0 .2rem}
.lib-sec{color:var(--muted);font-size:.85rem;margin:.55rem 0 .1rem}
.lib-pin{border:none;background:none;cursor:pointer;font-size:1.05rem;line-height:1;color:#b9c6d4;padding:.05rem .3rem}
.lib-pin.on{color:#dfa50f}
.lib-note-btn{border:1px solid var(--line);background:#fff;color:var(--muted);font:inherit;font-size:.78rem;border-radius:8px;padding:.08rem .5rem;cursor:pointer;white-space:nowrap}
.lib-note-btn:hover,.lib-note-btn.has{border-color:var(--accent);color:var(--accent)}
.tnote.lib-note{display:none}
.tnote.lib-note.open{display:block}
"""

JS = """(function () {
  // NB.store (assets/store.js) is the storage layer; the literal below is only a
  // fallback for a stale cached page that didn't load store.js.
  const store = (window.NB && window.NB.store) || {
    get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v === null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
    getRaw(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    keys(p) { const out = []; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && (!p || k.indexOf(p) === 0)) out.push(k); } return out; }
  };
  document.querySelectorAll('.row[data-key]').forEach(row => {
    const key = row.dataset.key;
    const st = store.get('chk:' + key, { c: false, r: '' });
    // existence check through the store too: a raw read can't see the active
    // user's scope and would re-seed defaults over their real ticks
    if (store.getRaw('chk:' + key) === null) store.set('chk:' + key, st, { silent: true }); // default row, not a user change
    const cb = row.querySelector('input[type=checkbox]');
    const sel = row.querySelector('select.rag');
    if (cb) cb.checked = !!st.c;
    if (sel) sel.value = st.r || '';
    const save = () => store.set('chk:' + key, { c: !!(cb && cb.checked), r: sel ? sel.value : '' });
    const paint = () => { row.setAttribute('data-rag', sel ? sel.value : ''); };
    if (cb) cb.addEventListener('change', () => { save(); paint(); progressPage(); try { if (window.Auth && window.Auth.queueSync) window.Auth.queueSync(); } catch (e) {} });
    if (sel) sel.addEventListener('change', () => { save(); paint(); progressPage(); try { if (window.Auth && window.Auth.queueSync) window.Auth.queueSync(); } catch (e) {} });
    paint();
  });
  function progressPage() {
    document.querySelectorAll('.bar[data-subject]').forEach(bar => {
      const prefix = bar.dataset.subject + '::';
      const rows = [...document.querySelectorAll('.row[data-key^="' + prefix + '"]')];
      if (!rows.length) return;
      const done = rows.filter(r => {
        const cb = r.querySelector('input[type=checkbox]');
        const sel = r.querySelector('select.rag');
        return (cb && cb.checked) || (sel && sel.value === 'g');
      }).length;
      bar.style.setProperty('--pct', Math.round(100 * done / rows.length) + '%');
    });
  }
  progressPage();
  document.querySelectorAll('.subj-card').forEach(cardEl => {
    const subj = cardEl.dataset.subject;
    let total = 0, done = 0;
    store.keys().forEach(k => { // logical (scoped) keys — raw localStorage would miss the active user's rows
      if (k.startsWith('chk:' + subj + '::')) {
        total++;
        const st = store.get(k, { c: false, r: '' });
        if (st.c || st.r === 'g') done++;
      }
    });
    if (total) {
      const pct = Math.round(100 * done / total) + '%';
      const mini = cardEl.querySelector('.bar.mini');
      if (mini) mini.style.setProperty('--pct', pct);
      const lbl = cardEl.querySelector('.pct');
      if (lbl) lbl.textContent = pct;
    }
  });
  const statsBody = document.getElementById('stats-body');
  if (statsBody) {
    const esc = (window.NB && window.NB.escapeHtml) || ((s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"));
    const d = new Date();
    const today = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    let html = '';
    const pcts = [];
    const log = store.get('quizlog', []).filter(e => e && typeof e.pct === 'number');
    if (log.length) {
      html += log.slice(0, 5).reverse().map(e => {
        const raw = String(e.label || '');
        const label = raw.length > 30 ? raw.slice(0, 29) + '…' : raw;
        pcts.push(e.pct);
        return '<div class="stat-row"><span class="stat-date">' + esc((e.date || '').slice(5)) + '</span><span class="stat-label">' + esc(label) + '</span><span class="bar mini"></span><span class="pct">' + esc(e.pct) + '%</span></div>';
      }).join('');
    } else {
      html += '<p class="muted">No quiz sessions yet — run one in the practice app.</p>';
    }
    const seen = Object.values(store.get('fc-state', {})).filter(c => c && typeof c.seen === 'number' && c.seen > 0);
    if (seen.length) {
      const due = seen.filter(c => c.due <= today).length;
      const mastered = seen.filter(c => c.box >= 4).length;
      html += '<p>Flashcards: ' + (due ? '<strong>' + due + '</strong>' : due) + ' due · ' + mastered + ' mastered of ' + seen.length + ' seen</p>';
    } else {
      html += '<p class="muted">Flashcards: nothing seen yet.</p>';
    }
    const bySubj = {};
    let total = 0, done = 0;
    store.keys().forEach(k => { // logical (scoped) keys — see the per-card loop above
      if (!k.startsWith('chk:')) return;
      const sep = k.indexOf('::');
      if (sep < 0) return;
      const st = store.get(k, { c: false, r: '' });
      const ok = st.c || st.r === 'g';
      total++;
      if (ok) done++;
      const subj = k.slice(4, sep);
      if (!bySubj[subj]) bySubj[subj] = { done: 0, total: 0 };
      bySubj[subj].total++;
      if (ok) bySubj[subj].done++;
    });
    if (total) {
      let worst = null;
      for (const subj in bySubj) {
        const s = bySubj[subj];
        const pct = Math.round(100 * s.done / s.total);
        if (!worst || pct < worst.pct) worst = { subj, pct };
      }
      html += '<p>Checklists: ' + Math.round(100 * done / total) + '% overall (' + done + ' of ' + total + ' rows) · weakest: ' + esc(worst.subj) + ' (' + worst.pct + '%)</p>';
    } else {
      html += '<p class="muted">Checklists: nothing ticked yet.</p>';
    }
    statsBody.innerHTML = html;
    statsBody.querySelectorAll('.bar').forEach((b, i) => b.style.setProperty('--pct', pcts[i] + '%'));
  }
  const cd = document.getElementById('countdown');
  if (cd) {
    const target = new Date('2028-04-28T00:00:00');
    const days = Math.max(0, Math.ceil((target - new Date()) / 86400000));
    cd.textContent = days.toLocaleString() + ' days';
  }
  document.querySelectorAll('input.week').forEach(inp => {
    inp.value = store.get('week:' + inp.dataset.i, '');
    inp.addEventListener('input', () => { store.set('week:' + inp.dataset.i, inp.value); try { if (window.Auth && window.Auth.queueSync) window.Auth.queueSync(); } catch (e) {} });
  });
  // Checklist filter (biology hub emits #chk-search; other pages no-op here).
  // Rows match on their syllabus code (data-code) or display title; headings
  // tagged data-chk hide once no visible row still belongs to them.
  const chkSearch = document.getElementById('chk-search');
  if (chkSearch) {
    const chkCard = chkSearch.closest('.card');
    const chkEmpty = document.getElementById('chk-empty');
    const chkRows = chkCard ? [...chkCard.querySelectorAll('.row[data-key]')] : [];
    chkSearch.addEventListener('input', () => {
      const q = chkSearch.value.trim().toLowerCase();
      let shown = 0;
      chkRows.forEach(r => {
        const name = r.querySelector('.name');
        const hay = ((r.dataset.code || '') + ' ' + (name ? name.textContent : '')).toLowerCase();
        r.hidden = !!q && hay.indexOf(q) < 0;
        if (!r.hidden) shown++;
      });
      if (chkCard) chkCard.querySelectorAll('h3[data-chk],h4[data-chk]').forEach(h => {
        h.hidden = !chkRows.some(r => !r.hidden && (r.dataset.chk || '').slice(0, h.dataset.chk.length) === h.dataset.chk);
      });
      if (chkEmpty) chkEmpty.hidden = shown > 0;
    });
  }
})();
"""

# ---------- write everything ----------
ASSETS.mkdir(exist_ok=True)
(ASSETS / "style.css").write_text(CSS, encoding="utf-8")
(ASSETS / "app.js").write_text(JS, encoding="utf-8")
written = [page(f, m["title"], m["content"], m["active"]) for f, m in SUBJECTS.items()]

missing = []
for f in written:
    txt = (ROOT / f).read_text(encoding="utf-8")
    for href in re.findall(r'href="([^"#]+)"', txt):
        if href.startswith(("http", "mailto")):
            continue
        if not lib_exists(ROOT / href.split("?")[0]):
            missing.append((f, href))
print("pages:", ", ".join(sorted(written)))
print("checklist rows:", n_math + n_bio + n_chem)
if missing:
    print("MISSING HREFS:")
    for m in missing:
        print("  ", m)
else:
    print("all local hrefs verified")
