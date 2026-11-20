# Next steps (prioritised)

_Updated 20 Nov 2026. Background: [HANDOFF.md](HANDOFF.md). Longer-term ideas: [VISION.md](VISION.md)._

## Status at a glance
- **Phase 0 complete (20 Nov 2026):** pre-improvement review of the existing app before the flashcard/quiz
  organisation work. Verified: the live site (rametric.com/nevaib) matches `main` byte-for-byte (209 files;
  the only difference is the not-yet-deployed favicon commit). Today panel: adds a 10 s fetch timeout plus
  clear error states — a failed class-schedule/deck/notes load no longer masquerades as an empty panel, and a
  hung fetch or failed script can no longer leave it on "Loading…" indefinitely. Fixed while checking the
  existing features: **dark mode never applied** (attribute mismatch — CSS looked for `data-fcTheme`, JS wrote
  `data-fc-theme`); the Cards editor's deck dropdown didn't re-render the card list on change and forgot the
  selection after saves; new cards always landed in the first deck's topic; uploaded-deck cards were edited/
  deleted as hidden overrides instead of updating the deck itself; quiz uploads left the manage list stale;
  storage-full writes reported success; and the deck-id collision check was silently broken on `/app/` pages
  (wrong fetch path, then cached forever). See [HANDOFF.md](HANDOFF.md) for the full list.
- **Upload limit measured (20 Nov 2026):** there is **no question-count or file-size cap** anywhere in the
  author/editor code or validation — the "8 questions" in [USER-TEST.md](USER-TEST.md) is only the example
  size in the AI-generation prompt (`tools/validate_content.py`'s `MIN_MCQ_FOR_CUE_CHECK = 8` is a pre-commit
  quality heuristic, not an import cap). Measured on a logged-in dev account (Chrome): 300 items (49 KB)
  import in ~0.15 s, 5,000 (0.77 MB) in ~0.9 s; 20,000 (~3 MB) and 40,000 (~6 MB) also import. The real
  ceiling is the browser's localStorage quota, which now reports as a clear error on the Upload page.
  Kept: malformed-JSON, duplicate-id and per-item validation. Caveat: a ~6 MB user-state file can make the
  sync push sluggish on the next load (seen once with the 40k-item test bank) — not a concern at realistic sizes.
- **Next focus (20 Nov 2026):** flashcard/quiz **organisation improvements based on student feedback** —
  folders/practice sets, a mistake log, filtering maths items, card editing, and Today-panel suggestions
  (the "higher upload limits" item is resolved: there is no cap — see the measured behaviour above).
  This takes priority over new content batches for now.
