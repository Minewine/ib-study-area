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
const CHROME = process.env.CHROME || ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find(p => fs.existsSync(p));
const bank = f => JSON.parse(fs.readFileSync(`${REPO}/library/questions/${f}.json`, "utf8"));
const sleep = ms => new Promise(r => setTimeout(r, ms));
let passed = 0; const ok = (name) => { passed++; console.log("ok -", name); };

async function newCtx(browser) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", m => { if (m.type() === "error" && !/^Failed to load resource/.test(m.text())) errors.push(m.text()); });
  page.on("pageerror", e => errors.push("pageerror: " + e.message));
  page.on("requestfailed", r => errors.push("requestfailed: " + r.url()));
  page.on("response", r => { if (r.status() >= 400 && !(r.status() === 409 && /action=save-state/.test(r.url()))) errors.push(r.status() + " " + r.url()); }); // 409 = handled conflict
  await page.evaluateOnNewDocument(() => { if (!localStorage.getItem("nb-api")) localStorage.setItem("nb-api", "/api/api.php"); });
  return { ctx, page, errors };
}
const ls = (page, k) => page.evaluate(k => JSON.parse(localStorage.getItem(k)), k);

function startServer() {
  fs.mkdirSync(path.join(DATA, "state"), { recursive: true });
  const hash = execFileSync("php", ["-r", "echo password_hash('testpass123', PASSWORD_DEFAULT);"]).toString();
  fs.writeFileSync(path.join(DATA, "users.json"), JSON.stringify({ tester: hash }));
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
    const pages = ["/index.html", "/app/index.html", "/app/notes.html", "/app/quiz.html", "/app/cards.html", "/app/author.html",
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
      if (await page.$("#q-box .choice")) await page.click("#q-box .choice");
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
      const cls = await page.evaluate(() => ({ correct: [...document.querySelectorAll(".choice.correct")].map(b => +b.dataset.i), wrong: [...document.querySelectorAll(".choice.wrong")].map(b => +b.dataset.i), note: document.querySelector(".q-note").className }));
      assert.deepStrictEqual(cls.correct, [item.answer], "correct option highlighted by original index");
      if (target.i === item.answer) { assert.deepStrictEqual(cls.wrong, []); assert.match(cls.note, /good/); }
      else {
        assert.deepStrictEqual(cls.wrong, [target.i]); assert.match(cls.note, /bad/);
        const e = (await ls(page, "q-errors")).find(e => e.key === "bio-unity-diversity-cells#" + item.id);
        assert.ok(e, "error stored under bank#id"); assert.strictEqual(e.userAnswer, target.i, "stored answer is original index"); assert.strictEqual(e.answer, item.answer);
        assert.strictEqual(e.choices[e.userAnswer], item.choices[target.i]);
        wrongIds.push(item.id);
      }
      await page.click("#q-next");
    } else {
      await page.click("#q-reveal"); await page.select("#q-selfscore", "0"); await page.click("#q-next");
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
  assert.strictEqual((await ls(page, "quizlog")).length, 2, "quizlog appended, old entry kept");

  // review mode works on migrated + legacy + new records
  await page.click("#q-again");
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
      await page.click(`#q-box .choice[data-i="${ans}"]`); await page.click("#q-next");
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
  const tRated = await A.page.evaluate(() => { const st = JSON.parse(localStorage.getItem("fc-state")); return Math.max(...Object.values(st).map(s => s.t || 0)); });
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
  const tOffline = await A.page.evaluate(() => { const st = JSON.parse(localStorage.getItem("fc-state")); return Math.max(...Object.values(st).map(s => s.t || 0)); });
  assert.ok(await A.page.evaluate(() => !!JSON.parse(localStorage.getItem("nb-dirty") || "{}")["fc-state"]), "offline change marked dirty");
  await A.page.setOfflineMode(false);
  await A.page.reload({ waitUntil: "networkidle0" }); await sleep(3000);
  srv = serverState();
  assert.ok(Object.values(srv["fc-state"]).some(s => s.t === tOffline), "offline review reached the server");
  assert.ok(Object.values(await ls(A.page, "fc-state")).some(s => s.t === tOffline), "and was not overwritten locally");
  ok("offline review → back online → pushed, not overwritten");

  // stale tab: B still shows an old page while A saved; B's write gets 409, merges, retries
  await B.page.goto(BASE + "/app/quiz.html", { waitUntil: "networkidle0" }); await sleep(1500);
  await A.page.evaluate(() => { const st = JSON.parse(localStorage.getItem("fc-state")); st["e2e-a"] = { box: 2, due: "2026-12-01", seen: 1, t: Date.now() }; window.NB.store.set("fc-state", st); });
  await A.page.evaluate(() => window.Auth.pushNow(true));
  const revBefore = JSON.parse(fs.readFileSync(STATE_FILE, "utf8")).rev;
  await B.page.evaluate(() => { const st = JSON.parse(localStorage.getItem("fc-state")); st["e2e-b"] = { box: 1, due: "2026-12-02", seen: 1, t: Date.now() }; window.NB.store.set("fc-state", st); });
  await B.page.evaluate(() => window.Auth.pushNow(true));
  srv = serverState();
  assert.ok(srv["fc-state"]["e2e-a"] && srv["fc-state"]["e2e-b"], "both devices' reviews on the server");
  assert.ok(JSON.parse(fs.readFileSync(STATE_FILE, "utf8")).rev > revBefore);
  assert.ok(fs.readdirSync(path.join(DATA, "state", "history", "tester")).length >= 3, "server kept previous versions");
  ok("stale tab: 409 → merge → retry keeps both devices' work; server history kept");

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
  assert.ok(await C.page.evaluate(() => Object.keys(localStorage).some(k => k.startsWith("nb-backup:"))), "safety copy taken");
  assert.strictEqual(await C.page.evaluate(() => localStorage.getItem("nb-token")), null, "no credentials restored");
  assert.deepStrictEqual(C.errors.filter(e => !/favicon/.test(e)), [], "restore console errors");
  ok("backup from A restored into another browser via the Cards UI: merged, snapshot taken, no token");
  await C.ctx.close();

  for (const d of [A, B]) assert.deepStrictEqual(d.errors.filter(e => !/favicon/.test(e)), [], "sync console errors");
  ok("no console errors during sync runs");
  await browser.close();
  php.kill();
  fs.rmSync(DATA, { recursive: true, force: true });
  console.log(`\n${passed} e2e checks passed`);
  process.exit(0);
})().catch(e => { console.error("FAIL:", e.message); process.exit(1); });
