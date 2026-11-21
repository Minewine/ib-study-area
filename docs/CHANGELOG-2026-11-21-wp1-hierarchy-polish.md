# Changelog — 21 Nov 2026: work package 1 — hierarchy polish (repeated uploads + not-yet-taught topics)

_Polish pass on top of the 20 Nov phase-1 practice-set hierarchy (see
[CHANGELOG-2026-11-20-neva-feedback.md](CHANGELOG-2026-11-20-neva-feedback.md)). Goal: make the
Subject → syllabus topic → named practice set hierarchy work for **repeated uploads** into the same
topic, and for **Maths topics she has not learned yet** (where the class schedule can't suggest a
teaching status). Built on `feat/practice-mistakes-today`; not deployed._

## What changed

### Three-state teaching status (was: taught / not-yet only)
- The Quiz page's "Topics & teaching status" panel now offers **Auto / Not yet / Learning /
  Ready to revise**. The stored record gains an optional additive `status`
  (`"not-taught" | "learning" | "ready"`); `taught` stays consistent with it, so the previously
  deployed client (which only reads the bool) keeps showing the same thing.
- `taughtState` resolves a consistent stored status as the topic's state (source "you"); a legacy
  bool-only record reads as `ready` when true (the old "Taught" meaning), `not-taught` when false;
  an invalid or contradictory status falls back to the bool. Schedule-derived topics stay
  two-state (taught / not-taught) with source "schedule".
- **Taught-topics-only excludes only "not yet taught"** — learning and ready-to-revise topics are
  included, as are unknown ones (unchanged). An explicitly picked topic is still kept regardless
  of the toggle.
- Topic options in the picker carry the status suffix: `· taught` (schedule), `· not yet taught`,
  `· learning`, `· ready to revise`.
- Sync merge (`NB.merge.RECORDS["topic-taught"]`): still newest-`t` per topic, plus a field-aware
  carry-over — when the newest record has **no** status (written by an old client) and the older
  one has a valid status consistent with the winner's `taught`, the status survives (an old client
  must not erase a learning/ready mark; same pattern as the `q-errors` field-aware merge). A
  contradictory or garbage status is dropped. The backup validator accepts the optional status.
- Maths is the driver: many maths topics have no class-schedule coverage (state "unknown"), so she
  can now mark them explicitly — including "not yet taught", which the taught-only filter honours.

### Stable set names + order for repeated uploads
- New pure helper `nextSetOrder(banks, subject, topic)` in `assets/bank-schema.js` (one past the
  largest integer `setOrder` stamped in the same subject + effective topic).
- The Upload page (both paths: pasted/file JSON **and** the AI-preview import) now stamps every
  new bank, before it is stored: `setOrder` = next per-topic number, and — only when the display
  name (`set || label`) would collide with an existing set in the same topic — a unique
  `set` name via `nextSetName` (e.g. `— named "Practice set 1" because a set called
  "Photosynthesis" already exists in this topic`). A meaningful, already-unique label is kept.
- **Already-stored banks are never rewritten.** Legacy duplicates that already share a name are
  disambiguated display-only in the picker (`disambiguateSetNames`): tied sets get their stored
  bank name (uploads), file stem (seeded banks) or upload date as a suffix, with a positional
  `N (set k)` last resort that can never collide with another set's literal name.

