/* NevaIB subject registry — window.NB.SUBJECTS + NB.canonicalSubject.
   The multi-user upgrade stores each account's subjects as ids in the server
   state (state.profile.subjects, maintained from admin.html) and filters
   student content against them. Load after store.js, before the pages that
   read the profile.

   - NB.SUBJECTS: the canonical registry, in dashboard order. Labels mirror
     library-manifest.json subjectLabel exactly so every page spells a subject
     the same way.
   - NB.subjectAlias / NB.canonicalSubject(): content manifests that predate the
     id scheme still say "maths-aa-sl" (quiz banks, topic-notes) and the
     checklists use "history" / "french" / "english-lit". Anything that reads a
     stored id funnels it through canonicalSubject() first, so old ids keep
     matching the registry instead of silently filtering to nothing. */
(function () {
  "use strict";
  const NB = window.NB = window.NB || {};
  NB.SUBJECTS = [
    { id: "biology-hl", label: "Biology HL" },
    { id: "chemistry-hl", label: "Chemistry HL" },
    { id: "math-aa-sl", label: "Math AA SL" },
    { id: "history-sl", label: "History SL" },
    { id: "french-a-langlit", label: "French A LangLit" },
    { id: "english-lit-hl", label: "English A Lit HL" }
  ];
  // legacy ids seen in committed manifests/content → canonical registry id
  NB.subjectAlias = {
    "maths-aa-sl": "math-aa-sl",
    "history": "history-sl",
    "french": "french-a-langlit",
    "english-lit": "english-lit-hl"
  };
  NB.canonicalSubject = function (id) { return NB.subjectAlias[id] || id; };

  /* NB.profile — the active account's subject profile, read from the synced
     "profile" state key ({"profile": {"subjects": ["biology-hl", …]}} — written
     by admin.html via set-profile; read through NB.store so it comes from the
     active user's scope). Every UI seam (quiz banks, card decks, notes,
     library dropdown, coursework tracks, today, deadlines) asks these
     functions instead of hardcoding subject lists, so an account only sees
     its own subjects. */
  NB.profile = (function () {
    // ALL SIX canonical ids, registry order — the default when the account has
    // no profile key at all (missing, null, or a non-array .subjects): accounts
    // that never got a profile (the existing single-student users) must see
    // everything, so the multi-user upgrade is zero-migration for them.
    // INVARIANT: default = all subjects; ONLY a real profile restricts. An
    // empty array IS honoured as a profile — an account profiled to no
    // subjects sees no subject content.
    const ALL = NB.SUBJECTS.map(function (s) { return s.id; });
    function subjects() {
      if (!NB.store) return ALL.slice(); // no store.js (stale cached page) → nothing to read → show everything
      const p = NB.store.get("profile", null);
      if (p && typeof p === "object" && Array.isArray(p.subjects)) {
        const out = [];
        p.subjects.forEach(function (id) {
          // canonical on the way in too: a profile may hold legacy ids
          // ("maths-aa-sl") — they must dedupe against canonical ones
          const c = NB.canonicalSubject(id);
          if (typeof c === "string" && c && out.indexOf(c) < 0) out.push(c);
        });
        return out;
      }
      return ALL.slice();
    }
    function allows(subject) {
      // INVARIANT: canonical compare on BOTH sides of every check — callers
      // pass manifest ids ("maths-aa-sl"), data-subject values ("history")
      // and profile ids ("math-aa-sl") alike, and they all must match.
      return subjects().indexOf(NB.canonicalSubject(subject)) >= 0;
    }
    // hides(id): true only when the id is one of the six registry subjects AND
    // the profile disallows it. The engines gate content with this instead of
    // !allows() so non-registry subjects — the quiz "ia-skills" bank, the
    // library's core-tok-ee/school/tsm groups — stay for every account: they
    // are coursework/school material, the same rule that leaves untagged
    // deadline entries visible. (No store → default-all → false.)
    function hides(subject) {
      const c = NB.canonicalSubject(subject);
      return ALL.indexOf(c) >= 0 && !allows(c);
    }
    // applyTo(elements): show/hide a list of [data-subject] elements (NodeList
    // or array — Array.forEach.call handles both). display:"" restores the
    // stylesheet's value; "none" hides. Returns the count hidden so callers
    // and tests can assert. Elements without a usable data-subject ("") are
    // left untouched — an empty tag means untagged, and untagged stays.
    function applyTo(elements) {
      let hidden = 0;
      Array.prototype.forEach.call(elements || [], function (el) {
        if (!el || !el.dataset || el.dataset.subject === undefined || el.dataset.subject === "") return;
        const show = allows(el.dataset.subject);
        el.style.display = show ? "" : "none";
        if (!show) hidden++;
      });
      return hidden;
    }
    function applyDocument() {
      if (typeof document === "undefined" || !document.querySelectorAll) return; // harness/tests
      applyTo(document.querySelectorAll("[data-subject]"));
    }
    if (typeof document !== "undefined") {
      // now if the DOM is already parsed, else on DOMContentLoaded — this file
      // loads right after store.js and before the engines, so static
      // [data-subject] markup (nav links, dashboard cards, hub blocks) is
      // filtered before the engines build their own dynamic content
      if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", applyDocument);
      else applyDocument();
    }
    return { subjects: subjects, allows: allows, hides: hides, applyTo: applyTo };
  })();
})();
