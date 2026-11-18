// In-memory stand-in for server/api.php's protocol (me/login/get-state/save-state
// with revisions + 409). legacy:true mimics the old api.php: no rev, whole-file replace.
"use strict";
class FakeServer {
  constructor(opts) {
    opts = opts || {};
    this.legacy = !!opts.legacy;
    this.state = opts.state === undefined ? null : JSON.parse(JSON.stringify(opts.state));
    this.rev = opts.rev || 0;
    this.online = true;
    this.saves = [];
    this.token = "tok-1";
  }
  fetchFor() {
    return async (url, init) => {
      init = init || {};
      if (!this.online) throw new TypeError("Failed to fetch");
      const action = new URL(url, "https://rametric.com/").searchParams.get("action");
      const body = init.body ? JSON.parse(init.body) : null;
      const authed = (init.headers || {})["X-Nevaib-Token"] === this.token;
      const reply = (status, data) => ({ ok: status < 400, status, json: async () => JSON.parse(JSON.stringify(data)) });
      if (action === "login") return body.password === "pw" ? reply(200, { ok: true, user: "tester", token: this.token }) : reply(401, { ok: false, error: "wrong" });
      if (action === "me") return reply(200, { ok: true, user: authed ? "tester" : null });
      if (action === "logout") return reply(200, { ok: true });
      if (!authed) return reply(401, { ok: false, error: "not logged in" });
      if (action === "get-state") {
        const d = { ok: true, state: this.state, updated_at: null };
        if (!this.legacy) d.rev = this.rev;
        return reply(200, d);
      }
      if (action === "save-state") {
        if (!this.legacy && body.base_rev !== undefined && body.base_rev !== null && body.base_rev !== this.rev) {
          return reply(409, { ok: false, error: "conflict", rev: this.rev, state: this.state });
        }
        this.saves.push({ body, keepalive: !!init.keepalive });
        if (this.legacy) this.state = body.state;
        else this.state = Object.assign({}, this.state || {}, body.state);
        this.rev++;
        const d = { ok: true, saved: true };
        if (!this.legacy) d.rev = this.rev;
        return reply(200, d);
      }
      return reply(400, { ok: false, error: "unknown action" });
    };
  }
}
module.exports = { FakeServer };
