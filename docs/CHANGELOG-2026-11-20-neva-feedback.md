# Changelog — 20 Nov 2026: student-feedback improvement phases (0–5)

_Consolidation pass, 20 Nov 2026. The phases were built in separate sessions on the same working
tree; this pass reviewed what each actually produced, verified the whole batch, documented it and
committed it as one merge request. Deploy to rametric.com/nevaib is **not** part of this batch —
it stays gated on explicit approval (NEXT-STEPS.md §1)._

Phase 0 was committed first (`58f6539 fix: phase 0 — …`) and the favicon SVG in `d86c0ec`; phases
1–5 land together in the consolidation merge request.

## Phase-by-phase summary

### Phase 0 — baseline review, Today panel loading/error states — ✅ committed (`58f6539`)
- Verified the live site matched `main` byte-for-byte; every `assets/today.js` fetch got a 10 s
  timeout with explicit error states (a failed class-schedule/decks/notes load no longer
  masquerades as an empty panel; a hung script can't leave "Loading…" forever, with an
  `app/index.html` fallback).
- Fixed while checking: dark mode attribute mismatch (`data-fcTheme` vs `data-fc-theme`), the
  Cards editor's deck dropdown, uploaded-deck card edits/deletes, quiz-upload manage-list staleness,
  storage-full writes reporting success, and the deck-id collision check on `/app/` pages.
- Upload limits measured and documented: **no question-count or file-size cap anywhere** (40,000
  items / ~6 MB import in about a second; the real ceiling is the browser's localStorage quota,
  which now surfaces as a clear error).

### Phase 1 — practice sets + taught/difficulty filters, batch imports — ✅ complete
- **Schema** (`assets/bank-schema.js`): shared validators for banks and decks, used by the Upload
  page and by `tools/validate_content.py`, so an uploaded bank cannot drift from a permanent
  library file. Optional, zero-migration fields: bank-level `set` / `setOrder` / `codes` (+
  `paperStyle` / `calculatorFree` for Paper-style labels) and item-level `difficulty`
  (`easy|standard|hard`; absent = Unrated, never guessed). `nextSetName` computes the next free
  "Practice set N" per topic.
- **Quiz picker** (`assets/quiz-engine.js`, `app/quiz.html`): banks group as **sets under their
  effective topics** (item `topic` → bank `topic` → filename stem); a **difficulty-range filter**
  (`#q-diff-min/max`, crossed values guarded); a **"taught topics only" toggle** with a
  **"Topics & teaching status" panel** (`topic-taught` overrides; topics without one fall back to
  the class-schedule suggestion); Paper-style badges in the set dropdown.
- **Manifest tooling**: `tools/build_questions_manifest.py` (new) computes the picker metadata
  into `library/questions/manifest.json`; `tools/validate_content.py` mirrors the aggregation so a
  stale manifest cannot drift (`tests/test_questions_manifest.py` pins it).
- **Batch imports**: no upload cap (measured in phase 0); multi-file upload stays.
- Tests: `tests/js/bank-schema.test.js`, `tests/js/quiz-picker.test.js` (picker model + 11 boot
  wiring tests), `tests/js/taught.test.js` (`topic-taught` sync/merge/backup contract).
- *Gap:* no e2e coverage of the new picker controls (unit-level only) — follow-up.

### Phase 2 — mistake log — ✅ complete
- `app/mistakes.html` + `assets/mistakes.js`: a browsable log over `q-errors` with
  **error type** tagging (careless / misread / content / time / other), **reflections** (≤500),
  **retry history** (written by the quiz engine, capped at 20, carries confidence), status ranking
  (**unresolved → recovered/"green" → retired**), and a reversible **"not relevant"** soft-hide
  (reason ≤200; retired questions are excluded from review and unresolved counts, never deleted).
- Filters: status / subject / text search, subject-profile aware; device-local filter state
  (`mistakes-filters`, LOCAL_ONLY). Deep links: retry one question (`quiz.html?errkeys=`) and open
  the topic's notes.
- Sync: the new `q-errors` fields merge field-aware (`store.js` `errMerge` — retries union deduped
  by ts+correct, reflection/errorType fill-in, retired rides the winning side).
- Registered everywhere: nav on all 9 app pages, launcher card, `build_deploy.py` PAGES, e2e page
  list (the PAGES entry was missing until this consolidation — fixed).