### Paper 1A/1B practice made scannable in the topic list
- A topic whose sets are **all** Paper-style gets a `· Paper 1A practice` / `· Paper 1B practice`
  suffix in the topic dropdown (skipped when the topic's label already says "Paper"); the
  per-set badges from phase 1 are unchanged. Mixed topics get no suffix.

### Unrated questions stay identifiable (no invented labels)
- Per-set difficulty histograms are now part of the picker model (from the manifest's per-topic
  histograms for seeded banks, from the item aggregate for uploads).
- Topic and set rows show `· N unrated` whenever a histogram has unrated questions — with today's
  content that is every row, honestly signalling that ratings don't exist yet rather than hiding
  the fact. The engine still never derives a difficulty label; a literal `"unrated"` stays a
  validator FAIL (absence means unrated). Default filter range remains Unrated–Hard, so nothing
  is silently dropped.

## Data model changes & migration notes

- **No schema bump, no migrations** (`SCHEMA_VERSION` stays 1); additive optional fields only.
  - `topic-taught` records: optional `status` (`"not-taught"|"learning"|"ready"`); `taught` remains
    the compatibility field and is kept consistent on every write path. Old records, old clients
    and older backups stay valid; `assets/backup.js` SPEC accepts the optional status (bogus
    statuses are dropped with a warning on restore).
  - `q-userbanks` entries: `set`/`setOrder` may now be **stamped at upload time** (they were
    schema-valid but unused before). Nothing existing is stamped, renamed or rewritten.
- Per-item progress needs no change: `q-errors` keys stay `<bankId>#<itemId>` with bank ids
  `ub-…` per upload, so **two sets sharing a topic and repeated item ids keep separate progress**
  (regression-tested at engine level; this was already true of phase 1 — the test pins it).
- Sync/server: no `server/api.php` change (per-key merge is client-side; the server blob preserves
  unknown keys). Status carry-over, pinned by tests: when a **pre-3-state client's** bool-only
  `{taught, t: newer}` record wins the newest-`t` merge, a valid status consistent with its bool
  is carried over from the older record — an old client cannot erase a learning/ready mark
  (`taughtStatusFill`); a contradictory or garbage status is dropped.
- Script versions bumped (cache-busting): `quiz-engine.js ?v=21` (app/quiz.html),
  `bank-schema.js ?v=2` (quiz + author), `store.js ?v=9` (23 pages + `tools/build_site.py`
  template — the byte-identical page-regeneration test forces the template bump),
  `backup.js ?v=7` (cards + author; caught by the review pass — its SPEC changed).

## Files touched

- **Modified (code)**: `assets/quiz-engine.js` (taughtState/setTaughtOverride/panel/fillTopics/
  syncSetSelect/buildTopics + new pure helpers `disambiguateSetNames`, `unratedSuffix`,
  `paperTopicSuffix`; all exported for tests), `assets/store.js` (topic-taught status carry-over),
  `assets/bank-schema.js` (`nextSetOrder`), `assets/backup.js` (SPEC),
  `app/author.html` (`stampSetMeta` on both upload paths), `app/quiz.html` (panel copy),
  23 pages + `tools/build_site.py` (`store.js?v=9` regeneration).
- **Modified (tests)**: `tests/js/quiz-picker.test.js` (three-state wiring + suffixes, legacy
  pre-selection, corrupt-map boot, per-set histograms, `paperOnly`, disambiguation incl.
  literal-name collision, `nextSetOrder` contract via bank-schema tests, **same-ids/two-banks
  progress separation**, legacy no-id bank), `tests/js/taught.test.js` (merge status carry-over,
  backup round-trip), `tests/js/bank-schema.test.js`, `tests/e2e/e2e.js` (new section 9:
  uploaded-bank counts + unrated suffix, learning override persistence, taught-only exclusion).
- **Modified (docs)**: this changelog, `docs/DEVELOPMENT.md`, `docs/NEXT-STEPS.md`,
  `docs/HANDOFF.md`, `README.md`.

## Verification

- `./dev.sh validate` — green (pre-existing content WARNs only).
- `./dev.sh test` — pytest 230 passed; node **242** tests, 0 fail; php lint ok.
- `./dev.sh e2e` — **36 checks pass** (33 pre-existing + 3 new picker/teaching-status checks;
  closes the "no e2e for phase-1 picker controls" gap from the 20 Nov changelog).
- Browser smoke pass on the local dev server (logged-in dev account), covering the acceptance
  criteria end-to-end: two 2-item MCQ banks uploaded into one maths topic via the paste+preview
  flow — the second auto-named `Practice set 1` (`— named "Practice set 1" because a set called
  "Smoke topic" already exists in this topic · set order 2`); the picker shows `Smoke topic · 4 Qs
  · 4 unrated` with sets `Smoke topic · 2 Qs` and `Practice set 1 · 2 Qs`; answering every question
  wrongly in both sets produced **four separate `q-errors` records** (`ub-<id-a>#m01/m02`,
  `ub-<id-b>#m01/m02` — same item ids, no collision); marking the topic **Not yet** stored
  `{taught: false, status: "not-taught", t}` and the taught-only Mixed session served only
  other topics' questions; switching to **Learning** stored `{taught: true, status: "learning", t}`
  and the option suffix became `· learning`.
- Independent review pass (read-only) found no P0/P1; its P2 (the missed `backup.js ?v=7` bump)
  and P3s (stale panel comment, disambiguation literal-name collision, comment wording) are fixed
  in this batch.
