# Development Notes

Architecture, data schemas, conventions and gotchas for anyone (including future-you)
touching this site.

## Architecture

- **Static site, no build step.** 18 study-site pages + 4 practice-app pages (`app/`, LIVE on rametric.com/nevaib) + 8 asset files + JSON data in `library/` (23 quiz banks / 631 items, 23 flashcard decks / 484 cards, and the PDF manifest `library/library-manifest.json` / 127 items). The engines build their pickers from `library/questions/manifest.json` + `library/flashcards/manifest.json`; the Library browser reads `library/library-manifest.json`.
- **Practice app (`app/`)**: `index.html` (launcher), `quiz.html`, `cards.html`, `author.html` (upload/manage/export).
  Engines resolve content via `PATH_BASE` (`../` when served from `/app/`, empty at the root), so the same engine
  files serve both layers. Root `quiz.html`/`flashcards.html` are one-line redirect stubs to the app.
- **Hosted deployment**: `server/api.php` (auth + per-user state, PHP sessions, JSON files under the cPanel home)
  + `tools/build_deploy.py` (assembles `deploy/nevaib/` — original content only). See `server/deploy-notes.md`.
- **auth.js (`assets/`)**: login/logout widget, server pull on load, debounced push on every engine write
  (engines call `Auth.queueSync()` from their `store.set`; `app.js` and the author page do the same after their writes).
  Logged out = localStorage-only fallback. The API base resolves per origin: pages on rametric.com use
  `/nevaib/api/api.php` (same-origin, session cookie), every other origin (localhost study site, LAN) uses the
  production URL **plus the login token** (`X-Nevaib-Token` header) — cookies can't cross origins, tokens can.
  A dev-only override exists for testing: `?nbapi=<url>` on a localhost page (sticky in localStorage `nb-api`,
  `?nbapi=` resets it).
- **Hosted backend (`server/api.php`)**: PHP, stdlib only — `login/logout/me/get-state/save-state`. **Must run on
  PHP 7.2+** (the host serves 7.2.34): no `never` return type, no arrow functions, positional
  `session_set_cookie_params`. Passwords: `password_hash`/`password_verify` against `~/nevaib-data/users.json`.
  Per-user state: JSON file per user under `~/nevaib-data/state/` (outside the web root). Sessions: PHP cookies
  (HttpOnly, Secure auto, 30 d) for same-origin callers; login also issues a bearer token (stored sha256-hashed
  in `~/nevaib-data/tokens.json`, 90-day expiry, max 8 per user) for cross-origin callers. Brute-force guard:
  5 fails → 5-min lockout (`login-fails.json`). Accounts: key-protected `action=setup`. CORS: whitelisted origins
  (rametric.com, localhost/127.0.0.1, LAN 192.168/10/172.16-31) get `Access-Control-Allow-Origin`; OPTIONS
  preflights answer 204 before auth.
- **Sync model**: last-write-wins on the whole synced payload (`q-userbanks, fc-userdecks, fc-state, fc-user,
  fc-deleted, fc-edits, quizlog, tok-objects, ee-ideas, io-issues, ia-debriefs, res-bookmarks, res-notes,
  res-recent` **+ `site-state`**). On load, the server state replaces local per key; every engine
  write triggers a debounced (2 s) push; retry loop every 15 s while dirty. Login triggers one reload so engines
  re-read restored state. `site-state` = `{checklists: {"chk:…": {c,r}}, week: {"week:0": "…"}}` — one batched
  object built from the per-row localStorage keys on push, distributed back to per-row keys on pull; **rows merge
  per-row** (server wins on pull; local-only rows survive; a push first re-fetches and merges server rows it lacks
  — never pushes blind, since `save-state` replaces the whole per-user file). First login on an empty account
  pushes the local state up (migration, no data loss).
- **Cache-busting convention**: engine script tags carry `?v=N` — bump N in the referencing pages whenever an engine
  file changes. auth.js is at `?v=5` on the eleven study-site auth pages (dashboard, hubs, core, ia, ee, library)
  and still `?v=4` on the four app pages; `app.js` is at `?v=2` everywhere it loads; `deadlines.js` is at `?v=2`
  (index + deadlines); `lists.js` is at `?v=2` (core, ia, french hub, ee); `library.js` is at `?v=1`
  (library.html, index, practice). Bank/deck/manifest fetches use `?cb=Date.now()` + `cache: no-store`.