- **Done and live (18 Nov morning):** PRs #1–#4.
- **Done and live (deployed 19 Nov evening):** PRs #1–#16 (topic notes, sync, Today panel, security hardening, weekly summary, exam practice, coursework planner, My resources, Ask an AI). `./dev.sh validate`, `./dev.sh test` and `./dev.sh e2e` pass on `main`.
- **Done, merged into `main` (Nov 2026), included in the later deploy:** the private cross-check of 25 topic notes and **My resources** on every note (PR #14).
- **Ask an AI (PRs #15, #16; hardened 19 Nov):** merged into `main` — copies a pre-formatted prompt synchronously, then opens the preferred assistant so she pastes with Ctrl+V; a **Copy the prompt again** button recovers a failed copy or blocked tab. Edit prompts, modes, assistants and `subjectNames` in `library/ai-prompts.json` (placeholders are listed in `_doc`); no code change needed for wording. After editing, run `./dev.sh test`. See [HANDOFF.md](HANDOFF.md).
- **Multi-user: done and live (deployed 19 Nov evening, PRs #17–#19):** per-student accounts with isolated data (per-user storage scopes), subject profiles filtering nav/quiz/cards/notes/library/coursework/deadlines, and the **admin** account (`admin` — password held by the family; there is no password-change feature). Students are created via the admin on the study site's `admin.html`, or via the API (see `server/deploy-notes.md`). Neva's login is unchanged and sees all subjects. Details in [HANDOFF.md](HANDOFF.md).

## 1. Deploy `main` (only with explicit approval)
1. **Back up first:** the server copy via `api/api.php?action=export` (logged in), and her browser progress with Cards → "Download full backup".
2. `git switch main && git pull && ./dev.sh test && ./dev.sh deploy`. This is a dry run: check the list includes `api/api.php`, `api/summary.php`, `api/weekly_email.php`, `coursework.html`, `summary.html`, and no PDFs or private folders.
3. `./dev.sh deploy --confirm`, then type DEPLOY. `api/api.php` goes first.
4. Hard-refresh (Ctrl+Shift+R) on every device she uses: the new API only accepts the token in a header, so an old cached page may need to log in again. Script versions are bumped so fresh pages load the new code.
5. Check: log in, do a few cards and a quiz, open Coursework and the Weekly summary, then save a fresh `?action=export` backup.
5. ~~**Multi-user bootstrap (once, after the deploy)**~~ — ✅ done (19 Nov): the admin account exists, the setup key was blanked again and `action=setup` is verified locked. To add a student: log in as admin on the study site's `admin.html` (local/LAN), or ask for the `create-user` curl recipe. Neva's account needed no changes: no profile key means "all subjects", and her local data is adopted into her scope automatically on her first login after the upgrade.
6. **Optional:** `~/nevaib-data/config.json` (outside `public_html`) for the weekly e-mail and a separate parent login, plus a cPanel cron job. Recipe in `server/deploy-notes.md`, "Parent weekly summary". Without it the summary page works with her own login.

## 2. Privacy
- **Make the GitHub repo private.** Re-flagged 20 Nov 2026: the repo is **still public** and shows the school, year group, IA notes and the hosting layout. (Visibility not changed without an explicit ask.)
- Don't run the old `python3 -m http.server --bind 0.0.0.0`. Use `./dev.sh start` (local only) or `./dev.sh start --lan` (serves only the built copy).

## 3. Open questions for the student
- **Stray `nevac` account** (from the first setup, likely a typo of `neva`): harmless and empty, but there is no delete-account API — remove it by editing `~/nevaib-data/users.json` on the host if you want it gone.
- **Biology IA experiment day:** group 1 (15 Jun 2027) or group 2 (17 Jun 2027)? Set it in the coursework planner.
- **Maths exploration:** does the teacher give a page length?
- **Class schedule:** do the "This week in class" units match her lessons (Biology, Chemistry, Maths)? Edit `library/class-schedule.json`.
- **Possible one-day-off dates** in `assets/deadlines.js`: EE proposal (file says 2 Mar 2027, may be 3 Mar) and TOK exhibition final (file says 16 Jun 2027, may be 15 Jun). Confirm against the school calendar.
- **Year 13 (2027–28) schedule** once the school publishes it.
- **Maths topics with no quiz items:** 1.6 (proof), 4.5, 4.7, 4.10.
- **Notes not yet linked** to the new exam banks (`chem-p1a-*`, `chem-p1b-*`, `bio-data-response-unfamiliar`, `ia-practical-skills`).
- **Teacher check:** the draft notes, including the cross-check additions (key ideas with ids like `s13-x1`), (all `status: "draft"`) and the questions that depend on data-booklet values.
- **Weekly e-mail:** wanted or not (optional config above).

## 4. Content decisions (you)
- 28 near-duplicate question pairs: keep or remove (list in PR #1).
- Whether to keep the Maths course-calendar quiz.

## 5. Content fixes
Done in the `fix/content-corrections` PR (Nov 2026):
- [x] **Chemistry bond energies** now match the v1.1 data booklet, with answers recomputed: `periodicity-energetics-review-11` (C–H 414, C=O 804, O=O 498 → −808 kJ mol⁻¹), `review-22` (C–H 414 → −124 kJ mol⁻¹), `review-12` (ΔHf(CH₄) −74 → −892 kJ mol⁻¹).
- [x] **"Half-filled stability" wording** replaced with the pairing-repulsion explanation in `fc-chem-p-09`, `p21`, `review-21` (also the Hund's-rule note in the Structure 3.1 bank and the Cr note in `review-03`).
- [x] **Off-syllabus Maths items** are now `"retired": true` (with a `retiredReason`). They stay in their files so ids and progress remain valid, but new quiz and card sessions skip them: m03, mnx6, fc-math-n-07, fc-math-st-05 (AI percentage error); s413 (AHL 1.10 counting), tf16, fc-math-tf-13 (AHL 2.14 odd/even).
- [x] **tf07** reads "horizontal stretch with scale factor ½".
- [x] **`wp01`**: left as it is on purpose. Progress is keyed `bank#id`, so the two `wp01` items no longer collide; renaming one would orphan any existing q-errors record. The validator warning stays.

Still open:
- **Maths checklist:** `math-aa-sl.html` uses textbook numbering, not IB numbering. Rebuild it from `library/syllabus/maths-aa-sl.json`.
- Missed-question review uses the copy saved when the question was missed, so an old miss of a corrected or retired item still shows its old text until it's answered correctly.

## 6. Fill the practice gaps the notes exposed
- ~~Flashcards for **B2.1–B2.3**~~ Done (Nov 2026): 52 cards in `bio-b2-1/2/3-*.json`, linked from the notes.
- ~~Questions for **Chemistry S1.1**~~ Cards done (Nov 2026): 18 in `chem-s1-1-particulate-nature.json`. Questions: 8 calculator-free S1.1 items in `chem-p1a-structure-1` and one data item in `chem-p1b-data-practice` (PR #11).
- ~~Turn the Chemistry Paper 1A prompts into quiz items~~ Done in PR #11: four calculator-free `chem-p1a-*` banks, plus Paper 1B-style banks `chem-p1b-data-practice` and `chem-p1b-experimental-skills`, and the Biology `bio-data-response-unfamiliar` bank. Topic notes don't link to these banks yet.
- The 15 Biology topics with no questions or cards (mostly DP2): see the Biology notes Page.
- Maths: AA papers have no multiple choice, so convert the mostly-MCQ maths banks to typed answers (roadmap H9).

## 7. Notes still to write
- ~~**Maths AA SL: 27 subtopics remain**~~ Done (Nov 2026): all 51 SL subtopics now have draft notes. Have her teacher check them before each unit. Still missing practice items for 1.6 (proof), 4.5, 4.7 and 4.10 (see each note's `links.gap`).
- **History, English, French:** later. Waiting on ISL's History topics and case studies and the English and French work lists.
- Have teachers check the flagged details: Biology statins and voltage-gated channels; local case studies; Chemistry codes, once the official guide is supplied (`syllabusFlags`).

## 8. Remaining technical roadmap (audit Page)
- **H4–H9** from the technical audit:
  - spaced retests of missed questions at 7 and 30 days;
  - exam-style timed practice (untimed Paper 1A/1B-style banks done in PR #11);
  - ~~progress reporting~~ (parent weekly summary, PR #10);
  - typed maths answers (H9);
  - and the rest as listed there.
- ~~**Security:** CSRF protection, session hardening, brute-force limits~~ Done in PR #9 (see `server/deploy-notes.md`). Still open: the missed-question list in the local study site's `practice.html` builds `innerHTML` without escaping (local-only page, not deployed); an optional `.htaccess` with security headers for static files (test on the host first).
- **Known sync limits:** if two devices edit the same list blob, the last one wins (the server history keeps the other version). A device's first sync after the upgrade unions both sides, so an item deleted elsewhere can come back once.

## 9. "Today" panel (practice home page)
- Built in PR #8: due cards, a 6-question quiz on the weakest topic, and this week's class units from `library/class-schedule.json`.
- **Check the schedule with her once a month.** The dates are estimates made from the ISL course calendars, and editing them is one JSON line per unit.
- Add the **Year 13 (2027-28)** units once ISL publishes the DP2 calendars (the current Maths one is based on an older year).

## 10. Coursework planner, exam practice, weekly summary (PRs #10–#12)
- Coursework dates are approximate; check them against the school calendar each term.
- Past-paper scores are logged by her on the Quiz page; nothing from the papers is stored.
- Weekly summary minutes are an estimate (the app doesn't time sessions).
