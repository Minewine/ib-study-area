# Feature Roadmap

_Last updated: 20 Nov 2026._

Scope guard: every item must serve the actual DP1→DP2 sequence (exams May 2028).
The weekly loop — quiz sessions, flashcards, error log, idea log — is the product;
features only exist to make that loop easier or more targeted.

---

## Shipped (2026-11-20)

Student-feedback improvement phases (built across 20 Nov sessions; consolidated, tested and
committed the same day — deploy pending approval):

- [x] **Phase 0 — baseline review + Today panel loading/error states** (commit `58f6539`): every
  Today fetch gets a 10 s timeout with explicit error states; dark-mode attribute mismatch fixed
  (`data-fcTheme`); Cards editor deck dropdown, uploaded-deck edits, quiz-upload manage list,
  storage-full reporting and deck-id collisions fixed; upload limits measured and documented (no cap).
- [x] **Phase 1 — practice sets + filters**: banks/decks carry optional `set`/`setOrder`/`codes`
  (+ `paperStyle`/`calculatorFree`) and item-level `difficulty` (`easy|standard|hard`, absent =
  unrated — zero migration); the Quiz picker groups banks as **sets under their topics**, adds a
  **difficulty-range filter** and a **taught-topics-only toggle** backed by a "Topics & teaching
  status" panel (`topic-taught`, synced per topic). Shared validators live in `assets/bank-schema.js`
  (same rules run in `tools/validate_content.py`); `tools/build_questions_manifest.py` computes the
  picker metadata. Upload limits confirmed: no cap (40k items import; ceiling = localStorage quota).
- [x] **Phase 2 — mistake log** (`app/mistakes.html` + `assets/mistakes.js`): every wrong answer
  with error type, reflection (≤500), retry history (capped 20); recovered vs unresolved vs
  **"not relevant"** (reversible soft-hide, never deleted); status/subject/search filters;
  one-question retry deep links (`quiz.html?errkeys=`). Sync-merge of the new `q-errors` fields is
  field-aware (retries union, reflection fill-in, retired rides the winner).
- [x] **Phase 3 — biology navigation + today suggestions**: Biology hub checklist grouped under
  **A/B/C/D theme headings with live search** (empty state + heading hiding); Today panel adds
  **ranked suggestions with visible reasons** (open mistakes → retry link, closing units → note
  link, deadline prep) capped at two, plus near/long-lead dated items; pinned-clock e2e.
- [x] **Phase 4 — resources + AI-assisted authoring** (`app/resources.html`): she saves her own
  links (title, subject, topic, type, note) tagged to a syllabus topic and optionally shown on
  that topic's note; stored in the synced `my-res` key, tombstone deletes, links only
  (http(s)/file, no file contents in localStorage), never read by the quiz/card engines. Each
  resource offers "Make questions…" into the Upload page's AI flow.
- [x] **Phase 4 — AI-assisted authoring end-to-end** (Upload page §1–2 + every topic note): pick
  topic → copy the `bankgen` prompt (exact subject id + topic key) → open the assistant → paste
  the JSON into a **staged preview** (`assets/bank-import.js`): validate, edit
  stems/choices/answers/marks, remove items, unique suggested name → **Import bank** in one batch,
  identical storage shape to a file upload. No external API calls. Classroom import and in-app
  generation explicitly deferred (privacy, OAuth, cost).
- [x] **Phase 5 — polish**: PNG favicon fallbacks + apple-touch icon on every page (`favicon.ico`,
  `assets/favicon-32.png`, `assets/apple-touch-icon.png` — committed with this batch); editor
  discoverability (Upload page rewritten as a five-section map, launcher-card copy, Cards editor
  explainers, Quiz "Extending the banks" note); Cards page **defaults to light mode** (dark stays
  a toggle).
- [x] Deploy-list gap fixed: `mistakes.html` added to `build_deploy.py`'s PAGES (would have 404ed
  on the live site once phases 0–3 shipped) + launcher cards for Mistakes and Resources.

## Shipped (2026-11-15)

- [x] Practice app spun out (`app/`) with content upload (author page) and cross-device sync (auth.js + api.php).
- [x] Automatic error capture: wrong quiz answers stored, review mode re-serves them until correct, unresolved list on the practice page.
- [x] **IA practice debrief page** (2026-11-15): ia.html — criteria-mapped debrief prompts + saved/synced notes for the Nov hydrogen-peroxide and Jan beetroot/osmosis sessions, feeding the June experiments.
- [x] **EE workspace** (2026-11-15): `ee.html` — idea-log shortlist (tracked list, synced), one-page proposal checklist mapped to the new-EE criteria, DP1 timeline, reflection guidance. TOK exhibition object shortlist on the Core hub (tracked, synced).
- [x] **French IO support** (2026-11-15): IO routine + global-issue bank (tracked list, synced) on the French hub; terminology deck (35 cards). English literary-terms deck (42 cards) live on the Cards page.
- [x] **Sync extended** (2026-11-15): four new synced blobs (`tok-objects`, `ee-ideas`, `io-issues`, `ia-debriefs`) via a small `lists.js` engine; verified end-to-end against the local PHP test host (push on first login + restore on a wiped device).
- [x] **Generator drift repaired** (2026-11-15): practice.html's missed-questions card + script folded into `build_site.py`; ia.html's duplicated paragraph removed at the source; dead duplicate NEXTUP/CALLOUT constants deleted; deadlines.js tail sorted (renderers now sort defensively).
- [x] **Mock schedule** (2026-11-15): Dec–Jan mock calendar on practice.html (8 Dec English P1 rehearsal + January-window mocks + night-before error-log loop); English A Lit row added to the papers-alignment table.

## Shipped (2026-11-18 → 19)

