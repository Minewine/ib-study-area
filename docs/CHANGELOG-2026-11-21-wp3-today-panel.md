# Changelog — 21 Nov 2026: work package 3 — Today panel: tiered suggestions

_Follows [WP2](CHANGELOG-2026-11-21-wp2-mistake-retries.md) on the same branch
(`feat/practice-mistakes-today`); not deployed. Goal: the phase-3 "Suggested next step" block
ranked due cards first and capped at two, so one big due pile crowded out everything else the
panel knows. It is now a tiered, three-slot ranking — imminent dates and unit closes first, then
work that is due, then optional enrichment — without changing any stored data shape._

## What changed

### The tiered ranking (assets/today.js)
- `suggestActions` is reworked from a 2-slot card-first list into a **tiered, 3-slot ranking**
  (`MAX_SUGGESTIONS = 3`; new `BREAK_LEAD_DAYS = 7` beside the existing lead-time constants).
  Output is strictly tier A → B → C and capped: a full tier A pushes lower priorities out.
- **Every suggestion must carry a title, a reason and at least one link** — a guarded `push`
  drops anything incomplete, so "no data behind it → no suggestion" holds per candidate; with
  zero candidates the whole block stays unrendered (pinned by a mutation-verified test).
- `suggestActions` stays pure and gained internal inputs — `breaks` (the class schedule's
  breaks), `nextUnits` (per-subject next units) and `enrich` (tier-C candidates, each carrying
  its subject for the profile check) — all computed in the render path where `DATA` lives. The
  function still touches nothing but its inputs.
- New pure helper **`nextUnits(schedule, subjects, today)`**, exported on `NB.today`: the next
  unit after today for each of the profile's subjects (the post-holiday planning input;
  `unitsFor` already skips malformed records, so a subject the schedule doesn't track yields
  nothing).

### Tier A — urgency and planning
- **The earliest near-term deadline** (≤ 21 days) — unchanged.
- **The earliest unit closing within 7 days** — now **always linkable**: a closing unit whose
  topic note yields no link falls back to `notes.html?subject=<subject>` instead of dropping
  linkless units.
- **Post-holiday planning**: today inside a scheduled break (the next unit then suggests however
  far out it is), or the next unit of a taken subject starting within `BREAK_LEAD_DAYS` — links
  the unit's first topic note or, without one, the subject's notes page.
- **Intent note (review P3-4):** the "Next unit" suggestion intentionally fires whenever the
  next unit of a taken subject starts within 7 days, not only during holidays — in the last
  week of every unit it shares the panel with "Unit closes this week" and can push due-card
  reminders past the 3-slot cap. Accepted: unit transitions are exactly when planning matters.

### Tier B — review that is due
- Due shared cards (the same counts as block 1, with the same deep link), **due-gated open
  mistakes** (the WP2 `dueAt` gate — not-yet-due records stay off the panel; legacy records
  without `dueAt` always show), and due own cards.

### Tier C — enrichment
- The weak-topic quiz and read-ahead candidates the render path passes in (`inp.enrich`), only
  filling the slots tiers A and B leave over.

### Guards and filtering (review hardening included)
- All new date fields are guarded with `isISO` — malformed records skip themselves and past
  dates never suggest.
- Profile `hides` + canonical-subject checks apply to every new source (unit closes, next
  units, enrichment candidates); subjectless unit rows are filtered out (review hardening); the
  two tier-A unit filters carry explicit subject-presence guards.

### Known limitation (pre-existing, same pattern as mistakes.js)
- `assets/notes.js` resolves `?subject=` strictly against the topic-notes manifest's key
  spelling, so a canonicalized fallback link (e.g. `notes.html?subject=math-aa-sl`) degrades to
  the notes index for maths subjects; manifest-spelled note links resolve correctly.

## Data model changes & migration notes

- **No stored data changed.** The rework is additive exports and internal function inputs only —
  no new store key, no new record field, no schema bump (`SCHEMA_VERSION` stays 1), no
  migration, no `assets/backup.js` SPEC change. The panel stays read-only (today.js never
  writes to storage).
- Script versions bumped (cache-busting): `today.js ?v=7` (app/index.html).

## Files touched

- **Modified (code)**: `assets/today.js` (tiered `suggestActions` with the guarded `push` and
  the new `breaks`/`nextUnits`/`enrich` inputs, `nextUnits` exported on `NB.today`,
  subject-presence guards, header comment), `app/index.html` (`today.js?v=7`).
- **Modified (tests)**: `tests/js/today.test.js` (old order/cap tests rewritten; new coverage —
  tier ordering + cap 3 with ≥4 candidates, post-break inside/outside a break + malformed
  breaks, hidden-subject exclusion per source, title/reason/link on every suggestion, past and
  malformed dates never suggest, closing-unit notes-page fallback, and a render-path test that
  the suggestions block is not rendered at all with zero candidates (mutation-verified) — the
  suite is now 33 today tests), `tests/e2e/e2e.js` (Today section rewritten: on the pinned date
  it asserts the tiered trio — Deadline ahead → Unit closes today → Next unit — with reason and
  href shapes; the seeded cards/mistakes remain asserted via panel blocks 1–2 and are
  legitimately ranked beyond the cap by the new tiering).
- **Modified (docs)**: this changelog and
  [CHANGELOG-2026-11-21-wp4-exam-reflections.md](CHANGELOG-2026-11-21-wp4-exam-reflections.md)
  (written in the same docs pass), `docs/HANDOFF.md`, `docs/NEXT-STEPS.md`, `docs/ROADMAP.md`,
  `README.md`, `docs/DEVELOPMENT.md`.

## Verification

- `./dev.sh validate` — ALL CHECKS PASSED (841 quiz items / 594 cards / 113 notes / 133
  coursework checks; pre-existing content WARNs only).
- `./dev.sh test` — pytest 230 passed; node **277** tests, 0 fail (WP2 baseline 269; +3 today
  tests); php lint ok; `node --check` on every `assets/*.js` clean.
- `./dev.sh e2e` — **39 checks pass** (same count as WP2 — the rewritten Today section reworked
  existing checks rather than adding new ones).
- Post-review rerun (after the hardening fixes): 277/277 node tests + 39/39 e2e again.
