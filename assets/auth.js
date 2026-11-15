/* Practice app — login + cross-device sync.
   Talks to api/api.php (PHP sessions). Logged in: the server holds the master
   copy of the app-owned state; every change is pushed (debounced). Logged out:
   localStorage-only, exactly as before. Keys synced are the app-owned ones —
   study-site data (checklists etc.) is not part of this payload. */
(function () {
  "use strict";

  const API = "api/api.php";
  const SYNCED_KEYS = [
    "q-userbanks", "fc-userdecks", "fc-state", "fc-user",
    "fc-deleted", "fc-edits", "quizlog"
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
    const init = { method: opts.method || "GET", credentials: "same-origin" };
    if (opts.body !== undefined) {
      init.method = "POST";
      init.headers = { "Content-Type": "application/json" };
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
      user = d.user;
      renderWidget();
      await pull();
    } catch (e) { status(e.message, "bad"); }
  }

  async function doLogout() {
    try { await api("logout", { method: "POST", body: {} }); } catch (e) {}
    user = null;
    renderWidget();
    status("Logged out \u2014 data stays on this device until next login", "");
  }

  async function pull() {
    try {
      const d = await api("get-state");
      if (d.state && typeof d.state === "object") {
        Object.entries(d.state).forEach(([k, v]) => store.set(k, v));
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
    return s;
  }

  async function pushNow(manual) {
    if (!user || syncing) return;
    syncing = true;
    if (!manual) status("Syncing\u2026");
    try {
      await api("save-state", { method: "PUT", body: { state: collectState() } });
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
    try {
      const d = await api("me");
      user = d.user || null;
    } catch (e) { user = null; }
    renderWidget();
    if (user) {
      try {
        const d = await api("get-state");
        if (d.state && typeof d.state === "object") {
          let changed = false;
          Object.entries(d.state).forEach(([k, v]) => {
            if (JSON.stringify(store.get(k, null)) !== JSON.stringify(v)) { store.set(k, v); changed = true; }
          });
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