- Tests: store-merge side pinned (`store.test.js`, `auth-merge.test.js`); page logic pinned in
  `tests/js/mistakes.test.js` (added in this consolidation — it was the one untested module).
- *Gap:* no interactive e2e for the page yet — follow-up.

### Phase 3 — biology navigation + Today suggestions — ✅ complete
- **Biology hub** (`biology-hl.html` + `assets/app.js`): syllabus checklist grouped under
  **A/B/C/D theme headings** with **live search** over row codes/names; headings with no visible
  rows hide themselves; explicit empty state; clearing restores all rows. (e2e section 6.)
- **Today panel** (`assets/today.js`): **ranked suggestions with visible reasons**, capped at two —
  open mistakes (→ retry link packing ≤20 `errkeys`), units closing this week (→ note link),
  deadline prep — plus **near-term (≤21 days)** and **"start thinking about" (long-lead ≤60 days)**
  dated items from deadlines + coursework, deduped. Weakest-topic quiz unchanged (q-errors first,
  then quizlog <70%).
- Tests: `tests/js/today.test.js` (+~300 lines: suggestions, ranking, reasons, errkeys format,
  dated windows, malformed records, calendar/planner dedupe); e2e section 7 with a pinned clock.

### Phase 4 — resources + AI-assisted authoring — ✅ complete
- **Resources page** (`app/resources.html` + `assets/resources.js`): she saves her own links —
  title, subject, topic, type (website/video/document/practice/other), URL, note — tagged to a
  syllabus topic, optionally **also shown on that topic's note** (the per-note "My resources" box
  keeps working). Filter bar (subject/type/search, in-memory), inline row editor, tombstone
  deletes. Per-resource **"Make questions…"** deep-links into the Upload page's AI flow.
- **Storage**: extends the existing synced `my-res` key with optional `subject/topic/type/comment`
  fields — no new key, no schema bump, no migration; `assets/backup.js` validates the extended
  shape (label/url rules apply to live records only; tombstones carry neither).
- **Hard rules kept**: links only (`http(s)://`/`file://`, ≤2000 chars — same rule as the notes
  page), no base64/file contents in localStorage, and nothing in `my-res` is ever read by the quiz
  or card engines — a resource cannot become quiz content.
- **AI-assisted authoring** (Upload page §1–2 + every topic note): pick subject/topic → **copy the
  prompt & open your AI** (mode `bankgen` in `library/ai-prompts.json`, with new `{subjectid}` /
  `{topickey}` placeholders so the JSON lands in the right subject; `assets/ai-prompt.js` gained
  `render(note, opts)` for the picker) → paste the returned JSON into the paste box → **staged
  preview** (`assets/bank-import.js`): validate with the shared bank rules, edit
  stems/choices/answer/marks/markscheme, remove items, unique suggested `ai-<topic>.json` name →
  **Import bank** in one batch into `q-userbanks`, byte-shape-equal to a file upload. Copy-before-
  open, tri-state copy, pop-up hint and copy-again hardening are shared with the notes page. No
  external API calls anywhere. **Explicitly deferred:** Google Classroom import and true in-app
  generation (privacy, OAuth, cost).
- Tests: `tests/js/resources.test.js`, `tests/js/bank-import.test.js` (new); `tests/js/myres.test.js`
  and `tests/js/ai-prompt.test.js` extended; e2e section 8 (save/delete resource, deep-linked AI
  card, staged paste → edit → import).

### Phase 5 — favicon, editor discoverability, light-mode default — ✅ complete
- **Favicon**: the SVG favicon was committed earlier (`d86c0ec`); this batch adds the **PNG
  fallbacks** (`assets/favicon-32.png`, `assets/apple-touch-icon.png`, root `favicon.ico`) that
  every page already references — they were untracked and are committed here, plus
  `build_deploy.py` copies `favicon.ico` into the deploy.
