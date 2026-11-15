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

---

## The drop-in workflow (5 steps)

1. **Copy the template**: `library/templates/quiz-bank-template.json` (or `flashcard-deck-template.json`).
2. **Fill it in** — keep `subject` and `topic` keys consistent with the existing banks (copy them from a working file).
3. **Save** into `library/questions/` (or `library/flashcards/`) as `kebab-case-name.json`.
4. **Register**: add one line to the matching manifest:
   - `library/questions/manifest.json` → `{"file": "library/questions/my-new-bank.json", "subject": "chemistry-hl", "subjectLabel": "Chemistry HL", "label": "My new topic"}`
   - `library/flashcards/manifest.json` → `{"file": "library/flashcards/my-new-deck.json", "subject": "biology-hl", "subjectLabel": "Biology HL"}`
5. **Validate + refresh**: run `python3 -I tools/validate_content.py` (it exits non-zero on any problem), then reload the browser page. Done — the picker picks it up automatically.

If the manifest line is missing, the bank simply doesn't appear in the picker (no error).
If a JSON has a syntax error, the validator names the file and the problem.

---

## Where the engines read from

- `quiz.html` loads `library/questions/manifest.json` at startup and builds its subject/topic
  pickers from it. Each entry: `{"file": "...", "subject": "...", "subjectLabel": "...", "label": "..."}`.
- `flashcards.html` loads `library/flashcards/manifest.json` the same way.
- Both have a built-in fallback list, so the site keeps working even if a manifest is broken.

A good "Mixed" session for the current term = set Subject to the subject, Topic to
*Mixed — all available topics*: the engine concatenates every registered bank for that
subject, so review + new unit mix automatically.

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
  copy (rametic.com/nevaib, logged in), uploads and progress **sync to the server** and follow
  the account across devices. Use the Upload page's **Download my content** button as a backup,
  and **Import** to restore on a new device.
- To make an uploaded bank permanent for every device: save its JSON into
  `library/questions/` (or `library/flashcards/`) and add one line to the matching
  `manifest.json` — then delete the upload from the app to avoid duplicates.
- Uploaded quiz banks must carry a `subject` key; a bank-level `label` and `subjectLabel`
  are optional (they name the entry in the picker).
- Validate before uploading: `python3 -I tools/validate_content.py` checks the library
  files; the Upload page applies the same rules in the browser.
