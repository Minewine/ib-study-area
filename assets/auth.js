/* Practice app — login + cross-device sync.
   Talks to api/api.php. Same-origin callers use PHP session cookies; on other
   origins (the study site on localhost etc.) cookies can't cross, so the login
   token is sent in the X-Nevaib-Token header instead. Logged in: the server
   holds the master copy of the app-owned state plus "site-state" (study-site
   checklist ticks + this-week items) and the tracked-list/debrief blobs
   (tok-objects, ee-ideas, io-issues, ia-debriefs — see lists.js); every change
   is pushed (debounced). Logged out: localStorage-only, exactly as before. */
(function () {
  "use strict";

  const qsApi = new URLSearchParams(location.search).get("nbapi");
  const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  // dev-only API override (?nbapi=<url> sets, ?nbapi= resets) — honoured on
  // localhost pages only so a crafted link can't redirect logins elsewhere
  const API = (LOCAL_HOST && localStorage.getItem("nb-api")) ||
    (/^(www\.)?rametric\.com$/.test(location.hostname)
      ? "/nevaib/api/api.php"
      : "https://rametric.com/nevaib/api/api.php");
  if (qsApi !== null && LOCAL_HOST) {
    if (qsApi === "") localStorage.removeItem("nb-api");
    else if (qsApi !== localStorage.getItem("nb-api")) localStorage.setItem("nb-api", qsApi);
  }

  const SYNCED_KEYS = [
    "q-userbanks", "fc-userdecks", "fc-state", "fc-user",
    "fc-deleted", "fc-edits", "quizlog", "site-state",
    // study-site tracked lists + debrief notes (lists.js blobs)
    "tok-objects", "ee-ideas", "io-issues", "ia-debriefs",
    // library browser resource tracking (library.js blobs)
    "res-bookmarks", "res-notes", "res-recent"
  ];
  const store = {
    get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v === null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };

  let user = null;
  let syncTimer = null;
  let dirty = false;
  let syncing = false;

  function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

  function status(text, cls) {
    const s = document.getElementById("auth-status");
    if (s) { s.textContent = text; s.className = "auth-status " + (cls || ""); }
    const w = document.getElementById("auth-widget");
    if (w) w.dataset.mode = user ? "in" : "out";
  }

  function renderWidget() {
    const slot = document.getElementById("auth-slot");
    if (!slot) return;
    if (user) {
      slot.innerHTML = `
        <span class="auth-user">\uD83D\uDC64 ${esc(user)}</span>
        <button class="btn fc-mini" id="auth-sync">Sync now</button>
        <span id="auth-status" class="auth-status"></span>
        <button class="btn fc-mini" id="auth-logout">Log out</button>`;
      document.getElementById("auth-sync").addEventListener("click", () => { pushNow(true); });
      document.getElementById("auth-logout").addEventListener("click", doLogout);
    } else {
      slot.innerHTML = `
        <form id="auth-form" class="auth-form">
          <input id="auth-user" placeholder="username" autocomplete="username" size="12">
          <input id="auth-pass" type="password" placeholder="password" autocomplete="current-password" size="12">
          <button class="btn fc-mini" id="auth-login-btn">Log in</button>
          <span id="auth-status" class="auth-status"></span>
        </form>`;
      document.getElementById("auth-form").addEventListener("submit", (e) => {
        e.preventDefault();
        login(document.getElementById("auth-user").value.trim(),
              document.getElementById("auth-pass").value);
      });
    }
  }

  async function api(action, opts = {}) {
    let url = API + "?action=" + encodeURIComponent(action);
    const init = { method: opts.method || "GET", credentials: "same-origin", headers: {} };
    const token = localStorage.getItem("nb-token");
    if (token) init.headers["X-Nevaib-Token"] = token;
    if (opts.body !== undefined) {
      init.method = "POST";
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(opts.body);
    }
    const res = await fetch(url, init);
    let data = null;
    try { data = await res.json(); } catch (e) { throw new Error("bad response (" + res.status + ")"); }
    if (!res.ok || data.ok === false) throw new Error(data.error || ("HTTP " + res.status));
    return data;
  }

  async function login(username, password) {
    status("Logging in\u2026");
    try {
      const d = await api("login", { method: "POST", body: { username, password } });
      if (d.token) localStorage.setItem("nb-token", d.token);
      user = d.user;
      renderWidget();
      await pull();
    } catch (e) { status(e.message, "bad"); }
  }

  async function doLogout() {
    try { await api("logout", { method: "POST", body: {} }); } catch (e) {}
    localStorage.removeItem("nb-token");
    user = null;
    renderWidget();
    status("Logged out \u2014 data stays on this device until next login", "");
  }

  function hasSiteEntries() {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && (k.startsWith("chk:") || /^week:\d+$/.test(k))) return true;
    }
    return false;
  }

  function collectSiteState() {
    const ss = { checklists: {}, week: {} };
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      if (k.startsWith("chk:")) {
        const v = store.get(k, null);
        if (v !== null) ss.checklists[k] = v;
      } else if (/^week:\d+$/.test(k)) {
        const v = store.get(k, null);
        if (typeof v === "string") ss.week[k] = v; // empty too — clearing must propagate
      }
    }
    return ss;
  }

  // merge incoming site rows into localStorage; local-only rows are never deleted
  function distributeSiteState(ss, preferLocal) {
    let changed = false;
    if (!ss || typeof ss !== "object") return changed;
    const put = (k, v) => {
      if (preferLocal && localStorage.getItem(k) !== null) return;
      if (JSON.stringify(store.get(k, null)) !== JSON.stringify(v)) { store.set(k, v); changed = true; }
    };
    Object.entries(ss.checklists || {}).forEach(([k, v]) => { if (k.startsWith("chk:")) put(k, v); });
    Object.entries(ss.week || {}).forEach(([k, v]) => { if (/^week:\d+$/.test(k)) put(k, v); });
    return changed;
  }

  async function pull() {
    try {
      const d = await api("get-state");
      if (d.state && typeof d.state === "object") {
        Object.entries(d.state).forEach(([k, v]) => {
          if (k !== "site-state") store.set(k, v);
        });
        if (d.state["site-state"]) distributeSiteState(d.state["site-state"], false);
        else if (hasSiteEntries()) queueSync(); // server predates site-state — push the migration
        status("Loaded from server \u2713", "good");
        setTimeout(() => location.reload(), 400);
        return true;
      }
      status("Account ready \u2014 this device will sync \u2713", "good");
      pushNow(true);
      return false;
    } catch (e) { status("Load failed: " + e.message, "bad"); return false; }
  }

  function collectState() {
    const s = {};
    SYNCED_KEYS.forEach(k => { const v = store.get(k, null); if (v !== null) s[k] = v; });
    s["site-state"] = collectSiteState(); // always present — stable shape
    return s;
  }

  async function pushNow(manual) {
    if (!user || syncing) return;
    syncing = true;
    if (!manual) status("Syncing\u2026");
    try {
      // save-state replaces the whole file — probe first and carry over server
      // keys this device doesn't hold so a fresh device can't wipe them; site
      // rows merge per-row. A failed probe aborts: pushing blind would replace
      // the file without those carry-overs.
      let server = null;
      const d = await api("get-state");
      if (d.state && typeof d.state === "object") server = d.state;
      if (server) distributeSiteState(server["site-state"], true);
      const payload = collectState();
      if (server) {
        SYNCED_KEYS.forEach(k => {
          if (payload[k] === undefined && server[k] !== undefined) payload[k] = server[k];
        });
      }
      await api("save-state", { method: "PUT", body: { state: payload } });
      dirty = false;
      status("Synced \u2713 " + new Date().toLocaleTimeString(), "good");
    } catch (e) { status("Sync failed \u2014 will retry: " + e.message, "bad"); dirty = true; }
    syncing = false;
  }

  function queueSync() {
    if (!user) return;
    dirty = true;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => { if (dirty) pushNow(false); }, 2000);
  }

  async function boot() {
    renderWidget();
    let meOk = false;
    try {
      const d = await api("me");
      user = d.user || null;
      meOk = true;
    } catch (e) { user = null; }
    if (meOk && !user && localStorage.getItem("nb-token")) localStorage.removeItem("nb-token"); // genuinely stale
    renderWidget();
    if (user) {
      try {
        const d = await api("get-state");
        if (d.state && typeof d.state === "object") {
          let changed = false;
          Object.entries(d.state).forEach(([k, v]) => {
            if (k === "site-state") { if (distributeSiteState(v, false)) changed = true; return; }
            if (JSON.stringify(store.get(k, null)) !== JSON.stringify(v)) { store.set(k, v); changed = true; }
          });
          if (changed || (!d.state["site-state"] && hasSiteEntries())) queueSync();
          if (changed) setTimeout(() => location.reload(), 300);
          status("Synced \u2713", "good");
        } else {
          status("No server data yet \u2014 press Sync now to back up this device", "");
        }
      } catch (e) { status("Offline \u2014 using this device only", ""); }
    }
    const origSet = store.set.bind(store);
    store.set = function (k, v) { origSet(k, v); queueSync(); };
    setInterval(() => { if (dirty && user) pushNow(false); }, 15000);
  }

  window.Auth = { queueSync, pull, login, logout: doLogout, user: () => user };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
