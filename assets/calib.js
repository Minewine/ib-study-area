/* NevaIB calibration card — window.NB.calib, rendered on app/index.html.
   Reads only the synced "quizlog": each session entry may carry a conf tally
   {sure, sureRight, guess, guessRight} (written via assets/confidence.js when the
   student rates each answer "I'm sure" / "I'm guessing"). The card shows whether
   "sure" answers are actually right — overall, per subject, and across the last
   rated sessions. Read-only: this file never writes to storage. summarize() is
   pure and exported for the node tests. */
(function () {
  "use strict";
  const NB = window.NB = window.NB || {};
  if (NB.calib) return;

  const KEYS = ["sure", "guess"];
  const emptyTally = () => ({ n: 0, right: 0, pct: null });
  const clip = (s, n) => { s = String(s == null ? "" : s); return s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s; };

  // Aggregate quizlog conf tallies. log is newest-first (capped at 20 by the
  // engine); entries without conf (sessions before ratings existed) count toward
  // `sessions` only. hides(subjectId) drops entries of subjects the account
  // doesn't take from everything rated.
  function summarize(log, hides) {
    const out = { sessions: 0, rated: 0, sure: emptyTally(), guess: emptyTally(), bySubject: {}, trend: [] };
    (Array.isArray(log) ? log : []).forEach(e => {
      if (!e || typeof e !== "object") return;
      out.sessions++;
      const c = e.conf;
      if (!c || typeof c !== "object") return;
      if (e.subject && hides && hides(e.subject)) return;
      out.rated++;
      KEYS.forEach(k => {
        const n = +c[k] || 0, r = +c[k + "Right"] || 0;
        if (n > 0) out[k].n += n, out[k].right += r;
        if (e.subject) {
          const s = out.bySubject[e.subject] = out.bySubject[e.subject] || { sure: { n: 0, right: 0 }, guess: { n: 0, right: 0 } };
          if (n > 0) s[k].n += n, s[k].right += r;
        }
      });
      out.trend.push({
        date: String(e.date || ""), label: String(e.label || ""),
        pct: typeof e.pct === "number" ? e.pct : null,
        surePct: (+c.sure || 0) > 0 ? Math.round(100 * (+c.sureRight || 0) / +c.sure) : null,
        guessPct: (+c.guess || 0) > 0 ? Math.round(100 * (+c.guessRight || 0) / +c.guess) : null
      });
    });
    KEYS.forEach(k => { if (out[k].n > 0) out[k].pct = Math.round(100 * out[k].right / out[k].n); });
    out.trend = out.trend.slice(0, 5);
    return out;
  }

  // ---------- rendering (browser only) ----------
  const store = (window.NB && window.NB.store) || {
    get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v === null ? d : v; } catch (e) { return d; } }
  };
  const el = (tag, attrs, ...kids) => {
    const n = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if (v === null || v === undefined || v === false) return;
      if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else if (k === "class") n.className = v;
      else n.setAttribute(k, v === true ? "" : String(v));
    });
    kids.flat().forEach(k => { if (k === null || k === undefined || k === false) return; n.append(typeof k === "string" ? document.createTextNode(k) : k); });
    return n;
  };
  const canon = (window.NB && window.NB.canonicalSubject) || ((x) => x);
  const subjectLabel = (id) => {
    const reg = (NB.SUBJECTS || []).find(s => s.id === id || canon(id) === s.id);
    return reg ? reg.label : id;
  };

  function barRow(label, t) {
    const pct = t.n ? Math.round(100 * t.right / t.n) : null;
    return el("div", { class: "cal-row" },
      el("span", { class: "cal-label" }, label),
      el("div", { class: "cal-bar" }, pct == null ? null : el("div", { style: "width:" + pct + "%" })),
      el("span", { class: "muted cal-n" }, t.n ? t.right + "/" + t.n + " right (" + pct + "%)" : "—"));
  }

  function render() {
    const box = document.getElementById("calib-body");
    if (!box) return;
    const hides = (id) => !!(NB.profile && NB.profile.hides && NB.profile.hides(id));
    const s = summarize(store.get("quizlog", []), hides);
    box.textContent = "";
    if (!s.rated) {
      box.append(el("p", { class: "muted" },
        "When you answer quiz questions, say whether you're sure or guessing. This card then shows how often each was actually right — a big gap means double-check the ones you're sure about."));
      return;
    }
    box.append(barRow("I'm sure", s.sure), barRow("I'm guessing", s.guess));
    const subs = Object.entries(s.bySubject)
      .map(([id, t]) => ({ id, sure: t.sure, guess: t.guess }))
      .filter(t => t.sure.n + t.guess.n > 0)
      .sort((a, b) => (b.sure.n + b.guess.n) - (a.sure.n + a.guess.n))
      .slice(0, 3);
    if (subs.length) {
      const ul = el("ul", { class: "cal-subs" });
      subs.forEach(t => {
        const bits = [];
        if (t.sure.n) bits.push("sure " + t.sure.right + "/" + t.sure.n + " (" + Math.round(100 * t.sure.right / t.sure.n) + "%)");
        if (t.guess.n) bits.push("guessing " + t.guess.right + "/" + t.guess.n + " (" + Math.round(100 * t.guess.right / t.guess.n) + "%)");
        ul.append(el("li", {}, subjectLabel(t.id) + ": " + bits.join(" · ")));
      });
      box.append(el("p", { class: "muted cal-subs-h" }, "By subject:"), ul);
    }
    if (s.trend.length) {
      const tl = el("p", { class: "muted" }, "Last rated sessions: ");
      s.trend.forEach((t, i) => {
        if (i) tl.append(" · ");
        tl.append((t.date || "?") + " " + clip(t.label, 24) + ": score " + (t.pct == null ? "?" : t.pct + "%")
          + (t.surePct != null ? ", sure " + t.surePct + "%" : "")
          + (t.guessPct != null ? ", guessing " + t.guessPct + "%" : ""));
      });
      box.append(tl);
    }
  }

  NB.calib = { summarize };

  if (typeof document === "undefined" || !document.getElementById || !document.getElementById("calib-body")) return;
  // re-render when a synced quizlog arrives or changes in another tab
  let timer = null;
  const later = () => { clearTimeout(timer); timer = setTimeout(render, 300); };
  if (NB.store && NB.store.onChange) NB.store.onChange((k) => { if (k === "quizlog") later(); });
  window.addEventListener("storage", (e) => { if (!e || e.key === "quizlog") later(); });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render);
  else render();
})();