- **Vanilla JS, one engine per concern**:
  | File | Owns | Page(s) |
  |---|---|---|
  | `assets/app.js` | Checklist rows (RAG + ticks), progress bars, countdown, this-week inputs | all pages (safe no-op) |
  | `assets/quiz-engine.js` | Session builder, MCQ marking, written self-marking, summaries, `fcSaveFromQuiz()` hook, PATH_BASE content resolution, user-bank merge | `quiz.html` (root + `app/`) |
  | `assets/flashcards.js` | Deck loading, Leitner SRS, session runner, editor, export/import, theme, PATH_BASE, user-deck merge | `flashcards.html` (root + `app/`) |
  | `assets/deadlines.js` | Deadline data + `#nextup` / `#timeline` renderers | `index.html`, `deadlines.html` |
  | `assets/lists.js` | Tracked lists (`data-list` containers) + debrief notes (`textarea[data-note]`), one synced blob each | `core.html`, `ia.html`, `french-a-langlit.html`, `ee.html` |
  | `assets/library.js` | Library browser over `library/library-manifest.json`: filter bar (subject/type/free-text), rows reusing the hub-row convention, ★ pins / notes / recent tracking, `#res-pins` + `#papers-list` renderers | `library.html`, `index.html`, `practice.html` |
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

**Testing the PHP API locally** (no host needed):

```bash
NEVAIB_DATA_DIR=/tmp/nevaib-test-data php -S 127.0.0.1:8018 -t . tools/dev_server.php
```

`tools/dev_server.php` maps `/api/api.php` onto `server/api.php` and `NEVAIB_DATA_DIR`
keeps test accounts/state out of the real `~/nevaib-data`. Point the browser at
`http://localhost:8017/…?nbapi=http://127.0.0.1:8018/api/api.php` to exercise the
cross-origin token path (the sticky override is localhost-only, by design).

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
| `q-errors` | quiz-engine + `practice.html` | missed-question tracker: `{key, subject, topic, topicLabel, format, stem, choices, answer, userAnswer, note, marks, markscheme, tactic, attempts, firstMissed, lastMissed, resolved}` — ids unique per file, key = id or stem hash; synced cross-device when logged in |
| `nb-token` | `auth.js` | login bearer token (sent as `X-Nevaib-Token`) — cross-origin sync |
| `nb-api` | `auth.js` | dev-only API override set via `?nbapi=` on localhost pages |
| `chk:*` / `week:*` | `app.js` | synced inside the `site-state` payload (not as their own keys) |
| `tok-objects` | `lists.js` (core.html) | TOK exhibition shortlist blob `{items:[{t, done, a: prompt, b: why}]}` |
| `ee-ideas` | `lists.js` (ee.html) | EE idea-log shortlist blob `{items:[{t, done, a: subject, b: why}]}` |
| `io-issues` | `lists.js` (french hub) | French IO global-issue bank blob `{items:[{t, done, a: text, b: work}]}` |
| `ia-debriefs` | `lists.js` (ia.html) | IA practice debrief notes `{nov:{rd,da,ce}, jan:{rd,ace}}` |
| `res-bookmarks` | `library.js` | pinned library resources: array of `subject::path` keys (★ on library rows), newest pin first |
| `res-notes` | `library.js` | per-resource free-text notes `{subject::path: text}` |
| `res-recent` | `library.js` | recently opened PDFs: array of `subject::path`, newest first, capped at 20 |
| `lib-filters` | `library.js` | library browser filter state `{subject, type, q}` — device-local, NOT synced |

`tok-objects`, `ee-ideas`, `io-issues`, `ia-debriefs` and the three `res-*` blobs are plain synced keys (in
`auth.js` `SYNCED_KEYS`, last-write-wins per blob). `q-errors` is deliberately NOT synced (device-local, rendered by practice.html's
inline script — now folded into the generator).

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

### Content manifests (`library/questions/manifest.json`, `library/flashcards/manifest.json`)
```json
[
  {"file": "library/questions/bio-unity-diversity-cells.json", "subject": "biology-hl",
   "subjectLabel": "Biology HL", "label": "Unity & diversity — Cells & membranes"}
]
```
Array of entries; this is what `quiz-engine.js` / `flashcards.js` fetch to build their
pickers (`?cb=` + `cache: no-store`). The flashcards manifest omits `label`. The inline
`FALLBACK_BANKS` / `FALLBACK_REGISTRY` lists at the top of the engines are partial
fetch-failure snapshots, not the source of truth — the manifests are. `validate_content.py`
checks that every manifest entry points to an existing file.

### Library manifest (`library/library-manifest.json`)
```json
{
  "generated": "2026-11-15T20:01:52Z",
  "items": [
    {"file": "library/notes/biology-hl/continuity-change/cell-nuclear-division.pdf",
     "subject": "biology-hl", "subjectLabel": "Biology HL", "type": "notes",
     "section": "continuity-change", "label": "Cell nuclear division"}
  ]
}
```
`type` is one of `notes | official | school | papers` (`papers/` may be empty); items are sorted by
(type, subject, section, label) so re-runs diff cleanly; `label`/`subjectLabel` are pre-HTML-escaped by
the tool (its `pretty()` mirrors `build_site.py`). Rebuild after adding/removing PDFs with
`python3 -I tools/build_library_manifest.py` — it scans `library/{notes,official,school,papers}` only
(`questions/` and `flashcards/` keep their own manifests). `library.html`, the dashboard pins card and
the practice papers list all render from this one file.

