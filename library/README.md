# library/ — content folder (mostly local-only)

This folder is the site's content data. **Most of it is deliberately NOT in the git
repository** — it holds copyrighted material (IB past papers/specimens/guides, ISL
internal course documents, and study notes that are not licensed for redistribution).
`.gitignore` excludes those folders; only the two `*-original*` folders are tracked.

Reconstruct it locally like this:

| Folder | In git? | How to populate | What the site expects |
|---|---|---|---|
| `official/` | ❌ | Download from ibo.org (free, public): specimen papers, subject briefs, formula/data booklets, EE guide. See the source list below. | Exact filenames listed in the manifest — hub pages link them directly |
| `school/` | ❌ | ISL course documents from her teachers (bio course outline, chem at-a-glance, math syllabus content) | `bio-course-outline-2026-28.pdf`, `chem-at-a-glance-m28.pdf`, `math-aa-syllabus-content.pdf` |
| `notes/` | ❌ | Topic notes per ISL teaching order — keep your local copies private | `<subject>/<section>/<topic>.pdf`; hub checklist rows link each file |
| `papers/` | ❌ | School-provided past papers + markschemes → one subfolder per subject | Surface on `practice.html` + `library.html` once in the manifest |
| `questions/` | ✅ tracked | — | 24 quiz banks (673 items), schema in `docs/DEVELOPMENT.md` |
| `flashcards/` | ✅ tracked | — | 24 decks (524 cards), same schema |

## Manifest — `library/library-manifest.json`

`python3 -I tools/build_library_manifest.py` scans `library/{notes,official,school,papers}`
(`questions/` and `flashcards/` keep their own manifests and are NOT scanned) and writes one entry per
PDF — `{file, subject, subjectLabel, type, section, label}`, sorted by (type, subject, section, label),
127 items at last count. Rebuild it after **every** PDF lands or moves: `library.html` (the browse/filter
page), the dashboard pinned-resources card and the practice papers list all render from this file, so a
PDF only becomes visible on the site once it is in the manifest.

## Manifest — `library/official/` (paths the pages link)

- `math-aa-sl/math-aa-formula-booklet-fa2021.pdf` — ibo.org → Maths in the DP
- `math-aa-sl/math-aa-specimen-papers-fa2021.pdf` — ibo.org → [sample exam papers](https://www.ibo.org/programmes/diploma-programme/assessment-and-exams/sample-exam-papers/)
- `math-aa-sl/math-aa-subject-brief-fa2021.pdf` — ibo.org
- `biology-hl/biology-hl-sl-specimen-papers-fa2025.pdf` — [ibo.org globalassets](https://www.ibo.org/globalassets/new-structure/programmes/dp/pdfs/biology-hl-sl-specimen-papers-1a-2b-2-en.pdf)
- `biology-hl/biology-hl-sample-paper-1b-fa2025.pdf` · `biology-sl-sample-paper-1b-fa2025.pdf` · `biology-subject-brief-fa2025.pdf` — ibo.org
- `chemistry-hl/chemistry-hl-sl-specimen-papers-fa2025.pdf` — [ibo.org globalassets](https://www.ibo.org/globalassets/new-structure/programmes/dp/pdfs/chemistry-hl-sl-specimen-papers-1a-2b-2-en.pdf)
- `chemistry-hl/chemistry-data-booklet-fa2025-v1.1.pdf` — ibo.org chemistry page (mirror: ibchem.com)
- `chemistry-hl/chemistry-hl-sample-paper-1b-fa2025.pdf` · `chemistry-sl-sample-paper-1b-fa2025.pdf` · `chemistry-subject-brief-fa2025.pdf` — ibo.org
- `history-sl/history-subject-brief-fa2028.pdf` (+ old-guide briefs, optional) — [History updates page](https://www.ibo.org/university-admission/latest-curriculum-updates/history-updates)
- `french-a-langlit/language-a-langlit-subject-brief.pdf` — ibo.org
- `english-lit-hl/english-a-lit-hl-paper-1-sample-fa2021.pdf` — [ibo.org](https://www.ibo.org/globalassets/new-structure/programmes/dp/pdfs/english-a-literature-hl-paper-1-en.pdf)
- `english-lit-hl/english-a-lit-hl-sl-paper-2-specimen-fa2021.pdf` — [ibo.org](https://www.ibo.org/globalassets/new-structure/programmes/dp/pdfs/english-a-literature-hl-sl-paper-2-en.pdf)
- `core-tok-ee/extended-essay-guide-fa2027.pdf` · `extended-essay-subject-brief-fa2027.pdf` · `tok-subject-brief.pdf` — ibo.org

The specimens are genuinely free/public on ibo.org — linking or downloading them for
private use is the clean route. **Do not commit them, and do not host them publicly.**

## Why the split?

The repo carries code + docs + original authored content (quiz banks, flashcards) — that
is safely shareable. The copyrighted PDFs stay on the family's machines only. If the repo
is cloned somewhere new, run the site, and the quiz/flashcard modules will work immediately;
the PDF-dependent bits (hub document links) fill in as the folders are repopulated.
