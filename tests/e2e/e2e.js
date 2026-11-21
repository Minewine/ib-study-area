// End-to-end checks against the local PHP dev server (tools/dev_server.php) using headless Chrome.
// End-to-end checks in headless Chrome against server/api.php on php -S (temp data dir).
// Run: ./dev.sh e2e   (CHROME=/path/to/chrome to override the browser)
const puppeteer = require("puppeteer-core");
const fs = require("fs"), os = require("os"), path = require("path"), assert = require("assert");
const { spawn, execFileSync } = require("child_process");
const REPO = path.resolve(__dirname, "..", "..");
const PORT = 18000 + Math.floor(Math.random() * 1000);
const BASE = "http://127.0.0.1:" + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "nevaib-e2e-"));
const STATE_FILE = path.join(DATA, "state", "tester.json");
const stateFileFor = (u) => path.join(DATA, "state", u + ".json"); // per-user server state (per-user storage)
const CHROME = process.env.CHROME || ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find(p => fs.existsSync(p));
const bank = f => JSON.parse(fs.readFileSync(`${REPO}/library/questions/${f}.json`, "utf8"));
const sleep = ms => new Promise(r => setTimeout(r, ms));
let passed = 0; const ok = (name) => { passed++; console.log("ok -", name); };

async function newCtx(browser) {
  const ctx = await browser.createBrowserContext();
  await ctx.overridePermissions(BASE, ["clipboard-read", "clipboard-write"]);
  const page = await ctx.newPage();
  // tall viewport: the sticky nav would otherwise cover buttons that puppeteer scrolls to the top edge
  await page.setViewport({ width: 1280, height: 2400 });
  const errors = [];
  page.on("console", m => { if (m.type() === "error" && !/^Failed to load resource/.test(m.text())) errors.push(m.text()); });
  page.on("pageerror", e => errors.push("pageerror: " + e.message));
  page.on("requestfailed", r => errors.push("requestfailed: " + r.url()));
  page.on("response", r => { if (r.status() >= 400 && !(r.status() === 409 && /action=save-state/.test(r.url()))) errors.push(r.status() + " " + r.url()); }); // 409 = handled conflict
  await page.evaluateOnNewDocument(() => { if (!localStorage.getItem("nb-api")) localStorage.setItem("nb-api", "/api/api.php"); });
  return { ctx, page, errors };
}
// through NB.store when present: storage is per user, so a raw localStorage
// read would miss the logged-in user's scoped keys (or hit another account's)
const ls = (page, k) => page.evaluate(k => {
  const s = window.NB && window.NB.store;
  return JSON.parse(s ? s.getRaw(k) : localStorage.getItem(k));
}, k);

function startServer() {
  fs.mkdirSync(path.join(DATA, "state"), { recursive: true });
  const hash = execFileSync("php", ["-r", "echo password_hash('testpass123', PASSWORD_DEFAULT);"]).toString();
  fs.writeFileSync(path.join(DATA, "users.json"), JSON.stringify({ tester: hash, tester2: hash }));
  const proc = spawn("php", ["-S", "127.0.0.1:" + PORT, "-t", REPO, path.join(REPO, "tools", "dev_server.php")],
    { env: Object.assign({}, process.env, { NEVAIB_DATA_DIR: DATA }), stdio: "ignore" });
  return proc;
}
const serverState = () => JSON.parse(fs.readFileSync(STATE_FILE, "utf8")).state;

