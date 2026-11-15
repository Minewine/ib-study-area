# Maintenance Checklist

The site's value compounds only if it stays current and the loop keeps running.
Budgets are deliberate: **10 min/week · 30 min/month · 1 hour/term.** Anything that
regularly costs more should be simplified, not maintained harder.

---

## Weekly (10 minutes — ideally with her, Sunday or Monday)

- [ ] Dashboard: set this week's 5 items; last week's ticks reviewed (what stayed red?)
- [ ] Flashcards: due count checked; one session planned (Tue/Thu per the plan page)
- [ ] Quiz: last session's weak-topic flags glanced — anything to turn into flashcards?
- [ ] Error log: any retry dates from last week's practice?

## Monthly (30 minutes)

- [ ] **Bank expansion check** against [CONTENT-PLAN.md](CONTENT-PLAN.md): is the next
      unit's bank built *before* ISL teaches it (chem/bio follow the timeline panels)?
- [ ] **Link check** run (script in DEVELOPMENT.md) — especially after edits.
- [ ] **Quiz log trend**: are scores on older topics holding up? If decay > 10%, schedule
      a spaced re-drill rather than moving on.
- [ ] **New session papers**: after each exam season (May/Nov), check school releases;
      add to `library/papers/` and `practice.html`.
- [ ] **Backup**: zip `ibsystem/` minus `source-archives/` to a second location
      (external drive or the hosting server). `library/` is the irreplaceable part.
- [ ] **Host backup** (once deployed to rametric.com/nevaib): the cPanel File Manager is
      disabled on this account — use the FTP + key-gated dumper recipe in
      [server/deploy-notes.md](../server/deploy-notes.md) to pull `~/nevaib-data/`
      (users.json + per-user state) — small, but it holds her progress.

## Termly (start of each ISL term: Jan, Apr, Sep)

- [ ] **Deadlines cross-check**: compare `assets/deadlines.js` against the official school
      calendar version (the Nov–Jun dates came from a photo — verify them at the January term).
- [ ] **Milestone table** on `ia.html`: fill in any new ISL internal dates; mark what's passed.
- [ ] **Currency re-check**: any new IB guide editions announced for her cohort? (Math
      changes first-assess 2029; History/new-guide materials still thin — watch for updates.)
- [ ] **Content completeness review**: update the matrix in [CONTENT-PLAN.md](CONTENT-PLAN.md);
      re-prioritise the queues.
- [ ] **School channel check**: Questionbank topical sets received? IA/TSM samples received?
      If not, chase — these unlock the most valuable content.
- [ ] **Host check** (once deployed): rametric.com/nevaib reachable over HTTPS, login works,
      state file updated recently (cPanel → `~/nevaib-data/state/`).
- [ ] **Works/topic lists** (English + French + History): updated into the hubs, quote
      banks and any new decks.

## Annual (each May/June)

- [ ] **New exam sessions released**: add newly aligned papers (bio/chem from May 2027
      onward; math every session) + markschemes to the library.
- [ ] **Grade boundaries** for the new sessions: glance + note them on the practice page.
- [ ] **Subject report review**: read the examiner commentary for her subjects; turn the
      two most common errors into checklist notes/flashcards.
- [ ] **DP1→DP2 transition** (June 2027): archive the year's trackers (export JSON +
      screenshot progress), reset the "this week" box, confirm DP2 unit sequence vs the
      course outlines (bio DP2 starts with division + IA draft in early September).

## IA & EE milestone anchors (from ISL's calendar — verify each term)

| When | What |
|---|---|
| DP1 Nov | Bio IA practice: hydrogen peroxide (all four criteria) → **fill the debrief on ia.html within a day** |
| DP1 Jan | Bio IA practice: beetroot (research design) + osmosis (analysis/conclusion/evaluation) → **fill the debrief on ia.html** |
| DP1 late June | **Bio IA experiments** (research question fixed by mid-May) |
| DP2 early Sept | **Bio IA draft** |
| DP2 Sep–Oct | Chemistry IA labwork |
| DP2 early Nov | **Bio IA final** |
| DP1 2 Mar | **EE proposal** (subject + topic + RRS) — idea log shortlisted in [ee.html](../ee.html) by the Feb 17 launch; proposal checklist ticked with the supervisor |
| DP2 | EE conference Jun 9 (DP1); viva voce per school |

## Health checks (2 minutes, whenever something seems off)

- [ ] `quiz.html` / `flashcards.html` load their banks (if empty: the server isn't running —
      fetch needs HTTP, see DEVELOPMENT.md).
- [ ] All internal links resolve (link-check script in DEVELOPMENT.md).
- [ ] PDFs open from hub links (spot-check 3).
- [ ] No file in `library/` has leaked to a public URL — the site stays behind auth, always.

## Anti-creep rule

If a proposed feature can't be justified by one sentence starting with "this makes the
weekly loop…" or "this fixes a real mark-loss…", park it in ROADMAP "Later" and move on.
The site is a study tool, not a product.
