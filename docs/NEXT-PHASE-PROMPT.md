# Handoff Prompt — next phase of development

Copy everything below the line into a new chat to continue development with full context.

---

You are continuing development of a private IB Diploma study website for one student (Year 12 / DP1 at the International School of Lausanne, exams May 2028). The project lives at `/home/mick/Projects/ibsystem` (git repo, remote `origin` = private `github.com/Minewine/ib-study-area`). A previous session built the entire site; this phase extends it. Work only inside that folder.

## Read first, in this order

1. `/home/mick/Projects/ibsystem/README.md` — overview, status, structure, next actions
2. `/home/mick/Projects/ibsystem/docs/DEVELOPMENT.md` — architecture, data schemas, localStorage keys, gotchas (READ THE GOTCHAS before editing)
3. `/home/mick/Projects/ibsystem/docs/ROADMAP.md` — done/queued features
4. `/home/mick/Projects/ibsystem/docs/CONTENT-PLAN.md` — content completeness matrix + queues
5. `/home/mick/Projects/ibsystem/server/deploy-notes.md` — the hosted deployment checklist

## What exists (summary)

- **Study site** (static, vanilla JS, no build step): dashboard, 6 subject hubs with syllabus checklists linked to local notes PDFs, deadlines timeline, DP1 plan, practice/error-log page, quick reference. Content data in `library/` (official/school/notes/questions/flashcards). 127 PDFs live locally; the copyrighted PDF folders (`library/official|school|notes|papers/`, `source-archives/`) are gitignored and must NEVER be committed, hosted, or included in any deploy.
- **Practice app** (`app/`): quiz engine (14 original banks, 303 items — every DP1 science/math unit through spring) + flashcards (12 decks, 229 cards, Leitner SRS) + `author.html` (upload/manage/export JSON content). Engines: `assets/quiz-engine.js`, `assets/flashcards.js` (manifest-driven via `library/*/manifest.json`), shared `PATH_BASE` content resolution so the same engines serve both the root site and `app/`.
- **Hosted backend** (`server/api.php`): PHP, stdlib only — login/logout/me + per-user state get/save (PHP sessions, JSON files under the cPanel home on rametic.com). Target deployment: `rametic.com/nevaib` on Namecheap shared hosting (no shell — cPanel/SFTP only; PHP 8 available; HTTPS live). Deploy artifact built by `tools/build_deploy.py` → `deploy/nevaib/`. NOT YET UPLOADED — that's the first task.
- **Sync model**: logged-in users get last-write-wins whole-payload sync of the app-owned keys (`q-userbanks, fc-userdecks, fc-state, fc-user, fc-deleted, fc-edits, quizlog`) via `app/assets/auth.js` (debounced 2 s push, pull on load, one reload to apply). Logged out = localStorage-only. Study-site checklist ticks (`chk:*`) and this-week items are NOT synced yet.

## Conventions & hard rules

- Vanilla JS + static HTML only; no frameworks, no build step. Python only for one-off/tooling scripts, run with `python3 -I`.
- **Copyright firewall (absolute)**: never commit, host, bundle, or reproduce IB/publisher copyrighted material (past papers, markschemes, guide text, the notes in `library/notes/`). Quiz banks and flashcards must be original items written to the syllabus.
- A formatter may reflow files after edits — always re-read/verify after writing; anchor patches on short unique substrings and re-run the link check.
- JS engines: run `node --check` after every edit. Content: run `python3 -I tools/validate_content.py` (must pass).
- Verify features in the browser end-to-end (the site runs via `python3 -m http.server 8017 --bind 0.0.0.0 --directory /home/mick/Projects/ibsystem`; the PHP API test host pattern is in `server/deploy-notes.md`).
- Commit with conventional messages and push to origin when a milestone passes.
- Documentation lives in `docs/` and README — update them as part of any milestone (ROADMAP checkboxes, CONTENT-PLAN matrix).

## Your tasks for this phase (in priority order)

1. **Complete the hosted deployment** (checklist: `server/deploy-notes.md`): build `deploy/nevaib/`, confirm its contents, guide the parent through the cPanel/SFTP upload and account creation (the parent does the upload; you prepare everything and verify what you can). Confirm HTTPS + login work; document anything host-specific discovered.
2. **Extend cross-device sync to the study-site data**: the hub checklist ticks (`chk:*` keys) and this-week items currently stay per-device. Add them to the synced payload + include `assets/auth.js` on the study-site pages (dashboard + hubs) with an auth indicator, keeping the logged-out fallback intact. Mind the storage-shape differences (`chk:*` keys are many small entries — batch them into one synced object, e.g. `{checklists: {...}, week: [...]}`) and migrate existing local state on first login without data loss.
3. **In-app quiz item editor** (`app/author.html` or `app/editor.html`): mirror the existing flashcard editor — add/edit/delete quiz items in an uploaded or created bank, with the same validation rules as the upload path.
4. **Progress dashboard v2** (`app/index.html` or the study dashboard): quiz-score trend from `quizlog` (last sessions), flashcards due count, checklist % per subject — one small stats view, no new infrastructure.
5. **Content**: build the February–March bank queue if not present (chem kinetics/equilibrium, bio respiration/protein synthesis — check `docs/CONTENT-PLAN.md` first; some exist). Flashcard decks for the same units. History banks remain blocked until the school confirms the class's focused studies/topics.
6. **Monthly maintenance** per `docs/MAINTENANCE.md`: backup, host state backup, validator + link check, content matrix update.

## Definition of done for this phase

- rametic.com/nevaib live over HTTPS with her account working from a phone; quiz sessions and flashcard reviews from a phone persist server-side and appear on other devices after login.
- Checklist ticks synced cross-device without data loss (migration path tested).
- All validators/link checks pass; docs updated; changes committed and pushed to `origin` (private repo — never make it public).
