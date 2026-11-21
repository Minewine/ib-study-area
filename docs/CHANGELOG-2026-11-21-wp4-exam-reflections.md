# Changelog — 21 Nov 2026: work package 4 — exam reflections: by-topic summary + trends

_Follows [WP3](CHANGELOG-2026-11-21-wp3-today-panel.md) on the same branch
(`feat/practice-mistakes-today`); not deployed. Goal: the past-paper log on the Quiz page
already stores everything a reflection needs in one record — score, max, paper, date,
teacher/self source, topic and the reflection itself — but only ever showed the raw rows. WP4
adds the aggregation layer: where do the marks actually come from, per subject and per topic._

## What changed

### Data layer unchanged by design (assets/papers.js)
- `pp-scores` already keeps score, max, paper, date, teacher/self source, topic and the
  reflection (notes) in one record; scoreless topic reflections were already saved. WP4 adds
  **only the aggregation layer** — no write path, validator or merge rule is touched.

### New pure helpers (assets/papers.js, additive)
- **`topicSummary(records)`** (exported on `NB.papers`): groups the records by subject + topic;
  topicless records fall into the subject's **"(whole paper)"** group; rows sorted subject →
  topic. Each row is `{subject, label, topic, topicLabel, scored, reflections,
  latest {score, max, pct, date} | null, points}` — `points` is the ascending-by-date,
  scored-only chain, capped at the last 5. A scoreless-only group **never invents a
  denominator**: `latest` stays `null` and `points` stays empty.
- **`subjectTrend(records)`**: the same ascending scored chain (capped at 5) for the whole
  subject.
- Both helpers self-filter tombstoned and malformed rows (`!r.deleted && r.id`) — reviewer
  hardening.

### Render additions (assets/papers.js, inside #pp-panel)
- A **"Score trend"** list: one line per subject with scored points, each point rendered
  `score/max (pct%) on D Mon`, joined with arrows.
- A **"By topic"** table: Subject | Topic | Scored | Reflections | Latest | Trend; scoreless
  rows show "—". Both blocks are hidden when there is nothing to show (no records / no scored
  points).
- **Denominator always visible:** every displayed score is `score/max (pct%)`, matching the
  records table.

### Separation invariant kept
- `papers.js` never reads `quizlog`: practice-quiz sessions stay in quiz history only (pinned
  by a new test that seeds `quizlog` and asserts the summaries are unchanged). The parent
  summary page (`server/summary.php`) remains quizlog-only by design.

### Hardening (review pass)
- The scored predicates require `max > 0` in all three helpers (including the pre-existing
  `summary()`), so corrupt synced data can't render "5/0 (0%)".

## Data model changes & migration notes

- **No schema change, no migration** (`SCHEMA_VERSION` stays 1): no new store key, no
  `pp-scores` record shape change, no `assets/backup.js` SPEC change. The two helpers are
  additive exports; the render blocks read the same records as before.
- Script versions bumped (cache-busting): `papers.js ?v=3` (app/quiz.html).

## Files touched

- **Modified (code)**: `assets/papers.js` (`topicSummary`/`subjectTrend` exported on
  `NB.papers`, "Score trend" + "By topic" render blocks, `max > 0` scored predicates incl. the
  pre-existing `summary()`), `app/quiz.html` (`papers.js?v=3`).
- **Modified (tests)**: `tests/js/papers.test.js` (5 new tests, tests 8–12: `topicSummary`
  grouping/sort/scoreless-only, per-point denominators + cap-at-5, `subjectTrend`, the quizlog
  no-mix guard, render smoke — trend + by-topic carry score/max denominators, hidden when
  empty — suite now 12 papers tests).
- **Modified (docs)**: this changelog and
  [CHANGELOG-2026-11-21-wp3-today-panel.md](CHANGELOG-2026-11-21-wp3-today-panel.md) (written
  in the same docs pass), `docs/HANDOFF.md`, `docs/NEXT-STEPS.md`, `docs/ROADMAP.md`,
  `README.md`, `docs/DEVELOPMENT.md`.

## Verification

- `./dev.sh validate` — ALL CHECKS PASSED (841 quiz items / 594 cards / 113 notes / 133
  coursework checks; pre-existing content WARNs only).
- `./dev.sh test` — pytest 230 passed; node **277** tests, 0 fail (WP2 baseline 269; +5 papers
  tests, 7 → 12); php lint ok; `node --check` on every `assets/*.js` clean.
- `./dev.sh e2e` — **39 checks pass**.
- Post-review rerun (after the hardening fixes): 277/277 node tests + 39/39 e2e again.