**Deployed live 2026-11-19** (PRs #5–#16):

- [x] Cards page loads decks in parallel (#5); content corrections: data-booklet bond enthalpies, half-filled-stability wording, off-syllabus Maths items retired (#6); B2.1–B2.3 + S1.1 cards and all 51 Maths AA SL notes (#7).
- [x] **Today panel** (#8): due cards, a weakest-topic quiz, this week's class units (`class-schedule.json`).
- [x] **Security hardening** (#9): login limits/lockout, header-only tokens, CSRF/origin guard, escaping, response headers.
- [x] **Parent weekly summary** (#10): read-only `app/summary.html` (own login) + `?action=summary` API + optional cron e-mail.
- [x] **Exam-style practice** (#11): Paper 1A/1B-style Chemistry banks + Biology data-response bank, confidence ratings ("sure"/"guessing"), past-paper score log (`pp-scores`).
- [x] **Coursework planner** (#12): Bio/Chem scientific investigation + Maths exploration tracks, synced per record; practical/IA skills quiz bank.
- [x] Docs status update + VISION.md (#13).
- [x] **Private cross-check + My resources** (#14): 25 notes cross-checked against a commercial set (kept out of the repo; 29 notes gained key ideas/misconceptions), per-note "My resources" links (`my-res`, synced, tombstoned deletes).
- [x] **Ask an AI** (#15) + copy-before-open fix (#16): copies the filled prompt synchronously, then opens the preferred assistant.

**Deployed live 2026-11-19** (PR #17; deploy-tool fix #19):

- [x] **Multi-user upgrade**: every data key physically scoped per account in localStorage (`store.js`); a separate **admin** account + `admin.html` creates students and edits their subject lists (`create-user`/`list-users`/`set-profile`, roles in `users.json`); per-student **subject profiles** (`assets/profile.js` + synced `profile` key) filter nav, dashboard cards, hub sections, quiz banks, decks, notes, library, coursework, the Today panel and tagged deadlines; legacy data adopted into its owner's scope behind a safety snapshot. Reviewed (two passes, all P1/P2 fixed), e2e two-account scenarios included.
- [x] **Ask-an-AI hardening** (19 Nov): copy tri-state, stale-prompt reset, pop-up hint, double-click guard.

## Short-term (next 2–4 weeks · before the December break)

*(Everything buildable before the December break is built. What remains is usage and school-dependent items.)*

- [ ] **School email sent → papers integrated.** File arrivals into `library/papers/<subject>/`, add links to `practice.html`, wire one mock per subject into the plan.
- [x] **Generator de-risked** (2026-11-14): all patches folded into the `PATCHES` list; regeneration verified. Keep template edits and PATCHES in sync going forward.
- [x] **January banks built** (2026-11-14): bio water potential/origin of cells (18 items), bio respiration/protein synthesis (21), math functions 2.4–2.5 (22).
- [x] **Chem energetics flashcards deck** — ✅ in place (chem-reactivity-1-energetics, 19 cards).
- [ ] **December 8 rehearsal**: English Paper 1 timed run using the local specimen; error-log entry after.
- [ ] **Calendar verification**: cross-check Nov–Jun dates against the official sheet (only Aug–Oct is text-verified; January term per MAINTENANCE.md).
- [ ] **Math unit order confirmed** with her teacher; relabel the Functions bank (trig bank + deck already exist).

## Medium-term (next 2–3 months · January–February, into exam season)

- [ ] **January exam preparation flow**: school papers integrated → full timed mocks per the practice-page protocol (schedule now on practice.html) → error-log-driven revision for each paper.
- [ ] **Fill the IA debriefs** after each session (Nov hydrogen-peroxide, Jan beetroot/osmosis) — the page and storage are live; the content is hers to capture.
- [ ] **EE shortlist → proposal**: she keeps the idea log current in `ee.html`; shortlist ready at the Feb 17 launch, proposal checklist ticked with the supervisor before Mar 2. TOK object candidates accumulate on `core.html` (plan due Mar 25).
- [x] **Quiz banks one unit ahead** (2026-11-15): chem kinetics + equilibrium (Feb–Mar) and bio respiration/protein synthesis built, each with a flashcard deck — the whole Feb–Mar queue is in place.
- [x] **Flashcards decks kept current** (2026-11-15): every DP1 science/math unit covered + French terminology (35) + English literary terms (42); 23 decks / 484 cards at the time — now 28 decks / 594 cards.
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
- [ ] **Coursework / Google Classroom automation** — deferred until she asks for it; the coursework planner stays manual until then.
- [x] **Git version control** — repo live at `github.com/Minewine/ib-study-area` (public; making it private is NEXT-STEPS step 2), `source-archives/` and the copyrighted PDF folders git-ignored.

## Explicitly not doing

- No public hosting of `library/` — IB-copyrighted material stays behind auth, forever. (Amended 2026-11-15: the practice app does use a tiny PHP backend for accounts/sync — stdlib PHP, JSON files, no database. The *study-site pages* stay local-only: one folder, no server required.)
- No public hosting of `library/` — IB-copyrighted material stays behind auth, forever.
- No MCQ banks for English/French/History-by-default — wrong tool for analysis subjects, and off-target until History topics are known.
- No feature that adds more than ~30 minutes of monthly maintenance. The 30-minute budget is the ceiling.


---

## Next phase

~~The prioritized next-phase list and the full handoff prompt live in
[NEXT-PHASE-PROMPT.md](NEXT-PHASE-PROMPT.md)~~ — **superseded 20 Nov 2026**: that prompt describes the
phases 1–5 work, which is now done (see "Shipped (2026-11-20)" above). Next actions are in
[NEXT-STEPS.md](NEXT-STEPS.md): merge the consolidation branch, then the gated deploy.
