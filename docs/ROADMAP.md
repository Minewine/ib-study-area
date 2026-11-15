# Feature Roadmap

Scope guard: every item must serve the actual DP1→DP2 sequence (exams May 2028).
The weekly loop — quiz sessions, flashcards, error log, idea log — is the product;
features only exist to make that loop easier or more targeted.

---

## Shipped (2026-11-15)

- [x] Practice app spun out (`app/`) with content upload (author page) and cross-device sync (auth.js + api.php).
- [x] Automatic error capture: wrong quiz answers stored, review mode re-serves them until correct, unresolved list on the practice page.

## Short-term (next 2–4 weeks · before the December break)

*(The December-exam bank queue is complete — wave-2 extension shipped 2026-11-15. What remains here is verification and usage, not building.)*

- [ ] **School email sent → papers integrated.** File arrivals into `library/papers/<subject>/`, add links to `practice.html`, wire one mock per subject into the plan.
- [x] **Generator de-risked** (2026-11-14): all patches folded into the `PATCHES` list; regeneration verified byte-identical. Keep template edits and PATCHES in sync going forward.
- [x] **January banks built** (2026-11-14): bio water potential/origin of cells (18 items), bio respiration/protein synthesis (21), math functions 2.4–2.5 (22).
- [x] **Chem energetics flashcards deck** — ✅ in place (chem-reactivity-1-energetics, 19 cards).
- [ ] **December 8 rehearsal**: English Paper 1 timed run using the local specimen; error-log entry after.
- [ ] **Calendar verification**: cross-check Nov–Jun dates against the official sheet (only Aug–Oct is text-verified).
- [ ] **Math unit order confirmed** with her teacher; relabel the Functions bank.

## Medium-term (next 2–3 months · January–February, into exam season)

- [ ] **January exam preparation flow**: school papers integrated → full timed mocks per the practice-page protocol → error-log-driven revision for each paper.
- [ ] **IA practice debrief page**: after the November hydrogen-peroxide and January beetroot/osmosis sessions, capture what research-design / data-analysis / conclusion / evaluation looked like in practice — she walks into the June IA experiments having already seen every criterion.
- [ ] **EE launch support (Feb 17 → proposal Mar 2)**: idea-log shortlist page → one-page proposal checklist mapped to the new EE criteria.
- [x] **Quiz banks one unit ahead** (2026-11-15): chem kinetics + equilibrium (Feb–Mar) and bio respiration/protein synthesis built, each with a flashcard deck — the whole Feb–Mar queue is in place.
- [x] **Flashcards decks kept current** (2026-11-15): energetics (Dec), water potential (Jan), respiration — all exist; 12 decks / 229 cards total.
- [x] **Progress dashboard v2** (2026-11-15): "Progress pulse" card on the study dashboard — quiz-score trend (last 5 sessions), flashcards due/mastered/seen, checklist % overall + weakest subject. Checklist % denominator fixed (untouched rows now initialise on hub visits).
- [x] **Deployment** (2026-11-15): live at rametric.com/nevaib over HTTPS, verified end-to-end (api auth, CORS preflights, token sync). Host runs PHP 7.2 — api.php written for it. Remaining habit: `push_deploy.py` for updates + cPanel backup of `~/nevaib-data/`.
- [x] **Study-site sync** (2026-11-15): hub checklist ticks (`chk:*`) + this-week items sync cross-device via a batched `site-state` payload (token auth + CORS in api.php; per-row merge, first-login migration without data loss — browser-verified).
- [x] **In-app quiz item editor** (2026-11-15): author.html — create banks, add/edit/delete items with the upload-path validation, per-bank export; edits flow into the Quiz picker and sync.
- [x] **First backup taken** (2026-11-15): `~/Backups/ibsystem-2026-11-15.zip` (minus `source-archives/`, deploy folder and credentials). Repeat monthly — `library/` is the irreplaceable part.

## Later / nice-to-have (revisit in DP2, or when something actually hurts)

- [x] **Progress sync across devices** (2026-11-15) — done for the practice app and the study-site checklist/week data via the hosted backend (token auth). Not planned: syncing anything beyond these (the data is small and the model is simple).
- [ ] **Chem bonding + organic banks** (DP2 units at ISL: Oct–Nov 2027 / Nov 2027–Mar 2028).
- [ ] **History content banks** — the moment her class's focused studies/topic list is known.
- [ ] **DP2 biology banks** (Continuity → Change units, Sept 2027 onward).
- [ ] **Offline/PWA wrapper** — add a service worker so the whole site (incl. library) works without the server running.
- [ ] **Whole-site dark mode** (currently only the Cards page has it).
- [ ] **NLP-style marking of written answers** — the wishlist item from the original notes; requires a defined marking methodology and is a real product, not a static-page feature. Revisit only if the self-marking discipline proves weak.
- [ ] **AI-predicted questions** — the notes' third sourcing idea; gated on a documented methodology mapped to the syllabus (the blind spot the notes themselves flagged).
- [ ] **Git version control** for `ibsystem/` (recommend: init the repo, commit content, keep `source-archives/` out via .gitignore).

## Explicitly not doing

- No public hosting of `library/` — IB-copyrighted material stays behind auth, forever. (Amended 2026-11-15: the practice app does use a tiny PHP backend for accounts/sync — stdlib PHP, JSON files, no database. The *study-site pages* stay local-only: one folder, no server required.)
- No public hosting of `library/` — IB-copyrighted material stays behind auth, forever.
- No MCQ banks for English/French/History-by-default — wrong tool for analysis subjects, and off-target until History topics are known.
- No feature that adds more than ~30 minutes of monthly maintenance. The 30-minute budget is the ceiling.


---

## Next phase (handoff prompt ready)

The prioritized next-phase list and the full handoff prompt live in
[NEXT-PHASE-PROMPT.md](NEXT-PHASE-PROMPT.md) — paste it into a fresh chat to continue.
