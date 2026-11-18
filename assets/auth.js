/* Practice app — login + cross-device sync.
   Talks to api/api.php. Same-origin callers use PHP session cookies; on other
   origins (the study site on localhost etc.) cookies can't cross, so the login
   token is sent in the X-Nevaib-Token header instead. Logged in: the server
   holds the master copy of the app-owned state plus "site-state" (study-site
   checklist ticks + this-week items) and the tracked-list/debrief blobs
   (tok-objects, ee-ideas, io-issues, ia-debriefs — see lists.js).
   Writes go through NB.store (assets/store.js), which marks changed synced keys
   in a persisted "nb-dirty" map; this file pushes them (debounced, on pagehide,
   on reconnect) against the server revision it last saw, and merges instead of
   overwriting whenever the server copy changed. Logged out: localStorage only;
   the dirty markers make those changes sync at the next login. */
(function () {
  "use strict";

  const qsApi = new URLSearchParams(location.search).get("nbapi");
  const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  // dev-only API override (?nbapi=<url> sets, ?nbapi= resets) — honoured on
  // localhost pages only so a crafted link can't redirect logins elsewhere
  if (qsApi !== null && LOCAL_HOST) { // applied before API is read, so it works on the first load
    if (qsApi === "") localStorage.removeItem("nb-api");
    else if (qsApi !== localStorage.getItem("nb-api")) localStorage.setItem("nb-api", qsApi);
  }
  const API = (LOCAL_HOST && localStorage.getItem("nb-api")) ||
    (/^(www\.)?rametric\.com$/.test(location.hostname)
      ? "/nevaib/api/api.php"
      : "https://rametric.com/nevaib/api/api.php");

  const NB = window.NB || {};
  const S = NB.store;   // assets/store.js — must load first
  const M = NB.merge;
  if (!S || !M) {       // stale cached page without store.js: don't sync blind
    const slot = document.getElementById("auth-slot");
    if (slot) slot.textContent = "Reload the page to enable sync.";
    window.Auth = { queueSync() {}, pull() {}, login() {}, logout() {}, user: () => null, mergeValue: (k, l, s) => s };
    return;
  }
  const SYNCED_KEYS = S.SYNCED_KEYS;   // + chk:* / week:* rows, sent as "site-state"
  const META_KEY = "nb-sync";          // {user, rev, legacy, at}: what this device last synced
  const KEEPALIVE_MAX = 60000;         // fetch keepalive bodies are capped at 64 KB

  // kept for tests/back-compat: per-record merge for record keys, server value otherwise
  function mergeValue(k, local, server) {
    if (M.RECORDS[k] && local !== null && local !== undefined) return M.RECORDS[k](local, server);
    return server;
  }
  const same = M.same;

  let user = null;
  let syncTimer = null;
  let syncing = false;
  let legacyServer = null;

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
    if (!res.ok || data.ok === false) {
      const err = new Error(data.error || ("HTTP " + res.status));
      err.status = res.status; err.data = data;
      throw err;
    }
    return data;
  }

  // ── sync bookkeeping ─────────────────────────────────────────────────────
  function meta() { const m = S.get(META_KEY, null); return m && typeof m === "object" ? m : null; }
  function setMeta(m) { S.set(META_KEY, m, { silent: true }); }
  const dirtyCount = () => Object.keys(S.dirty()).length;
  const rowKeys = () => S.keys().filter(S.isSiteRow);

  function collectSiteState() {
    const ss = { checklists: {}, week: {} };
    rowKeys().forEach(k => {
      const v = S.get(k, null);
      if (k.indexOf("chk:") === 0) { if (v !== null) ss.checklists[k] = v; }
      else if (typeof v === "string") ss.week[k] = v; // empty too — clearing must propagate
    });
    return ss;
  }
  function siteRows(ss) {
    const out = {};
    if (!ss || typeof ss !== "object") return out;
    Object.entries(ss.checklists || {}).forEach(([k, v]) => { if (k.indexOf("chk:") === 0) out[k] = v; });
    Object.entries(ss.week || {}).forEach(([k, v]) => { if (/^week:\d+$/.test(k)) out[k] = v; });
    return out;
  }

  /* Merge the server copy into this device. Never overwrites newer local work:
     - fc-state / q-errors / quizlog merge per record (newest wins, nothing dropped);
     - any other key or checklist row this device changed since its last sync
       (persisted nb-dirty marker) keeps the local value and is pushed;
     - untouched keys take the server value (so deletions made elsewhere stick);
     - on this device's FIRST sync with the account both copies are unioned.
     Every local value about to be replaced is snapshotted first (nb-backup:*);
     if that snapshot can't be saved, the key is left as it is. */
  function reconcile(server, first) {
    const sv = server && typeof server === "object" ? server : {};
    const dirty = S.dirty();
    const plan = {}, push = new Set();
    const decide = (k, l, r, isRow) => {
      let m;
      if (r === null || r === undefined) m = l;
      else if (l === null || l === undefined) m = r;
      else if (M.RECORDS[k]) m = M.RECORDS[k](l, r);
      else if (first) m = dirty[k] ? M.union(k, l, r) : M.union(k, r, l);
      else m = dirty[k] ? l : r;
      if (m === null || m === undefined) return;
      if (!same(m, l)) plan[k] = m;
      const onServer = !(r === null || r === undefined);
      if (!same(m, r) && (onServer || !isRow || dirty[k] || !M.isDefaultRow(k, m))) push.add(k);
    };
    SYNCED_KEYS.forEach(k => decide(k, S.get(k, null), sv[k] === undefined ? null : sv[k], false));
    const rows = siteRows(sv["site-state"]);
    new Set(rowKeys().concat(Object.keys(rows))).forEach(k => decide(k, S.get(k, null), k in rows ? rows[k] : null, true));

    const replace = Object.keys(plan).filter(k => S.getRaw(k) !== null);
    let skipped = [];
    if (replace.length && !S.snapshot("before merging the server copy", replace)) {
      skipped = replace; // no safety copy → don't touch them this time
      S.banner("Sync: couldn't save a safety copy (storage full?), so " + replace.length + " item(s) were not updated from the server.");
    }
    const applied = Object.keys(plan).filter(k => skipped.indexOf(k) < 0);
    applied.forEach(k => S.set(k, plan[k], { silent: true }));
    push.forEach(k => { if (skipped.indexOf(k) < 0) S.markDirty(k); }); // never push a value we couldn't merge
    // dirty keys the server already holds identically need no push
    const cleared = Object.keys(dirty).filter(k => !push.has(k) && skipped.indexOf(k) < 0);
    S.clearDirty(cleared, Date.now());
    return { changed: applied.length > 0, push: push.size };
  }

  function applyServer(d, first) {
    const res = reconcile(d && d.state, first);
    const legacy = !d || d.rev === undefined || d.rev === null;  // server predates revisions
    legacyServer = legacy ? (d && d.state) || null : null; // in memory only; re-fetched before every legacy push
    setMeta({ user: user, rev: legacy ? null : d.rev, legacy: legacy, at: Date.now() });
    return res;
  }

  // changed keys only (the server keeps keys a save omits); site rows travel as one blob
  function buildPayload(dirty) {
    const p = {};
    let site = false;
    Object.keys(dirty).forEach(k => {
      if (S.isSiteRow(k)) { site = true; return; }
      if (SYNCED_KEYS.indexOf(k) < 0) return;
      const v = S.get(k, null);
      if (v !== null) p[k] = v;
    });
    if (site) p["site-state"] = collectSiteState();
    return p;
  }

  async function pushNow(manual) {
    if (!user || syncing) return false;
    syncing = true;
    if (!manual) status("Syncing\u2026");
    let ok = false;
    try {
      for (let attempt = 0; attempt < 4 && !ok; attempt++) {
        let m = meta();
        if (!m || m.user !== user || m.legacy) {
          // unknown base (first sync, other account, or a server without revisions):
          // fetch and merge before sending anything
          applyServer(await api("get-state"), !m || m.user !== user);
          m = meta();
        }
        const sentAt = Date.now();
        const dirty = S.dirty();
        let payload = buildPayload(dirty);
        if (m.legacy) {
          // old api.php replaces the whole file: send everything + carry over its other keys
          payload = {};
          SYNCED_KEYS.forEach(k => { const v = S.get(k, null); if (v !== null) payload[k] = v; });
          payload["site-state"] = collectSiteState();
          Object.keys(legacyServer || {}).forEach(k => { if (payload[k] === undefined) payload[k] = legacyServer[k]; });
        }
        if (!Object.keys(payload).length) { ok = true; break; }
        const body = { state: payload };
        if (!m.legacy) body.base_rev = m.rev;
        try {
          const r = await api("save-state", { method: "PUT", body: body });
          const legacy = r.rev === undefined || r.rev === null;
          setMeta({ user: user, rev: legacy ? null : r.rev, legacy: legacy, at: Date.now() });
          S.clearDirty(Object.keys(dirty), sentAt);
          ok = true;
        } catch (e) {
          if (e.status === 409 && e.data && typeof e.data === "object") {
            // another device saved first: merge its copy and try again
            if (applyServer(e.data, false).changed) status("Merged changes from another device \u2014 reload to see them", "");
            continue;
          }
          throw e;
        }
      }
      if (ok) status("Synced \u2713 " + new Date().toLocaleTimeString(), "good");
      else status("Sync busy \u2014 will retry", "bad");
    } catch (e) {
      const n = dirtyCount();
      status("Sync failed \u2014 " + (n ? n + " change(s) kept on this device, " : "") + "will retry: " + e.message, "bad");
    }
    syncing = false;
    return ok;
  }

  function queueSync() {
    if (!user) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => { if (dirtyCount()) pushNow(false); }, 2000);
  }

  // last-chance push when the page is hidden or unloaded (navigation within the 2 s
  // debounce, closing the tab). If it doesn't get through, the persisted nb-dirty
  // markers make the next page load push the same changes.
  function flushOnHide() {
    if (!user || syncing) return;
    const m = meta();
    if (!m || m.user !== user || m.legacy) return;
    const dirty = S.dirty();
    if (!Object.keys(dirty).length) return;
    const body = JSON.stringify({ state: buildPayload(dirty), base_rev: m.rev });
    if (body.length > KEEPALIVE_MAX) return;
    const headers = { "Content-Type": "application/json" };
    const token = localStorage.getItem("nb-token");
    if (token) headers["X-Nevaib-Token"] = token;
    const sentAt = Date.now();
    clearTimeout(syncTimer);
    try {
      fetch(API + "?action=save-state", { method: "POST", keepalive: true, credentials: "same-origin", headers: headers, body: body })
        .then(r => r.json())
        .then(r => {
          if (r && r.ok && r.rev !== undefined) {
            setMeta({ user: user, rev: r.rev, legacy: false, at: Date.now() });
            S.clearDirty(Object.keys(dirty), sentAt);
          }
        })
        .catch(() => {});
    } catch (e) {}
  }

  // fetch + merge + push; used on page load and right after login
  async function syncWithServer(isLogin) {
    const d = await api("get-state");
    const m = meta();
    const first = !m || m.user !== user;
    let changed = false;
    if (!d.state || typeof d.state !== "object") {
      // empty account: this device's data becomes the first copy
      S.keys().filter(k => SYNCED_KEYS.indexOf(k) >= 0 || (S.isSiteRow(k) && !M.isDefaultRow(k, S.get(k, null)))).forEach(k => S.markDirty(k));
      setMeta({ user: user, rev: d.rev === undefined ? null : d.rev, legacy: d.rev === undefined, at: Date.now() });
      status(isLogin ? "Account ready \u2014 this device will sync \u2713" : "No server data yet \u2014 backing up this device\u2026", "good");
    } else {
      changed = applyServer(d, first).changed;
    }
    if (dirtyCount()) await pushNow(true);
    else status(isLogin ? "Loaded from server \u2713" : "Synced \u2713", "good");
    return changed;
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

  async function pull() {
    try {
      const changed = await syncWithServer(true);
      if (changed) setTimeout(() => location.reload(), 400); // engines re-read the merged state
      return changed;
    } catch (e) { status("Load failed: " + e.message, "bad"); return false; }
  }

  async function doLogout() {
    if (dirtyCount() && user) await pushNow(true); // don't strand unsynced work on the server side
    try { await api("logout", { method: "POST", body: {} }); } catch (e) {}
    localStorage.removeItem("nb-token");
    S.remove(META_KEY);
    user = null;
    renderWidget();
    status("Logged out \u2014 data stays on this device until next login", "");
  }

  async function connect() {
    let meOk = false;
    try {
      const d = await api("me");
      user = d.user || null;
      meOk = true;
    } catch (e) { user = null; }
    if (meOk && !user && localStorage.getItem("nb-token")) localStorage.removeItem("nb-token"); // genuinely stale
    renderWidget();
    if (!user) return false;
    try {
      const changed = await syncWithServer(false);
      if (changed) setTimeout(() => location.reload(), 300);
    } catch (e) {
      const n = dirtyCount();
      status("Offline \u2014 using this device only" + (n ? " (" + n + " change(s) will sync later)" : ""), "");
    }
    return true;
  }

  let wired = false;
  async function boot() {
    renderWidget();
    if (!wired) {
      wired = true;
      // every user change to a synced key (marked dirty by NB.store) schedules a push
      S.onChange((k, v, o) => { if (!o.silent && S.isSynced(k)) queueSync(); });
      window.addEventListener("pagehide", flushOnHide);
      document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flushOnHide(); });
      window.addEventListener("online", () => { if (user) pushNow(false); else if (localStorage.getItem("nb-token")) connect(); });
      setInterval(() => { if (user && dirtyCount()) pushNow(false); }, 15000);
    }
    await connect();
  }

  window.Auth = { queueSync, pull, login, logout: doLogout, user: () => user, mergeValue, pushNow, _reconcile: reconcile };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
