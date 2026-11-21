# Changelog — 21 Nov 2026: difficulty defaults + AI suggestions + first Maths tagging batch

_On the same day as the study-loop batch; works on top of the uncommitted WP2 tree. Goal: make
the existing difficulty axis actually useful — a Maths session should stay on easier, taught
material with no manual exclusion — by preferring rated questions in the picker default, having
the AI generator propose (never assign) difficulties, and tagging a first, reviewable batch of
Maths questions. Data changes are additive only: optional per-item `difficulty` in three bank
files, nothing else; no schema bump, no stored-data migration._

## What changed

### Sessions prefer rated Foundation + Core (assets/quiz-engine.js, app/quiz.html)
- New pure **`pickSessionItems(items, {dmin, dmax, format, n, fillUnrated})`** (exported on
  `window.NB.quizEngine`): format-filter, split into a rated pool (passing `difficultyPass`) and
  an unrated top-up pool (deduped when the range already starts at Unrated), shuffles both, and
  serves `rated.concat(topUp).slice(0, n)` — **hard/out-of-range items never top up**. Returns
  `{use, ratedCount, unratedCount}` counted over the served session.
- **`startSession` defaults changed**: difficulty range `easy→standard` (was `unrated→hard`),
  plus a new **"Top up with unrated questions when rated ones run short"** checkbox
  (`q-diff-fill`, checked by default). The session notice discloses the mix ("N of M from rated
  questions; K unrated added to fill the session."); the empty-state message only suggests
  switching the top-up on when it is actually off. `migrateErrorKeys` still runs over the full
  fetched list before selection.
- Picker labels are now **Foundation (easy) / Core (standard) / Stretch (hard)** (stored values
  unchanged); `quiz-engine.js?v=23`.
- Deliberately untouched: `startFromLink` (Today/topic-note deep links), `startFromErrKeys` /
  `startReview` (Mistakes flows) — they bypass bank filters on purpose and are pinned by tests.
- Design note: rated questions lead and unrated fillers cluster at the end of a short-rated
  session (disclosed by the notice) — reviewable, not hidden. Subjects with no rated questions
  (Biology, Chemistry today) behave exactly as before via the top-up.

### AI-generated questions carry a *suggested* difficulty, unreviewed until applied
- `library/ai-prompts.json` `bankgen` mode (and its sibling `docs/QUIZ-GENERATION-PROMPT.md`
  template): exemplar items carry `"suggestedDifficulty"` and a rule defines the scale (easy =
  single-step recall/direct substitution; standard = typical exam-style multi-step; hard =
  extended, multi-step or multi-topic) and says the suggestions stay unreviewed until the
  student checks and applies them.
- `assets/bank-import.js`: pure `suggestionFor` / `applySuggestion` / `applyAllSuggestions`
  (validate-then-commit like `editItem`); **`finalize` strips any residual `suggestedDifficulty`**
  — a stored bank can never carry an unreviewed suggestion, and hand-authored `difficulty`
  survives untouched. `bank-import.js?v=2` (app/author.html).
- Upload preview (app/author.html): rows show "AI suggested: Core (standard) — unreviewed" with
  per-item **Apply** plus **"Apply all suggestions (N)"**; importing with suggestions left
  unapplied asks for confirmation (they would be discarded), and the row copy says so.
- The picker-side UI wording is Foundation/Core/Stretch; stored values stay
  `easy|standard|hard` throughout (schema, validators, manifest) — display-only relabelling.

### First tagged batch: Maths AA SL, currently-taught units (78 items)
Chosen from `library/class-schedule.json` (what has actually finished teaching by 2026-11-21:
Functions & quadratics through 16 Oct, Differentiation through 20 Nov; circular trig starts
24 Nov — left for the next batch, as are Number & algebra, Statistics and the course-calendar
bank):

| Bank | easy | standard | hard | unrated |
|---|---|---|---|---|
| `math-aa-functions-2-1-to-2-3.json` (35) | 28 | 7 | 0 | 0 |
| `math-functions-2-4-to-2-5.json` (21 active) | 17 | 4 | 0 | 0 |
| `math-aa-topic5-calculus.json` (22) | 9 | 12 | 1 | 0 |
| **Total** | **54** | **23** | **1** | **0** |

Rubric: **easy** = single-step recall or direct substitution; **standard** = typical exam-style
multi-step on one standard technique; **hard** = extended/multi-part synthesis, multi-topic, or
optimisation/modeling from a wordy context; leave unrated over force a label; never tag retired
items (retired `tf16` stayed untouched). Spot-checks: `f11` vertex read-off (easy), `f14`
k-for-equal-roots discriminant (standard), `tf15` quadratic inequality (standard), `c508` chain
rule on (2x+1)⁵ (standard), `c521` 6-mark river-fencing optimisation (hard). Distribution is
honest rather than forced: the Functions banks are early-DP1 drill, so easy-heavy is defensible
(independently audited item-by-item). `tools/build_questions_manifest.py` regenerated the
histograms; `tools/validate_content.py` passes.

## Data model changes & migration notes

- Additive only: optional item-level `difficulty` in three library bank files; `manifest.json`
  regenerated (histograms are computed). The field and vocabulary already existed — no schema,
  validator or store changes; `suggestedDifficulty` exists only in staging and is stripped at
  finalize, so stored banks (`q-userbanks`) and library files never see it.
- Script versions bumped (cache-busting): `quiz-engine.js ?v=23` (app/quiz.html),
  `bank-import.js ?v=2` (app/author.html). No other pages reference these engines.

## Files touched

- **Modified (code)**: `assets/quiz-engine.js` (`pickSessionItems` + `effDifficulty`, rewritten
  `startSession` selection/notices/empty-state, exports), `app/quiz.html` (labels, defaults,
  `q-diff-fill`, `?v=23`), `assets/bank-import.js` (suggestion helpers, finalize strip, exports),
  `app/author.html` (suggestion chip + Apply / Apply-all + import confirmation, `?v=2`).
- **Modified (content/prompt)**: `library/ai-prompts.json` (bankgen), `docs/QUIZ-GENERATION-PROMPT.md`
  (template + post-generation step), `library/questions/math-aa-functions-2-1-to-2-3.json`,
  `library/questions/math-functions-2-4-to-2-5.json`, `library/questions/math-aa-topic5-calculus.json`,
  regenerated `library/questions/manifest.json`.
- **Modified (tests)**: `tests/js/quiz-picker.test.js` (pickSessionItems behaviour + real-data
  acceptance test: a default-options session over the tagged Functions bank is 100% rated
  easy/standard), `tests/js/bank-import.test.js` (suggestion apply/strip/rollback),
  `tests/js/ai-prompt.test.js` (bankgen wording), `tests/e2e/e2e.js` (bankgen prompt assertions).
- **Modified (docs)**: this changelog, `docs/DEVELOPMENT.md`, `docs/AUTHORING.md`,
  `docs/NEXT-STEPS.md`, `docs/ROADMAP.md`, `docs/HANDOFF.md`.

## Verification

- `./dev.sh test` — ALL TESTS PASSED: pytest **230**, node **295**, php lint ok
  (`python3 -I tools/build_questions_manifest.py --check` exit 0).
- Independent review (read-only): no P0; the import-discards-unapplied-suggestions gap, the
  empty-state top-up hint and a stale cache-bust table were fixed before review sign-off
  (SHIP WITH FIXES → addressed). Follow-ups noted: interleaving unrated fillers instead of
  trailing them; automated coverage for the author.html wiring (e2e extension).
