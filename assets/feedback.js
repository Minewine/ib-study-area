/* NevaIB feedback widget — window.NB.feedback.
   A small "Feedback" button (bottom-right) on the practice pages opens a
   lightweight modal (type / area / title / description + an optional
   "Include current page and topic" checkbox) and POSTs JSON to the Signalbox
   feedback endpoint. No stored data, no store.js dependency. Everything
   configurable lives in the FEEDBACK_CONFIG block below — the endpoint URL
   and the app key are PLACEHOLDERS until the Signalbox side confirms them.

   CSP note: the app pages carry a meta CSP whose connect-src whitelist allows
   only 'self' + rametric.com/www.rametric.com + localhost. The endpoint host
   must stay in that whitelist (or the CSP on all pages must be edited with
   it) — never move the endpoint off it silently. The POST goes through
   fetch(), never a real <form action> (form-action 'self' would block that).

   Exports for the node tests (tests/js/feedback.test.js):
   - buildPayload(input): validate {type, area, title, body} + assemble the
     {page, subject, topic, user} context; friendly Error on bad input.
   - collectContext(): current page/subject/topic from the page's own state
     (Quiz/Cards selects, the Notes URL params); nulls where unknown, never
     throws when elements are missing.
   - submit(payload): fetch POST with a 10 s timeout (today.js convention);
     2xx resolves, non-OK throws the server's error message ("HTTP <status>"
     when the body isn't JSON) — same convention as auth.js.
   - config: FEEDBACK_CONFIG. */