(async () => {
  assert.ok(CHROME, "Chrome/Chromium not found — set CHROME=/path/to/browser");
  const php = startServer();
  process.on("exit", () => { try { php.kill(); } catch (e) {} });
  await sleep(800);
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });

  // ── 1. every page loads without console errors ───────────────────────────
  {
    const { page, errors, ctx } = await newCtx(browser);
    const pages = ["/index.html", "/app/index.html", "/app/notes.html", "/app/quiz.html", "/app/cards.html", "/app/author.html", "/app/summary.html", "/app/coursework.html", "/app/mistakes.html", "/app/resources.html",
      ...fs.readdirSync(REPO).filter(f => f.endsWith(".html")).map(f => "/" + f)];
    for (const p of [...new Set(pages)]) {
      errors.length = 0;
      await page.goto(BASE + p, { waitUntil: "networkidle0" });
      const bad = errors.filter(e => !/favicon/.test(e));
      assert.deepStrictEqual(bad, [], p + " console errors: " + bad.join(" | "));
    }
    ok(`${new Set(pages).size} pages load with no console errors / failed requests`);
    await ctx.close();
  }

  // ── 1b. topic notes: every note renders; note links start the right quiz / cards ──
  {
    const { page, errors, ctx } = await newCtx(browser);
    const man = JSON.parse(fs.readFileSync(`${REPO}/library/topic-notes/manifest.json`, "utf8"));
    for (const n of man.notes) {
      const topic = path.basename(n.file, ".json");
      await page.goto(`${BASE}/app/notes.html?subject=${n.subject}&topic=${topic}`, { waitUntil: "networkidle0" });
      await page.waitForSelector("#nt-title");
      assert.strictEqual(await page.$eval("#nt-title", e => e.textContent), `${n.code} ${n.title}`);
    }
    assert.deepStrictEqual(errors.filter(e => !/favicon/.test(e)), [], "notes console errors");
    // recall-first: answers hidden until revealed
    await page.goto(`${BASE}/app/notes.html?subject=chemistry-hl&topic=s1-4`, { waitUntil: "networkidle0" });
    await page.waitForSelector(".nt-idea");
    assert.ok(await page.$eval(".nt-idea .nt-answer", e => e.hidden), "key-idea answer hidden at first");
    await page.click(".nt-idea > button");
    assert.ok(!(await page.$eval(".nt-idea .nt-answer", e => e.hidden)), "revealed on demand");
    assert.match(await page.$eval(".nt-label", e => e.textContent), /not IB markschemes/);
    const note = JSON.parse(fs.readFileSync(`${REPO}/library/topic-notes/chemistry-hl/s1-4.json`, "utf8"));
    const qb = note.links.quizBanks[0], want = new Set(qb.itemIds);
    const bankItems = bank(path.basename(qb.file, ".json")).items;
    const stemToId = Object.fromEntries(bankItems.map(i => [i.stem, i.id]));
    await page.goto(await page.$eval("#nt-quiz", a => a.href), { waitUntil: "networkidle0" });
    await page.waitForSelector("#q-box .q-stem");
    const notice = await page.evaluate(() => document.getElementById("runner").innerText);
    assert.match(notice, /S1\.4/, "session labelled with the note");
    const seen = [];
    for (let q = 0; q < Math.min(20, want.size); q++) {
      const stem = await page.$eval("#q-box .q-stem", e => e.textContent);
      seen.push(stemToId[stem]);
      if (await page.$("#q-box .choice")) { await page.click("#q-box .choice"); await page.click("#q-guess"); }
      else { await page.click("#q-reveal"); await page.select("#q-selfscore", "0"); }
      await page.click("#q-next");
    }
    assert.ok(seen.every(id => want.has(id)), "every question comes from the note's linked ids: " + seen.join(","));
    assert.strictEqual(new Set(seen).size, seen.length, "no repeats");
    const deck = note.links.decks[0];
    await page.goto(`${BASE}/app/notes.html?subject=chemistry-hl&topic=s1-4`, { waitUntil: "networkidle0" });
    await page.waitForSelector("#nt-cards");
    await page.goto(await page.$eval("#nt-cards", a => a.href), { waitUntil: "networkidle0" });
    await page.waitForFunction(() => document.getElementById("runner").style.display !== "none");
    const front = await page.$eval("#fc-front", e => e.textContent);
    const deckCards = JSON.parse(fs.readFileSync(`${REPO}/${deck.file}`, "utf8")).cards;
    const card = deckCards.find(c => c.front === front);
    assert.ok(card && (!deck.cardIds || deck.cardIds.includes(card.id)), "first card is one of the note's linked cards");
    assert.deepStrictEqual(errors.filter(e => !/favicon/.test(e)), [], "notes → quiz/cards console errors");
    ok(`${man.notes.length} topic notes render; recall-first reveal; note links start a quiz on exactly the linked questions and cards on the linked deck`);
    // My resources: add a link (escaped), reject a javascript: URL, delete leaves a tombstone
    await page.goto(`${BASE}/app/notes.html?subject=chemistry-hl&topic=s1-4`, { waitUntil: "networkidle0" });
    await page.waitForSelector("#nt-res-url");
    await page.type("#nt-res-label", "<b>My notes</b>"); await page.type("#nt-res-url", "javascript:alert(1)");
    await page.click(".nt-res-form button[type=submit]");
    assert.strictEqual(await page.$$eval("#nt-res-list a", a => a.length), 0, "javascript: link refused");
    await page.$eval("#nt-res-url", e => { e.value = ""; }); await page.type("#nt-res-url", "https://example.org/x");
    await page.click(".nt-res-form button[type=submit]");
    assert.strictEqual(await page.$eval("#nt-res-list a", a => a.textContent), "<b>My notes</b>", "label shown as text");
    await page.click("#nt-res-list button[data-del]");
    const mr = await page.evaluate(() => JSON.parse(localStorage.getItem("my-res")));
    assert.ok(Object.values(mr).length === 1 && Object.values(mr)[0].deleted === true, "deletion stored as a tombstone");
    assert.deepStrictEqual(errors.filter(e => !/favicon/.test(e)), [], "my resources console errors");
    ok("My resources: add, escape, reject non-http(s)/file links, delete");
    // Ask an AI: mode buttons on the note; click copies the prompt and opens the preferred URL
    await page.goto(`${BASE}/app/notes.html?subject=biology-hl&topic=a1-1`, { waitUntil: "networkidle0" });
    await page.waitForSelector("#nt-ai-modes button");
    const modeIds = await page.$$eval("#nt-ai-modes button", bs => bs.map(b => b.dataset.mode));
    assert.ok(modeIds.includes("explain") && modeIds.includes("quiz") && modeIds.includes("data"), "three core modes: " + modeIds.join(","));
    const againBefore = await page.$eval("#nt-ai-again", e => ({ display: getComputedStyle(e).display, label: e.textContent }));
    assert.strictEqual(againBefore.label, "Copy the prompt again", "copy-again button has a label");
    assert.strictEqual(againBefore.display, "none", "copy-again truly hidden before the first prompt (.btn must not defeat [hidden])");
    await page.evaluate(() => { window.__opened = []; window.open = (u, n, f) => { window.__opened.push({ u, n, f }); return { close() {} }; }; });
    await page.click('#nt-ai-modes button[data-mode="quiz"]');
    const opened = await page.evaluate(() => window.__opened);
    assert.strictEqual(opened.length, 1, "one new tab");
    assert.strictEqual(opened[0].u, "https://gemini.google.com/app");
    assert.strictEqual(opened[0].n, "_blank");
    const copied = await page.evaluate(async () => {
      try { const t = await navigator.clipboard.readText(); if (t) return t; } catch (e) {}
      return window.NB.aiPrompt.lastText;
    });
    assert.match(copied, /experienced IB Biology HL teacher/);
    assert.match(copied, /A1\.1 Water/);
    assert.match(copied, /one question at a time/i);
    assert.doesNotMatch(copied, /\{[a-z_]+\}/);
    const toast = await page.$eval("#nt-ai-toast", e => e.textContent);
    assert.match(toast, /Prompt copied — press Ctrl\+V|paste comes up empty/, "success or hedged toast (depends on execCommand support)");
    const againAfter = await page.$eval("#nt-ai-again", e => getComputedStyle(e).display);
    assert.notStrictEqual(againAfter, "none", "copy-again button visible after the first prompt");
    await page.select("#nt-ai-pref", "chatgpt");
    await page.evaluate(() => { window.__opened = []; });
    await page.click('#nt-ai-modes button[data-mode="explain"]');
    const opened2 = await page.evaluate(() => window.__opened);
    assert.strictEqual(opened2[0].u, "https://chatgpt.com/");
    assert.strictEqual(await page.evaluate(() => localStorage.getItem("ai-pref")), "chatgpt");
    // switching notes in-page must not leave the previous note's prompt copyable
    await page.click(".nt-back");
    await page.waitForSelector("#nt-index a");
    await page.evaluate(() => {
      const a = [...document.querySelectorAll("#nt-index a")].find(x => !/topic=a1-1(&|$)/.test(x.getAttribute("href")));
      a.click();
    });
    await page.waitForFunction(() => document.querySelector("#nt-title") && !/A1\.1/.test(document.querySelector("#nt-title").textContent));
    const againOther = await page.$eval("#nt-ai-again", e => ({ last: window.NB.aiPrompt.lastNote, display: getComputedStyle(e).display }));
    assert.strictEqual(againOther.last, "bio-a1-1", "lastNote records where the prompt was built");
    assert.strictEqual(againOther.display, "none", "copy-again resets on another note (no stale cross-note copy)");
    assert.deepStrictEqual(errors.filter(e => !/favicon/.test(e)), [], "ask-ai console errors");
    ok("Ask an AI: buttons present, quiz mode copies a filled prompt, opens Gemini, remembers ChatGPT, copy-again labelled, hidden before first use and reset per note");
    await ctx.close();
  }

  // ── 1c. coursework planner: three tracks; a tick, a note and a date persist across reloads ──
  {
    const { page, errors, ctx } = await newCtx(browser);
    await page.goto(BASE + "/app/coursework.html?track=chem", { waitUntil: "networkidle0" });
    assert.strictEqual(await page.$$eval("#cw-tabs button", b => b.length), 3, "three tracks");
    assert.ok((await page.$eval("#cw-track", e => e.textContent)).includes("Chemistry HL"), "?track=chem opens the chemistry track");
    await page.click(".cw-stage[open] .cw-checks input[type=checkbox]");
    await page.type(".cw-stage[open] textarea.cw-note", "ask about titration range");
    await page.$eval(".cw-stage[open] input[type=date]", (e) => { e.value = "2027-09-20"; e.dispatchEvent(new Event("change")); });
    await page.click("h2"); // blur → note saved
    await page.reload({ waitUntil: "networkidle0" });
    const p = await page.evaluate(() => JSON.parse(localStorage.getItem("cw-progress")));
    assert.strictEqual(p.checks["chem.topic.c1"].c, true, "tick stored");
    assert.strictEqual(p.notes["chem.topic"].s, "ask about titration range", "note stored");
    assert.strictEqual(p.dates["chem.topic"].d, "2027-09-20", "date stored");
    assert.ok(await page.$eval(".cw-stage .cw-checks input[type=checkbox]", e => e.checked), "tick shown after reload");
    assert.ok(await page.evaluate(() => !!JSON.parse(localStorage.getItem("nb-dirty") || "{}")["cw-progress"]), "marked for sync");
    assert.deepStrictEqual(errors.filter(e => !/favicon/.test(e)), [], "coursework console errors");
    ok("coursework planner: 3 tracks render; tick, note and own date persist across reload and are marked for sync");
    await ctx.close();
  }

  // ── 2. shuffle, marking, error key, migration, topics, tactics ───────────
  const unity = bank("bio-unity-diversity-cells");
  const b01 = unity.items.find(i => i.id === "b01");
  const wp = bank("bio-water-potential-origin-cells");
  const resp = bank("bio-respiration-protein-synthesis");
  // a bare id that exists in more than one bio bank, to test collided-id migration
  const ids = f => new Set(bank(f).items.map(i => i.id));
  const legacy = [
    { key: "b01", id: "b01", subject: "biology", topic: "", topicLabel: "", format: b01.format, stem: b01.stem, choices: b01.choices, answer: b01.answer, userAnswer: 0, note: "", attempts: 2, firstMissed: "2026-10-01", lastMissed: "2026-10-05", resolved: false },
    { key: "b01", id: "b01", subject: "biology", format: "mcq", stem: "A stem that no current bank has", choices: ["a", "b"], answer: 0, attempts: 1, firstMissed: "2026-09-01", lastMissed: "2026-09-01", resolved: false },
  ];
  const { page, errors, ctx } = await newCtx(browser);
  await page.goto(BASE + "/app/quiz.html", { waitUntil: "networkidle0" });
  await page.evaluate(l => { localStorage.setItem("q-errors", JSON.stringify(l)); localStorage.setItem("quizlog", JSON.stringify([{ date: "2026-10-01", label: "old", got: 1, max: 2, pct: 50 }])); }, legacy);
  await page.reload({ waitUntil: "networkidle0" });

  // choose Biology → the unity bank, mixed format, 20 questions
  const chosen = await page.evaluate(() => {
    const s = document.getElementById("q-subject");
    for (const o of s.options) {
      s.value = o.value; s.dispatchEvent(new Event("change"));
      const t = [...document.getElementById("q-topic").options].find(x => /Unity & diversity/.test(x.textContent));
      if (t) { document.getElementById("q-topic").value = t.value; return o.value; }
    }
    return null;
  });
  assert.ok(chosen, "biology subject found");
  await page.select("#q-format", "mixed"); await page.select("#q-length", "20");
  await page.click("#q-start");
  await page.waitForSelector("#q-box .q-stem");

  // migration happened on bank load
  let errs = await ls(page, "q-errors");
  const mig = errs.find(e => e.key === "bio-unity-diversity-cells#b01");
  assert.ok(mig && mig.legacyKey === "b01" && mig.attempts === 2 && mig.bankId === "bio-unity-diversity-cells" && mig.ts, "legacy b01 renamed with history kept");
  assert.ok(errs.find(e => e.key === "b01" && e.stem === "A stem that no current bank has"), "non-matching legacy record left untouched (still reviewable)");
  assert.strictEqual(errs.length, 2, "no records lost or duplicated");
  ok("legacy q-errors migrated to bank#id (matching stem only; unmatched kept)");

  // answer every question: MCQ wrong on purpose (records error), written self-score 0
  const stemMap = Object.fromEntries(unity.items.map(i => [i.stem, i]));
  let orders = new Set(), nonIdentity = 0, mcqSeen = 0, wrongIds = [];
  for (let q = 0; q < 20; q++) {
    const info = await page.evaluate(() => {
      const stem = document.querySelector("#q-box .q-stem").textContent;
      const btns = [...document.querySelectorAll("#q-box .choice")].map(b => ({ i: +b.dataset.i, text: b.textContent }));
      return { stem, btns };
    });
    const item = stemMap[info.stem]; assert.ok(item, "stem from the chosen bank");
    if (item.format === "mcq") {
      mcqSeen++;
      const order = info.btns.map(b => b.i);
      orders.add(order.join(","));
      if (order.join(",") !== order.slice().sort().join(",")) nonIdentity++;
      // each button shows the text of its original index, letters by position
      info.btns.forEach((b, pos) => assert.strictEqual(b.text, String.fromCharCode(65 + pos) + ". " + item.choices[b.i]));
      // click a wrong option on even questions, the correct one on odd
      const target = q % 2 === 0 ? info.btns.find(b => b.i !== item.answer) : info.btns.find(b => b.i === item.answer);
      await page.click(`#q-box .choice[data-i="${target.i}"]`);
      // nothing is revealed until a confidence rating is given
      assert.strictEqual(await page.$(".choice.correct"), null, "answer not revealed before the rating");
      // wrong answers are rated "sure" (false confidence), right ones "guessing"
      await page.click(target.i === item.answer ? "#q-guess" : "#q-sure");
      const cls = await page.evaluate(() => ({ correct: [...document.querySelectorAll(".choice.correct")].map(b => +b.dataset.i), wrong: [...document.querySelectorAll(".choice.wrong")].map(b => +b.dataset.i), note: document.querySelector(".q-note").className }));
      assert.deepStrictEqual(cls.correct, [item.answer], "correct option highlighted by original index");
      if (target.i === item.answer) { assert.deepStrictEqual(cls.wrong, []); assert.match(cls.note, /good/); }
      else {
        assert.deepStrictEqual(cls.wrong, [target.i]); assert.match(cls.note, /bad/);
        const e = (await ls(page, "q-errors")).find(e => e.key === "bio-unity-diversity-cells#" + item.id);
        assert.ok(e, "error stored under bank#id"); assert.strictEqual(e.userAnswer, target.i, "stored answer is original index"); assert.strictEqual(e.answer, item.answer);
        assert.strictEqual(e.choices[e.userAnswer], item.choices[target.i]);
        assert.strictEqual(e.lastConf, "sure", "rating stored on the missed question"); assert.strictEqual(e.sureWrong, 1);
        wrongIds.push(item.id);
      }
      await page.click("#q-next");
    } else {
      await page.click("#q-reveal-guess"); await page.select("#q-selfscore", "0"); await page.click("#q-next");
      const e = (await ls(page, "q-errors")).find(e => e.key === "bio-unity-diversity-cells#" + item.id);
      assert.strictEqual(e.lastConf, "guess", "written rating stored");
      wrongIds.push(item.id);
    }
  }
  assert.ok(mcqSeen >= 8 && nonIdentity >= mcqSeen / 2, `options shuffled (${nonIdentity}/${mcqSeen} non-identity orders)`);
  ok(`MCQ options shuffled (${nonIdentity}/${mcqSeen} reordered); marking + stored answers use original indices`);

  await page.waitForSelector("#summary h3");
  const summary = await page.evaluate(() => document.getElementById("summary").innerText);
  assert.ok(!/undefined/.test(summary), "no 'undefined' topic in summary");
  // only 4 of the 42 items carry a tactic, so the section appears only when one of them was missed
  const missedWithTactic = unity.items.filter(i => wrongIds.includes(i.id) && i.tactic).length;
  if (missedWithTactic) assert.match(summary, /Tactics for the questions you missed/, "tactics shown for missed items");
  else assert.ok(!/Tactics for the questions you missed/.test(summary), "no empty tactics section");
  ok(`summary: tactics section ${missedWithTactic ? "shown" : "correctly absent"} (${missedWithTactic} missed item(s) with a tactic); no 'undefined' topic`);

  errs = await ls(page, "q-errors");
  const today = new Date(); const ymd = today.getFullYear() + "-" + String(today.getMonth() + 1).padStart(2, "0") + "-" + String(today.getDate()).padStart(2, "0");
  const fresh = errs.filter(e => e.key.startsWith("bio-unity-diversity-cells#") && e.firstMissed === ymd);
  assert.ok(fresh.length >= 1, "new errors dated with local date");
  assert.ok(errs.every(e => e.key !== "b01" || e.stem === "A stem that no current bank has"));
  ok(`missed questions recorded (${errs.length} records), dated ${ymd} (local)`);
  const qlog = await ls(page, "quizlog");
  assert.strictEqual(qlog.length, 2, "quizlog appended, old entry kept");
  assert.ok(qlog[0].conf && qlog[0].conf.sure >= 1 && qlog[0].conf.sureRight === 0 && qlog[0].conf.guess >= 1, "session confidence tally saved: " + JSON.stringify(qlog[0].conf));
  assert.strictEqual(qlog[1].conf, undefined, "old entry untouched");
  assert.match(summary, /Confident but wrong \(\d+\)/, "summary lists confident-but-wrong");
  ok("confidence ratings: required before reveal, stored on q-errors + quizlog, confident-but-wrong listed");
  await page.click("#q-again");
  const setupText = await page.evaluate(() => document.getElementById("setup").innerText);
  assert.match(setupText, /Review confident-but-wrong \(\d+\)/, "setup panel lists confident-but-wrong");
  assert.ok(!/undefined/.test(setupText), "old quizlog entry renders without 'undefined'");
  ok("setup shows the confident-but-wrong panel; old quizlog entries render");

  // review mode works on migrated + legacy + new records
  await page.click("#q-review-btn");
  await page.waitForSelector("#q-box .q-stem");
  const n = await page.evaluate(() => document.getElementById("q-progress").textContent);
  assert.match(n, new RegExp(`/ ${errs.filter(e => !e.resolved).length}$`));
  // answer every review item correctly
  for (;;) {
    const st = await page.evaluate(() => ({ stem: document.querySelector("#q-box .q-stem")?.textContent, mcq: !!document.querySelector("#q-box .choice") }));
    if (!st.stem) break;
    if (st.mcq) {
      const ans = (await ls(page, "q-errors")).find(e => e.stem === st.stem).answer;
      await page.click(`#q-box .choice[data-i="${ans}"]`); await page.click("#q-sure");
      await page.click("#q-next");
    } else {
      await page.click("#q-reveal");
      const max = await page.evaluate(() => document.querySelector("#q-selfscore").options.length - 1);
      await page.select("#q-selfscore", String(max)); await page.click("#q-next");
    }
    if (await page.$("#summary h3") && await page.evaluate(() => document.getElementById("summary").style.display !== "none")) break;
  }
  errs = await ls(page, "q-errors");
  assert.ok(errs.every(e => e.resolved), "all reviewed records resolved");
  assert.ok(errs.filter(e => e.lastAttempt).every(e => e.ts));
  ok("Review past errors: migrated, legacy and new records all reviewable and resolve");
  assert.deepStrictEqual(errors.filter(e => !/favicon/.test(e)), [], "quiz run console errors");
  ok("no console errors during quiz runs");
  await ctx.close();

  // ── 3. two-device sync with per-record merge ─────────────────────────────
  const A = await newCtx(browser), B = await newCtx(browser);
  for (const d of [A, B]) {
    await d.page.goto(BASE + "/app/quiz.html", { waitUntil: "networkidle0" });
  }
  // device A has old-format data (no timestamps) before ever logging in
  await A.page.evaluate(() => {
    localStorage.setItem("fc-state", JSON.stringify({ "cardA": { box: 2, due: "2026-11-20", seen: 2 }, "shared": { box: 1, due: "2026-11-19", seen: 1 } }));
    localStorage.setItem("q-errors", JSON.stringify([{ key: "b02", id: "b02", stem: "legacy A", format: "mcq", choices: ["x", "y"], answer: 0, attempts: 1, resolved: false }]));
  });
  await A.page.evaluate(() => window.Auth.login("tester", "testpass123"));
  await sleep(3500); // login → pushNow (no server state yet)
  let srv = serverState();
  assert.ok(srv["q-errors"] && srv["q-errors"].length === 1 && srv["fc-state"].cardA, "A's data incl. q-errors on server");
  ok("device A (old-format data) logs in → fc-state and q-errors uploaded");

  // device B has its own progress, then logs in: must keep both
  await B.page.evaluate(() => {
    localStorage.setItem("fc-state", JSON.stringify({ "cardB": { box: 3, due: "2026-11-25", seen: 3, t: Date.now() }, "shared": { box: 4, due: "2026-12-01", seen: 4, t: Date.now() } }));
    localStorage.setItem("q-errors", JSON.stringify([{ key: "bank-x#q1", stem: "B miss", format: "mcq", choices: ["x", "y"], answer: 1, attempts: 1, resolved: false, ts: Date.now() }]));
  });
  await B.page.evaluate(() => window.Auth.login("tester", "testpass123"));
  await sleep(1500);
  await B.page.waitForFunction(() => document.readyState === "complete");
  await sleep(4000); // pull → reload → boot → queued push (2 s)
  srv = serverState();
  assert.deepStrictEqual(Object.keys(srv["fc-state"]).sort(), ["cardA", "cardB", "shared"]);
  assert.strictEqual(srv["fc-state"].shared.box, 4, "newer review wins");
  assert.deepStrictEqual(srv["q-errors"].map(e => e.key).sort(), ["b02", "bank-x#q1"]);
  const bLocal = await ls(B.page, "fc-state");
  assert.deepStrictEqual(Object.keys(bLocal).sort(), ["cardA", "cardB", "shared"]);
  ok("device B logs in → server and B hold the union (newest per card wins, nothing wiped)");

  // device A rates a card through the UI; reload of A picks up B's records
  await A.page.reload({ waitUntil: "networkidle0" }); await sleep(3000);
  const aLocal = await ls(A.page, "fc-state");
  assert.ok(aLocal.cardB && aLocal.shared.box === 4, "A merged B's progress on boot");
  assert.ok((await ls(A.page, "q-errors")).some(e => e.key === "bank-x#q1"), "A got B's missed question");
  ok("device A reload → merges B's cards and missed questions");

  await A.page.goto(BASE + "/app/cards.html", { waitUntil: "networkidle0" }); await sleep(800);
  await A.page.click("#fc-start"); await A.page.waitForSelector("#fc-card");
  const cid = await A.page.evaluate(() => { document.getElementById("fc-card").click(); return null; });
  await A.page.click('#fc-rate button[data-r="easy"]');
  await sleep(4500);
  srv = serverState();
  const stamped = Object.entries(srv["fc-state"]).filter(([, v]) => v.t && v.seen >= 1);
  assert.ok(Object.keys(srv["fc-state"]).length >= 4 && stamped.length >= 3, "rated card synced with timestamp, others kept");
  ok("card rated in UI on A → synced with timestamp t, other cards untouched");

  // old client simulation: save-state without q-errors must not wipe it
  const tok = await A.page.evaluate(() => localStorage.getItem("nb-token"));
  const before = srv["q-errors"].length;
  const r = await fetch(BASE + "/api/api.php?action=save-state", { method: "PUT", headers: { "Content-Type": "application/json", "X-Nevaib-Token": tok }, body: JSON.stringify({ state: { "fc-state": srv["fc-state"], quizlog: [] } }) });
  assert.ok(r.ok);
  srv = serverState();
  assert.strictEqual(srv["q-errors"].length, before, "old client push kept q-errors");
  ok("API: a save-state without q-errors (old cached client) keeps stored q-errors");

  // write, then navigate away immediately (inside the 2 s debounce): pagehide flush
  await A.page.goto(BASE + "/app/cards.html", { waitUntil: "networkidle0" }); await sleep(800);
  await A.page.click("#fc-start"); await A.page.waitForSelector("#fc-card");
  await A.page.evaluate(() => document.getElementById("fc-card").click());
  await A.page.click('#fc-rate button[data-r="hard"]');
  const tRated = await A.page.evaluate(() => { const st = window.NB.store.get("fc-state") || {}; return Math.max(...Object.values(st).map(s => s.t || 0)); });
  await A.page.goto(BASE + "/app/quiz.html", { waitUntil: "networkidle0" });
  await sleep(500);
  srv = serverState();
  assert.ok(Object.values(srv["fc-state"]).some(s => s.t === tRated), "review saved although the page was left within 2 s");
  ok("rate a card and leave the page at once → saved (pagehide keepalive flush)");

  // offline study, then back online: nothing overwritten
  await A.page.goto(BASE + "/app/cards.html", { waitUntil: "networkidle0" }); await sleep(800);
  await A.page.setOfflineMode(true);
  await A.page.click("#fc-start"); await A.page.waitForSelector("#fc-card");
  await A.page.evaluate(() => document.getElementById("fc-card").click());
  await A.page.click('#fc-rate button[data-r="easy"]');
  const tOffline = await A.page.evaluate(() => { const st = window.NB.store.get("fc-state") || {}; return Math.max(...Object.values(st).map(s => s.t || 0)); });
  assert.ok(await A.page.evaluate(() => !!(window.NB.store.dirty() || {})["fc-state"]), "offline change marked dirty");
  await A.page.setOfflineMode(false);
  await A.page.reload({ waitUntil: "networkidle0" }); await sleep(3000);
  srv = serverState();
  assert.ok(Object.values(srv["fc-state"]).some(s => s.t === tOffline), "offline review reached the server");
  assert.ok(Object.values(await ls(A.page, "fc-state")).some(s => s.t === tOffline), "and was not overwritten locally");
  ok("offline review → back online → pushed, not overwritten");

  // stale tab: B still shows an old page while A saved; B's write gets 409, merges, retries
  await B.page.goto(BASE + "/app/quiz.html", { waitUntil: "networkidle0" }); await sleep(1500);
  await A.page.evaluate(() => { const st = window.NB.store.get("fc-state") || {}; st["e2e-a"] = { box: 2, due: "2026-12-01", seen: 1, t: Date.now() }; window.NB.store.set("fc-state", st); });
  await A.page.evaluate(() => window.Auth.pushNow(true));
  const revBefore = JSON.parse(fs.readFileSync(STATE_FILE, "utf8")).rev;
  await B.page.evaluate(() => { const st = window.NB.store.get("fc-state") || {}; st["e2e-b"] = { box: 1, due: "2026-12-02", seen: 1, t: Date.now() }; window.NB.store.set("fc-state", st); });
  await B.page.evaluate(() => window.Auth.pushNow(true));
  srv = serverState();
  assert.ok(srv["fc-state"]["e2e-a"] && srv["fc-state"]["e2e-b"], "both devices' reviews on the server");
  assert.ok(JSON.parse(fs.readFileSync(STATE_FILE, "utf8")).rev > revBefore);
  assert.ok(fs.readdirSync(path.join(DATA, "state", "history", "tester")).length >= 3, "server kept previous versions");
  ok("stale tab: 409 → merge → retry keeps both devices' work; server history kept");

  // past-paper score log on the quiz page: saved, survives reload, reaches the server
  await A.page.goto(BASE + "/app/quiz.html", { waitUntil: "networkidle0" });
  await A.page.select("#pp-subject", "chemistry-hl");
  await A.page.type("#pp-paper", "Paper 1A practice"); await A.page.type("#pp-score", "30"); await A.page.type("#pp-max", "40");
  await A.page.click("#pp-add");
  await A.page.reload({ waitUntil: "networkidle0" });
  assert.match(await A.page.evaluate(() => document.getElementById("pp-list").innerText), /Paper 1A practice[\s\S]*30\/40 \(75%\)/);
  await A.page.evaluate(() => window.Auth.pushNow(true));
  srv = serverState();
  assert.ok((srv["pp-scores"] || []).some(r => r.paper === "Paper 1A practice" && r.score === 30), "pp-scores on the server");
  ok("past-paper score saved, shown after reload, synced to the server");
  await A.page.goto(BASE + "/app/cards.html", { waitUntil: "networkidle0" }); // backup.js lives on the Cards page

  // backup on A, restore (merge) on a fresh logged-out browser through the Cards UI
  const backup = await A.page.evaluate(() => JSON.stringify(window.NB.backup.collect()));
  const C = await newCtx(browser);
  await C.page.goto(BASE + "/app/cards.html", { waitUntil: "networkidle0" }); await sleep(500);
  await C.page.evaluate(() => { localStorage.setItem("fc-state", JSON.stringify({ "only-on-c": { box: 1, due: "2026-12-03", seen: 1, t: 1 } })); });
  await C.page.reload({ waitUntil: "networkidle0" }); await sleep(500);
  await C.page.evaluate((b) => { document.getElementById("fc-io").value = b; }, backup);
  await C.page.click("#fc-import");
  await C.page.waitForSelector(".nb-restore table");
  const restoreSummary = await C.page.evaluate(() => document.querySelector(".nb-restore").innerText);
  assert.match(restoreSummary, /flashcard progress/);
  await C.page.evaluate(() => [...document.querySelectorAll(".nb-restore button")].find(b => b.textContent === "Restore").click());
  await sleep(300);
  const cState = await ls(C.page, "fc-state");
  assert.ok(cState["only-on-c"] && cState["e2e-a"], "merge kept C's own progress and added A's");
  assert.ok((await ls(C.page, "q-errors")).length >= 1, "missed questions restored too");
  assert.ok((await ls(C.page, "pp-scores") || []).some(r => r.paper === "Paper 1A practice"), "past-paper scores restored too");
  assert.ok(await C.page.evaluate(() => Object.keys(localStorage).some(k => k.startsWith("nb-backup:"))), "safety copy taken");
  assert.strictEqual(await C.page.evaluate(() => localStorage.getItem("nb-token")), null, "no credentials restored");
  assert.deepStrictEqual(C.errors.filter(e => !/favicon/.test(e)), [], "restore console errors");
  ok("backup from A restored into another browser via the Cards UI: merged, snapshot taken, no token");
  await C.ctx.close();

  for (const d of [A, B]) assert.deepStrictEqual(d.errors.filter(e => !/favicon/.test(e)), [], "sync console errors");
  ok("no console errors during sync runs");

  // ── 4. two accounts on one browser: per-user storage keeps them apart ────
  {
    const U = await newCtx(browser);
    await U.page.goto(BASE + "/app/quiz.html", { waitUntil: "networkidle0" });
    // user1 has plain (pre-scope) data on this browser before ever logging in
    await U.page.evaluate(() => {
      localStorage.setItem("fc-state", JSON.stringify({ "user1card": { box: 2, due: "2026-12-01", seen: 2, t: 100 } }));
      localStorage.setItem("q-errors", JSON.stringify([{ key: "bank-u1#q1", stem: "user1 miss", format: "mcq", choices: ["x", "y"], answer: 0, attempts: 1, resolved: false, ts: Date.now() }]));
    });
    await U.page.evaluate(() => window.Auth.login("tester", "testpass123"));
    await sleep(3500); // login → one-time adoption into the tester scope → seeded to the account
    let srv = serverState();
    assert.ok(srv["fc-state"] && srv["fc-state"].user1card, "user1's cards on the server");
    assert.ok((srv["q-errors"] || []).some(e => e.key === "bank-u1#q1"), "user1's missed questions on the server");
    assert.strictEqual(await U.page.evaluate(() => localStorage.getItem("nb-active-user")), "tester", "scope recorded");
    ok("user1 logs in on a used browser → legacy data adopted into their scope and uploaded");

    // user2 (an empty account) logs in on the same browser: must see nothing of user1
    await U.page.evaluate(() => window.Auth.logout());
    await sleep(800);
    await U.page.evaluate(() => window.Auth.login("tester2", "testpass123"));
    await sleep(3500);
    assert.strictEqual(await U.page.evaluate(() => localStorage.getItem("nb-active-user")), "tester2", "scope switched");
    assert.strictEqual(await U.page.evaluate(() => window.NB.store.get("fc-state", null)), null, "user2's scope starts empty");
    assert.strictEqual(await U.page.evaluate(() => localStorage.getItem("tester:fc-state") !== null), true, "user1's scoped data still on the device");
    const srv2 = fs.existsSync(stateFileFor("tester2")) ? JSON.parse(fs.readFileSync(stateFileFor("tester2"), "utf8")).state : null;
    assert.ok(!srv2 || (!srv2["fc-state"] && !srv2["q-errors"]), "user2's empty account did not receive user1's data");
    ok("user2 logs in on the same browser → empty scope, nothing of user1's seeded or uploaded");

    // user2 writes something of their own, then user1 comes back
    await U.page.evaluate(() => window.NB.store.set("fc-state", { "user2card": { box: 1, due: "2026-12-05", seen: 1, t: 200 } }));
    await U.page.evaluate(() => window.Auth.pushNow(true));
    await sleep(800);
    await U.page.evaluate(() => window.Auth.logout());
    await sleep(800);
    await U.page.evaluate(() => window.Auth.login("tester", "testpass123"));
    await sleep(3500);
    const back = await U.page.evaluate(() => window.NB.store.get("fc-state", null));
    assert.ok(back && back.user1card && !back.user2card, "user1 sees only their own cards after re-login");
    assert.ok(await U.page.evaluate(() => localStorage.getItem("tester2:fc-state") !== null), "user2's data untouched in their scope");
    const srv2b = JSON.parse(fs.readFileSync(stateFileFor("tester2"), "utf8")).state;
    assert.ok(srv2b["fc-state"] && srv2b["fc-state"].user2card, "user2's own write reached their account");
    assert.deepStrictEqual(U.errors.filter(e => !/favicon/.test(e)), [], "two-account console errors");
    ok("account switch back: user1's data restored, user2's kept separate");
    await U.ctx.close();
  }

  // ── 5. per-user subject profiles: a restricted student sees only her subjects ──
  {
    // the account is written in the admin users.json format ({"h", "role"}) and
    // her subject profile lives in her server state file (state.profile.subjects —
    // exactly what create-user/set-profile write); logging in pulls it into her
    // storage scope and profile.js hides every [data-subject] element outside it
    const hash = execFileSync("php", ["-r", "echo password_hash('testpass123', PASSWORD_DEFAULT);"]).toString();
    const users = JSON.parse(fs.readFileSync(path.join(DATA, "users.json"), "utf8"));
    users.stu = { h: hash, role: "student" };
    fs.writeFileSync(path.join(DATA, "users.json"), JSON.stringify(users));
    fs.writeFileSync(stateFileFor("stu"), JSON.stringify(
      { state: { profile: { subjects: ["biology-hl", "chemistry-hl"] } }, updated_at: new Date().toISOString(), rev: 0 }));
    const P = await newCtx(browser);
    await P.page.goto(BASE + "/index.html", { waitUntil: "networkidle0" });
    await P.page.evaluate(() => window.Auth.login("stu", "testpass123"));
    await sleep(3500); // login → pull merges the profile → reload → applyTo hides
    const vis = (sel) => P.page.$eval(sel, (e) => e.style.display);
    assert.strictEqual(await vis('nav a[data-subject="biology-hl"]'), "", "in-profile nav link visible");
    assert.strictEqual(await vis('nav a[data-subject="chemistry-hl"]'), "", "in-profile nav link visible");
    assert.strictEqual(await vis('nav a[data-subject="math-aa-sl"]'), "none", "out-of-profile nav link hidden");
    assert.strictEqual(await vis('nav a[data-subject="history-sl"]'), "none", "out-of-profile nav link hidden");
    assert.strictEqual(await vis('nav a[data-subject="french-a-langlit"]'), "none", "out-of-profile nav link hidden");
    assert.strictEqual(await vis('nav a[data-subject="english-lit-hl"]'), "none", "out-of-profile nav link hidden");
    // dashboard cards carry the legacy short ids ("history") — canonicalised on compare
    assert.strictEqual(await vis('.subj-card[data-subject="history"]'), "none", "dashboard card for an unprofiled subject hidden");
    assert.strictEqual(await vis('.subj-card[data-subject="biology-hl"]'), "", "dashboard card kept");
    assert.deepStrictEqual(P.errors.filter(e => !/favicon/.test(e)), [], "subject-profile console errors");
    ok("subject profile: student with bio+chem → nav links and dashboard cards outside her subjects hidden");
    await P.ctx.close();
  }

  // ── 6. biology checklist search: empty state, then restore ─────────────────
  {
    const { page, errors, ctx } = await newCtx(browser);
    await page.goto(BASE + "/biology-hl.html", { waitUntil: "networkidle0" });
    assert.deepStrictEqual(await page.$$eval("h3[data-chk]", hs => hs.map(h => h.dataset.chk)),
      ["A", "B", "C", "D", "tools"], "official sections A–D + Tools & other render");
    const rows = ".card .row[data-key]";
    assert.strictEqual(await page.$$eval(rows, rs => rs.filter(r => !r.hidden).length), 43, "all 43 rows visible");
    await page.type("#chk-search", "zzzqqq"); // nonsense
    await page.waitForFunction(() => !document.getElementById("chk-empty").hidden);
    assert.strictEqual(await page.$$eval(rows, rs => rs.filter(r => !r.hidden).length), 0, "nonsense query hides every row");
    assert.ok(await page.$$eval("h3[data-chk],h4[data-chk]", hs => hs.every(h => h.hidden)), "every data-chk heading hides");
    await page.$eval("#chk-search", e => { e.focus(); e.select(); });
    await page.keyboard.press("Backspace");
    await page.waitForFunction(() => document.getElementById("chk-empty").hidden);
    assert.strictEqual(await page.$$eval(rows, rs => rs.filter(r => !r.hidden).length), 43, "clearing restores all rows");
    assert.deepStrictEqual(errors.filter(e => !/favicon/.test(e)), [], "checklist search console errors");
    ok("biology checklist search: nonsense query → #chk-empty with zero rows, clearing restores all 43");
    await ctx.close();
  }

  // ── 7. Today panel suggestions with seeded storage; manifest fetched once ──
  {
    const { page, errors, ctx } = await newCtx(browser);
    // fixed fake clock (local noon 2026-11-20): the dated-window assertions must
    // not be calendar time-bombs — on a live clock the English commentary leaves
    // the 21-day near window after 2026-12-09 and the EE launch enters the 60-day
    // "start thinking" window after 2026-12-19. Pinned date → stable windows;
    // expected membership is still derived from the live deadline/coursework
    // data below, so calendar edits cannot stale the assertions.
    await page.evaluateOnNewDocument(() => {
      const Real = Date, MS = new Real(2026, 10, 20, 12).getTime();
      class FakeDate extends Real {
        constructor(...a) { if (a.length === 0) super(MS); else super(...a); }
        static now() { return MS; }
      }
      window.Date = FakeDate;
    });
    // seed before any page script runs: 12 bio-c1-1 cards due (9 + 3 due on the
    // pinned today), one open biology C1.1 mistake, and an ACTIVE subject
    // profile — the store key holds {subjects:[…]} directly (profile.js reads
    // p.subjects); a wrapped {"profile":{…}} shape would be silently ignored
    const fc = {}; for (let i = 1; i <= 12; i++) fc["fc-bio-e-" + String(i).padStart(2, "0")] =
      { box: i <= 9 ? 2 : 1, due: i <= 9 ? "2026-11-15" : "2026-11-20", seen: 1, t: 1763000000000 + i };
    const seed = {
      profile: { subjects: ["biology-hl", "english-lit-hl", "chemistry-hl", "math-aa-sl"] },
      "fc-state": fc,
      "q-errors": [{ key: "bio-c1-1-enzymes-metabolism#e01", id: "e01", bankId: "bio-c1-1-enzymes-metabolism",
        subject: "biology-hl", topic: "c1-1-enzymes-metabolism", topicLabel: "C1.1 — Enzymes & metabolism (Nov unit)",
        format: "mcq", stem: "Seeded mistake stem", attempts: 1, firstMissed: "2026-11-18", lastMissed: "2026-11-18", resolved: false, ts: 1763450000000 }]
    };
    await page.evaluateOnNewDocument(s => { for (const [k, v] of Object.entries(s)) localStorage.setItem(k, JSON.stringify(v)); }, seed);
    const manifestReqs = [];
    page.on("request", r => { if (/library\/questions\/manifest\.json/.test(r.url())) manifestReqs.push(r.url()); });
    await page.goto(BASE + "/app/index.html", { waitUntil: "networkidle0" });
    await page.waitForFunction(() => {
      const b = document.getElementById("today-body");
      return b && b.textContent.indexOf("Loading today's plan") === -1;
    }, { timeout: 15000, polling: 100 });
    const sugg = await page.evaluate(() => {
      const b = [...document.querySelectorAll("#today-body .td-block")]
        .find(x => (x.querySelector("h4") || {}).textContent && /Suggested/.test(x.querySelector("h4").textContent));
      return b ? [...b.querySelectorAll(".td-subj")].map(d => ({ title: d.querySelector("strong").textContent, href: d.querySelector("a").getAttribute("href") })) : [];
    });
    assert.strictEqual(sugg.length, 2, "two suggestions render (got " + sugg.length + ")");
    const cards = sugg.find(s => /cards due/.test(s.title));
    assert.ok(cards && /^12 cards due$/.test(cards.title), "cards suggestion counts the seeded 12");
    assert.ok(cards && /^cards\.html\?from=bio-c1-1-enzymes-metabolism&n=12&label=/.test(cards.href), "cards link: deck id + n=12");
    const mist = sugg.find(s => /Open mistakes/.test(s.title));
    assert.ok(mist && /C1\.1 — Enzymes & metabolism/.test(mist.title), "mistakes suggestion names the topic");
    assert.ok(mist && /^quiz\.html\?errkeys=bio-c1-1-enzymes-metabolism%23e01$/.test(mist.href), "mistakes link: errkeys=<bank#item>");
    // the profile seed must actually be engaged (this is what the store-key
    // shape fix buys): a wrapped {"profile":{…}} would leave default-all active
    const prof = await page.evaluate(() => ({
      subjects: window.NB.profile.subjects(),
      hidesFrench: window.NB.profile.hides("french-a-langlit")
    }));
    assert.deepStrictEqual(prof.subjects, ["biology-hl", "english-lit-hl", "chemistry-hl", "math-aa-sl"],
      "seeded profile is active, not default-all");
    assert.strictEqual(prof.hidesFrench, true, "profile filtering engaged");
    assert.ok(await page.evaluate(() => {
      const fr = window.NB.deadlines.find(x => /French A HL: essay \(draft\)/.test(x.t));
      const items = window.NB.today.datedItems(window.NB.deadlines, [], window.NB.profile.hides);
      return !!fr && !items.some(x => x.label === fr.t);
    }), "hidden-subject deadline (French A HL essay) dropped by the active profile");
    // dated windows pinned by the fake clock, membership derived from the live
    // data: every rendered near item must satisfy today <= d <= today+21 and
    // every "Start thinking about" item (today+21, today+60]
    const win = await page.evaluate(async () => {
      const iso = d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
      const today = iso(new Date());
      const add = (s, n) => { const [y, m, dd] = s.split("-").map(Number); const t = new Date(y, m - 1, dd, 12); t.setDate(t.getDate() + n); return iso(t); };
      const nearEnd = add(today, 21), farEnd = add(today, 60);
      const cw = await (await fetch("../library/coursework/coursework.json")).json();
      const items = window.NB.deadlines
        .filter(x => x && !(x.subject && window.NB.profile.hides(x.subject)))
        .map(x => ({ d: x.d, label: x.t }));
      (Array.isArray(cw.tracks) ? cw.tracks : []).forEach(tr => {
        if (tr && tr.subject && window.NB.profile.hides(tr.subject)) return;
        (Array.isArray(tr.stages) ? tr.stages : []).forEach(st => (Array.isArray(st.dates) ? st.dates : []).forEach(dv => {
          const label = [dv.label, st.title, tr.label].find(v => typeof v === "string" && v);
          if (dv && label) items.push({ d: dv.date, label });
        }));
      });
      items.sort((a, b) => (a.d < b.d ? -1 : 1));
      return {
        near: items.filter(x => today <= x.d && x.d <= nearEnd).map(x => x.label),
        think: items.filter(x => x.d > nearEnd && x.d <= farEnd).map(x => x.label)
      };
    });
    const coming = await page.evaluate(() => {
      const b = [...document.querySelectorAll("#today-body .td-block")]
        .find(x => (x.querySelector("h4") || {}).textContent && /Coming up/.test(x.querySelector("h4").textContent));
      if (!b) return { near: [], think: [] };
      const uls = [...b.querySelectorAll("ul")];
      const texts = ul => ul ? [...ul.querySelectorAll("li")].map(li => li.textContent) : [];
      return { near: texts(uls[0]), think: texts(uls[1]) };
    });
    assert.strictEqual(coming.near.length, win.near.length,
      "near-term list exactly covers [today, today+21] (got " + coming.near.length + ", want " + win.near.length + ")");
    win.near.forEach((label, i) => assert.ok(coming.near[i].includes(label.slice(0, 70)), "near item in date order: " + label));
    assert.strictEqual(coming.think.length, win.think.length,
      "long-lead list exactly covers (today+21, today+60] (got " + coming.think.length + ", want " + win.think.length + ")");
    win.think.forEach((label, i) => assert.ok(coming.think[i].includes(label.slice(0, 70)) && /^Start thinking about/.test(coming.think[i]),
      "long-lead item labelled: " + label));
    if (win.near.some(l => /practice commentary/.test(l)))
      assert.match(coming.near.join(" "), /practice commentary/, "English commentary (2026-12-08) is near-term on the pinned date");
    if (!win.near.concat(win.think).some(l => /Extended Essay|TOK Exhibition/.test(l)))
      assert.ok(!/Extended Essay|TOK Exhibition/.test(await page.$eval("#today-body", e => e.textContent)),
        "EE launch (2027-02-17) and TOK plan (2027-03-25) stay beyond both windows");
    assert.deepStrictEqual(errors.filter(e => !/favicon/.test(e)), [], "seeded Today console errors");
    // storage-event storm → debounced re-render, and the questions manifest is
    // cached in DATA: fetched once on load, never per re-render
    assert.strictEqual(manifestReqs.length, 1, "manifest fetched once on load");
    errors.length = 0;
    await page.evaluate(() => {
      const m = document.createElement("div"); m.id = "storm-marker";
      document.getElementById("today-body").appendChild(m);
      for (let i = 0; i < 50; i++) window.dispatchEvent(new StorageEvent("storage", { key: i % 2 ? "fc-state" : "q-errors" }));
    });
    await page.waitForFunction(() => !document.getElementById("storm-marker"), { timeout: 5000 });
    assert.strictEqual(manifestReqs.length, 1, "manifest NOT re-fetched by the storm re-renders");
    assert.match(await page.$eval("#today-body", e => e.textContent), /12 cards due/, "panel intact after the storm");
    assert.deepStrictEqual(errors.filter(e => !/favicon/.test(e)), [], "storage-storm console errors");
    ok("Today suggestions (seeded storage, pinned clock): 12-cards-due + C1.1 mistakes links, active-profile deadline filtering, window-exact near/long-lead dated items, storm re-render without re-fetching the manifest");
    await ctx.close();
  }
  // ── 8. resources page + the staged AI-bank import ──────────────────────────
  {
    const { page, errors, ctx } = await newCtx(browser);
    const today = new Date().toISOString().slice(0, 10);
    // 8a. save a resource: tagged, note-linked, escaped, and never a quiz bank
    await page.goto(BASE + "/app/resources.html", { waitUntil: "networkidle0" });
    await page.waitForSelector("#res-add-form");
    await page.type("#res-label", "<b>Water video</b>");
    await page.select("#res-subject-add", "biology-hl");
    await page.waitForFunction(() => [...document.querySelectorAll("#res-topics option")].length > 0, { timeout: 5000 });
    await page.type("#res-topic", "a1-1");
    await page.select("#res-type-add", "video");
    await page.type("#res-url", "https://example.org/water");
    await page.type("#res-comment", "osmosis at 4:30");
    await page.waitForSelector("#res-note-wrap:not([hidden])", { timeout: 5000 });
    assert.ok(await page.$eval("#res-note-link", e => e.checked), "note link pre-ticked for a known topic");
    await page.click("#res-add-form button[type=submit]");
    await page.waitForSelector("#res-list .res-row");
    assert.strictEqual(await page.$eval("#res-list .res-link", e => e.textContent), "<b>Water video</b>", "title rendered as text, not HTML");
    assert.strictEqual(await page.$eval("#res-list .res-link", e => e.getAttribute("href")), "https://example.org/water");
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("my-res")));
    assert.strictEqual(Object.keys(stored).length, 1);
    const rec = Object.values(stored)[0];
    assert.strictEqual(rec.subject, "biology-hl");
    assert.strictEqual(rec.topic, "a1-1");
    assert.strictEqual(rec.type, "video");
    assert.strictEqual(rec.note, "bio-a1-1", "topic matched the manifest note id");
    assert.strictEqual(rec.comment, "osmosis at 4:30");
    assert.strictEqual(await page.evaluate(() => localStorage.getItem("q-userbanks")), null, "a resource never becomes a quiz bank");
    // 8b. delete leaves a tombstone
    await page.click("#res-list .res-del");
    const after = await page.evaluate(() => JSON.parse(localStorage.getItem("my-res")));
    assert.strictEqual(Object.values(after)[0].deleted, true, "deletion stored as a tombstone");
    assert.deepStrictEqual(errors.filter(e => !/favicon/.test(e)), [], "resources console errors");
    ok("resources: tagged save (subject/topic/type/note-link), escaped title, tombstone delete, quiz storage untouched");
    // 8c. Ask an AI for a practice set: deep link → bankgen prompt → copy + open
    await page.goto(`${BASE}/app/author.html?ai-subject=biology-hl&ai-topic=a1-1`, { waitUntil: "networkidle0" });
    await page.waitForSelector("#ai-card #nt-ai-modes button[data-mode=bankgen]", { timeout: 5000 });
    assert.strictEqual(await page.$eval("#ai-subject", e => e.value), "biology-hl", "deep-link subject preselected");
    assert.strictEqual(await page.$eval("#ai-topic", e => e.value), "a1-1", "deep-link topic preselected");
    assert.strictEqual(await page.$$eval("#ai-card #nt-ai-modes button[data-mode]", bs => bs.length), 1, "only the bankgen mode is offered on the Upload page");
    await page.evaluate(() => { window.__opened = []; window.open = (u) => { window.__opened.push({ u }); return { close() {} }; }; });
    await page.click('#ai-card #nt-ai-modes button[data-mode="bankgen"]');
    const opened = await page.evaluate(() => window.__opened);
    assert.strictEqual(opened.length, 1);
    assert.strictEqual(opened[0].u, "https://gemini.google.com/app");
    const copied = await page.evaluate(() => window.NB.aiPrompt.lastText);
    assert.match(copied, /"subject": "biology-hl"/);
    assert.match(copied, /"topic": "a1-1"/);
    assert.match(copied, /A1\.1 Water/);
    assert.match(copied, /0-based index/);
    assert.doesNotMatch(copied, /\{[a-z_]+\}/);
    ok("AI picker: deep link prefills bio/a1-1, bankgen prompt carries the exact subject id + topic key, copy-before-open preserved");
    // 8d. staged import: paste → preview → edit a stem → Import in one batch
    const aiBank = JSON.stringify({ subject: "biology-hl", topic: "a1-1", topicLabel: "A1.1 Water", items: [
      { id: "p01", format: "mcq", topic: "a1-1", stem: "Why is water polar?", choices: ["O is more electronegative", "the molecule is symmetric", "hydrogen is heavier"], answer: 0, note: "electronegativity difference" },
      { id: "p02", format: "mcq", topic: "a1-1", stem: "Water has a high specific heat because…", choices: ["hydrogen bonding absorbs energy", "its mass is low", "covalent bonds break"], answer: 0 },
      { id: "p03", format: "written", topic: "a1-1", marks: 2, stem: "Define cohesion.", markscheme: ["hydrogen bonding between water molecules (1)", "attraction (1)"] },
    ] });
    await page.evaluate((b) => { document.getElementById("paste-box").value = b; }, aiBank);
    await page.click("#paste-add");
    await page.waitForSelector("#preview-panel:not([hidden])", { timeout: 5000 });
    assert.match(await page.$eval("#pv-summary", e => e.textContent), /3 questions \(2 MCQ, 1 written\)/);
    assert.strictEqual(await page.$eval("#pv-name", e => e.value), "ai-a1-1.json", "unique name suggested from the topic");
    assert.match(await page.$eval("#pv-status", e => e.textContent), /Ready to import/);
    assert.strictEqual(await page.$$eval("#pv-items .pv-item", els => els.length), 3, "one editable row per item");
    await page.evaluate(() => {
      const t = document.querySelector('.pv-item[data-pv="0"] .pv-stem');
      t.value = "Why is a water molecule polar (edited)?";
      t.dispatchEvent(new Event("input", { bubbles: true }));
    });
    assert.match(await page.$eval("#pv-status", e => e.textContent), /Ready to import/, "the edit keeps the bank valid");
    await page.click("#pv-import");
    await page.waitForFunction(() => document.getElementById("preview-panel").hidden, { timeout: 5000 });
    const banks = await page.evaluate(() => JSON.parse(localStorage.getItem("q-userbanks")));
    assert.strictEqual(banks.length, 1, "exactly one bank imported");
    assert.strictEqual(banks[0].name, "ai-a1-1.json");
    assert.strictEqual(banks[0].items[0].stem, "Why is a water molecule polar (edited)?", "the preview edit was imported");
    assert.strictEqual(banks[0].items.length, 3, "the whole set imported in one batch");
    assert.strictEqual(banks[0].label, "A1.1 Water");
    assert.strictEqual(banks[0].uploaded, today);
    assert.strictEqual(banks[0].subjectLabel, "biology-hl");
    assert.deepStrictEqual(errors.filter(e => !/favicon/.test(e)), [], "author staged-import console errors");
    ok("staged import: paste → preview (summary, suggested name, editable rows) → edit → Import lands one edited bank in q-userbanks");
    await ctx.close();
  }
  await browser.close();
  php.kill();
  fs.rmSync(DATA, { recursive: true, force: true });
  console.log(`\n${passed} e2e checks passed`);
  process.exit(0);
})().catch(e => { console.error("FAIL:", e.message); process.exit(1); });
