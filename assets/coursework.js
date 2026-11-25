/* IB Study Area — coursework planner (app/coursework.html).
   Content: library/coursework/coursework.json (three tracks: Biology and Chemistry
   scientific investigations, Maths AA exploration; stages > self-check items, pitfalls,
   approximate school dates). Progress: ONE synced localStorage key, "cw-progress":
     { checks: { "<track>.<stage>.<check>": {c: bool, t: ms} },
       notes:  { "<track>.<stage>": {s: "text", t: ms} },
       dates:  { "<track>.<stage>": {d: "YYYY-MM-DD" | "", t: ms} } }
   Every edit stamps t, so sync and backup restore merge record by record, newest
   edit wins (NB.merge.RECORDS["cw-progress"] in store.js). An untick is stored as
   c:false — never deleted — so it wins over an older tick from another device.
   Everything is rendered with textContent. */
(function () {
  "use strict";
  const NB = window.NB = window.NB || {};
  const KEY = "cw-progress";
  const S = NB.store || {
    get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v === null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
    onChange() {}
  };
  const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);

  // ── pure helpers (unit-tested) ───────────────────────────────────────────
  function normalize(p) {
    const out = isObj(p) ? Object.assign({}, p) : {};
    ["checks", "notes", "dates"].forEach(s => { out[s] = isObj(out[s]) ? Object.assign({}, out[s]) : {}; });
    return out;
  }
  const withRecord = (p, sec, id, rec) => { const n = normalize(p); n[sec][id] = rec; return n; };
  const setCheck = (p, id, on, now) => withRecord(p, "checks", id, { c: !!on, t: now || Date.now() });
  const setNote = (p, id, text, now) => withRecord(p, "notes", id, { s: String(text || "").slice(0, 4000), t: now || Date.now() });
  const setDate = (p, id, d, now) => withRecord(p, "dates", id, { d: /^\d{4}-\d{2}-\d{2}$/.test(d || "") ? d : "", t: now || Date.now() });
  const isChecked = (p, id) => !!(isObj(p) && isObj(p.checks) && p.checks[id] && p.checks[id].c === true);
  const noteText = (p, id) => (isObj(p) && isObj(p.notes) && p.notes[id] && typeof p.notes[id].s === "string") ? p.notes[id].s : "";
  const ownDate = (p, id) => (isObj(p) && isObj(p.dates) && p.dates[id] && typeof p.dates[id].d === "string") ? p.dates[id].d : "";

  function stageCount(p, track, stage) {
    const ids = (stage.checks || []).map(c => track.id + "." + stage.id + "." + c.id);
    return { done: ids.filter(id => isChecked(p, id)).length, total: ids.length };
  }
  function trackCount(p, track) {
    return (track.stages || []).reduce((a, s) => { const c = stageCount(p, track, s); return { done: a.done + c.done, total: a.total + c.total }; }, { done: 0, total: 0 });
  }
  // upcoming dates for one track: her own target dates and the school's approximate
  // ones, from `today` (YYYY-MM-DD) on, soonest first
  function upcoming(p, track, today) {
    const out = [];
    (track.stages || []).forEach(s => {
      const mine = ownDate(p, track.id + "." + s.id);
      if (mine && mine >= today) out.push({ date: mine, when: mine, label: s.title + " (my date)", own: true, stage: s.id });
      (s.dates || []).forEach(d => { if (d.date >= today) out.push({ date: d.date, when: d.when || d.date, label: d.label, own: false, stage: s.id, source: d.source }); });
    });
    return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }

  NB.coursework = { KEY, setCheck, setNote, setDate, isChecked, noteText, ownDate, stageCount, trackCount, upcoming };

  // ── page ─────────────────────────────────────────────────────────────────
  const PATH_BASE = (typeof location !== "undefined" && location.pathname.includes("/app/")) ? "../" : "";
  const $ = (id) => document.getElementById(id);
  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else if (k === "class") n.className = v;
      else if (k === "checked" || k === "open") n[k] = !!v;
      else if (k === "value") n.value = v;
      else n.setAttribute(k, v === true ? "" : String(v));
    }
    for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) n.append(c instanceof Node ? c : String(c));
    return n;
  }
  const todayISO = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
  const fmt = (iso) => { const d = new Date(iso + "T12:00:00"); return isNaN(d) ? iso : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }); };

  let DATA = null, current = null;
  const load = () => normalize(S.get(KEY, {}));
  const save = (p) => S.set(KEY, p);
  const noteTimers = {}, pendingNotes = {};

  function flushNotes() {
    const ids = Object.keys(pendingNotes);
    if (!ids.length) return;
    let p = load();
    ids.forEach(id => { clearTimeout(noteTimers[id]); if (noteText(p, id) !== pendingNotes[id]) p = setNote(p, id, pendingNotes[id]); delete pendingNotes[id]; });
    save(p);
  }

  function renderTabs() {
    const box = $("cw-tabs");
    box.textContent = "";
    DATA.tracks.forEach(t => {
      const c = trackCount(load(), t);
      box.append(el("button", { type: "button", class: "btn" + (current === t.id ? " primary" : ""), "aria-pressed": current === t.id ? "true" : "false",
        onclick: () => { flushNotes(); current = t.id; try { history.replaceState(null, "", "?track=" + t.id); } catch (e) {} render(); } },
        t.label, el("span", { class: "cw-count" }, " " + c.done + "/" + c.total)));
    });
  }

  function stageView(track, stage, p, today, open) {
    const sid = track.id + "." + stage.id;
    const cnt = stageCount(p, track, stage);
    const mine = ownDate(p, sid);
    const school = (stage.dates || [])[0];
    const head = el("summary", {}, el("strong", {}, stage.title), el("span", { class: "cw-count" }, " · " + cnt.done + "/" + cnt.total),
      mine ? el("span", { class: "cw-when" }, " · my date " + fmt(mine)) : school ? el("span", { class: "cw-when" }, " · school: " + school.when + " (approx.)") : null);
    const list = el("ul", { class: "cw-checks" }, (stage.checks || []).map(c => {
      const id = sid + "." + c.id;
      return el("li", {}, el("label", {}, el("input", { type: "checkbox", checked: isChecked(p, id),
        onchange: (e) => { save(setCheck(load(), id, e.target.checked)); renderTabs(); head.querySelector(".cw-count").textContent = " · " + stageCount(load(), track, stage).done + "/" + cnt.total; } }), " ", c.text));
    }));
    const dates = (stage.dates || []).length ? el("div", { class: "cw-school" }, el("strong", {}, "School dates (approximate): "),
      el("ul", {}, stage.dates.map(d => el("li", {}, d.when + " — " + d.label + " ", el("span", { class: "muted" }, "(" + d.source + ")"))))) : null;
    const note = el("textarea", { class: "cw-note", rows: "3", maxlength: "4000", placeholder: "My notes for this stage (decisions, teacher comments, to-dos)…", value: noteText(p, sid),
      oninput: (e) => { pendingNotes[sid] = e.target.value; clearTimeout(noteTimers[sid]); noteTimers[sid] = setTimeout(flushNotes, 700); },
      onblur: flushNotes });
    const date = el("input", { type: "date", value: mine, "aria-label": "My target date for " + stage.title,
      onchange: (e) => { save(setDate(load(), sid, e.target.value)); renderUpcoming(track, today); } });
    return el("details", { class: "card cw-stage", open: !!open },
      head,
      el("p", { class: "muted" }, stage.summary),
      el("h4", {}, "Self-check"), list,
      el("h4", {}, "Common pitfalls"), el("ul", { class: "cw-pit" }, (stage.pitfalls || []).map(x => el("li", {}, x))),
      dates,
      el("div", { class: "cw-mine" }, el("label", {}, "My target date: ", date)),
      note);
  }

  function renderUpcoming(track, today) {
    const box = $("cw-upcoming");
    if (!box) return;
    const up = upcoming(load(), track, today).slice(0, 4);
    box.textContent = "";
    box.append(el("h3", {}, "Coming up"));
    box.append(up.length ? el("ul", {}, up.map(u => el("li", {}, el("strong", {}, u.own ? fmt(u.date) : u.when), " — " + u.label + (u.own ? "" : " (approx.)"))))
      : el("p", { class: "muted" }, "No dates yet. Add your own target dates in each stage below when your teacher gives them."));
  }

  function render() {
    renderTabs();
    const track = DATA.tracks.find(t => t.id === current) || DATA.tracks[0];
    const p = load(), today = todayISO();
    const root = $("cw-track");
    root.textContent = "";
    root.append(el("section", { class: "card", id: "cw-upcoming" }));
    root.append(el("section", { class: "card" }, el("h3", {}, track.label),
      el("details", {}, el("summary", {}, "Key facts and rules"), el("ul", {}, track.facts.map(f => el("li", {}, f)))),
      el("details", {}, el("summary", {}, "The criteria at a glance (our own summary — use the official criteria from your teacher)"),
        el("table", { class: "wt" }, el("thead", {}, el("tr", {}, el("th", {}, "Criterion"), el("th", {}, "Marks"), el("th", {}, "Questions to ask about your work"))),
          el("tbody", {}, track.criteria.map(c => el("tr", {}, el("td", {}, c.name), el("td", {}, String(c.max)), el("td", {}, c.focus))))))));
    // the first unfinished stage starts open; the rest stay folded
    const first = track.stages.find(s => { const c = stageCount(p, track, s); return c.done < c.total; });
    track.stages.forEach(s => root.append(stageView(track, s, p, today, s === first)));
    renderUpcoming(track, today);
  }

  async function init() {
    const root = $("cw-track");
    if (!root) return;
    try {
      const res = await fetch(PATH_BASE + "library/coursework/coursework.json?cb=" + Date.now(), { cache: "no-store" });
      if (!res.ok) throw new Error(res.status);
      DATA = await res.json();
      // Per-user subject profile (assets/profile.js): tracks for subjects the
      // account doesn't take are removed before any rendering. Every committed
      // track carries a subject; a subject-less track would always stay.
      if (window.NB && window.NB.profile) DATA.tracks = DATA.tracks.filter(t => !t.subject || !window.NB.profile.hides(t.subject));
    } catch (e) { root.textContent = "Could not load the coursework planner content (" + (e && e.message) + "). Reload to try again."; return; }
    const disc = $("cw-disclaimer");
    if (disc) disc.textContent = DATA.disclaimer;
    if (!DATA.tracks.length) { root.textContent = "No coursework planner tracks for your subjects."; return; }
    const want = new URLSearchParams(location.search).get("track");
    current = DATA.tracks.some(t => t.id === want) ? want : DATA.tracks[0].id;
    render();
    // a sync from another device updated the planner: redraw unless she is typing
    S.onChange((k, v, o) => { if (k === KEY && o && o.silent && !(document.activeElement && document.activeElement.tagName === "TEXTAREA")) render(); });
    window.addEventListener("pagehide", flushNotes);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flushNotes(); });
  }

  if (typeof document !== "undefined" && document.getElementById) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
    else init();
  }
})();
