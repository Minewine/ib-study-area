/* Weekly summary page (app/summary.html) — read-only view of ?action=summary.
   Deliberately does NOT load store.js/auth.js and never touches nb-token or any
   synced key: a parent's browser must not merge its own local data into the
   student's account. Login is token-only ("no_session") and the token lives in
   sessionStorage (gone when the tab closes). DOM is built with textContent only. */
(function () {
  "use strict";
  const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  const API = (LOCAL_HOST && localStorage.getItem("nb-api")) ||
    (/^(www\.)?rametric\.com$/.test(location.hostname) ? "/nevaib/api/api.php" : "https://rametric.com/nevaib/api/api.php");
  const TOKEN_KEY = "nb-summary-token";
  const $ = (id) => document.getElementById(id);

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = String(text);
    return e;
  }

  async function api(action, params, body) {
    const q = new URLSearchParams(Object.assign({ action }, params || {}));
    const init = { method: body ? "POST" : "GET", credentials: "omit", headers: {} };
    const tok = sessionStorage.getItem(TOKEN_KEY);
    if (tok) init.headers["X-Nevaib-Token"] = tok;
    if (body) { init.headers["Content-Type"] = "application/json"; init.body = JSON.stringify(body); }
    const res = await fetch(API + "?" + q.toString(), init);
    let d = null;
    try { d = await res.json(); } catch (e) { throw new Error("bad response (" + res.status + ")"); }
    if (!res.ok || !d || d.ok === false) { const err = new Error((d && d.error) || ("HTTP " + res.status)); err.status = res.status; throw err; }
    return d;
  }

  function showLogin(msg) {
    $("ws-login").hidden = false; $("ws-controls").hidden = true; $("ws-out").textContent = "";
    $("ws-login-msg").textContent = msg || "";
  }

  function stat(label, value, note) {
    const box = el("div", "ws-stat");
    box.appendChild(el("strong", "", value));
    box.appendChild(el("span", "", label));
    if (note) { box.appendChild(el("br")); box.appendChild(el("small", "muted", note)); }
    return box;
  }

  function table(headers, rows) {
    const t = el("table", "ws-table");
    const tr = el("tr");
    headers.forEach(h => tr.appendChild(el("th", "", h)));
    t.appendChild(tr);
    rows.forEach(r => { const row = el("tr"); r.forEach(c => row.appendChild(el("td", "", c))); t.appendChild(row); });
    return t;
  }

  function render(d) {
    const s = d.summary, out = $("ws-out");
    out.textContent = "";
    $("ws-msg").textContent = d.user + " · " + s.from + " to " + s.to;
    const grid = el("div", "ws-grid");
    grid.appendChild(stat("active days of " + s.days, s.active_days));
    grid.appendChild(stat("minutes (estimate)", "≈ " + s.est_minutes, s.est_minutes_note));
    grid.appendChild(stat("quiz sessions", s.quiz.sessions));
    grid.appendChild(stat("quiz accuracy", s.quiz.pct === null ? "—" : s.quiz.pct + "%"));
    grid.appendChild(stat("cards reviewed", s.cards.reviewed, s.cards.reviewed_note));
    grid.appendChild(stat("cards due now", s.cards.due_now));
    out.appendChild(grid);

    const weak = el("section", "card");
    weak.appendChild(el("h3", "", "Topics to revisit"));
    if (s.weakest_topics.length) {
      const ul = el("ul");
      s.weakest_topics.forEach(w => {
        const li = el("li", "ws-weak", w.label);
        const bits = [];
        if (w.pct !== null) bits.push(w.pct + "% in quizzes");
        if (w.missed) bits.push(w.missed + " question(s) missed");
        if (bits.length) li.appendChild(el("span", "muted", " — " + bits.join(" · ")));
        ul.appendChild(li);
      });
      weak.appendChild(ul);
    } else weak.appendChild(el("p", "muted", "No weak topics flagged in this period."));
    out.appendChild(weak);

    const quiz = el("section", "card");
    quiz.appendChild(el("h3", "", "Quizzes"));
    if (s.quiz.by_subject.length) quiz.appendChild(table(["Session", "Sessions", "Score"], s.quiz.by_subject.map(b => [b.label, b.sessions, (b.pct === null ? "—" : b.pct + "%") + " (" + b.got + "/" + b.max + ")"])));
    else quiz.appendChild(el("p", "muted", "No quiz sessions in this period."));
    if (s.quiz.by_topic.length) {
      quiz.appendChild(el("h4", "", "By topic"));
      quiz.appendChild(table(["Topic", "Score"], s.quiz.by_topic.map(t => [t.label, (t.pct === null ? "—" : t.pct + "%") + " (" + t.got + "/" + t.max + ")"])));
    }
    out.appendChild(quiz);

    const cards = el("section", "card");
    cards.appendChild(el("h3", "", "Flashcards"));
    cards.appendChild(el("p", "", s.cards.mastered_total + " mastered of " + s.cards.seen_total + " seen so far."));
    if (s.cards.by_subject.length) cards.appendChild(table(["Subject", "Cards reviewed"], s.cards.by_subject.map(b => [b.label, b.reviewed])));
    out.appendChild(cards);
  }

  async function load() {
    const params = { days: $("ws-days").value };
    const target = $("ws-target").value;
    if (target) params.user = target;
    $("ws-msg").textContent = "Loading…";
    try {
      const d = await api("summary", params);
      $("ws-login").hidden = true; $("ws-controls").hidden = false;
      const sel = $("ws-target");
      if (!sel.options.length) (d.viewable || [d.user]).forEach(u => { const o = el("option", "", u); o.value = u; sel.appendChild(o); });
      sel.value = d.user;
      render(d);
    } catch (e) {
      if (e.status === 401) { sessionStorage.removeItem(TOKEN_KEY); showLogin(""); $("ws-msg").textContent = ""; }
      else $("ws-msg").textContent = "Could not load the summary: " + e.message;
    }
  }

  $("ws-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("ws-login-msg").textContent = "Logging in…";
    try {
      const d = await api("login", null, { username: $("ws-user").value.trim(), password: $("ws-pass").value, no_session: true });
      sessionStorage.setItem(TOKEN_KEY, d.token);
      $("ws-pass").value = "";
      $("ws-login-msg").textContent = "";
      load();
    } catch (err) { $("ws-login-msg").textContent = err.message; }
  });
  $("ws-days").addEventListener("change", load);
  $("ws-target").addEventListener("change", load);
  $("ws-logout").addEventListener("click", async () => {
    try { await api("logout", null, {}); } catch (e) {}
    sessionStorage.removeItem(TOKEN_KEY);
    $("ws-target").textContent = "";
    showLogin("Logged out.");
  });

  if (sessionStorage.getItem(TOKEN_KEY)) load(); else showLogin("");
})();
