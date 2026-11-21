# Generating large batches of quiz questions

Three ways to grow the banks, fastest last:

1. **Ask in a session** — "build the bank for unit X" — a chat session authors + validates +
   registers it (what we've done so far).
2. **Generate with an AI chat yourself** — paste the prompt template below into any capable
   chat (fill in the unit), get a drop-in JSON bank, validate, register. Best for scale.
3. **Hand-write** — for the units where she struggles most; slowest but most targeted.

For large batches, use route 2 with route 1 as the reviewer.

---

## The generation prompt (copy, fill the three [brackets], paste)

```text
Create an IB quiz bank as ONE valid JSON file, exactly matching the schema below.

Subject: [e.g. math-aa-sl / biology-hl / chemistry-hl]
Topic key: [e.g. functions-2-4-to-2-5 — must match the existing bank naming]
Topic label: [human-readable, e.g. "Functions 2.4–2.5 — further functions & transformations"]
Scope: [paste the syllabus section list or unit description here — from the
       ISL course outline or the IB guide, NOT from memory]
Count: 20 multiple-choice + 2 written items (Paper 1A / Paper 2 style)
Level: [SL only / SL+AHL as appropriate]

Schema (return ONLY this JSON, no commentary):
{
  "subject": "<subject key>",
  "topic": "<topic key>",
  "topicLabel": "<topic label>",
  "items": [
    { "id": "<topic-01>", "format": "mcq", "stem": "…",
      "choices": ["…", "…", "…", "…"], "answer": 0,
      "suggestedDifficulty": "…",
      "note": "why the right answer is right + the trap in the wrong ones" },
    { "id": "<topic-21>", "format": "written", "marks": 4, "stem": "…",
      "suggestedDifficulty": "…",
      "markscheme": ["point (1)", "point (1)"],
      "tactic": "how to attack this question type" }
  ]
}

Quality rules — these are hard requirements:
- Exactly ONE defensibly correct answer per MCQ; plausible distractors; no "all of the above".
- Every note states the fact AND the trap. No hedging, no self-correction.
- Written markschemes are mark-by-mark, each entry earning exactly one point.
- Items must be answerable from the stated scope only — no content from other topics.
- Mix recall, application and data/calculation items roughly 40/40/20.
- Ids: <topic>-01 … sequential, unique.
- Difficulty: ~30% easy, 50% standard, 20% hard.
- "suggestedDifficulty" on every item is your best guess: "easy" = single-step recall or
  direct substitution, "standard" = a typical exam-style multi-step question, "hard" =
  extended, multi-step or multi-topic work. Suggestions only — the app keeps them marked
  unreviewed until the student checks and applies them in the Upload preview.
```

---

## The post-generation loop (this is where quality comes from)

1. **Save** the returned JSON as `library/questions/<topic-key>.json`.
2. **Validate**: `python3 -I tools/validate_content.py` — catches structural errors
   (schema, ids, answer bounds, markschemes). Fix and re-run until it passes.
3. **Register**: add one line to `library/questions/manifest.json`
   (`{"file": "library/questions/<name>.json", "subject": "...", "subjectLabel": "...", "label": "..."}`).
4. **Spot-check 5 items against the notes/guide** — AI-generated items fail on FACTS, not
   format. Wrong questions are worse than missing ones; delete anything doubtful.
5. **Apply the difficulty suggestions** — after the spot-check, check each AI-suggested
   difficulty in the Upload preview and apply it (per item, or "Apply all suggestions");
   fix wrong ones by hand instead. Nothing unreviewed ships: importing strips any
   suggestion you did not apply.
6. **Refresh the Quiz page** — the new bank appears in the picker (bump `?v=N` if it
   doesn't; see docs/DEVELOPMENT.md cache-busting).

---

## What AI generation is good and bad at

Good: format-perfect banks, broad syllabus coverage, plausible distractors, consistent
mark-by-mark markschemes, fast scale.

Bad: occasional factual errors (especially chemistry calculations and biology
mechanisms), hallucinated syllabus codes, questions slightly off the IB's wording style.
That's why step 4 exists: a human spots 5 items per batch against the notes, and the
daughter's error log catches the rest in use. Expect to delete ~1 in 20 at first; the
rate drops as the prompt's scope section gets more precise.
