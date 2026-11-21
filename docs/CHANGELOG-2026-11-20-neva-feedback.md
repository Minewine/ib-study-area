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
  by ts+correct, reflection/errorType fill-in; retirement survives a newer write from a client
  that predates the field — see the review-fix section below).
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

## Consolidation verification (20 Nov 2026 smoke pass)

`./dev.sh validate` (green, warnings only), `./dev.sh test` (196 JS tests + pytest + php lint),
`./dev.sh e2e` (33 checks) — all pass. Browser smoke pass on a local dev server (logged-in):

- Quiz picker: subject → topic → set cascade; taught-status labels + "Topics & teaching status"
  panel render; **difficulty filter verified end-to-end** (Easy–Standard session on a 62-question
  topic served exactly the 16 rated easy/standard uploads, excluding 42 unrated + 2 hard).
- Upload: two 10-question pasted banks imported via the staged preview under one topic → picker
  shows **3 sets** (42 + 10 + 10) under that topic.
- Mistake log: error type + reflection saved and rendered; correct retry flips the card to
  **Recovered ("green", "last retry correct")**; retire → reason → **Retired** view → Restore all
  verified (retire itself uses a native `prompt()`, fine in real browsers).
- Cards editor reachable via "Edit & add cards" next to Start session; deck dropdown populated;
  card edit saved and rendered.
- Biology hub: A→B→C→D→Tools heading order correct; search narrows 43 rows and clearing restores all.
- Today panel loads without hanging, suggestions carry reasons and links. Favicon serves (`.ico`
  + SVG/PNG/apple-touch links). Light mode is the fresh-load default (`data-fcTheme="light"`).

Rough edges noted (not fixed here — small, non-blocking):

- The picker's topic/set dropdown counts stay unfiltered by design (the difficulty range applies
  when the session starts, with a "short session" notice); a student may expect the counts to move.
- The mistake-log "Not relevant…" flow asks for its reason via a native `prompt()` — works, but an
  inline form would be more consistent with the rest of the page.
- Validator warnings (non-blocking, content quality): biology question id `wp01` is reused across
  two banks (respiration/protein-synthesis vs water-potential/origin-cells); several banks have
  skewed MCQ answer-key positions and correct-option-length cues (display is shuffled at runtime,
  so impact is limited).

## Review-fix pass (20 Nov 2026, external code review)

An external review of this branch found five issues; all five were verified against the code and
fixed in this pass (225 JS tests + 33 e2e checks green afterwards).

1. **High — uploaded-bank mistake keys collided.** `bankIdFor` keyed inline uploads as
   `user:<label>`, while imports commonly reuse item ids (the AI prompt's p01–p08): two sets that
   shared a label wrote into ONE mistake history. Uploaded banks already carry a unique stored
   name (`ai-<topic>.json`, collision-deduped at import); it is now the bank id for error keys,
   and records written under the old label keys rename onto it per bank at load time
   (`migrateUserBankKeys`, matched by id AND stem — the same idempotent rename pattern as the
   bare-id migration). Histories already conflated under one shared key follow the stem match;
   unmatched records stay put and remain reviewable.
2. **Medium — "not relevant" could be erased by an older client.** `errMerge` rode the retirement
   fields on the ts-winner alone, so a stale cached page (predating the feature) overwriting the
   same record with a newer ts silently un-retired it. Restore now writes an explicit
   `retired: false` sentinel (not deleted fields), and `errMerge` preserves the loser's retirement
   only when the winner has no `retired` field at all — an explicit restore still wins. Records
   already erased before this fix cannot be recovered.
3. **Medium — the AI authoring prompt vs the paste importer.** The prompt asked for "a JSON code
   block" while `bank-import.js` did a bare `JSON.parse` — typical fenced chatbot output failed
   before preview. The prompt now asks for raw JSON, and `parse()` strips one optional markdown
   fence (tagged or bare) defensively; prose around the JSON still fails cleanly.
4. **Medium — the Mistakes deep link served retired errors.** `quiz.html?errkeys=…` (the
   `startReview` keys path) lacked the `!e.retired` filter the automatic paths have, and the log
   rendered a live "Retry this question" link on retired rows. Retired records are never served
   now (picker extracted as `pickReviewErrors`, notices count skipped-vs-missing keys), and the
   retry link is hidden on retired rows.
5. **Medium — the long-lead window was too short.** `LONG_LEAD_DAYS` 60 → 120: events just after
   the summer break sit >60 days out for most of May–June, defeating the early heads-up. The e2e
   window assertions (pinned 2026-11-20 clock) now cover (today+21, today+120].

Tests: `tests/js/auth-merge.test.js` + `tests/js/mistakes.test.js` re-pinned to the new retirement
contract; new regression tests in `tests/js/retired.test.js` (bank ids, key migration incl. the
merge-into-existing case, deep-link picker) and `tests/js/bank-import.test.js` (fence stripping);
`tests/e2e/e2e.js` long-lead window updated. All 225 JS tests + 33 e2e checks pass.

### Independent review round (same day)

A second, independent review of the fixes above confirmed the retirement/merge semantics and the
fence handling, and caught one High + one Medium in the first implementation — both fixed and
pinned:

- **Sync convergence of the uploaded-bank rename.** The `q-errors` merge's drop filter only
  handled legacy keys *without* a `#`, so an old-key record synced from another device survived
  the merge, got written back, and was re-absorbed on every load — `attempts` inflating forever.
  The filter now drops any record whose key equals another record's `legacyKey` (pinned in
  `tests/js/auth-merge.test.js`).
- **Today-panel dead links for uploaded banks.** `weakestTopic` excluded uploaded-bank records by
  the old `user:` bank-id prefix; the new name-based ids passed that filter and rendered a
  "Start a quiz" link that resolves library banks only. The exclusion now also covers the stored
  bank names of everything in `q-userbanks` (pinned in `tests/js/today.test.js`).
- Smaller items: the mistakes.js module header documents the new restore sentinel; the
  migration's legacy-id fallback now spells "My bank" exactly like the old BANKS entry default;
  duplicated keys in an `errkeys=` deep link no longer count as "not found".

Known nit left as-is: for uploaded banks whose items carry no `topic`, the effective topic key
changes from the label-derived id to the stored-name id, so a `topic-taught` override set the old
way silently stops applying and re-toggling it re-keys it (self-healing, no data loss).

### Uploaded-bank records get an explicit stable id (follow-up, same day)

- **Uploaded banks get an identity.** The stored `name` is unique only per device at import time —
  two devices uploading the same topic produced identical names, the `q-userbanks` union merge
  collapsed them into one record, and their mistake keys collided. Both upload paths now stamp
  `id: "ub-" + base36 time + "-" + base36 random`; `bankIdFor` prefers it, the union merge dedupes
  by it (pre-id records keep the `subject::name` composite) and the Today exclusion covers the id
  spelling. Existing records are never stamped — their name-derived identity and keys stay as they
  are (pinned in `tests/js/bank-import.test.js`, `tests/js/today.test.js`).
