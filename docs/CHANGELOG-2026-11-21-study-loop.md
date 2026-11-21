# Changelog — 21 Nov 2026: study-loop consolidation (reliability fixes + WP1–WP4)

One-page summary of the 21 Nov study-loop batch on `feat/practice-mistakes-today` (not deployed —
deploy needs explicit approval). The reliability fixes were committed earlier on this branch
(`5f243e1`); WP1–WP4 land in this consolidation commit. Per-package detail with full migration
notes:

- [CHANGELOG-2026-11-21-wp1-hierarchy-polish.md](CHANGELOG-2026-11-21-wp1-hierarchy-polish.md)
- [CHANGELOG-2026-11-21-wp2-mistake-retries.md](CHANGELOG-2026-11-21-wp2-mistake-retries.md)
- [CHANGELOG-2026-11-21-wp3-today-panel.md](CHANGELOG-2026-11-21-wp3-today-panel.md)
- [CHANGELOG-2026-11-21-wp4-exam-reflections.md](CHANGELOG-2026-11-21-wp4-exam-reflections.md)

Verification for the whole batch: `./dev.sh validate` ALL CHECKS PASSED (pre-existing content
WARNs only) · `./dev.sh test` pytest **230** + node **277** + php lint ok · `./dev.sh e2e`
**39/39**.

## What was implemented in each part

### Reliability fixes (committed in `5f243e1`)
- **Stable bank identity**: every upload is stamped with a stable `ub-` id at finalize
  (`assets/bank-import.js`, `app/author.html`); the sync union no longer collapses distinct
  banks (`assets/store.js` — `bankId` prefers the stored id). Pre-id composite identity is kept
  and ids are never back-stamped onto old copies (all pinned by tests).
- **"Not relevant" survives merging**: a retirement recorded on one device can no longer be
  erased by a retirement-unaware winner (`errMerge` in `assets/store.js`); Restore writes an
  explicit `retired: false`; a legacy-key copy folds into the renamed record (attempts take the
  max) without resurrecting or duplicating it.
- **Paste importer**: `assets/bank-import.js` strips markdown fences before `JSON.parse` (typical
  chatbot output parses), names the parse error for broken JSON inside a proper fence, and stages
  validate → preview/edit → import; the staged bank gets the same `ub-` id at finalize.
- **Retired deep links**: `quiz.html?errkeys=` links skip retired records and say so; retired
  mistake rows drop the Retry deep link but keep Restore.
- **Today long-lead**: the "start thinking" window grew from 60 to 120 days
  (`LONG_LEAD_DAYS`, `assets/today.js`) — EE/IA-scale horizons now surface.

### WP1 — hierarchy polish (subject → topic → named set)
- Teaching status is three-state: **Auto / Not yet / Learning / Ready to revise** (additive
  optional `status` on `topic-taught`; `taught` stays consistent so the deployed client keeps
  showing the same thing). Taught-only excludes only "not yet taught" — Maths topics without
  schedule coverage can now be marked by hand.
- Repeated uploads: `setOrder` and (on name collision) a unique `set` name are stamped at upload
  (`nextSetOrder`/`nextSetName` in `assets/bank-schema.js`, `stampSetMeta` on both
  `app/author.html` upload paths). Stored banks are never rewritten; legacy duplicate names are
  disambiguated display-only (`disambiguateSetNames`).
- Topic rows label all-Paper topics (`· Paper 1A practice` / `· Paper 1B practice`) and show
  `· N unrated` difficulty counts (labels are never invented).
- Two uploads sharing a topic and item ids keep separate `q-errors` records (regression test).

### WP2 — mistake log as spaced review
- `q-errors` records gain an optional `dueAt` (epoch ms): **the first wrong outcome schedules a
  retest 7 days out, any later wrong outcome 30 days out** (pure `dueDelayMs`/`nextDueAt`/
  `isDue`/`applyRetry`, exported for tests).
- A wrong review retry **re-opens a recovered record** (an old bug let it stay recovered) and
  reschedules; a correct answer at/after the due date recovers and clears the schedule; before
  the date it is practice only. Legacy records without `dueAt` recover as before (absent = due
  now). `attempts` now counts wrong outcomes.
- "Review past errors" and the Today panel serve/list only due records; the `errkeys=` deep links
  and the confident-but-wrong review stay ungated (an early retry is practice). When nothing is
  due, the setup panel names the next due date instead of "well done!".
- The mistakes page shows `· due YYYY-MM-DD` on open rows; restore keeps explicit
  `retired: false`.

### WP3 — Today as a short reasoned plan
- "Suggested next step" is a **tiered, three-slot ranking with a reason and a link on every
  suggestion** (`MAX_SUGGESTIONS = 3`): tier A urgency/planning (earliest near-term deadline
  ≤ 21 days, earliest unit close ≤ 7 days — now always linkable via the subject's notes page —
  and next-unit plan-ahead, including inside a scheduled break), tier B review that is due (due
  cards, due-gated open mistakes, due own cards), tier C enrichment (weak-topic quiz, read-ahead)
  only in the slots left over.
- A guarded push drops incomplete candidates; with zero candidates the block is not rendered at
  all. New sources are `isISO`-guarded and profile/canon filtered; `nextUnits` is exported pure.

### WP4 — exam reflections, separated from practice history
- The Quiz page's past-paper log (`pp-scores`) gained a read-only aggregation layer: a
  per-subject **Score trend** (ascending scored chain, last 5, each `score/max (pct%) on
  D Mon`) and a **By topic** table (scored papers, scoreless reflections, latest result, trend
  chain; topicless records group under "(whole paper)").
