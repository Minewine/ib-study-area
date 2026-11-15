# Handoff Prompt — next phase of development

Copy everything below the line into a new chat to continue development with full context.

---

You are continuing development of a private IB Diploma study website for one student (Year 12 / DP1 at the International School of Lausanne, exams May 2028). The project lives at `/home/mick/Projects/ibsystem` (git repo, remote `origin` = private `github.com/Minewine/ib-study-area`). Previous sessions built the site, the practice app, the hosted sync backend, and the content through spring 2027; this phase is about **usage-driven work** — papers, mocks, IA/EE support, and the next content queues. Work only inside that folder.

## Read first, in this order

1. `/home/mick/Projects/ibsystem/README.md` — overview, status, structure, next actions
2. `/home/mick/Projects/ibsystem/docs/DEVELOPMENT.md` — architecture, data schemas, localStorage keys, gotchas (READ THE GOTCHAS before editing)
3. `/home/mick/Projects/ibsystem/docs/ROADMAP.md` — done/queued features
4. `/home/mick/Projects/ibsystem/docs/CONTENT-PLAN.md` — content completeness matrix + queues
5. `/home/mick/Projects/ibsystem/server/deploy-notes.md` — the hosted deployment checklist

## What exists (all verified live 2026-11-15)

- **Study site** (static, vanilla JS, no build step, local-only by design): dashboard with "Progress pulse" stats, 6 subject hubs with syllabus checklists linked to local notes PDFs, deadlines timeline, DP1 plan, practice/error-log page, quick reference. 127 PDFs in `library/`; the copyrighted folders (`library/official|school|notes|papers/`, `source-archives/`) are gitignored and must NEVER be committed, hosted, or included in any deploy.
- **Practice app** (`app/`, the only thing hosted): quiz engine (23 original banks, 631 items — every DP1 science/math unit through spring) + flashcards (21 decks, 407 cards, Leitner SRS) + `author.html` (upload/manage/quiz-item-editor/export). Engines are shared via `PATH_BASE`; content resolves through `library/*/manifest.json`.
- **Hosted backend** (rametric.com/nevaib, LIVE over HTTPS): `server/api.php` (PHP 7.2-compatible, stdlib only; login/logout/me + per-user state, JSON files under the cPanel home). Account `neva` active. Re-deploy with `python3 -I tools/push_deploy.py --rebuild` (FTPS, credentials in gitignored `deploy/.ftp-credentials`).
- **Sync**: logged-in users get last-write-wins sync of `q-userbanks, fc-userdecks, fc-state, fc-user, fc-deleted, fc-edits, quizlog, q-errors` plus a batched `site-state` (checklist ticks `chk:*` + this-week items) via `assets/auth.js` — wired on all 4 app pages and all 7 study-site auth pages, with first-login migration and per-row merge. Logged out = localStorage-only. Bump `?v=N` on engine script tags in referencing pages whenever an engine file changes.

## Conventions & hard rules

- Vanilla JS + static HTML only; no frameworks, no build step. Python only for one-off/tooling scripts, run with `python3 -I`.
- **Copyright firewall (absolute)**: never commit, host, bundle, or reproduce IB/publisher copyrighted material (past papers, markschemes, guide text, the notes in `library/notes/`). Quiz banks and flashcards must be original items written to the syllabus.
- A formatter may reflow files after edits — always re-read/verify after writing; anchor patches on short unique substrings and re-run the link check.
- JS engines: run `node --check` after every edit. Content: run `python3 -I tools/validate_content.py` (must pass).
- Verify features in the browser end-to-end (dev server: `python3 -m http.server 8017 --bind 0.0.0.0 --directory /home/mick/Projects/ibsystem`; PHP API test host pattern in `server/deploy-notes.md`).
- Any hand-edit to one of the 10 generator-built pages must also be folded into `tools/build_site.py` (template or PATCHES) — see DEVELOPMENT.md "Generator".
- Commit with conventional messages and push to origin when a milestone passes. Docs (`README`, `ROADMAP`, `CONTENT-PLAN`) are part of every milestone.

## Your tasks for this phase (in priority order)

1. **School papers integration** (the school-requests email is ready at the bottom of `plan.html`): when papers/markschemes arrive, file into `library/papers/<subject>/`, link them on `practice.html`, wire one mock per subject into the plan.
2. **January exam preparation flow**: full timed mocks per the practice-page protocol; error-log-driven revision per paper; **December 8 rehearsal** — English Paper 1 timed run using the local specimen, error-log entry after.
3. **IA practice debrief page**: after the November hydrogen-peroxide and January beetroot/osmosis sessions, capture what research-design / data-analysis / conclusion / evaluation looked like in practice (feeds the June IA experiments).
4. **EE launch support (Feb 17 → proposal Mar 2)**: idea-log shortlist page → one-page proposal checklist mapped to the new EE criteria. Also a TOK exhibition object shortlist on the Core hub (plan due 25 March).
5. **Content queues** (check `docs/CONTENT-PLAN.md` first — most things exist): math **Topic 3 trigonometry** bank + trig-formulae deck once Functions closes (confirm ISL's math unit order first, then relabel the Functions bank); **French** IO global-issue bank + terminology flashcards; **English** quote banks per studied work + literary-terms deck. History banks stay **blocked** until the school confirms the class's focused studies/topics.
6. **Verification items**: cross-check Nov–Jun deadline dates against the official calendar (only Aug–Oct text-verified; do it at the January term per MAINTENANCE.md); optionally ask Namecheap support to enable PHP 8.x for the account (hygiene — `server/api.php` runs fine on 7.2).
7. **Monthly maintenance** per `docs/MAINTENANCE.md`: backup (`ibsystem/` minus `source-archives/`), host state backup (FTP + key-gated dumper recipe in `server/deploy-notes.md`), validator + link check, content matrix update, `push_deploy.py --rebuild` whenever content changed.

## Definition of done for this phase

- Whatever ships: all validators/link checks pass; docs updated; changes committed and pushed to `origin` (private repo — never make it public); hosted copy refreshed via `tools/push_deploy.py --rebuild` if content or engines changed.
- New content matches the matrix keys (`subject` + `topic`) and passes `tools/validate_content.py`.
- No copyrighted file ever enters the repo, the deploy build, or the host.
