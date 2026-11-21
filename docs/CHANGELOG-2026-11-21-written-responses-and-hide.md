# Changelog — 21 Nov 2026: written-answer capture + question-level hide

_On the same working tree as the difficulty batch (not deployed). Goal: the mistake log should
be able to show what she actually wrote when a written answer went wrong or partial, and she
should be able to banish a bad question from future quizzes and cards without touching the bank
files. Data changes are additive only: two optional fields on `q-errors` (plus optional fields
on `retries[]` entries) and one new synced key `q-hidden` — no schema bump, no migration, zero
server changes._

## What changed

### 1. Written answers are captured (assets/quiz-engine.js, assets/mistakes.js)
- A written item marked **wrong or partial** (`got < marks` — the existing "correct" rule)
  now stores a **bounded copy of her response** (`response`, trimmed ≤2000 chars, absent when
  empty) and the **self-awarded mark** (`awarded`) — on the record (both `recordError`
  branches: first miss and repeat miss) and on every wrong `retries[]` entry via the extended
  `pushRetry(e, correct, conf, extra?)` / `applyRetry(rec, correct, conf, nowMs?, extra?)` /
  `markReviewResult(it, correct, conf, extra?)`. The first miss keeps its "no retry entry"
  rule — its response lives at record level. MCQ attempts and correct outcomes store neither
  field (byte-identical behaviour); the dead `selfScore` extra name (never read by anything)
  is replaced by `awarded`.
- The mistake log (mistakes.js rowHtml) shows "Answer (2/3): …" from the stored response
  (excerpted, `.mk-reflect` styling) whenever one exists; nothing renders for records without
  one. `mistakes.js?v=3`.
- Bounds mirror the reflection precedent (write-side `.trim().slice(0, N)`): response ≤2000
  (worked solutions run longer than reflections), `awarded` is the raw mark.

### 2. Question-level hide — new synced key `q-hidden`
- Shape: `{ "<bankId#itemId>": { hidden: true|false, t, reason?, label? } }`; `label` is a
  bounded stem slice (≤120) captured at hide time so the restore panel renders without
  fetching banks; `reason` ≤200, both dropped when empty. **Restore writes an explicit
  `{hidden:false, t}` sentinel** (never a delete — the sync union would let another device's
  stale hide win) and drops reason/label: restore means gone.
- **Sync-safe by construction**: registered in `SYNCED_KEYS` + a `RECORDS["q-hidden"]` merge
  (per-entry newest-`t` wins, tie → server, union of keys, garbage dropped — the
  `topic-taught` pattern) + a backup.js SPEC shape validator. A stale client predating the key
  never touches it (sync iterates only its own key list; api.php preserves keys a payload
  omits), and old `q-errors` copies merge exactly as before.
- **Serving gates** (new pure module `assets/qhidden.js`, `NB.qhidden` = keyFor/hiddenIds/
  filterItems): both `bankItems` branches filter hidden items — covering normal sessions,
  Today/notes deep links (`startFromLink` counts them as "N hidden question(s) skipped.",
  including the every-id-hidden error message) and inline uploads; `today.js pickQuizIds`
  skips hidden ids (an all-hidden topic degrades to the whole-bank link, which then honestly
  starts nothing); **review paths stay unfiltered on purpose** — the mistake log, "Retry this
  question" and scheduled retests are history, governed by the record-level "not relevant"
  flag, not by this one. Bank-level `retired:true` semantics are untouched.
- **Cards**: `fcSaveFromQuiz` refuses a hidden question ("Hidden — not saved") and stamps
  `qkey` on every new from-quiz card; flashcards `rebuild()` suppresses `fc-user` cards whose
  `qkey` is currently hidden — cards made before hiding disappear while hidden and return on
  restore. Old cards without `qkey` always pass.
- **UI**: a "Hide question…" button in both after-answer action blocks (optional reason
  prompt, cancel-safe; the current session is unaffected — future builds only), and a
  "Hidden questions (N)" restore panel on quiz.html below the teaching-status panel (newest
  first, stored label + reason, Restore per row). Hide/restore go through `hideQuestion` /
  `restoreQuestion` (read-modify-write, `setTaughtOverride` pattern, exported for tests).
- Hide keys always come from the item's `errKey` when one exists (review items, including
  legacy/migrated records whose stored `id` is null and whose key carries the real id or a
  `stem-…` fallback) — `keyFor(bankId, null)` would write a dead `"<bankId>#"` key that gates
  nothing; the from-quiz card stamp (`qkey = errKeyFor(it)`) agrees with that choice.

## Data model changes & migration notes

- Additive only: optional `response`/`awarded` on `q-errors` records and `retries[]` entries;
  new synced key `q-hidden` (fresh — no legacy population, so no stale-key edge exists).
  Sync/restore semantics pinned by tests: record-level `response`/`awarded` ride the errRank
  winner like `userAnswer` (NOT fill-from-loser — the `retries[]` union already keeps both
  devices' per-attempt copies; the only lossy case is two devices writing the identical
  `(ts, correct)` pair in the same millisecond, where the winner's entry wins wholesale —
  documented and pinned). The errMerge fill list is untouched.
- Script versions bumped (cache-busting): `store.js?v=10→11` (all 22 referencing pages + the
  `tools/build_site.py` template), `quiz-engine.js?v=24` (quiz.html), `mistakes.js?v=3`,
  `flashcards.js?v=17` (cards.html), `today.js?v=8` (index.html), new `qhidden.js?v=1`
  (quiz/index/cards, loaded before each page's engine script).

## Files touched

- **New**: `assets/qhidden.js`, `tests/js/qhidden.test.js`, `tests/js/written-responses.test.js`,
  this changelog.
- **Modified (code)**: `assets/quiz-engine.js` (capture + threading + hide/restore + panel +
  gates + fc guard/stamp), `assets/mistakes.js` (Answer block + header docs), `assets/store.js`
  (SYNCED_KEYS + merge), `assets/backup.js` (SPEC), `assets/today.js`, `assets/flashcards.js`,
  `app/quiz.html`, `app/index.html`, `app/cards.html`, `tools/build_site.py` (+ the 22-page
  store.js cache-bust).
- **Modified (tests)**: `tests/js/quiz-picker.test.js` (boot element list gained `q-answer` —
  the written handler now reads it; no assertion weakened).
- **Modified (docs)**: `docs/DEVELOPMENT.md` (cache-bust rows, `q-hidden`/`q-errors` key rows),
  `docs/NEXT-STEPS.md`, `docs/ROADMAP.md`, `docs/HANDOFF.md`.

## Verification

- `./dev.sh test` — ALL TESTS PASSED: pytest **230** (incl. the byte-identical build_site
  regeneration proving the template bump), node **349**, php lint ok;
  `python3 -I tools/build_questions_manifest.py --check` exit 0.
- Independent review (read-only): no P0; verdict SHIP WITH FIXES — the legacy id-null review
  hide-key bug (P1), the review-hide test gap, a flake-prone 400 ms debounce wait (widened to
  ≥800 ms) and the all-hidden deep-link message were fixed before sign-off. Accepted as
  documented: `#`-less hand-edited keys restore as a no-op; the Today quizlog-source link
  relies on the deep-link filter (short session + honest notice, worst case); same-ms
  retry-entry collisions.
