# Development Notes

Architecture, data schemas, conventions and gotchas for anyone (including future-you)
touching this site.

## Architecture

- **Static site, no build step.** 16 study-site pages + 4 practice-app pages (`app/`) + 5 asset files + JSON data in `library/`.
- **Practice app (`app/`)**: `index.html` (launcher), `quiz.html`, `cards.html`, `author.html` (upload/manage/export).
  Engines resolve content via `PATH_BASE` (`../` when served from `/app/`, empty at the root), so the same engine
  files serve both layers. Root `quiz.html`/`flashcards.html` are one-line redirect stubs to the app.
- **Hosted deployment**: `server/api.php` (auth + per-user state, PHP sessions, JSON files under the cPanel home)
  + `tools/build_deploy.py` (assembles `deploy/nevaib/` — original content only). See `server/deploy-notes.md`.
- **auth.js (`app/assets/`)**: login/logout widget, server pull on load, debounced push on every engine write
  (engines call `Auth.queueSync()` from their `store.set`). Logged out = localStorage-only fallback.
- **Vanilla JS, one engine per concern**:
  | File | Owns | Page(s) |
  |---|---|---|
  | `assets/app.js` | Checklist rows (RAG + ticks), progress bars, countdown, this-week inputs | all pages (safe no-op) |
  | `assets/quiz-engine.js` | Session builder, MCQ marking, written self-marking, summaries, `fcSaveFromQuiz()` hook, PATH_BASE content resolution, user-bank merge | `quiz.html` (root + `app/`) |
  | `assets/flashcards.js` | Deck loading, Leitner SRS, session runner, editor, export/import, theme, PATH_BASE, user-deck merge | `flashcards.html` (root + `app/`) |
  | `assets/deadlines.js` | Deadline data + `#nextup` / `#timeline` renderers | `index.html`, `deadlines.html` |
- **State** lives in `localStorage` (per browser/device — see table below).
- **Python** is used only for one-off scripts, run with `python3 -I` (`tools/build_site.py`,
  past extraction scripts). Nothing at runtime needs Python except the file server.

## Running it

```bash
python3 -m http.server 8017 --bind 0.0.0.0 --directory ~/Projects/ibsystem
```

**Gotcha:** `quiz.html` and `flashcards.html` `fetch()` their JSON banks — `fetch()` on
`file://` is blocked by browsers. The site *pages* open fine from disk, but always use the
HTTP server for real use.

## localStorage keys

| Key | Owner | Contents |
|---|---|---|
| `chk:<subject>::<path>` | `app.js` | syllabus checklist row: `{c: bool, r: "r/a/g"}` |
| `week:0` … `week:4` | `app.js` | dashboard this-week items |
| `quizlog` | `quiz-engine.js` | last 20 session summaries `{date, label, got, max, pct}` |
| `fc-state` | `flashcards.js` | per-card SRS state `{box: 1–5, due: "YYYY-MM-DD", seen}` |
| `fc-user` | both | user-created cards (quiz hook + editor), full card objects |
| `fc-deleted` | `flashcards.js` | seeded card ids the user deleted (override) |
| `fc-edits` | `flashcards.js` | edits to seeded cards `{id: {front, back, tags}}` |
| `fc-theme` | `flashcards.js` | "light"/"dark" for the Cards page |
| `q-userbanks` | `app/author.html` + quiz-engine | uploaded quiz banks (per device) |
| `fc-userdecks` | `app/author.html` + flashcards | uploaded flashcard decks (per device) |

## Data schemas

### Quiz bank (`library/questions/*.json`)
```json
{
  "subject": "chemistry-hl",
  "topic": "structure-3-1-periodicity",
  "topicLabel": "human-readable",
  "items": [
    {"id": "p01", "format": "mcq", "stem": "…", "choices": ["…"], "answer": 1,
     "note": "why the answer is right + the trap"},
    {"id": "p21", "format": "written", "marks": 3, "stem": "…",
     "markscheme": ["point (1)", "point (1)"], "tactic": "how to attack this question type"}
  ]
}
```
Rules: ids unique across the file; `answer` is a 0-based choice index; every item carries
its unit `topic` code; notes state the fact and the trap — never hedge.

### Flashcard deck (`library/flashcards/*.json`)
```json
{
  "subject": "biology-hl",
  "topic": "c1-1-enzymes-metabolism",
  "topicLabel": "human-readable",
  "cards": [
    {"id": "fc-bio-e-01", "type": "term | qa", "tags": ["definition", "IA"],
     "front": "term or question", "back": "definition or answer"}
  ]
}
```
Ids unique **across all decks** (prefix per deck). Same `topic` keys as question banks.

### Deadlines (`assets/deadlines.js` → `DEADLINES` array)
`{ d: "YYYY-MM-DD", t: "label", tag: "sciences|ee|tok|core|exams|langlit|university|sixth" }`

## Generator

`tools/build_site.py` regenerates the 10 base pages (index, 5 hubs, core, practice, ia,
quick-reference) plus `assets/style.css` and `assets/app.js`. All post-generation patches
are folded into its `PATCHES` list (teaching-sequence panels, dashboard next-up strip,
English Lit card, quiz callout, ISL milestone dates, ISL paragraph, chip styles, canonical
nav) — re-running it reproduces every page byte-for-byte (**verified 2026-11-14**).

Rules:
- Any hand-edit to one of the 10 generated pages must ALSO be folded into the generator
  (template or PATCHES entry) — otherwise the next regeneration reverts it.
- The hand-maintained pages (`quiz.html`, `plan.html`, `deadlines.html`, `flashcards.html`,
  `english-lit-hl.html`, `sixth-subject.html`) are never touched by the generator.

## Recipes (common changes)

- **Add school papers**: save into `library/papers/<subject>/`, then link them from the
  matching table/card on `practice.html`.
- **Add a quiz bank**: JSON into `library/questions/`, register the file+label in `BANKS`
  at the top of `quiz-engine.js`. Validate: every `answer` in range, unique ids.
- **Add a flashcard deck**: JSON into `library/flashcards/`, register in `REGISTRY` at the
  top of `flashcards.js`.
- **Add deadlines**: edit the `DEADLINES` array in `assets/deadlines.js` (dashboard next-up
  and the timeline update automatically).
- **Add a subject hub**: copy a hub page, keep the checklist `data-key` convention
  (`<subject>::<path>`), add the nav link on **every** page (navs are hand-copied), add a
  dashboard card with `data-subject="<key>"`.

## Link check (run after edits)

```bash
python3 -I - <<'EOF'
import re
from pathlib import Path
ROOT = Path.home() / "Projects" / "ibsystem"
for f in ROOT.glob("*.html"):
    for href in re.findall(r'href="([^"#]+)"', f.read_text()):
        if not href.startswith(("http", "mailto")) and not (ROOT / href.split("?")[0]).exists():
            print("MISSING:", f.name, href)
EOF
```

## Known quirks

- Em-dashes/unicode subscripts inside JSON are fine (UTF-8 everywhere) — but always
  validate with `json.loads` after editing banks.
- Anchor-based patches must match exactly; the generated pages are single-line in places,
  so patch on short unique substrings and re-run the link check.
- `ibsystem/library/` is **canonical**. The ZCode workspace copy (`ib-library/`) was a
  staging area — do not update it further.
- `source-archives/` holds the original downloaded ZIPs (~434 MB) — provenance only,
  deletable once confident in `library/notes/`.
- The Cards page dark mode is scoped to that page (`data-fcTheme` attribute); the rest of
  the site is light-only by design (one thing to change at a time).
