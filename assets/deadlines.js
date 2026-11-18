/* ISL Year 12 deadline calendar (2026–27), transcribed from the school calendar.
   Renders: #nextup (dashboard, next 4 upcoming) and #timeline (deadlines page). */
(function () {
  "use strict";

  const DEADLINES = [
    { d: "2026-09-01", t: "Collaborative Science Project: introduction (periods 4–5)", tag: "sciences" },
    { d: "2026-09-24", t: "Collaborative Science Project: research & planning (periods 1–5)", tag: "sciences" },
    { d: "2026-09-30", t: "CAS: initial interview (in homeroom)", tag: "core" },
    { d: "2026-12-08", t: "English A Lit HL: practice commentary — first timed Paper 1 rehearsal", tag: "langlit" },
    { d: "2027-01-12", t: "Revision-only homework window begins (no in-class tests)", tag: "exams" },
    { d: "2027-01-14", t: "First Semester Examinations begin (run to ~22 Jan)", tag: "exams" },
    { d: "2027-02-17", t: "Extended Essay: launch — half-day introduction (periods 1–3)", tag: "ee" },
    { d: "2027-03-02", t: "Extended Essay: submit subject, topic & RRS + initial proposal", tag: "ee" },
    { d: "2027-03-12", t: "Extended Essay: Reflective Session 1 (preliminary date)", tag: "ee" },
    { d: "2027-03-23", t: "Extended Essay: experimental equipment order", tag: "ee" },
    { d: "2027-03-24", t: "University information session", tag: "university" },
    { d: "2027-03-25", t: "TOK Exhibition: plan due", tag: "tok" },
    { d: "2027-03-26", t: "French A HL: essay (draft) — HL French class; confirm if it applies to her SL course", tag: "langlit" },
    { d: "2027-04-14", t: "CAS: second interview (in homeroom)", tag: "core" },
    { d: "2027-04-27", t: "Extended Essay: Phase 2 submission", tag: "ee" },
    { d: "2027-04-28", t: "TOK Exhibition: draft", tag: "tok" },
    { d: "2027-05-11", t: "English A Lit HL: HL Essay (draft)", tag: "langlit" },
    { d: "2027-05-13", t: "Revision-only homework window begins (second semester)", tag: "exams" },
    { d: "2027-05-25", t: "Second Semester Examinations (late May; exact dates per school)", tag: "exams" },
    { d: "2027-06-01", t: "Physics: IA experiment (group 1)", tag: "sixth" },
    { d: "2027-06-03", t: "Physics: IA experiment (group 2)", tag: "sixth" },
    { d: "2027-06-07", t: "CAS: portfolio due (Year 12 checkpoint)", tag: "core" },
    { d: "2027-06-09", t: "EE conference (periods 4–5)", tag: "ee" },
    { d: "2027-06-14", t: "French A HL: essay (final) — HL French class only", tag: "langlit" },
    { d: "2027-06-16", t: "TOK Exhibition: final", tag: "tok" },
    { d: "2027-06-15", t: "Biology: IA experiment day (group 1)", tag: "sciences" },
    { d: "2027-06-17", t: "Biology: IA experiment day (group 2)", tag: "sciences" },
    { d: "2027-06-18", t: "English A Lit HL: HL Essay (final)", tag: "langlit" },
    { d: "2027-06-23", t: "Physics: IA report (draft)", tag: "sixth" },
    { d: "2027-06-25", t: "Geography: IA (final)", tag: "sixth" },
    { d: "2027-09-06", t: "Biology: IA draft due (early Sept, DP2 — approximate)", tag: "sciences" },
    { d: "2027-11-08", t: "Biology: IA final due (early Nov, DP2 — approximate)", tag: "sciences" }
  ];

  // renderers assume chronological order — sort defensively (the literal has
  // drifted out of order once already)
  DEADLINES.sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));

  const TAGS = {
    sciences: { label: "Sciences", color: "#2e8b57" },
    ee: { label: "Extended Essay", color: "#2c5fa8" },
    tok: { label: "TOK", color: "#7b4ea8" },
    core: { label: "CAS", color: "#c47f17" },
    exams: { label: "Exams", color: "#c23b3b" },
    langlit: { label: "Languages", color: "#5b6b7c" },
    university: { label: "University", color: "#3a7ca5" },
    sixth: { label: "Possible sixth-subject items", color: "#8a8f98" }
  };

  const fmt = (iso) => {
    const d = new Date(iso + "T12:00:00");
    return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  };
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const daysTo = (iso) => Math.round((new Date(iso + "T12:00:00") - today) / 86400000);

  function chip(tag) {
    const t = TAGS[tag] || { label: tag, color: "#5b6b7c" };
    return `<span class="chip" style="border-color:${t.color};color:${t.color}">${t.label}</span>`;
  }

  function row(item, past) {
    const d = daysTo(item.d);
    const when = past ? fmt(item.d)
      : d === 0 ? "TODAY" : d === 1 ? "tomorrow" : `in ${d} days`;
    return `<li class="${past ? "past" : "future"}"><span class="dl-date">${fmt(item.d)}</span> ${chip(item.tag)} <span class="dl-label">${item.t}</span> <span class="dl-in muted">${past ? "" : "· " + when}</span></li>`;
  }

  const nextup = document.getElementById("nextup");
  if (nextup) {
    const upcoming = DEADLINES.filter(x => daysTo(x.d) >= 0).slice(0, 4);
    nextup.innerHTML = upcoming.length
      ? upcoming.map(x => row(x, false)).join("")
      : "<li>No scheduled deadlines left — well done.</li>";
  }

  const timeline = document.getElementById("timeline");
  if (timeline) {
    const past = DEADLINES.filter(x => daysTo(x.d) < 0);
    const future = DEADLINES.filter(x => daysTo(x.d) >= 0);
    timeline.innerHTML =
      (future.length ? `<h3>Upcoming</h3><ul class="links">${future.map(x => row(x, false)).join("")}</ul>` : "") +
      (past.length ? `<h3 class="count">Earlier this year</h3><ul class="links">${past.map(x => row(x, true)).join("")}</ul>` : "") +
      `<p class="muted">Transcribed from the ISL Year 12 deadline calendar 2026–27. Items tagged “possible sixth-subject” (Physics, Economics, Geography) apply only if that subject is chosen — SAT registration deadlines are in the school calendar too. Verify dates against the official school version when planning.</p>`;
  }
})();
