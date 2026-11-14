# IB Study Area — private study site for our daughter (DP1, ISL, exams May 2028)

A self-contained, private, static study website. No framework, no build step, no accounts.
Everything here was built around one idea: **content is only useful if it matches the exact
syllabus editions she is examined on (May 2028) and the order ISL actually teaches it.**

Status snapshot: **2026-11-14** — see [docs/ROADMAP.md](docs/ROADMAP.md) for what's next.

---

## What is built

| Module | Page | Notes |
|---|---|---|
| Dashboard | `index.html` | Countdown to May 2028, "this week" box, 6 subject progress cards, next school deadlines |
| Subject hubs (6) | `math-aa-sl.html` `biology-hl.html` `chemistry-hl.html` `history-sl.html` `french-a-langlit.html` `english-lit-hl.html` | Verified assessment weightings, currency banners (which papers/guides match), syllabus checklists linked to notes PDFs, IA corners, ISL teaching-sequence panels (bio/chem), teaching hours (math) |
| Core | `core.html` | TOK (exhibition 33% / essay 67%), **new EE guide** (first assessment 2027), CAS |
| Quiz engine | `quiz.html` | 20-question sessions, filtered by subject/topic/format; instant MCQ marking; written answers self-marked against markschemes; weak-topic flags + tactics; "＋ Flashcard" button on every answer |
| Flashcards | `flashcards.html` | Leitner spaced repetition (1/2/4/8/16-day boxes), flip UI, keyboard shortcuts, dark mode, editor, export/import |
| Practice | `practice.html` | Mock protocol, printable error log, paper-alignment table per subject |
| Plan | `plan.html` | DP1 term-by-term plan merged from ISL's deadline calendar + weekly loop + school-requests email (copy-paste) |
| Deadlines | `deadlines.html` | ISL Year 12 calendar as a live timeline (past struck through, upcoming with days-to-go) |
| Reference | `quick-reference.html` | Formula/data booklets, command terms, GDC exam-mode, citation |
| Redirect | `sixth-subject.html` | The sixth subject is English A Literature HL → redirects to its hub |

Content totals: **127 PDFs** in the library · **154 quiz questions** (7 banks) · **58 flashcards** (3 decks).

## Tech stack (deliberately boring)

- **Static HTML + vanilla JS.** No framework, no dependencies, no build step.
- **Data** = JSON files in `library/` (question banks, flashcard decks, deadlines array).
- **State** = browser `localStorage` (checklist ticks, SRS boxes, quiz logs, this-week items) — per device; Export/Import on the Cards page moves it.
- **Python 3** used only for one-off scripts (extraction, site generation) — always run with `-I`.
- **Must be served over HTTP** for the quiz/flashcards to load their JSON (`fetch()` fails on `file://`):
  ```bash
  python3 -m http.server 8017 --bind 0.0.0.0 --directory ~/Projects/ibsystem
  ```
- Deployment + privacy (basic auth) → [DEPLOY.md](DEPLOY.md).

## File structure

```
ibsystem/
├── README.md                 ← you are here
├── DEPLOY.md                 ← LAN + hosting + auth instructions
├── docs/
│   ├── CONTENT-PLAN.md       ← per-subject content status + what to add next
│   ├── ROADMAP.md            ← feature roadmap (short/medium/later)
│   ├── DEVELOPMENT.md        ← architecture, data schemas, gotchas
│   └── MAINTENANCE.md        ← weekly/termly checklists
├── index.html … *.html       ← 16 pages (see table above)
├── assets/
│   ├── style.css             ← site-wide styles
│   ├── app.js                ← checklists, progress bars, countdown, this-week
│   ├── quiz-engine.js        ← quiz sessions + flashcard hook
│   ├── flashcards.js         ← SRS engine + editor + export/import
│   └── deadlines.js          ← deadline data + timeline renderers
├── library/                  ← all content data (the important folder — back this up)
│   ├── official/             ← 21 PDFs from ibo.org (guides, specimens, briefs, booklets, EE guide)
│   ├── school/               ← ISL course documents (bio outline, chem at-a-glance, math syllabus)
│   ├── notes/                ← 103 topic PDFs, organised by ISL teaching order
│   ├── questions/            ← 7 quiz banks (154 items) — schema in DEVELOPMENT.md
│   ├── flashcards/           ← 3 decks (58 cards) — schema in DEVELOPMENT.md
│   └── papers/               ← (empty) school-provided past papers land here
├── source-archives/          ← original downloaded ZIPs (kept as provenance; deletable once confident)
└── tools/build_site.py       ← OPTIONAL generator for 10 base pages — see warning in DEVELOPMENT.md
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

## Docs index

| Doc | Use it for |
|---|---|
| [docs/CONTENT-PLAN.md](docs/CONTENT-PLAN.md) | What content exists, what's missing, per-subject priorities, completeness matrix |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Feature roadmap: next 2–4 weeks / 2–3 months / later |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | Architecture, data schemas, localStorage keys, gotchas, recipes |
| [docs/MAINTENANCE.md](docs/MAINTENANCE.md) | Weekly/termly checklists, backups, health checks |
| [DEPLOY.md](DEPLOY.md) | Getting it onto her devices safely |

## Next actions (ordered — details in the linked docs)

1. **Send the school-requests email** (ready to copy at the bottom of `plan.html`) — papers + markschemes, History FA2028 guide/specimens, LangLit materials, IA samples. Then file arrivals into `library/papers/<subject>/` and link them on `practice.html`.
2. **Confirm with the school**: Nov–Jun calendar dates (only Aug–Oct verified against the official text layer), French A HL essay applicability, ISL's math unit order, licensed platforms.
3. **De-risk the generator** — `tools/build_site.py` regenerates 10 pages and would *lose hand-patches* (dashboard next-up strip, quiz callout, ISL dates). Do not re-run it before folding those patches in (see [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)).
4. **Build the January banks** (bio water potential/origin of cells, math 2.4–2.5) before the exam window — see [docs/CONTENT-PLAN.md](docs/CONTENT-PLAN.md) queue.
5. **Deploy** behind basic auth (DEPLOY.md) and set up the backup (MAINTENANCE.md).
6. **Start the weekly loop with her** — Monday set the week · Tue+Thu quiz sessions · Friday error log · Sunday idea log. The compounding habit matters more than any remaining feature.

## Known issues & risks (flagged, not urgent)

- **Generator regression risk** — see #3 above. The 10 generated pages are currently *ahead* of the generator.
- **Nov–Jun deadline dates** come from a photo transcription; Aug–Oct verified against the official PDF.
- **Progress is per-device** (localStorage). Export/Import exists on the Cards page; the Google-Sheet sync upgrade is in the roadmap if this starts to hurt.
- **Math Functions bank** is labelled "likely next unit" — ISL's math teaching order isn't documented; confirm and rename if needed.
- **`source-archives/` holds ~434 MB of ZIPs** already extracted into `library/notes/` — safe to delete once you're confident in the extraction (your call).
- A staging copy of the official library exists in the ZCode workspace (`ib-library/`) — `ibsystem/library/` is the canonical one; stop updating the staging copy.
- The dev server (`http://127.0.0.1:8017`) runs as a background process of this session — restart command is documented above.
