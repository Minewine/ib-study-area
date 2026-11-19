# User test — a guided tour for the actual student

_Purpose: a real person clicks through everything before we call the multi-user release good.
~30–45 minutes, on whatever device you'd actually use (phone or laptop), logged in at
**https://rametric.com/nevaib** with your own username and password._

As you go, jot down three kinds of notes: **👍 worked**, **🤔 confused me**, **🐛 broke**.
Nobody is judging the clicks — we're judging the site.

---

## 0. Before you start

1. Open **https://rametric.com/nevaib** and log in.
2. If the site looks odd or old, hard-refresh the page (Ctrl+Shift+R, or on phones: browser menu → refresh). It was just updated.
3. After logging in, the small box at the top should say `👤 <your name>` and eventually `Synced ✓` — that's your data syncing to your own private account.

## 1. The click-through checklist

Work top to bottom. You don't have to finish everything — cover what you'd actually use.

| # | Where | What to do | What you should see |
|---|---|---|---|
| 1 | Home | Look at the countdown, your subject cards, "this week", next deadlines | Subject cards for your subjects; nothing for subjects you don't take |
| 2 | Today | Open the app home → **Today** panel: start the due cards, try the weakest-topic quiz, read "this week in class" | Cards due today; a 6-question quiz; class units for the week |
| 3 | Notes | Open **Notes**, pick any topic. Read the key ideas. Use the **quiz** and **cards** links under the note | The quiz starts on that note's exact questions; cards start on its deck |
| 4 | Notes → **Ask an AI** | On the same note: pick a mode (explain / quiz me / data-response), pick an assistant, press the button | The prompt is copied, a new tab opens on the AI — paste (Ctrl+V / long-press → Paste) and send. If the copy fails, the tab must NOT open and you should see a "copy again" button |
| 5 | Quiz | Run one full session (mix MCQ + written). Answer honestly. Use **sure / guessing** when asked | MCQs marked instantly; written ones you mark yourself against the markscheme; the summary at the end |
| 6 | Quiz → missed questions | Deliberately get one wrong, then find it in the review list | The question shows your answer, the note, and re-serves until you get it right |
| 7 | Cards | Rate a few due cards; try the editor on one card; flip dark mode on and off | Boxes go up/down; edits stick after reload |
| 8 | Coursework | Open the planner, tick something, add a note, set a date | It saves and survives a page reload |
| 9 | Library | Filter by subject, open a PDF, ★ pin something | PDF opens in a new tab; the pin shows on the dashboard |
| 10 | Practice / Deadlines / Plan | Skim each page | Papers table, timeline (past struck through), term plan |
| 11 | Everywhere | Watch the top-right widget | `Synced ✓` appears within a couple of seconds after you change anything |
| 12 | Log out, log back in | Check your ticks/boxes/scores are still there | Everything you did is still yours — this is the multi-user part: your data is nobody else's |

## 2. Make your own quiz — upload a question bank

This is the fun one: you choose the topic, an AI writes the questions, you upload them and quiz yourself on them.

### Step 1 — pick a topic
One syllabus topic you want to get better at (e.g. Bio A1.1 Water, Chem S1.1 Particulate nature, Maths 1.1 Number toolkit).

### Step 2 — give this prompt to any AI (Gemini / ChatGPT / Claude)

Copy the whole block below, replace the three `FILL-IN` lines, paste it into the AI, and send it.
It asks for **only the JSON** in exactly the format the site needs.

```text
You are writing quiz questions for an IB Diploma student. Output ONLY a JSON code block —
no explanation before or after. Use original questions (never copy IB past-paper questions
or markschemes). IB DP level, but clear and fair.

Fill this EXACT JSON shape:
{
  "subject": "FILL-IN subject id (one of: biology-hl, chemistry-hl, math-aa-sl)",
  "topic": "FILL-IN topic code (I will give you mine below)",
  "topicLabel": "FILL-IN human-readable topic name",
  "items": [
    {"id": "p01", "format": "mcq", "topic": "<same topic code>",
     "stem": "question text", "choices": ["option A", "option B", "option C", "option D"],
     "answer": 1,
     "note": "why the answer is right AND the trap people fall into"},
    {"id": "p02", "format": "written", "topic": "<same topic code>", "marks": 3,
     "stem": "question text needing 2-4 sentences or a calculation",
     "markscheme": ["marking point (1 mark)", "marking point (1 mark)", "marking point (1 mark)"],
     "tactic": "how to attack this question type"}
  ]
}

Rules:
- 8 questions total: 5 MCQ (ids p01–p05), 3 written (ids p06–p08).
- "answer" is the 0-based index into "choices" (first option = 0).
- Every item repeats the same "topic" as the bank.
- MCQ distractors must be plausible — real misconceptions, not joke answers.
- Written markschemes: one short marking point per mark, like a real markscheme.
- My topic: FILL-IN topic code (for example: c1-1-enzymes-metabolism, structure-3-1-periodicity, 1-1-number-toolkit)
- My topic name: FILL-IN (for example: "C1.1 — Enzymes & metabolism")
```

If the AI adds chatter around the JSON, reply: *"only the JSON, nothing else"*.

### Step 3 — upload it
1. Go to **Upload** (the author page, `author.html`).
2. Paste the JSON into the paste box (or use the file import if you saved it as a `.json` file) and submit.
3. Green result = uploaded. Red error = the JSON is malformed — check the message, fix (usually a missing comma) or ask the AI to repair it, and try again. Stuck? Screenshot it for dad.

### Step 4 — use it
1. Open **Quiz** → your bank appears under its subject (it's labelled as one of your uploaded banks).
2. Run a session on it. Get one wrong on purpose and find it in the missed-questions review.
3. To fix or remove questions later: **Upload** page → manage/edit items, or delete the whole bank. Your changes survive reloads and sync across your devices.

### Step 5 — say what you think
Was the upload flow clear? Did the AI's questions feel like real exam questions? Was the "note" actually useful?

## 3. About "Ask an AI" (the copy-and-open thing)

- It lives on every **topic note**, with modes: explain it, quiz me on it, unfamiliar data-response, help with my wrong answers.
- It **copies the prompt first, then opens the assistant** — because a browser only allows copying while the page still has focus. So: button → switch to the AI tab → **paste** → send.
- If you see "Copied ✓" but no tab opened, your browser blocked the pop-up — there's a hint for that; allow pop-ups for this site.
- The prompt never contains your name, school, or grades — just the topic content.
- Pick your favourite assistant in the dropdown (Gemini is the default); it's remembered on that device.

## 4. When you're done

1. Press **Sync now** once and wait for `Synced ✓`.
2. (Optional, extra safe) Cards page → **Download full backup** — a file with all your progress. Keep it.
3. Send dad your 👍 / 🤔 / 🐛 list. Short is fine; specific is better ("the pin didn't show on my phone" beats "library weird").

Thanks — this is the part that makes the site actually good.
