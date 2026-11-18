# What would elevate NevaIB

_Ideas document, 18 Nov 2026. Nothing here is committed work; the prioritised list is [NEXT-STEPS.md](NEXT-STEPS.md)._

NevaIB already does the basics well: notes, retrieval quizzes, spaced flashcards, a daily "Today" plan, exam-style practice, a coursework planner and a parent summary. This document asks what would turn it from a good study tool into one that measurably improves how a single IB student learns over two years.

## Constraints every idea respects

- **Stack:** static HTML, vanilla JS, JSON content, localStorage, one small PHP 7.2 API. No frameworks, no build step at runtime.
- **One student, privacy first:** no third-party analytics, no external services holding her data, no public pages.
- **No copyrighted IB material:** original questions and wording only; official documents stay private references.
- **No gamification:** no points, streak pressure, leaderboards or badges. Motivation comes from visible progress and good habits, not rewards.
- **No recurring costs:** nothing that needs a subscription or paid API.

Effort: **S** = an afternoon, **M** = a few days, **L** = a week or more. Value is the expected learning gain for her, not polish.

## Near-term (build on what exists)

| Idea | Why it works | Effort | Value |
|---|---|---|---|
| **Mistake journal** | Each missed question gets a one-line "why I got it wrong" tag (misread, concept gap, calculation slip, command term, ran out of time). Reflecting on the *type* of error is what turns errors into learning (error-reflection and metacognition research). Builds on the existing `q-errors` records. | S | High |
| **Calibration chart over time** | The confidence ratings already record "sure" vs "guessing". Plotting how often "sure" answers are right, per subject and month, shows whether her confidence is earned. Good calibration predicts better exam judgement (where to spend time, when to double-check). | S | High |
| **Command-term training** | IB questions hinge on command terms ("outline", "explain", "evaluate", "deduce"). Short drills: given an answer, which command term does it satisfy? Or rewrite an "outline" answer into an "explain" answer. Targets a known way students lose marks while knowing the content. | M | High |
| **End-of-unit readiness check** | When the class schedule says a unit is ending, offer a 10-minute mixed check across its subtopics, with a red/amber/green result fed into the checklist. Retrieval before a test is itself learning (testing effect), and the result tells her what to revisit while the teacher is still on it. | M | High |
| **Printable weekly retrieval sheet** | One A4 page each week: 10 questions from older topics she is about to forget (from the SRS data), answered on paper with no screen. Interleaved, spaced, low-stakes retrieval, plus a break from devices. Generated client-side, printed from the browser. | S | Medium |
| **Spaced retests of missed questions** | Bring missed questions back at roughly 1, 7 and 30 days rather than only until first correct. Expanding intervals beat massed re-practice (spacing effect). Already on the roadmap as H4. | S | High |
| **Link notes to the new exam banks** | Each note gets "Paper 1A-style" and "data practice" links where those banks cover it, so practice follows reading without hunting. | S | Medium |

## Ambitious (new capabilities)

| Idea | Why it works | Effort | Value |
|---|---|---|---|
| **Teach-back mode** | She explains a concept in her own words (typed, or spoken into the browser's own speech input where available) and then ticks a self-check rubric of the key points written for that note. Explaining to an imagined learner exposes gaps that re-reading hides (the protégé effect, self-explanation). Nothing is sent anywhere. | M | High |
| **Error-pattern diagnosis** | Across all subjects, look for repeated patterns in missed questions: units and significant figures, sign of ΔH, reading graph axes, "explain" answers that only describe. Report the top three patterns with one targeted drill each. Fixing a cross-topic habit pays off in every paper. | M | High |
| **Exam-simulation mode** | Timed sessions shaped like real papers: number of questions, mark weighting, calculator-free sections, reading time, a clock, then self-marking against original markschemes. Practising under realistic conditions improves pacing and reduces anxiety on the day (transfer-appropriate processing). | M | High |
| **Back-scheduled spaced plan to May 2028** | Work backwards from the exam dates and the school mock dates: each topic gets a planned first review, consolidation rounds and a final pass, adjusted by her mastery data. Turns "revise everything" into a calendar, and protects older topics from being forgotten during DP2. | L | High |
| **IA data-analysis helpers** | Small, transparent calculators that run in the page: mean and standard deviation, t-test with the steps shown, uncertainty propagation (absolute, percentage, through products and powers), gradient uncertainty from max/min lines. Each shows the working so she learns the method, not just the number. Supports the coursework planner directly. | M | High |
| **Concept maps across Bio, Chem and Maths** | Hand-curated links between topics (enzymes ↔ reaction rates ↔ exponential functions; water potential ↔ intermolecular forces; respiration ↔ redox). Shown as a simple map from each note. Connecting ideas across subjects builds deeper, more transferable understanding (elaboration) and helps with TOK and the EE. | M | Medium |
| **Offline support (PWA)** | A service worker caches pages, notes and banks, so study works on a train or with bad Wi-Fi, and progress syncs when back online (the sync layer already handles offline edits). | M | Medium |
| **Audio flashcards** | Cards read aloud with the browser's built-in speech synthesis, with a pause before the answer. Lets her review while walking or commuting, and adds a second channel for recall. No audio files to host. | S | Medium |
| **Parent/teacher read-only share link** | A time-limited, revocable link to the weekly summary (no login needed, nothing editable), so a teacher or tutor can see progress if she chooses to share it. She stays in control of who sees what. | M | Medium |

## Moonshots (worth exploring, carefully)

| Idea | Why it works | Effort | Value |
|---|---|---|---|
| **Private local-AI tutor** | An optional tutor that runs on the family's own hardware (a small open model served on the home network), never on a cloud API. It could give feedback on teach-back answers, generate *new* practice variants from our own notes, and ask Socratic follow-up questions. Firm boundaries: it only sees what she sends it, keeps no logs beyond her device, never sees school documents or official IB material, and is clearly labelled as possibly wrong. The app works fully without it. | L | High if reliable |
| **Answer-quality feedback for written answers** | For extended-response questions, compare her answer to the marking points and highlight which points are present, missing or vague (simple keyword and synonym matching first, local AI later). Faster, more specific feedback is one of the strongest levers in learning research. | L | High |
| **Two-year learning record** | A private, exportable record of what she studied, how her calibration and mastery changed, and which strategies helped, kept by her after the diploma. Useful for university study habits, and a reminder that progress came from consistent practice. | M | Medium |
| **Adaptive daily plan** | The Today panel learns how much she actually does and when, then sizes the plan to fit (shorter on heavy school days, longer before mocks), always within a fixed time box. Keeps the habit sustainable rather than overwhelming. | L | Medium |

## Suggested order

1. Mistake journal, calibration chart and spaced retests (small, use data already collected).
2. Command-term training and end-of-unit readiness checks (target how marks are actually lost).
3. IA data-analysis helpers (coursework is a large share of the grade and the deadlines start in 2027).
4. Exam-simulation mode and the back-scheduled plan (before the first DP1 mocks).
5. Teach-back, then the local-AI tutor only if the earlier pieces are used regularly.

## What we deliberately won't build

- Points, streaks, badges or leaderboards.
- Anything that uploads her work to a third-party service.
- Copies of IB papers, markschemes or commercial revision material.
- Social features or public profiles.
