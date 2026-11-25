# 2026-11-25 — calibration card, weekly print sheet, notes → exam-bank links

Three small read-only additions from VISION.md's near-term list (effort S each). No
stored-data change: everything reads existing synced keys (`quizlog`, `q-errors`,
`fc-state`, `fc-deleted`, `fc-user`) and existing manifests; no schema bump, no
migration, no server change.

- **Calibration card** (`assets/calib.js?v=1`, `NB.calib`, on `app/index.html` below
  Today). `summarize(quizlog)` aggregates the per-session `conf` tally that
  `assets/confidence.js` already writes: how often "I'm sure" vs "I'm guessing"
  answers were actually right, overall (bar rows), per subject (up to 3), and across
  the last 5 rated sessions. Sessions from before ratings existed (no `conf`) count
  only toward the session total; subjects hidden by the account profile are dropped.
  Re-renders on `quizlog` changes (sync / other tab). Empty state explains the
  sure/guessing rating buttons on the Quiz page.
- **Printable weekly retrieval sheet** (`assets/sheet.js?v=1`, `NB.sheet`, button in
  the Today card on `app/index.html`). Builds one printable page: up to 10 questions
  to answer on paper — up to 6 due missed questions first (the `q-errors` record
  already carries stem/choices/answer/markscheme, so no bank fetches), then due
  flashcards (decks fetched lazily, hidden subjects skipped, deleted/retired cards
  excluded) — with an answer key on a second page (`break-before: page`). Print CSS
  hides everything except the sheet (`body.sheet-printing`). "Nothing due" shows an
  explanatory message instead of an empty sheet.
- **Notes → exam-style bank links** (`assets/notes.js?v=6`): each topic note now shows
  "Exam-style practice" mini-links to question banks whose `codes` include the note's
  syllabus code and that carry `paperStyle` (1A/1B) or a data-response label — e.g.
  S1.1 links `chem-p1a-structure-1`, `chem-p1b-data-practice`, the S1.1 exam bank;
  A1.1 links `bio-data-response-unfamiliar`. 75 of 113 notes get links. The questions
  manifest is fetched with a 10 s timeout and is strictly optional — a missing or
  slow manifest just means no extra links. Links use the existing `quiz.html?from=`
  deep-link format.

Tests: `tests/js/calib.test.js` (5) + `tests/js/weekly-sheet.test.js` (4) cover the
pure selectors/aggregators, incl. legacy records without `conf`/`dueAt`, hidden
subjects, deleted/retired cards and the cap composition. Gates: `./dev.sh validate`,
`./dev.sh test` (pytest + node --test + php -l + node --check), green.

Deploy note: `calib.js`/`sheet.js` are new asset files — `build_deploy.py` copies
`assets/` wholesale, and `app/index.html` is already in its PAGES list, so a normal
`./dev.sh deploy` picks everything up. Bump noted in DEVELOPMENT.md (`notes.js` now
`?v=6`).
