// In-memory stand-in for server/api.php's protocol (me/login/get-state/save-state
// with revisions + 409). legacy:true mimics the old api.php: no rev, whole-file replace.
// One store per account. opts.users maps username → password (default {"tester": "pw"});
// opts.state/opts.rev seed the FIRST account, later ones start empty. The `state`/`rev`
// getters expose the primary account ("tester") so single-account tests keep their shape.
"use strict";
class FakeServer {
  constructor(opts) {
    opts = opts || {};
    this.legacy = !!opts.legacy;
    this.online = true;
    this.saves = [];
    this.users = opts.users || { tester: "pw" };
    const seed = opts.state === undefined ? null : JSON.parse(JSON.stringify(opts.state));
    this.accts = {};
    Object.keys(this.users).forEach((u, i) => {
      this.accts[u] = { state: i === 0 ? seed : null, rev: i === 0 ? (opts.rev || 0) : 0 };
    });
    // token per account, pre-seeded so a storage-dumped "nb-token" works without a login
    this.tokens = {};
    Object.keys(this.users).forEach(u => { this.tokens[u === "tester" ? "tok-1" : "tok-" + u] = u; });
  }
  get state() { return this.accts.tester.state; }
  set state(v) { this.accts.tester.state = v; }
  get rev() { return this.accts.tester.rev; }
  set rev(v) { this.accts.tester.rev = v; }
  fetchFor() {
    return async (url, init) => {
      init = init || {};
      if (!this.online) throw new TypeError("Failed to fetch");
      const action = new URL(url, "https://rametric.com/").searchParams.get("action");
      const body = init.body ? JSON.parse(init.body) : null;
      const user = this.tokens[(init.headers || {})["X-Nevaib-Token"]] || null;
      const acct = user ? this.accts[user] : null;
      const reply = (status, data) => ({ ok: status < 400, status, json: async () => JSON.parse(JSON.stringify(data)) });
      if (action === "login") {
        const u = body && body.username;
        return this.users[u] === (body && body.password) ? reply(200, { ok: true, user: u, token: u === "tester" ? "tok-1" : "tok-" + u }) : reply(401, { ok: false, error: "wrong" });
      }
      if (action === "me") return reply(200, { ok: true, user: user });
      if (action === "logout") return reply(200, { ok: true });
      if (!user) return reply(401, { ok: false, error: "not logged in" });
      if (action === "get-state") {
        const d = { ok: true, state: acct.state, updated_at: null };
        if (!this.legacy) d.rev = acct.rev;
        return reply(200, d);
      }
      if (action === "save-state") {
        if (!this.legacy && body.base_rev !== undefined && body.base_rev !== null && body.base_rev !== acct.rev) {
          return reply(409, { ok: false, error: "conflict", rev: acct.rev, state: acct.state });
        }
        this.saves.push({ body, keepalive: !!init.keepalive, user });
        if (this.legacy) acct.state = body.state;
        else acct.state = Object.assign({}, acct.state || {}, body.state);
        acct.rev++;
        const d = { ok: true, saved: true };
        if (!this.legacy) d.rev = acct.rev;
        return reply(200, d);
      }
      return reply(400, { ok: false, error: "unknown action" });
    };
  }
}
module.exports = { FakeServer };
