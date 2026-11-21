# Changelog — 21 Nov 2026: work package 2 — spaced mistake retests (7/30-day schedule)

_Follows [WP1](CHANGELOG-2026-11-21-wp1-hierarchy-polish.md) on the same branch
(`feat/practice-mistakes-today`); not deployed. Goal: make the mistake log drive follow-up
practice on the schedule NEXT-STEPS.md promised ("spaced retests of missed questions at 7 and 30
days", technical audit H4–H9) without changing what a mistake record is: one new optional field,
no new store, no schema migration, nothing hard-deleted._

## What changed

### The schedule (assets/quiz-engine.js)
- Every `q-errors` record gains an optional `dueAt` (epoch ms) — when the item next comes due for
  a scheduled retest. The ladder: **the first wrong outcome schedules a retest 7 days out, any
  later wrong outcome 30 days out** (`DUE_DELAY_FIRST_DAYS`/`DUE_DELAY_LATER_DAYS`; pure helpers
  `dueDelayMs(attempts)` / `nextDueAt(rec, nowMs)`, exported for tests).
- `recordError` (normal-session misses) writes `dueAt` in both branches: a new record lands at
  `ts + 7 days`, a repeat miss reschedules at `ts + 30 days`. It touches nothing else — the stem
  snapshot, reflection, error type and retry history of the existing record are preserved
  (regression-tested).
- **`attempts` now counts wrong outcomes**: misses (as before) plus wrong review retries (new —
  `applyRetry`, below). Correct retries append to the retry history but do not bump the counter
  (the retries array keeps every outcome; the capped-20 rule is unchanged).
- `markReviewResult` was refactored onto the exported mutation helper **`applyRetry(rec, correct,
  conf, nowMs)`**, which pins the review-outcome semantics:
  - **wrong:** re-opens a recovered record (`resolved = false` — an old bug let a record stay
    recovered after being missed again in review), counts the wrong outcome and reschedules
    `dueAt` (+30 days from now);
  - **correct at/after the scheduled retest** (or on a record without `dueAt`): recovers
    (`resolved = true`) and **deletes `dueAt`** — the scheduled time has arrived and was passed;
  - **correct before the scheduled retest:** practice only — the retry is recorded, the record
    stays open and keeps its schedule. Legacy records without `dueAt` recover on the first
    correct answer, exactly as before.
- The exported pure gate `isDue(rec, nowMs)`: open, not retired, and `dueAt` absent or in the
  past.

### What is due-gated (and what is not)
- **"Review past errors" serves only due records** (`pickReviewErrors` gained the gate, with
  `opts.ignoreDue` as the explicit opt-out and `opts.nowMs` for the node tests). When the gate
  leaves nothing to review but unresolved mistakes exist, the setup panel explains the schedule
  instead of the old "well done!" (which still shows when the log is genuinely empty): "No missed
  questions are due for retest yet — the next one comes back YYYY-MM-DD. You can retry a question
  early from the mistake log."
- The **count next to the button reflects due items** ("N missed question(s) due for retest" /
  "none due yet — next one YYYY-MM-DD"); the button stays clickable while anything is unresolved,
  so the click can explain the schedule instead of dead-ending on a disabled control.
- **Bypass paths stay ungated:** the `quiz.html?errkeys=` deep links (Mistakes-page retry links)
  and the confident-but-wrong review serve their picked records immediately — an early retry is
  practice and does not resolve the record, but it is offered when asked for.
- **Today suggestions** (`assets/today.js openMistakes`): not-yet-due mistakes no longer feed the
  "Open mistakes …" suggestion (they would immediately deep-link into items that are not due).
  They remain visible on the mistakes page. Legacy records without `dueAt` always show.
- The **mistakes page** (`assets/mistakes.js rowHtml`) shows the schedule on open rows: the meta
  line gains `· due YYYY-MM-DD` (local date; overdue rows keep showing the past date). Nothing
  else in the page changes — retire/restore work as before.

### Sync merge (assets/store.js errMerge)
- `dueAt` joins the fill-from-loser set: a record whose winner lacks the field (an old client's
  copy) inherits the other side's schedule; when both sides have it, the errRank winner's value
  wins like every other scalar. Retirement, reflection and errorType semantics are untouched and
  stay pinned by tests.

## Data model changes & migration notes

- **One new optional field on `q-errors`: `dueAt` (epoch ms).** No schema bump
  (`SCHEMA_VERSION` stays 1), no migration — optional fields with sensible defaults need none
  (absent = due now, so legacy records and pre-WP2 clients behave exactly as before, and a
  pre-WP2 client simply never writes the field). Records are never hard-deleted; recovery
  clears `dueAt`, a wrong retry overwrites it.
- `attempts` semantics tightened to "wrong outcomes" — a display-only nuance for records that
  were practised correctly before their retest date (the retry history keeps every outcome).
- `retries[].conf?` is unchanged and still engine-written: `applyRetry` threads the review rating
  through to the retry entry — **conf preserved on review retries**, exactly as `markReviewResult`
  recorded it before the refactor (regression-tested).
- Server/API unchanged (per-key merge is client-side; the server blob preserves unknown fields).
  Known trade-off, consistent with the existing fill rules: a recovered record (no `dueAt`) that
  merges with a stale open copy inherits that copy's `dueAt`; it is inert while the record is
  resolved and is overwritten by the next wrong outcome.
- Script versions bumped (cache-busting): `store.js ?v=10` (23 pages + the
  `tools/build_site.py` template — the byte-identical regeneration test forces the template
  bump), `quiz-engine.js ?v=22` (app/quiz.html), `today.js ?v=6` (app/index.html),
  `mistakes.js ?v=2` (app/mistakes.html).

## Files touched

- **Modified (code)**: `assets/quiz-engine.js` (due ladder + `dueDelayMs`/`nextDueAt`/`isDue`/
  `applyRetry` exported, `recordError` writes `dueAt`, `markReviewResult` → `applyRetry`,
  due-gated `pickReviewErrors`, empty-review notice, due-aware review count),
  `assets/store.js` (`dueAt` fill-from-loser in `errMerge` + comments),
  `assets/today.js` (`openMistakes` due gate, injectable `nowMs`),
  `assets/mistakes.js` (`· due YYYY-MM-DD` on open rows, header comment),
  23 pages + `tools/build_site.py` (`store.js?v=10` regeneration), `app/quiz.html` (`?v=22`),
  `app/index.html` (`?v=6`), `app/mistakes.html` (`?v=2`).
- **Modified (tests)**: `tests/js/mistake-schedule.test.js` (new: ladder, `isDue`, `applyRetry`
  outcomes, due-gated `pickReviewErrors` + `ignoreDue`/keys bypass, `recordError` repeat-miss
  regression), `tests/js/store.test.js` (`dueAt` merge + retirement sentinel pins),
  `tests/js/today.test.js` (`openMistakes` due gate), `tests/e2e/e2e.js` (section 2 reworked for
  the due gate + deep-link practice; new section 10: pinned advancing clock — miss today →
  nothing due → +7d review wrong (re-opened, +30d) → +37d review correct (recovered, schedule
  cleared) → mistakes page lists the recovered records and a retired record restores).
- **Modified (docs)**: this changelog, `docs/DEVELOPMENT.md`, `docs/NEXT-STEPS.md`,
  `docs/HANDOFF.md`, `docs/ROADMAP.md`, `README.md`.

## Verification

- `./dev.sh validate` — ALL CHECKS PASSED (pre-existing content WARNs only); the byte-identical
  `build_site.py` regeneration test (pytest) stays green with the template bump.
- `./dev.sh test` — pytest 230 passed; node **269** tests, 0 fail (WP1 baseline 242; +9 schedule
  tests, +16 edge tests); php lint ok; `node --check` on every `assets/*.js` ok.
- `./dev.sh e2e` — **39 checks pass** (37 pre-existing + 2 new; the two reworked section-2 checks
  pin the due gate and the deep-link practice path).
