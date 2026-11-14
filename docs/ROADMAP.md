# Feature Roadmap

Scope guard: every item must serve the actual DP1→DP2 sequence (exams May 2028).
The weekly loop — quiz sessions, flashcards, error log, idea log — is the product;
features only exist to make that loop easier or more targeted.

---

## Short-term (next 2–4 weeks · before the December break)

- [ ] **School email sent → papers integrated.** File arrivals into `library/papers/<subject>/`, add links to `practice.html`, wire one mock per subject into the plan.
- [x] **Generator de-risked** (2026-11-14): all patches folded into the `PATCHES` list; regeneration verified byte-identical. Keep template edits and PATCHES in sync going forward.
- [ ] **January banks built** (one unit ahead): bio water potential + origin of cells; math Functions 2.4–2.5.
- [ ] **Chem energetics flashcards deck** (small: definitions, q=mcΔT, ΔG cases) before that unit starts in December.
- [ ] **December 8 rehearsal**: English Paper 1 timed run using the local specimen; error-log entry after.
- [ ] **Calendar verification**: cross-check Nov–Jun dates against the official sheet (only Aug–Oct is text-verified).
- [ ] **Math unit order confirmed** with her teacher; relabel the Functions bank.

## Medium-term (next 2–3 months · January–February, into exam season)

- [ ] **January exam preparation flow**: school papers integrated → full timed mocks per the practice-page protocol → error-log-driven revision for each paper.
- [ ] **IA practice debrief page**: after the November hydrogen-peroxide and January beetroot/osmosis sessions, capture what research-design / data-analysis / conclusion / evaluation looked like in practice — she walks into the June IA experiments having already seen every criterion.
- [ ] **EE launch support (Feb 17 → proposal Mar 2)**: idea-log shortlist page → one-page proposal checklist mapped to the new EE criteria.
- [ ] **Quiz banks one unit ahead** (chem kinetics + equilibrium for Feb–Mar; bio respiration for Feb).
- [ ] **Flashcards decks kept current**: energetics (Dec), water potential (Jan), then respiration.
- [ ] **Progress dashboard v2**: index card showing quiz-score trend (last 5 sessions from `quizlog`), flashcards due tomorrow, and checklist % per subject — one small stats aggregation, no new infrastructure.
- [ ] **Deploy decision executed** (basic auth on the website host) + first backup taken.

## Later / nice-to-have (revisit in DP2, or when something actually hurts)

- [ ] **Progress sync across devices** (Google-Sheet embed or a tiny JSON-sync) — only if per-device localStorage becomes a real annoyance.
- [ ] **Chem bonding + organic banks** (DP2 units at ISL: Oct–Nov 2027 / Nov 2027–Mar 2028).
- [ ] **History content banks** — the moment her class's focused studies/topic list is known.
- [ ] **DP2 biology banks** (Continuity → Change units, Sept 2027 onward).
- [ ] **Offline/PWA wrapper** — add a service worker so the whole site (incl. library) works without the server running.
- [ ] **Whole-site dark mode** (currently only the Cards page has it).
- [ ] **NLP-style marking of written answers** — the wishlist item from the original notes; requires a defined marking methodology and is a real product, not a static-page feature. Revisit only if the self-marking discipline proves weak.
- [ ] **AI-predicted questions** — the notes' third sourcing idea; gated on a documented methodology mapped to the syllabus (the blind spot the notes themselves flagged).
- [ ] **Git version control** for `ibsystem/` (recommend: init the repo, commit content, keep `source-archives/` out via .gitignore).

## Explicitly not doing

- No accounts/servers/backends — the site's value is that it is one folder.
- No public hosting of `library/` — IB-copyrighted material stays behind auth, forever.
- No MCQ banks for English/French/History-by-default — wrong tool for analysis subjects, and off-target until History topics are known.
- No feature that adds more than ~30 minutes of monthly maintenance. The 30-minute budget is the ceiling.