- **Editor discoverability**: the Upload page opens with a five-section map ("ask an AI (1),
  upload or paste with a check-first preview (2), manage (3), edit items (4), back up (5)"); the
  app-home Upload launcher card says what the page now does; the Cards editor gained "Edit & add
  cards" wording + explainers on where own cards live; the Quiz page has an "Extending the banks"
  note pointing at the Upload page.
- **Light-mode default**: `assets/flashcards.js` defaults the Cards page theme to **light**
  (`store.get("fc-theme", null) || "light"`); dark remains the explicit toggle. Device-local key.

## Student-facing improvements (short list)

1. She can organise practice: sets under topics, difficulty ranges, taught-only sessions.
2. Every wrong answer becomes a logged, taggable, retryable entry with her own reflection — and
   "not relevant" ones stop nagging without disappearing.
3. The Biology hub is navigable by theme + search; the Today panel tells her *why* each
   suggestion is there.
4. A Resources page for her own links that can never pollute quizzes, and an AI path that turns
   "make me questions on A1.1" into an imported, checked bank in one sitting.
5. Clearer Upload page, better icons, predictable light default on Cards.

## Data model changes & migration notes

- **No schema bump, no migrations** (`SCHEMA_VERSION` stays 1): every change is additive with
  absent-field validity.
  - `q-userbanks` / `fc-userdecks` entries: optional `set`, `setOrder`, `codes`, `paperStyle`,
    `calculatorFree`; items: optional `difficulty`. Old banks stay valid.
  - `q-errors` records: optional `errorType`, `reflection`, `retries`, `retired`/`retiredReason`/
    `retiredAt`. Merged field-aware on sync/restore.
  - New synced key `topic-taught` (`{topicKey: {taught, t}}`, per-topic newest-`t` merge).
  - `my-res` records gain optional `subject`/`topic`/`type`/`comment` (merge unchanged: newest-`t`
    per id, tombstone deletes). `assets/backup.js` SPEC widened accordingly.
  - New LOCAL_ONLY keys: `mistakes-filters`; `fc-theme` semantics now default to "light".
- `library/questions/manifest.json` gained per-bank picker metadata (rebuilt by
  `tools/build_questions_manifest.py`; drift-checked by the validator + test).
- Backup/restore: all new shapes are validated in `assets/backup.js` SPEC; restoring older backups
  still works (absent fields stay absent).

## Files touched (consolidation batch)

- **New**: `app/mistakes.html`, `app/resources.html`, `assets/mistakes.js`, `assets/resources.js`,
  `assets/bank-schema.js`, `assets/bank-import.js`, `tools/build_questions_manifest.py`,
  `tests/js/{bank-schema,quiz-picker,taught,myres,mistakes,resources,bank-import}.test.js`,
  `tests/test_questions_manifest.py`, `favicon.ico`, `assets/favicon-32.png`,
  `assets/apple-touch-icon.png`, this changelog.
- **Modified (code)**: `assets/{store,quiz-engine,backup,ai-prompt,notes,flashcards,today,app,style}.js`,
  `app/*.html` (nav + features; author/quiz/cards/notes most), `library/ai-prompts.json`,
  `library/questions/*.json` + `manifest.json`, `tools/{build_deploy,build_site,validate_content}.py`,
  `tests/e2e/e2e.js`, several root pages (favicon links, bio hub search markup).
- **Modified (docs)**: `README.md`, `docs/{HANDOFF,NEXT-STEPS,DEVELOPMENT,ROADMAP,AUTHORING,USER-TEST}.md`.

## Remaining limitations / follow-ups

1. **Deploy** — this whole batch (phases 0–5) is undeployed; push with
   `./dev.sh deploy --confirm` only after explicit approval, and hard-refresh devices (script
   versions were bumped: `backup.js ?v=6`, `ai-prompt.js/notes.js ?v=5`, `app.js ?v=6`,
   `quiz-engine.js ?v=20`, `today.js ?v=5`, `deadlines.js ?v=6` — two stale tags found and fixed
   during this pass: `backup.js` never bumped after its SPEC change, `app.js ?v=5` left on
   ee/library/english-lit pages).
2. **No e2e for the phase-1 picker controls** (sets/difficulty/taught) or **mistake-log page
   interactions** — both are unit-tested; browser-level coverage would be the next test investment.
3. The mistakes page's filter dropdown refreshes from records; subjects with no logged mistakes
   don't appear until one exists (same pattern as before).
4. Google Classroom import and true in-app AI generation remain explicitly deferred
   (privacy / OAuth / cost) — revisit when she asks.
5. Repo privacy: the GitHub repo is still **public** (NEXT-STEPS §2) — making it private remains
   an open, family-owned decision.
