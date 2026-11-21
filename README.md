# IB Study Area — private study site for our daughter (DP1, ISL, exams May 2028)

A self-contained, private, static study website. No framework, no build step. Accounts are
deliberately minimal: one PHP file, JSON storage, a login per student (and one admin).
Everything here was built around one idea: **content is only useful if it matches the exact
syllabus editions she is examined on (May 2028) and the order ISL actually teaches it.**

Status snapshot: **2026-11-20 (consolidation)** — **rametric.com/nevaib runs the multi-user release**
(everything through PR #19). Built locally since then, awaiting deploy: the 20 Nov student-feedback
phases — **practice sets + taught/difficulty filters (phase 1)**, a **mistake log (phase 2)**,
**biology A–D navigation + search and Today suggestions with reasons (phase 3)**, a **Resources
page + AI-assisted bank authoring with a check-first preview (phase 4)**, and favicon/editor-copy/
light-mode polish (phase 5). Everything passes `./dev.sh validate` + `./dev.sh test` + e2e. See
[docs/HANDOFF.md](docs/HANDOFF.md), [docs/NEXT-STEPS.md](docs/NEXT-STEPS.md) and the phase summary
[docs/CHANGELOG-2026-11-20-neva-feedback.md](docs/CHANGELOG-2026-11-20-neva-feedback.md).

Next focus (2026-11-20): **deploy this batch** (only with explicit approval — NEXT-STEPS step 1),
then usage: December 8 English rehearsal, January mocks, IA debriefs, EE shortlist.

---

## What is built

| Module | Page | Notes |
|---|---|---|
| Dashboard | `index.html` | Countdown to May 2028, "this week" box, 6 subject progress cards, next school deadlines |
| Subject hubs (6) | `math-aa-sl.html` `biology-hl.html` `chemistry-hl.html` `history-sl.html` `french-a-langlit.html` `english-lit-hl.html` | Verified assessment weightings, currency banners (which papers/guides match), syllabus checklists linked to notes PDFs (biology grouped under searchable A–D theme headings), IA corners, ISL teaching-sequence panels (bio/chem), teaching hours (math) |
| Core | `core.html` | TOK (exhibition 33% / essay 67%), **new EE guide** (first assessment 2027), CAS + TOK exhibition object shortlist (tracked, synced) |
| EE workspace | `ee.html` | Idea-log shortlist (tracked, synced), one-page proposal checklist mapped to the new-EE criteria, DP1 timeline, reflection-session guidance |
| Quiz engine | `quiz.html` | 20-question sessions, filtered by subject/topic/format; **practice sets grouped under topics, difficulty-range filter (easy/standard/hard/unrated), taught-topics-only toggle with a "Topics & teaching status" panel**; instant MCQ marking; written answers self-marked against markschemes; weak-topic flags + tactics; "＋ Flashcard" button on every answer |
| Topic notes | `app/notes.html` | 113 original notes (Biology HL 40, Chemistry HL 22, Maths AA SL 51) by syllabus code: recall-first key ideas, key terms (+ card), common mistakes, worked examples, practice prompts (self-check points, not IB markschemes), booklet pointers, one-tap quiz/flashcards on the linked items; **My resources** box per note (her own links, synced); **Ask an AI** copies a pre-filled prompt and opens the preferred assistant — including "Write a practice set to import"; linked from every matching checklist row |
| Mistake log | `app/mistakes.html` | every wrong answer with its why: error type (careless/misread/content/time/other), reflection, retry history; recovered ("green") vs unresolved vs "not relevant" (reversible); filter by status/subject/search; one-question retry deep links |
| Resources | `app/resources.html` | her own collection of links (videos, class notes, files), tagged by subject/topic/type — never quiz content; links only (http/file), synced; each row offers "Make questions…" into the Upload page's AI flow |
| Today panel | `app/index.html` | due cards, a 6-question quiz on the weakest topic, this week's class units from `library/class-schedule.json`, plus **ranked suggestions with visible reasons** (open mistakes, closing units, deadline prep) and near/long-lead dated items |
| Exam practice | `app/quiz.html` | Paper 1A/1B-style Chemistry banks, Biology data-response practice, "sure/guessing" confidence ratings, past-paper score log |
| Coursework planner | `app/coursework.html` | Bio/Chem scientific investigation + Maths exploration: stages, self-checks, pitfalls, her own dates (synced per record) |
| Weekly summary | `app/summary.html` | read-only parent view (own login) + optional cron e-mail |
| Accounts & admin | `admin.html` | per-student logins with isolated data and subject profiles; an admin account creates students and sets their subjects (in the working tree, see status above) |
| Flashcards | `flashcards.html` | Leitner spaced repetition (1/2/4/8/16-day boxes), flip UI, keyboard shortcuts, dark mode, editor, full backup / restore |
| Practice | `practice.html` | Mock protocol, printable error log, missed-question tracker, paper-alignment table per subject, Dec–Jan mock schedule, manifest-driven papers list |
| Library | `library.html` | Filterable/searchable browser over every library PDF (notes · official · school · papers) from `library/library-manifest.json`; ★ pin resources (dashboard card), private per-resource notes, recently-opened tracking — all synced |
| IA & EE | `ia.html` | IA/EE criteria per subject, milestone timeline, **practice-IA debrief notes** (Nov hydrogen-peroxide + Jan beetroot/osmosis — saved + synced) |
| Plan | `plan.html` | DP1 term-by-term plan merged from ISL's deadline calendar + weekly loop + school-requests email (copy-paste) |
| Deadlines | `deadlines.html` | ISL Year 12 calendar as a live timeline (past struck through, upcoming with days-to-go) |
| Reference | `quick-reference.html` | Formula/data booklets, command terms, GDC exam-mode, citation |
| Redirect | `sixth-subject.html` | The sixth subject is English A Literature HL → redirects to its hub |

Content totals: **127 PDFs** in the library (indexed by `library/library-manifest.json` — rebuilt with `tools/build_library_manifest.py` after any PDF lands) · **32 quiz banks / 841 items** · **28 flashcard decks / 594 cards** · **113 topic notes** (schema in DEVELOPMENT.md).

## Tech stack (deliberately boring)

- **Static HTML + vanilla JS.** No framework, no dependencies, no build step.
- **Data** = JSON files in `library/` (question banks, flashcard decks, topic notes, coursework, deadlines array).
- **State** = browser `localStorage`, **physically scoped per account** (`<user>:<key>`) in the working tree —
  synced across devices when logged in (merged per record for SRS boxes and missed questions); logged out it
  stays on the device and syncs at the next login. Full backup / restore (merge by default) on the Cards page;
  the server keeps the last 30 versions per user.
- **Accounts** = `server/api.php` (PHP 7.2, JSON files, no database): one login per student plus a separate
  **admin** account that creates students and sets their per-student subject profile (which filters nav,
  quiz banks, decks, notes, library, coursework and deadlines). Details: [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).
- **Python 3** used only for one-off scripts (extraction, site generation) — always run with `-I`.
- **Must be served over HTTP** for the quiz/flashcards to load their JSON (`fetch()` fails on `file://`):
  ```bash
  ./dev.sh start      # http://127.0.0.1:8018 — site + local API; ./dev.sh help for test/validate/build/deploy
  ```
- Deployment + privacy (basic auth) → [DEPLOY.md](DEPLOY.md).

## File structure

```
ibsystem/
├── README.md                 ← you are here
├── DEPLOY.md                 ← LAN + hosting + auth instructions
├── docs/
│   ├── HANDOFF.md            ← start here: system, architecture, data/sync, what was done
│   ├── NEXT-STEPS.md         ← prioritised next steps (deploy, content, open questions)
│   ├── CONTENT-PLAN.md       ← per-subject content status + what to add next
│   ├── ROADMAP.md            ← feature roadmap (shipped / short / medium / later)
│   ├── DEVELOPMENT.md        ← architecture, data schemas, localStorage keys, gotchas
│   ├── AUTHORING.md          ← how to add quiz banks/decks (schema, practice sets, AI prompt)
│   ├── USER-TEST.md          ← student user-test guide (+ AI bank-generation prompt)
│   ├── CHANGELOG-2026-11-20-neva-feedback.md ← what changed in phases 0–5 (student feedback batch)
│   ├── MAINTENANCE.md        ← weekly/termly checklists
│   └── VISION.md             ← ideas for later (nothing committed)
├── index.html … *.html       ← study-site pages (see table above) + admin.html (account admin)
├── app/                      ← self-contained practice app (notes, quiz, cards, mistakes, resources, today, coursework, upload, summary)
├── server/                   ← PHP backend + deploy notes for rametric.com/nevaib (accounts + cross-device sync)
├── assets/
│   ├── style.css             ← site-wide styles
│   ├── store.js              ← shared storage layer (NB.store): per-user scopes, schema, migrations, sync markers, snapshots
│   ├── profile.js            ← canonical subject registry + per-user subject profiles (filtering)
│   ├── auth.js               ← login widget + sync (dirty-key pushes, 409 retry, pagehide flush)
│   ├── app.js                ← checklists, progress bars, countdown, this-week, hub checklist search
│   ├── quiz-engine.js        ← quiz sessions (topics/sets, difficulty + taught filters) + flashcard hook
│   ├── bank-schema.js        ← shared bank/deck validators (upload + library, same rules)
│   ├── flashcards.js         ← SRS engine + editor
│   ├── today.js              ← Today panel (due cards, weakest topic, class week, suggestions with reasons)
│   ├── mistakes.js           ← mistake log over q-errors (tags, reflections, retire/restore)
│   ├── resources.js          ← Resources page engine (my-res links, tagged, never quiz content)
│   ├── coursework.js         ← coursework planner
│   ├── confidence.js/papers.js ← confidence ratings + past-paper score log
│   ├── notes.js/ai-prompt.js ← topic-notes viewer + Ask an AI (incl. practice-set prompt mode)
│   ├── bank-import.js        ← Upload page staged paste import (validate → preview/edit → import)
│   ├── backup.js             ← full backup + validated, merge-by-default restore
│   ├── lists.js              ← tracked lists + debrief notes (synced blobs)
│   ├── library.js            ← library browser: manifest filter/search, pins/notes/recent tracking
│   └── deadlines.js          ← deadline data + timeline renderers
├── library/                  ← all content data (the important folder — back this up)
│   ├── official/             ← PDFs from ibo.org (guides, specimens, briefs, booklets, EE guide)
│   ├── school/               ← ISL course documents (bio outline, chem at-a-glance, math syllabus)
│   ├── notes/                ← topic PDFs, organised by ISL teaching order
│   ├── questions/            ← 32 quiz banks (841 items) + manifest.json (picker metadata) — schema in DEVELOPMENT.md
│   ├── flashcards/           ← 28 decks (594 cards) — schema in DEVELOPMENT.md
│   ├── topic-notes/          ← 113 original notes (JSON, per subject) + syllabus maps
│   ├── coursework/           ← coursework planner content
│   ├── papers/               ← (empty) school-provided past papers land here
│   └── library-manifest.json ← auto-built index of every PDF (127 items) — rebuild after changes
├── source-archives/          ← original downloaded ZIPs (kept as provenance; deletable once confident)
├── tools/build_site.py       ← generator for 10 study-site pages — see DEVELOPMENT.md (generated files must match it)
├── tools/build_library_manifest.py ← rebuilds library/library-manifest.json from the PDF tree
├── tools/build_questions_manifest.py ← rebuilds library/questions/manifest.json (picker metadata)
├── tools/validate_content.py ← pre-commit content validator (./dev.sh validate)
└── tools/build_deploy.py     ← assembles deploy/nevaib/ (original content only)
```

## How content is organised

Everything shares one keying scheme — `subject` (`biology-hl`, `math-aa-sl`, …) and
`topic` (official syllabus codes: `c1-1-enzymes-metabolism`, `structure-3-1-periodicity`,
`1-1-number-toolkit`, …). That key is what links a hub checklist row, a quiz bank, a
flashcard deck and a notes PDF together.

```
Subject hub (page)
 ├─ Syllabus checklist rows ──→ library/notes/<subject>/<section>/<topic>.pdf
 ├─ Quiz bank (topic key)   ──→ library/questions/<subject>-<topic>.json
 ├─ Flashcard deck (topic key) → library/flashcards/<subject>-<topic>.json
 └─ Official/school docs    ──→ library/official/ · library/school/
```

Rule of thumb: **IB guides & ISL course documents are the authority on content and order;
mirrors/notes are supplements.** Never trust a PDF without checking the guide-edition
banner on its hub.

## Get it onto your laptop

Your copy lives at `~/Projects/ibsystem`; everything is merged on `main`:

```bash
cd ~/Projects/ibsystem
git status                      # should be clean
git switch main && git pull
./dev.sh test                   # all tests (needs python3 + uv, node ≥ 18, php)
./dev.sh start                  # http://127.0.0.1:8018 — study site + practice app + local API
```

Full handoff: [docs/HANDOFF.md](docs/HANDOFF.md) · what to do next: [docs/NEXT-STEPS.md](docs/NEXT-STEPS.md).

## Docs index

| Doc | Use it for |
|---|---|
| [docs/HANDOFF.md](docs/HANDOFF.md) | Start here: what the system is, architecture, data/sync, what was done, links to the audit Pages |
| [docs/USER-TEST.md](docs/USER-TEST.md) | **For the student**: a guided click-through test + how to upload your own AI-generated question bank |
| [docs/NEXT-STEPS.md](docs/NEXT-STEPS.md) | Prioritised next steps: merges, deploy, content fixes, roadmap |
| [docs/CONTENT-PLAN.md](docs/CONTENT-PLAN.md) | What content exists, what's missing, per-subject priorities, completeness matrix |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Feature roadmap: shipped / next 2–4 weeks / 2–3 months / later |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | Architecture, data schemas, localStorage keys, gotchas, recipes |
| [docs/MAINTENANCE.md](docs/MAINTENANCE.md) | Weekly/termly checklists, backups, health checks |
| [docs/VISION.md](docs/VISION.md) | Ideas for later — nothing there is committed work |
| [DEPLOY.md](DEPLOY.md) | LAN / generic-host options + the multi-user release checklist |
| [server/deploy-notes.md](server/deploy-notes.md) | Hosted deployment to rametric.com/nevaib (accounts, admin bootstrap, cross-device sync) |
| [docs/NEXT-PHASE-PROMPT.md](docs/NEXT-PHASE-PROMPT.md) | Point-in-time handoff prompt (superseded by HANDOFF.md for current state) |
| [docs/QUIZ-GENERATION-PROMPT.md](docs/QUIZ-GENERATION-PROMPT.md) | Reusable prompt for generating new question batches |
| [docs/CHANGELOG-2026-11-20-neva-feedback.md](docs/CHANGELOG-2026-11-20-neva-feedback.md) | Phase-by-phase summary of the 20 Nov student-feedback work (phases 0–5) |

## Next actions (ordered — details in the linked docs)

1. **Tell her** — the site is live at rametric.com/nevaib with her existing login (`neva`). Accounts are
   managed by the admin (`admin.html` on the study site, or the API — see `server/deploy-notes.md`).
2. **Send the school-requests email** (ready to copy at the bottom of `plan.html`) — papers + markschemes, History FA2028 guide/specimens, LangLit materials, IA samples. Then file arrivals into `library/papers/<subject>/` and run `tools/build_library_manifest.py` — they surface on `practice.html` and `library.html` automatically.
3. **8 December**: English Paper 1 timed rehearsal (specimen on the English hub) → error-log entry. The Dec–Jan mock schedule lives on `practice.html`; the IA debrief boxes on `ia.html` get filled after each bio practice session.
4. **Confirm with the school**: Nov–Jun calendar dates (only Aug–Oct verified against the official text layer), the English P2 work list (unlocks quote banks). ISL's math unit order is confirmed (see CONTENT-PLAN).
5. **Monthly rhythm** (MAINTENANCE.md): content commit + push, host backup of `~/nevaib-data/`, next bank/deck batch per [docs/CONTENT-PLAN.md](docs/CONTENT-PLAN.md), validator + link check.

Development handoff for the next phase: [docs/NEXT-PHASE-PROMPT.md](docs/NEXT-PHASE-PROMPT.md).

## Known issues & risks (flagged, not urgent)

- **Nov–Jun deadline dates** come from a photo transcription; Aug–Oct verified against the official PDF.
- **Progress syncs across devices when logged in.** The hosted copy (rametric.com/nevaib) syncs every
  progress key to a per-user server file (token auth). In the working tree, each account's data is also
  isolated on shared devices (per-user localStorage scopes) and an admin can create further student
  accounts with their own subject lists — not deployed yet.
- **Math Functions bank** unit-order label: resolved 2026-11-18 — the ISL course calendar is ingested (see CONTENT-PLAN).
- **`source-archives/` holds ~434 MB of ZIPs** already extracted into `library/notes/` — safe to delete once you're confident in the extraction (your call).
- A staging copy of the official library exists in the ZCode workspace (`ib-library/`) — `ibsystem/library/` is the canonical one; stop updating the staging copy.
- The dev server runs on **http://127.0.0.1:8018** (`./dev.sh start`).