(function () {
  "use strict";
  const NB = window.NB = window.NB || {};
  if (NB.feedback) return;

  var FEEDBACK_CONFIG = {
    app: "nevaib",
    endpoint: "https://rametric.com/feedback/api.php?action=submit", // PLACEHOLDER — confirm Signalbox URL
    appKey: "CHANGE_ME_APP_KEY" // PLACEHOLDER — set the Signalbox app key
  };

  const TYPES = ["bug", "improvement", "idea"];
  const TYPE_LABELS = { bug: "Bug", improvement: "Improvement", idea: "Idea" };
  const AREAS = ["quiz", "cards", "today", "notes", "upload", "other"];
  const AREA_LABELS = { quiz: "Quiz", cards: "Cards", today: "Today", notes: "Notes", upload: "Upload", other: "Other" };
  const AREA_BY_PAGE = { index: "today", quiz: "quiz", cards: "cards", notes: "notes", author: "upload" }; // mistakes/coursework/resources → other
  const FAB_ID = "sbx-fab";
  const STYLE_ID = "sbx-styles";
  const SUBMIT_TIMEOUT = 10000; // a hung request must not leave the button stuck on "Sending…"

  function buildPayload(input) {
    const i = input || {};
    const type = String(i.type || "");
    const area = String(i.area || "");
    const title = String(i.title == null ? "" : i.title).trim();
    const body = String(i.body == null ? "" : i.body).trim();
    if (TYPES.indexOf(type) < 0) throw new Error("Choose a feedback type (bug, improvement or idea).");
    if (AREAS.indexOf(area) < 0) throw new Error("Choose an area (quiz, cards, today, notes, upload or other).");
    if (!title) throw new Error("Add a short title so the feedback is easy to triage.");
    if (!body) throw new Error("Describe the feedback — a sentence or two is enough.");
    const payload = { app: FEEDBACK_CONFIG.app, key: FEEDBACK_CONFIG.appKey, type: type, area: area, title: title, body: body };
    const context = {};
    if (i.context && typeof i.context === "object") {
      if (i.context.page) context.page = i.context.page;
      if (i.context.subject) context.subject = i.context.subject;
      if (i.context.topic) context.topic = i.context.topic;
    }
    if (typeof i.user === "string" && i.user) context.user = i.user;
    if (Object.keys(context).length) payload.context = context;
    return payload;
  }

  const canon = (id) => (typeof NB.canonicalSubject === "function" ? NB.canonicalSubject(id) : id);

  // The visible label of the selected <option> (the engines put human labels in
  // the option text and topic keys in the value). Falls back to scanning the
  // children when options/selectedIndex are unavailable (the test DOM).
  function selectedLabel(sel) {
    if (!sel) return "";
    let opt = null;
    if (typeof sel.selectedIndex === "number" && sel.selectedIndex >= 0 && sel.options) opt = sel.options[sel.selectedIndex] || null;
    if (!opt && sel.value) {
      const kids = sel.children || [];
      for (let k = 0; k < kids.length; k++) if (kids[k] && kids[k].value === sel.value) { opt = kids[k]; break; }
    }
    return opt ? String(opt.textContent || opt.label || "").trim() : String(sel.value || "").trim();
  }

  function collectContext() {
    const out = { page: null, subject: null, topic: null };
    const base = String((typeof location !== "undefined" && location.pathname) || "").split("/").pop() || "";
    const page = base.replace(/\.html$/i, "");
    if (page) out.page = page;
    const params = new URLSearchParams((typeof location !== "undefined" && location.search) || "");
    const val = (id) => { const el = document.getElementById(id); return el && typeof el.value === "string" ? el.value.trim() : ""; };
    if (page === "quiz" || page === "cards") {
      const subject = val(page === "quiz" ? "q-subject" : "fc-subject");
      if (subject) out.subject = canon(subject);
      const sel = document.getElementById(page === "quiz" ? "q-topic" : "fc-topic");
      const topic = sel && sel.value !== "*" ? selectedLabel(sel) : ""; // "*" = mixed → no topic
      if (topic) out.topic = topic;
    } else if (page === "notes") {
      const subject = (params.get("subject") || "").trim();
      if (subject) out.subject = canon(subject);
      const topic = (params.get("topic") || "").trim();
      if (topic) out.topic = topic;
    }
    return out;
  }

  function submit(payload) {
    const ctrl = typeof AbortController === "function" ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), SUBMIT_TIMEOUT) : null;
    const clear = () => { if (timer !== null) clearTimeout(timer); };
    return fetch(FEEDBACK_CONFIG.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify(payload),
      signal: ctrl ? ctrl.signal : undefined
    }).then((res) => {
      clear();
      if (res.ok) return true; // 2xx = accepted, whatever the body says
      return res.json().catch(() => null).then((data) => {
        throw new Error((data && data.error) ? String(data.error) : "HTTP " + res.status);
      });
    }, (e) => { clear(); throw e; });
  }

  // ---------- UI (browser only; scripts load at the end of <body>, so the DOM is ready) ----------
  // Own prefixed classes + this injected <style>: there is no shared .btn and
  // no page CSS to lean on (the ai-prompt toast's styles live in notes.html only).
  const CSS = `
.sbx-fab{position:fixed;right:14px;bottom:14px;z-index:9990;padding:6px 13px;font:inherit;font-size:.8rem;color:var(--muted,#5b6b7c);background:var(--card,#fff);border:1px solid var(--line,#dfe4ea);border-radius:999px;cursor:pointer;box-shadow:0 1px 3px rgba(15,25,40,.08)}
.sbx-fab:hover{color:var(--ink,#1d2733)}
.sbx-backdrop{position:fixed;inset:0;z-index:9991;background:rgba(18,26,38,.45);display:flex;align-items:center;justify-content:center;padding:16px}
.sbx-modal{width:100%;max-width:420px;max-height:calc(100vh - 48px);overflow:auto;background:var(--card,#fff);color:var(--ink,#1d2733);border:1px solid var(--line,#dfe4ea);border-radius:12px;padding:16px;box-shadow:0 10px 30px rgba(15,25,40,.25)}
.sbx-modal h3{margin:0 0 .6rem}
.sbx-field{display:block;margin:.55rem 0 0;font-size:.8rem;color:var(--muted,#5b6b7c)}
.sbx-field select,.sbx-field input,.sbx-field textarea{display:block;width:100%;margin-top:.25rem;padding:7px 9px;font:inherit;font-size:.9rem;color:var(--ink,#1d2733);background:var(--bg,#f6f7f9);border:1px solid var(--line,#dfe4ea);border-radius:8px;box-sizing:border-box}
.sbx-field textarea{min-height:96px;resize:vertical}
.sbx-check{display:flex;align-items:center;gap:.45rem;margin:.7rem 0 0;font-size:.82rem;color:var(--muted,#5b6b7c)}
.sbx-status{min-height:1.1em;margin:.6rem 0 0;font-size:.82rem}
.sbx-status.sbx-bad{color:#b3261e}
.sbx-row{display:flex;justify-content:flex-end;gap:.5rem;margin-top:.8rem}
.sbx-btn{padding:7px 14px;font:inherit;font-size:.88rem;color:var(--ink,#1d2733);background:var(--card,#fff);border:1px solid var(--line,#dfe4ea);border-radius:8px;cursor:pointer}
.sbx-btn.sbx-primary{color:#fff;background:var(--accent,#2c5fa8);border-color:var(--accent,#2c5fa8)}
.sbx-done{margin:1rem 0 0;font-size:.92rem;color:#1e7d3c}
`;
  const el = (tag, attrs, ...kids) => {
    const n = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => { if (v === null || v === undefined || v === false) return; if (k === "class") n.className = v; else n.setAttribute(k, v); });
    kids.flat().forEach(k => { if (k === null || k === undefined || k === false) return; n.append(typeof k === "string" ? document.createTextNode(k) : k); });
    return n;
  };

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const st = document.createElement("style");
    st.id = STYLE_ID;
    st.textContent = CSS;
    (document.head || document.body).appendChild(st);
  }

  const authUser = () => (window.Auth && typeof window.Auth.user === "function" ? window.Auth.user() : null);

  let openBackdrop = null;
  let sending = false; // a send in flight: the modal must not be dismissible (the outcome would never be seen)

  function closeModal() {
    if (sending || !openBackdrop) return;
    if (typeof document.removeEventListener === "function") document.removeEventListener("keydown", onKey);
    openBackdrop.remove();
    openBackdrop = null;
  }
  function onKey(e) { if (e && (e.key === "Escape" || e.key === "Esc")) closeModal(); }

  function openModal() {
    if (openBackdrop) return;
    const status = el("p", { class: "sbx-status" });
    const typeSel = el("select", { "aria-label": "Feedback type" }, TYPES.map(t => el("option", { value: t }, TYPE_LABELS[t])));
    const areaSel = el("select", { "aria-label": "Area" }, AREAS.map(a => el("option", { value: a }, AREA_LABELS[a])));
    areaSel.value = AREA_BY_PAGE[collectContext().page || ""] || "other";
    const titleIn = el("input", { type: "text", maxlength: "120", placeholder: "Short summary" });
    const bodyTa = el("textarea", { maxlength: "4000", placeholder: "What happened, or what would you change?" });
    const inc = el("input", { type: "checkbox" });
    inc.checked = true;
    const send = el("button", { type: "button", class: "sbx-btn sbx-primary" }, "Send");
    const cancel = el("button", { type: "button", class: "sbx-btn" }, "Cancel");
    const modal = el("div", { class: "sbx-modal", role: "dialog", "aria-modal": "true", "aria-labelledby": "sbx-heading" },
      el("h3", { id: "sbx-heading" }, "Send feedback"),
      el("label", { class: "sbx-field" }, "Type", typeSel),
      el("label", { class: "sbx-field" }, "Area", areaSel),
      el("label", { class: "sbx-field" }, "Title", titleIn),
      el("label", { class: "sbx-field" }, "Description", bodyTa),
      el("label", { class: "sbx-check" }, inc, "Include current page and topic"),
      status,
      el("div", { class: "sbx-row" }, send, cancel));
    const backdrop = el("div", { class: "sbx-backdrop" }, modal);
    backdrop.addEventListener("click", (e) => { if (!e || e.target === backdrop) closeModal(); });
    cancel.addEventListener("click", closeModal);
    send.addEventListener("click", async () => {
      const fail = (msg) => { sending = false; status.textContent = msg; status.className = "sbx-status sbx-bad"; send.disabled = false; send.textContent = "Send"; };
      sending = true;
      send.disabled = true;
      send.textContent = "Sending\u2026";
      status.textContent = "";
      status.className = "sbx-status";
      let payload;
      try {
        payload = buildPayload({
          type: typeSel.value, area: areaSel.value, title: titleIn.value, body: bodyTa.value,
          context: inc.checked ? collectContext() : null, user: authUser()
        });
      } catch (e) { fail(e.message); return; }
      // the 10 s abort must not surface as the browser-internal "This operation was aborted" text
      try { await NB.feedback.submit(payload); } catch (e) { fail(e && e.name === "AbortError" ? "Request timed out — check your connection and try again." : e.message); return; }
      sending = false; // outcome shown — the 2 s auto-close (and early Escape) may proceed
      modal.textContent = ""; // swap the form for a plain success note, then close
      modal.appendChild(el("p", { class: "sbx-done" }, "Thanks — feedback sent."));
      setTimeout(closeModal, 2000);
    });
    openBackdrop = backdrop;
    document.addEventListener("keydown", onKey);
    document.body.appendChild(backdrop);
    if (typeof titleIn.focus === "function") titleIn.focus();
  }

  function boot() {
    if (document.getElementById(FAB_ID)) return; // double include: one button, one style block
    injectStyles();
    const fab = el("button", { type: "button", class: "sbx-fab" }, "Feedback");
    fab.id = FAB_ID; // property, not setAttribute — the test DOM's getElementById only sees .id
    fab.addEventListener("click", openModal);
    document.body.appendChild(fab);
  }

  NB.feedback = { buildPayload, collectContext, submit, config: FEEDBACK_CONFIG };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
