# Handoff Prompt — next phase of development

> **Point-in-time artifact (written 2026-11-15, before PRs #5–#16 and the multi-user work).**
> For the *current* state, read [HANDOFF.md](HANDOFF.md) and [NEXT-STEPS.md](NEXT-STEPS.md) instead;
> this prompt is kept only as a reusable template for starting a fresh chat.

Copy everything below the line into a new chat to continue development with full context.

---

You are continuing development of a private IB Diploma study website for one student (Year 12 / DP1 at the International School of Lausanne, exams May 2028). The project lives at `/home/mick/Projects/ibsystem` (git repo, remote `origin` = private `github.com/Minewine/ib-study-area`). Previous sessions built the site, the practice app, the hosted sync backend, all DP1 content queues, and the EE/TOK/IA support pages; this phase is about **usage-driven work** — papers integration, mock season, and filling in the captured debriefs/shortlists. Work only inside that folder.

## Read first, in this order

1. `/home/mick/Projects/ibsystem/README.md` — overview, status, structure, next actions
2. `/home/mick/Projects/ibsystem/docs/DEVELOPMENT.md` — architecture, data schemas, localStorage keys, gotchas (READ THE GOTCHAS before editing)
3. `/home/mick/Projects/ibsystem/docs/ROADMAP.md` — done/queued features
4. `/home/mick/Projects/ibsystem/docs/CONTENT-PLAN.md` — content completeness matrix + queues
5. `/home/mick/Projects/ibsystem/server/deploy-notes.md` — the hosted deployment checklist

## What exists (all verified live 2026-11-15)

- **Study site** (static, vanilla JS, no build step, local-only by design): dashboard with "Progress pulse" stats, 6 subject hubs with syllabus checklists linked to local notes PDFs, deadlines timeline, DP1 plan, practice/error-log page with missed-question tracker + Dec–Jan mock schedule, IA page with criteria-mapped practice debrief notes, EE workspace (`ee.html`: idea-log shortlist + proposal checklist mapped to the new-EE criteria), Core hub with a TOK exhibition object shortlist, French hub with an IO global-issue bank (tracked, synced), quick reference. 127 PDFs in `library/`; the copyrighted folders (`library/official|school|notes|papers/`, `source-archives/`) are gitignored and must NEVER be committed, hosted, or included in any deploy.
- **Practice app** (`app/`, the only thing hosted): quiz engine (23 original banks, 631 items — every DP1 science/math unit through spring) + flashcards (23 decks, 484 cards — every DP1 science/math unit + French terminology + English literary terms, Leitner SRS) + `author.html` (upload/manage/quiz-item-editor/export). Engines are shared via `PATH_BASE`; content resolves through `library/*/manifest.json`.
- **Hosted backend** (rametric.com/nevaib, LIVE over HTTPS): `server/api.php` (PHP 7.2-compatible, stdlib only; login/logout/me + per-user state, JSON files under the cPanel home). Account `neva` active. Re-deploy with `python3 -I tools/push_deploy.py --rebuild` (FTPS, credentials in gitignored `deploy/.ftp-credentials`).
- **Sync**: logged-in users get last-write-wins sync of `q-userbanks, fc-userdecks, fc-state, fc-user, fc-deleted, fc-edits, quizlog, tok-objects, ee-ideas, io-issues, ia-debriefs` plus a batched `site-state` (checklist ticks `chk:*` + this-week items) via `assets/auth.js` — wired on all 4 app pages and all 10 study-site auth pages (dashboard, hubs, core, ia, ee), with first-login migration and per-row merge. `lists.js` owns the four tracked-list/debrief blobs. Logged out = localStorage-only. Bump `?v=N` on engine script tags in referencing pages whenever an engine file changes (auth.js at `?v=4`, lists.js `?v=1`, deadlines.js `?v=2`).
- **Generator**: `tools/build_site.py` reproduces the 10 base pages byte-for-byte, including the practice-page missed-questions card + inline script (drift repaired 2026-11-15) and the ia.html sciences-IA paragraph (single-source now). Any hand-edit to a generated page must be folded back in.

## Conventions & hard rules

- Vanilla JS + static HTML only; no frameworks, no build step. Python only for one-off/tooling scripts, run with `python3 -I`.
- **Copyright firewall (absolute)**: never commit, host, bundle, or reproduce IB/publisher copyrighted material (past papers, markschemes, guide text, the notes in `library/notes/`). Quiz banks and flashcards must be original items written to the syllabus.
- A formatter may reflow files after edits — always re-read/verify after writing; anchor patches on short unique substrings and re-run the link check.
- JS engines: run `node --check` after every edit. Content: run `python3 -I tools/validate_content.py` (must pass).
- Verify features in the browser end-to-end (dev server: `python3 -m http.server 8017 --bind 0.0.0.0 --directory /home/mick/Projects/ibsystem`; PHP API test host pattern in `server/deploy-notes.md`).
- Any hand-edit to one of the 10 generator-built pages must also be folded into `tools/build_site.py` (template, SUBJECTS content, PATCHES, or EXTRA_SCRIPTS) — see DEVELOPMENT.md "Generator".
- Commit with conventional messages and push to origin when a milestone passes. Docs (`README`, `ROADMAP`, `CONTENT-PLAN`) are part of every milestone.

## Your tasks for this phase (in priority order)

1. **School papers integration** (the school-requests email is ready at the bottom of `plan.html`): when papers/markschemes arrive, file into `library/papers/<subject>/`, link them on `practice.html`, update the mock schedule there to use them.
2. **December 8 rehearsal + January mocks (usage, not building)**: English Paper 1 timed run using the local specimen, error-log entry after; January-window mocks per the practice-page schedule; night-before error-log review only.
3. **Fill the captured content**: IA debrief notes on `ia.html` after each bio practice session (Nov hydrogen-peroxide, Jan beetroot/osmosis); EE idea shortlist kept current in `ee.html` (shortlist ready at the Feb 17 launch, proposal checklist ticked with the supervisor before Mar 2); TOK object candidates on `core.html` (plan due Mar 25); French IO bank fed weekly from the P1 routine.
4. **Confirm with the school**: Nov–Jun calendar dates (only Aug–Oct verified against the official text layer; January term per MAINTENANCE.md), ISL's math unit order (relabel the Functions bank if needed), the English P2 work list (unlocks quote banks).
5. **Content queues**: English quote banks per studied work — **blocked until the work list is confirmed**; History banks — **blocked until the class's focused studies/topics are known**; nothing else is missing (check `docs/CONTENT-PLAN.md` first).
6. **Hygiene**: optionally ask Namecheap support to enable PHP 8.x for the account (`server/api.php` runs fine on 7.2).
7. **Monthly maintenance** per `docs/MAINTENANCE.md`: backup (`ibsystem/` minus `source-archives/`), host state backup (FTP + key-gated dumper recipe in `server/deploy-notes.md`), validator + link check, content matrix update, `push_deploy.py --rebuild` whenever content changed.

## Definition of done for this phase

- Whatever ships: all validators/link checks pass; docs updated; changes committed and pushed to `origin` (private repo — never make it public); hosted copy refreshed via `tools/push_deploy.py --rebuild` if content or engines changed.
- New content matches the matrix keys (`subject` + `topic`) and passes `tools/validate_content.py`.
- No copyrighted file ever enters the repo, the deploy build, or the host.
