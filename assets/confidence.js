/* NevaIB confidence ratings — window.NB.conf (pure helpers, no DOM, no storage).
   Each answered quiz question carries conf: "sure" | "guess" (null on records made
   before ratings existed). Used by quiz-engine.js for:
     - the per-session calibration line and "confident but wrong" list,
     - the compact `conf` summary saved on the quizlog entry,
     - the lastConf / sureWrong fields on q-errors records.
   Old quizlog and q-errors records have none of these fields and stay valid. */
(function () {
  "use strict";
  const NB = window.NB = window.NB || {};
  if (NB.conf) return;

  const CONFS = ["sure", "guess"];
  const norm = (c) => CONFS.indexOf(c) >= 0 ? c : null;
  const fullMarks = (r) => r && typeof r.got === "number" && typeof r.max === "number" && r.got >= r.max;

  // {sure, sureRight, guess, guessRight} for a session's results; unrated results are ignored
  function tally(results) {
    const t = { sure: 0, sureRight: 0, guess: 0, guessRight: 0 };
    (results || []).forEach(r => {
      const c = norm(r && r.conf);
      if (!c) return;
      t[c]++;
      if (fullMarks(r)) t[c + "Right"]++;
    });
    return t;
  }

  // results answered "sure" that did not get full marks, i.e. false confidence
  function confidentWrong(results) {
    return (results || []).filter(r => r && norm(r.conf) === "sure" && !fullMarks(r));
  }

  // quizlog field: compact tally, or null when nothing in the session was rated
  function logField(results) {
    const t = tally(results);
    return (t.sure + t.guess) ? t : null;
  }

  // "sure 5/6 right · guessing 1/4 right" for a quizlog entry; "" for old entries
  function describe(conf) {
    if (!conf || typeof conf !== "object") return "";
    const bits = [];
    if (conf.sure) bits.push(`sure ${conf.sureRight || 0}/${conf.sure} right`);
    if (conf.guess) bits.push(`guessing ${conf.guessRight || 0}/${conf.guess} right`);
    return bits.join(" \u00b7 ");
  }

  // update a q-errors record after an attempt; wrong && sure counts as false confidence
  function applyToError(rec, conf, wrong) {
    const c = norm(conf);
    if (!rec || !c) return rec;
    rec.lastConf = c;
    if (wrong && c === "sure") rec.sureWrong = (rec.sureWrong || 0) + 1;
    return rec;
  }

  // unresolved missed questions whose latest miss was answered "sure" — newest first
  function confidentWrongErrors(errs) {
    return (Array.isArray(errs) ? errs : [])
      .filter(e => e && !e.resolved && e.lastConf === "sure")
      .sort((a, b) => String(b.lastMissed || b.lastAttempt || "").localeCompare(String(a.lastMissed || a.lastAttempt || "")) || (b.ts || 0) - (a.ts || 0));
  }

  NB.conf = { tally, confidentWrong, logField, describe, applyToError, confidentWrongErrors };
})();
