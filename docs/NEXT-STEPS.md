# Next steps (prioritised)

_18 Nov 2026. Background: [HANDOFF.md](HANDOFF.md)._

## 1. Merge (you, on GitHub)
Merge **PR #1 → PR #2 → PR #3**, in that order (each one builds on the previous). CI runs on every PR; only merge when it's green. Then run `git switch main && git pull` on the laptop.

## 2. Deploy (only with explicit approval)
1. **Back up the host first**: `~/nevaib-data/`, using the recipe in `server/deploy-notes.md`. Also save her browser progress with Cards → "Download full backup".
2. `./dev.sh test && ./dev.sh deploy`. This is a dry run, so check the file list.
3. Upload **`api/api.php` first**, or in the same run. The new API accepts old clients, and the new pages also work with the old API.
4. Then upload the pages, assets and content: `./dev.sh deploy --confirm`, then type DEPLOY.
5. Check https://rametric.com/nevaib/: log in, do a few cards, then open `api/api.php?action=export`.
6. Existing server data needs no migration. Old state files are read as revision 0, and the first save creates `rev` and `state/history/`.

## 3. Privacy
- **Make the GitHub repo private.** Today it publicly shows her school, year group, IA notes and the hosting layout.
- Don't run the old `python3 -m http.server --bind 0.0.0.0`. Use `./dev.sh start` (local only) or `./dev.sh start --lan` (serves only the built copy).

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
- Questions for **Chemistry S1.1** (her first topic has none). Cards done (Nov 2026): 18 in `chem-s1-1-particulate-nature.json`.
- Turn the **Chemistry Paper 1A prompts** in the notes (`paper1A`, about 81) into quiz items in a calculator-free bank.
- The 15 Biology topics with no questions or cards (mostly DP2): see the Biology notes Page.
- Maths: AA papers have no multiple choice, so convert the mostly-MCQ maths banks to typed answers (roadmap H9).

## 7. Notes still to write
- ~~**Maths AA SL: 27 subtopics remain**~~ Done (Nov 2026): all 51 SL subtopics now have draft notes. Have her teacher check them before each unit. Still missing practice items for 1.6 (proof), 4.5, 4.7 and 4.10 (see each note's `links.gap`).
- **History, English, French:** later. Waiting on ISL's History topics and case studies and the English and French work lists.
- Have teachers check the flagged details: Biology statins and voltage-gated channels; local case studies; Chemistry codes, once the official guide is supplied (`syllabusFlags`).

## 8. Remaining technical roadmap (audit Page)
- **H4–H9** from the technical audit:
  - spaced retests of missed questions at 7 and 30 days;
  - exam-style timed practice;
  - progress reporting;
  - typed maths answers (H9);
  - and the rest as listed there.
- **Security:**
  - CSRF protection and session hardening in `api.php` (cookie flags, token rotation);
  - escape the remaining `innerHTML` sink in `practice.html` (missed-question rendering);
  - per-IP plus per-account brute-force limits.
- **Known sync limits:** if two devices edit the same list blob, the last one wins (the server history keeps the other version). A device's first sync after the upgrade unions both sides, so an item deleted elsewhere can come back once.
