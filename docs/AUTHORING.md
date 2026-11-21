# Authoring Guide — add your own quiz banks and flashcard decks

You never need to touch JavaScript. The workflow is: **fill a JSON file → drop it in the
right folder → add one line to the manifest → validate → refresh the browser.**

---

## The two formats

### 1. Quiz bank (`library/questions/*.json`)

```json
{
  "subject": "chemistry-hl",
  "topic": "structure-2-bonding",
  "topicLabel": "Structure 2 — Bonding (DP2: Oct–Nov unit)",
  "items": [
    {
      "id": "b01",
      "format": "mcq",
      "stem": "Which compound is held by ionic bonding?",
      "choices": ["CO2", "MgO", "CH4", "I2"],
      "answer": 1,
      "note": "Metal → non-metal electron transfer. answer is the 0-based index of the correct choice (B = 1)."
    },
    {
      "id": "b02",
      "format": "written",
      "marks": 4,
      "stem": "Explain why NaCl conducts when molten but not when solid.",
      "markscheme": ["Ions present in both states (1)", "Solid: ions fixed in the lattice (1)", "Molten: ions free to move (1)", "Conduction = movement of charged particles (1)"],
      "tactic": "Structure → property → reason. Name what changes at melting."
    }
  ]
}
```

Rules that the validator enforces:
- `id`: unique **within the file** (kebab-case, stable — never reuse an id for a different question).
- `format`: `"mcq"` or `"written"` — nothing else.
- `mcq`: `answer` is the **0-based index** into `choices` (first choice = 0). Minimum 2 choices.
- `written`: needs `marks` (≥ 1) and a `markscheme` list where each entry carries its own mark allocation, e.g. `"point (1)"`.
- Every item needs `stem`; written items should also carry a `tactic`.
- `topic` must match the topic key used by the hub checklist (that's what links the two).

Optional fields (all validated; unknown values are rejected, absent fields change nothing):
- Bank-level `set`: the practice-set display name shown under its topic in the Quiz picker
  (e.g. `"Practice set 1 — core recall"`). Without it, the picker uses the manifest `label` — so
  old banks need no renaming. Two sets may share a topic but must use unique `set` names
  (duplicate names get a warning; uploads get a suggested next name instead).
- Bank-level `setOrder`: integer, display order of the set within its topic (sets without one sort last).
- Bank-level `codes`: array of official IB topic codes the bank covers, e.g. `["S1.1", "S1.2"]` —
  used to suggest which topics are already taught (from `library/class-schedule.json`). Only state
  codes the data actually covers; the item-level `topic` keys stay the join to notes and cards.
- Bank-level `paperStyle` (`"1A"` / `"1B"`) + `calculatorFree` (`true`): label Paper-style sets
  ("Paper 1A · calculator-free", "Paper 1B · data practice") in the set picker. Never infer these —
  they describe what the set emulates.
- Item-level `difficulty`: `"easy"`, `"standard"` or `"hard"`, per question. Untagged questions
  show and filter as **Unrated** — only tag what you know; nothing guesses a rating for you.
  Quiz sessions default to rated **Foundation (easy) + Core (standard)** first and only top up
  from unrated when the rated pool runs short (top-up checkbox, on by default; hard/Stretch stays
  opt-in). AI-generated banks carry `suggestedDifficulty` instead — the Upload preview shows it
  as unreviewed until you apply it, and importing without applying discards it.

### 2. Flashcard deck (`library/flashcards/*.json`)

```json
{
  "subject": "biology-hl",
  "topic": "c1-1-enzymes-metabolism",
  "topicLabel": "C1.1 — Enzymes & metabolism (Nov unit)",
  "cards": [
    {
      "id": "fc-bio-e-01",
      "type": "term",
      "tags": ["definition"],
      "front": "Enzyme",
      "back": "Globular protein catalyst that lowers activation energy without being consumed."
    },
    {
      "id": "fc-bio-e-02",
      "type": "qa",
      "tags": ["IA"],
      "front": "Why include a boiled-enzyme tube?",
      "back": "Negative control — proves the change is enzyme-dependent."
    }
  ]
}
```

Rules:
- `id` must be unique **across ALL decks** (the spaced-repetition state is keyed by id) — prefix per deck: `fc-bio-e-…`, `fc-math-tf-…`.
- `type`: `"term"` (term → definition) or `"qa"` (question → answer). Purely presentational.
- `tags` free-form; the site uses `definition`, `formula`, `process`, `command-term`, `IA`, `exam`.
- `topic` must match the quiz bank's topic so cards and questions interlink.
- Optional deck-level `set` / `setOrder`: display name + order when several decks share one topic
  (Cards topic options then show "— <set name>"). Same rules as the quiz-bank fields above.

---

## The drop-in workflow (5 steps)

1. **Copy the template**: `library/templates/quiz-bank-template.json` (or `flashcard-deck-template.json`).
2. **Fill it in** — keep `subject` and `topic` keys consistent with the existing banks (copy them from a working file).
3. **Save** into `library/questions/` (or `library/flashcards/`) as `kebab-case-name.json`.
4. **Register**: add one line to the matching manifest (for `library/questions/`, or run the
   generator instead — it appends the entry and computes the picker metadata for you):
   - `python3 -I tools/build_questions_manifest.py` — preserves every existing entry (labels and
     order) byte-identical, appends new banks (label = `topicLabel` or filename), and fills in the
     computed `counts`/`topics` metadata the Quiz picker uses for its hierarchy. `--check` exits
     non-zero if the file on disk would change (CI-friendly).
   - `library/flashcards/manifest.json` → `{"file": "library/flashcards/my-new-deck.json", "subject": "biology-hl", "subjectLabel": "Biology HL"}`
5. **Validate + refresh**: run `python3 -I tools/validate_content.py` (it exits non-zero on any problem; it also
   verifies the generated questions manifest against the bank files), then reload the browser page. Done — the picker picks it up automatically.

Uploaded banks also feed the **error-review loop**: wrong answers from an uploaded bank are stored in the
missed-question tracker (`q-errors`, synced when logged in), and the Quiz page's “Review past errors” mode
re-serves them until they're answered correctly.

If the manifest line is missing, the bank simply doesn't appear in the picker (no error).
If a JSON has a syntax error, the validator names the file and the problem.

---

## Creating large batches of questions

For scale (a whole unit, or several), don't hand-write JSON — use the generation prompt in
[QUIZ-GENERATION-PROMPT.md](QUIZ-GENERATION-PROMPT.md): paste it into any capable AI chat with
the unit's syllabus scope filled in, save the returned JSON as a bank, validate, spot-check
5 items against the notes, register in the manifest. The validator catches format errors;
the human spot-check catches factual ones (the real failure mode of generated questions).

A flashcard-deck equivalent works the same way with the deck schema (fronts 3–12 words,
one fact per card).

## Where the engines read from

- `quiz.html` loads `library/questions/manifest.json` at startup and builds its **Subject →
  syllabus topic → practice set** hierarchy from it. Each entry keeps its hand-written
  `{"file", "subject", "subjectLabel", "label"}` plus computed metadata (added by
  `tools/build_questions_manifest.py`): the bank's `topic`/`topicLabel`/`set`/`setOrder`/
  `codes`/`paperStyle`/`calculatorFree`, `counts {mcq, written, total}` over active items, and
  `topics: [{topic, topicLabel, count, difficulty:{unrated, easy, standard, hard}}]` — the
  per-topic aggregation (effective topic = item `topic`, else the bank's, else the filename).
- `flashcards.html` loads `library/flashcards/manifest.json` the same way (topic options show
  card counts; deck `set` names appear when a topic has them).
- Both have a built-in fallback list, so the site keeps working even if a manifest is broken —
  fallback banks simply appear as one set each, without metadata.

Topic options show question counts and teaching status; the **Taught topics only** filter and
the difficulty range (Unrated < easy < standard < hard — default easy→standard, filling any
shortfall from unrated) then apply to specific topics
and to *Mixed* alike. Teaching status is suggested from `library/class-schedule.json` (a topic
whose codes are all in units that have finished) and can be overridden per topic in the
"Topics & teaching status" panel on the Quiz page (stored in the synced `topic-taught` key).
Topics with no schedule data are always shown — nothing is hidden by default.

A good "Mixed" session for the current term = set Subject to the subject, Topic to
*Mixed — all topics (revision)*: the engine concatenates every registered bank for that
subject, so review + new unit mix automatically (narrowed to taught topics when the filter is on).

---

## Quality rules (what makes a good item)

- One defensibly correct answer. If two options could argue for "correct", rewrite the item.
- Every MCQ carries a `note`: the fact AND the trap (why wrong options tempt).
- Written markschemes are mark-by-mark: each entry states one earning point and its marks.
- Stems are self-contained (no "in the example above").
- Flashcard fronts are 3–12 words; backs are 1–3 lines. One fact per card — split compound facts into two cards.
- Tag honestly (`definition`, `formula`, `process`, `command-term`, `IA`, `exam`) — the filters are only as useful as the tags.

---

## Adding a new SUBJECT (rare)

1. Create the banks/decks with the new `subject` key (e.g. `ess-sl`).
2. Add the manifest entries with a `subjectLabel` (e.g. "Environmental Systems & Societies").
3. The quiz and Cards pickers pick it up automatically. For a full subject **hub page**, copy an
   existing hub and follow docs/DEVELOPMENT.md (hubs are generated or hand-maintained — see there).


---

## Uploading your own content (the Practice App)

The standalone practice app (`app/` — Quiz, Cards, Upload) accepts your own JSON files
without touching the server or any manifest:

1. Author the JSON per the formats above (copy a template from `library/templates/`).
2. Open the app's **Upload** page, drop the file (or paste the JSON) and press Add.
3. The upload is validated (ids, answer indexes, markschemes, required fields) and stored
   **in that browser** — it appears immediately in the Quiz and Cards pickers.

Notes:
- Uploaded content is **per device** (localStorage) when the app runs locally. On the hosted
  copy (rametric.com/nevaib, logged in), uploads and progress **sync to the server** and follow
  the account across devices. Use the Upload page's **Download my content** button as a backup,
  and **Import** to restore on a new device.
- To make an uploaded bank permanent for every device: save its JSON into
  `library/questions/` (or `library/flashcards/`) and add one line to the matching
  `manifest.json` (or run `python3 -I tools/build_questions_manifest.py`) — then delete the
  upload from the app to avoid duplicates.
- Uploaded quiz banks must carry a `subject` key; a bank-level `label` and `subjectLabel`
  are optional (they name the entry in the picker). Bank-level `set`/`setOrder`/`codes` and
  item-level `difficulty` follow the same optional-field rules as above; the item editor can
  set per-question difficulty (Unrated omits the field).
- There is **no question-count or file-size limit** on uploads — batch-import as many files as
  you like in one go; each file gets its own result line. The real ceiling is the browser's
  storage quota (the upload reports it if hit). When a topic already has sets, the result
  suggests the next free "Practice set N" name (a suggestion only — your file is saved as-is).
- Validate before uploading: `python3 -I tools/validate_content.py` checks the library
  files; the Upload page applies the same rules in the browser.

---

## AI-assisted authoring (Ask an AI → paste → preview → import)

For one-topic practice sets there is a built-in path that needs no JSON knowledge —
the student picks a topic and the app writes the prompt for her:

1. **Upload page, section 1** — pick a subject and a topic (topics come from the
   topic-notes manifest), press **Copy the prompt & open your AI**. The prompt (mode
   `bankgen` in `library/ai-prompts.json`) carries the exact `subject` id and `topic`
   key, so the AI's JSON lands in the right picker. Nothing is sent by the site: the
   prompt is copied to the clipboard first, then the assistant opens in a new tab.
2. The same **"Write a practice set to import"** button sits in every topic note's
   Ask an AI box (Notes page), prefilled with that note's topic.
3. **Paste the returned JSON into section 2** and press **Preview pasted JSON**. The
   staged preview shows every item for editing (stem, choices, correct answer, note,
   marks/markscheme) or removal, re-validating with the shared bank rules
   (`assets/bank-schema.js`) after every keystroke. Nothing is saved yet.
4. **Import bank** saves the whole set in one batch as a normal uploaded bank
   (`q-userbanks` — identical shape to a file upload), and it appears in the Quiz
   picker immediately. *Discard* throws the staging away.

Rules and edges:
- Files still upload **directly** (no preview) — the preview is for pasted AI output.
  Very large pastes get per-item editors for the **first 200 items** only; the rest
  are shown as a count and import as-is (edit them afterwards in the item editor,
  section 4).
- The preview suggests a unique bank name (`ai-<topic>.json`, `-2`, `-3`…); the
  duplicate-name collision that used to block a second paste is resolved by editing
  that field. The suggested name is editable.
- To change the prompt wording, add a mode, or switch assistants: edit
  `library/ai-prompts.json` (`_doc` lists the placeholders; `bankgen` also uses
  `{subjectid}` and `{topickey}`) and run `./dev.sh test`. There are **no external API
  calls** anywhere in this flow — copy-and-paste is the transport, on purpose.
- Same hard rule as everywhere: the AI must write **original** items to the syllabus;
  the prompt forbids past-paper reproduction, and pasted content passes the same
  validation as hand-written banks.

---

## My resources (links — never quiz content)

The **Resources** page (`app/resources.html`) collects the student's own links:
title, subject, optional topic, type (website / video / document / practice
questions / other), URL and an optional note. Rules:

- Stored in the same synced key the per-note links use (`my-res`, per-user scoped,
  tombstone deletes, newest-`t` merge — see `assets/resources.js`). A resource whose
  topic matches a topic note can also **show on that note** (the "Also show on the
  topic note" checkbox), and the notes page's own "My resources" box keeps working.
- A resource is **only a link**: URLs must be `http(s)://` or `file://` (≤2000 chars).
  File contents are never stored — no base64 PDFs in localStorage.
- Resources are **never read by the quiz or card engines** — nothing on that page can
  turn into quiz content. Each row offers *Make questions…*, which opens the Upload
  page's AI flow (section 1) pre-selected to the resource's subject/topic.
- Backups and restore accept the extended record shape (`assets/backup.js` validates
  label/url/subject/topic/type/comment); tests: `tests/js/resources.test.js`,
  `tests/js/myres.test.js`.