- A scoreless-only group never invents a denominator; scored predicates require `max > 0`
  everywhere, so corrupt synced data can't render "5/0 (0%)".
- Separation invariant pinned by tests: `papers.js` never reads `quizlog` (practice-quiz
  sessions stay in quiz history; the parent summary stays quizlog-only).

## Student-facing improvements

- **Quiz page** (`app/quiz.html`): subject → syllabus topic → named set picker with per-set
  counts and Paper 1A/1B badges, difficulty-range filter with honest unrated counts, three-state
  teaching-status panel; "Review past errors" is now a scheduled retest queue that explains when
  the next one comes due; the past-paper log shows score trends and a by-topic summary.
- **Mistake log** (`app/mistakes.html`): open rows show when their spaced retest comes due;
  "not relevant" retirement is merge-safe; retry deep links never resurrect retired records.
- **Today panel** (`app/index.html`): a short, reasoned plan (max 3 suggestions with links)
  instead of a due-cards-first pile; the long-lead planning window is 120 days.
- **Upload page** (`app/author.html`): chatbot-pasted banks import cleanly (fence tolerance),
  get stable ids and unique set names/order — repeated uploads stay separate and sortable.

## Data-model changes & migration notes

- **No schema bump anywhere (`SCHEMA_VERSION` stays 1); no stored-data migration.** All changes
  are additive optional fields; absent-field records and pre-WP clients behave exactly as before.
  The server/API is unchanged (per-key merge is client-side; the server blob preserves unknown
  fields).
- **`topic-taught`** (WP1): optional `status` (`"not-taught"|"learning"|"ready"`); `taught` stays
  the compatibility field, kept consistent on every write path. Newest-`t` merge carries a valid,
  consistent status from the older record so an old client cannot erase it (`taughtStatusFill`);
  contradictory or garbage statuses are dropped. `assets/backup.js` SPEC accepts the optional
  status (bogus ones dropped with a warning on restore).
- **`q-userbanks`** (WP1): `set`/`setOrder` may now be stamped at upload (schema-valid but unused
  before); nothing already stored is renamed or rewritten. Per-item progress keys stay
  `<bankId>#<id>`.
- **`q-errors`** (WP2): optional `dueAt` (epoch ms; absent = due now, so legacy records and
  pre-WP2 clients behave as before); recovery clears it, a wrong retry overwrites it;
  `attempts` = wrong outcomes (display nuance only — the retry history keeps every outcome).
  Sync merge stays field-aware: retries unioned, `reflection`/`errorType`/`dueAt` fill from the
  loser only when the winner lacks them, retirement preserved from a loser when the winner has
  no field.
- **`pp-scores`** (WP4): unchanged — the record already carried score, max, paper, source, topic
  and reflection; WP4 only reads it.
- Cache-bust bumps (see [DEVELOPMENT.md](DEVELOPMENT.md) for the current table): `store.js ?v=10`
  (23 pages + the `tools/build_site.py` template), `quiz-engine.js ?v=22`, `today.js ?v=7`,
  `mistakes.js ?v=2`, `papers.js ?v=3`, `bank-schema.js ?v=2`, `backup.js ?v=7`.

## Files touched

- **Engines**: `assets/quiz-engine.js` (picker model + taught panel + due ladder),
  `assets/store.js` (merge rules: bank id, retirement, `dueAt`, taught status),
  `assets/bank-schema.js` (`nextSetOrder`), `assets/bank-import.js` (paste importer, committed
  earlier), `assets/backup.js` (SPEC), `assets/mistakes.js` (due labels, restore),
  `assets/today.js` (tiered suggestions, 120-day lead), `assets/papers.js` (aggregations).
- **Pages**: `app/author.html` (`stampSetMeta`), `app/quiz.html` (panel copy + versions),
  `app/index.html`, `app/mistakes.html`; cache-bust version bumps across the remaining pages +
  `tools/build_site.py`.
- **Tests**: new `tests/js/mistake-schedule.test.js` (9) and `tests/js/wp2-edges.test.js`
  (16); extended `quiz-picker.test.js` (37), `taught.test.js`, `bank-schema.test.js`,
  `store.test.js`, `today.test.js` (33), `papers.test.js` (12), `tests/e2e/e2e.js` (sections 9–10,
  39 checks total).
- **Docs**: README, HANDOFF, NEXT-STEPS, DEVELOPMENT, ROADMAP, the four per-WP changelogs and
  this summary. The stray `review-diff.txt` review artifact (committed with `5f243e1`) is removed
  in this pass.

## Remaining limitations & follow-ups

- **Deploy pending** — nothing here is on rametric.com yet; deploy only with explicit approval.
- WP2: a recovered record that merges with a stale open copy inherits that copy's `dueAt`; it is
  inert while resolved and is overwritten by the next wrong outcome.
- WP3: in the last week of a unit, the "Next unit" suggestion shares tier A with "Unit closes
  this week" and can push due-card reminders past the 3-slot cap (accepted trade-off).
- WP1: two devices uploading into the same topic while offline can compute identical `setOrder`
  values (ties resolve by name in the picker; cosmetic, currently untested).
- WP1: with today's content every set row shows `· N unrated` — honest but noisy until difficulty
  ratings are authored.
- Pre-existing: `assets/notes.js` resolves `?subject=` strictly against the manifest spelling, so
  canonicalized maths fallback links degrade to the notes index.
- Pre-existing content WARNs (validate): key-position skew and longest-option cues in several
  banks — authoring-quality advisories; runtime display is shuffled.