### Deadlines (`assets/deadlines.js` → `DEADLINES` array)
`{ d: "YYYY-MM-DD", t: "label", tag: "sciences|ee|tok|core|exams|langlit|university|sixth" }`

## Generator

`tools/build_site.py` regenerates the 10 base pages (index, 5 hubs, core, practice, ia,
quick-reference) plus `assets/style.css` and `assets/app.js`. All post-generation patches
are folded into its `PATCHES` list (teaching-sequence panels, dashboard next-up strip,
English Lit card, quiz callout, ISL milestone dates, chip styles, canonical nav) — re-running
it reproduces every page. The practice-page "Missed questions" card + its inline script live in
the generator too (folded in 2026-11-15 — they used to be hand-added drift). The sciences-IA
paragraph on ia.html is single-source (the old IA_PARA prefix-patch that duplicated a fragment
is gone).

Rules:
- Any hand-edit to one of the 10 generated pages must ALSO be folded into the generator
  (template or PATCHES entry) — otherwise the next regeneration reverts it.
- Auth widget (auth-slot + `auth.js?v=4` tag) is injected by `page()` for the `AUTH_PAGES` set
  (index, 5 hubs, core, ia); `english-lit-hl.html` and `ee.html` carry the same markup
  hand-authored. Keep them in sync. Core/ia/ee load auth.js because their lists/notes sync.
- Per-page engine scripts go through `EXTRA_SCRIPTS` (lists.js on core/ia/french; library.js on index
  + practice — it drives the dashboard pins card and the practice papers list).
- The hand-maintained pages (`quiz.html`, `plan.html`, `deadlines.html`, `flashcards.html`,
  `english-lit-hl.html`, `ee.html`, `library.html`, `sixth-subject.html`) are never touched by the generator.

## Recipes (common changes)

- **Add school papers (manifest-driven intake)**: save the PDF into `library/papers/<subject>/`, run
  `python3 -I tools/build_library_manifest.py`, refresh — the papers list on `practice.html` and the
  Papers group on `library.html` pick it up from the manifest; no page edit needed. The drop-files hint
  shows on both only while the papers count is 0.
- **Add library resources (notes/official/school)**: file the PDF under its `library/<type>/<subject>/`
  folder, re-run the manifest tool, refresh `library.html` — filter by type/subject/section or search;
  ★ pins, per-resource notes and recently-opened tracking sync via the `res-*` blobs.
- **Add a quiz bank**: JSON into `library/questions/`, then add an entry to
  `library/questions/manifest.json` (`file`, `subject`, `subjectLabel`, `label`). The engines
  fetch the manifest — no engine edit needed. The inline `FALLBACK_BANKS` in `quiz-engine.js`
  is only a best-effort snapshot for a manifest-fetch failure (may lag the manifest; not
  authoritative) — update it only if the degraded picker should include the new bank too.
  Validate with `python3 -I tools/validate_content.py` (answer ranges, unique ids,
  manifest→file consistency).
- **Add a flashcard deck**: JSON into `library/flashcards/`, then add an entry to
  `library/flashcards/manifest.json` (`file`, `subject`, `subjectLabel`). Same fallback note
  (`FALLBACK_REGISTRY` in `flashcards.js`) and same validator.
- **Add deadlines**: edit the `DEADLINES` array in `assets/deadlines.js` (dashboard next-up
  and the timeline update automatically; the renderers sort by date, but keep the array ordered).
- **Add a tracked list or debrief notes**: drop a `<div data-list="<key>" data-list-fields='[{"k":"a","label":"…","ph":"…"}]'></div>`
  or `<textarea class="tnote" data-note="<key>:<dot.path>"></textarea>` into the page, register `<key>`
  in `auth.js` `SYNCED_KEYS`, and load `lists.js` on that page (add it to `EXTRA_SCRIPTS` for generated
  pages, or the script tag for hand-made ones). One blob key per list/notes group; blobs are
  last-write-wins on sync.
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
- **The host runs PHP 7.2.34**, not 8 (cPanel can switch it — worth asking for). `server/api.php`
  is written for 7.2+: no `never` return type, no arrow functions, positional
  `session_set_cookie_params`, no trailing commas in calls. Keep it that way even though local
  `php -l` (8.3) accepts newer syntax.
