"""Parent weekly summary: server/summary.php computation (run through php CLI with a
fixed clock), ?action=summary auth + viewer rules, token-only login, and the cron
e-mail script's dry run. Read-only: the state file must be byte-identical afterwards."""

import json
import os
import subprocess
import time
from pathlib import Path

import pytest

from test_api import PASSWORD, PHP, ROOT, call, login, server  # noqa: F401  (fixture)

php = pytest.mark.skipif(PHP is None, reason="php not installed")
LIB = ROOT / "server" / "summary.php"
NOW = 1763460000  # 2025-11-18 10:00 UTC — fixed clock for the pure-function tests
DAY = 86400


def summarize(state, days=7, now=NOW, index=None):
    code = (
        "require $argv[1];"
        "$in = json_decode(stream_get_contents(STDIN), true);"
        "$idx = $in['index'] === null ? nb_card_index($argv[2]) : $in['index'];"
        "echo json_encode(nb_summary($in['state'], (int)$in['days'], (int)$in['now'], $idx, 'Europe/Zurich'));"
    )
    r = subprocess.run([PHP, "-r", code, str(LIB), str(ROOT / "library" / "flashcards")],
                       input=json.dumps({"state": state, "days": days, "now": now, "index": index}),
                       capture_output=True, text=True, check=True)
    return json.loads(r.stdout)


def ms(ts):
    return ts * 1000


STATE = {
    "quizlog": [
        {"date": "2025-11-17", "label": "Biology HL", "got": 6, "max": 10, "pct": 60, "ts": ms(NOW - DAY),
         "subject": "biology-hl", "topics": {"c1-1": {"l": "C1.1 Enzymes", "g": 1, "m": 5}, "a2-1": {"l": "A2.1 Origin of cells", "g": 5, "m": 5}}},
        {"date": "2025-11-15", "label": "Chemistry HL", "got": 8, "max": 10, "pct": 80, "ts": ms(NOW - 3 * DAY)},
        {"date": "2025-11-01", "label": "Chemistry HL", "got": 0, "max": 10, "pct": 0, "ts": ms(NOW - 17 * DAY)},  # outside
        {"date": "2025-11-16", "label": "Maths AA SL", "got": 3, "max": 4, "pct": 75},  # legacy: no ts → by date
    ],
    "q-errors": [
        {"key": "b#1", "topic": "c1-1", "topicLabel": "C1.1 Enzymes", "lastMissed": "2025-11-17", "resolved": False},
        {"key": "b#2", "topic": "c1-1", "topicLabel": "C1.1 Enzymes", "lastMissed": "2025-11-17", "resolved": False},
        {"key": "c#1", "topic": "s1-1", "topicLabel": "S1.1 Particles", "lastMissed": "2025-11-16", "resolved": False},
        {"key": "c#2", "topic": "s2-1", "topicLabel": "S2.1 Ionic", "lastMissed": "2025-11-16", "resolved": True},   # resolved
        {"key": "c#3", "topic": "r1-1", "topicLabel": "R1.1 Old", "lastMissed": "2025-10-01", "resolved": False},     # outside
    ],
    "fc-state": {
        "fc-bio-e-01": {"box": 4, "due": "2025-11-30", "seen": 3, "t": ms(NOW - 2 * DAY)},
        "fc-bio-e-02": {"box": 1, "due": "2025-11-18", "seen": 1, "t": ms(NOW - 2 * DAY)},
        "u-123": {"box": 2, "due": "2025-11-10", "seen": 2, "t": ms(NOW - 1 * DAY)},          # user card
        "fc-old": {"box": 5, "due": "2025-12-30", "seen": 6, "t": ms(NOW - 30 * DAY)},          # outside
        "fc-bad": "garbage",
    },
}


@php
def test_summary_computation():
    s = summarize(STATE)
    assert (s["days"], s["to"]) == (7, "2025-11-18")
    q = s["quiz"]
    assert q["sessions"] == 3 and (q["got"], q["max"]) == (17, 24) and q["pct"] == 71
    subj = {b["label"]: b for b in q["by_subject"]}
    assert subj["Biology HL"]["pct"] == 60 and subj["Chemistry HL"]["sessions"] == 1 and subj["Maths AA SL"]["pct"] == 75
    assert [t["topic"] for t in q["by_topic"]] == ["c1-1", "a2-1"]   # weakest first
    c = s["cards"]
    assert c["reviewed"] == 3 and c["seen_total"] == 4 and c["mastered_total"] == 2 and c["due_now"] == 2
    assert {b["label"]: b["reviewed"] for b in c["by_subject"]} == {"Biology HL": 2, "My own cards": 1}
    assert s["missed_questions"] == 3
    weak = s["weakest_topics"]
    assert weak[0] == {"topic": "c1-1", "label": "C1.1 Enzymes", "pct": 20, "missed": 2}
    assert weak[1]["topic"] == "s1-1" and weak[1]["pct"] is None and weak[1]["missed"] == 1
    assert all(w["topic"] not in ("s2-1", "r1-1", "a2-1") for w in weak)
    assert s["active_days"] == 3 and s["active_dates"] == ["2025-11-15", "2025-11-16", "2025-11-17"]
    # estimate: 3 cards × 20 s + 24 marks × 60 s = 1500 s = 25 min
    assert s["est_minutes"] == 25 and "estimate" in s["est_minutes_note"]


@php
def test_summary_empty_and_malformed_state():
    for st in ({}, {"quizlog": "x", "q-errors": None, "fc-state": []}, {"quizlog": [None, 3, {"label": 1}]}):
        s = summarize(st, index={})
        assert s["quiz"]["sessions"] == 0 and s["cards"]["reviewed"] == 0 and s["weakest_topics"] == []
        assert s["quiz"]["pct"] is None


@php
def test_summary_window_is_clamped():
    assert summarize({}, days=0, index={})["days"] == 1
    assert summarize({}, days=999, index={})["days"] == 90
    assert summarize(STATE, days=30)["quiz"]["sessions"] == 4


@php
def test_card_index_maps_seed_cards():
    s = summarize({"fc-state": {"fc-bio-e-01": {"box": 1, "t": ms(NOW)}}}, now=NOW + 10)
    assert s["cards"]["by_subject"] == [{"label": "Biology HL", "reviewed": 1}]


# ── API ──────────────────────────────────────────────────────────────────────

@php
def test_summary_requires_login_and_is_read_only(server):  # noqa: F811
    assert call(server, "summary")[0] == 401
    tok = login(server)
    now_ms = int(time.time() * 1000)
    st, d, _ = call(server, "save-state", {"state": {"quizlog": [{"date": "x", "label": "Biology HL", "got": 1, "max": 2, "pct": 50, "ts": now_ms}]}}, tok)
    assert st == 200
    p = server["data"] / "state" / "tester.json"
    before = p.read_bytes()
    files_before = sorted(x.name for x in server["data"].rglob("*"))
    st, d, _ = call(server, "summary", token=tok, extra="&days=7")
    assert st == 200 and d["user"] == "tester" and d["summary"]["quiz"]["sessions"] == 1
    assert d["viewable"] == ["tester"]
    assert p.read_bytes() == before                                       # state untouched
    assert sorted(x.name for x in server["data"].rglob("*")) == files_before  # no history/new files
    assert call(server, "summary", token=tok, extra="&days=0")[0] == 400


@php
def test_summary_other_account_needs_viewer_config(server):  # noqa: F811
    tok = login(server, "other")
    assert call(server, "summary", token=tok, extra="&user=tester")[0] == 403
    (server["data"] / "config.json").write_text(json.dumps({"summary_viewers": {"other": ["tester"]}}))
    st, d, _ = call(server, "summary", token=tok, extra="&user=tester")
    assert st == 200 and d["user"] == "tester" and d["viewable"] == ["other", "tester"]
    # the viewer list never opens the reverse direction or unknown users
    t2 = login(server, "tester")
    assert call(server, "summary", token=t2, extra="&user=other")[0] == 403


@php
def test_token_only_login_sets_no_session(server):  # noqa: F811
    import http.cookiejar
    import urllib.request
    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))

    def jar_call(action, body=None):
        req = urllib.request.Request(server["base"] + "?action=" + action, method="POST" if body is not None else "GET")
        if body is not None:
            req.data = json.dumps(body).encode()
            req.add_header("Content-Type", "application/json")
        with opener.open(req, timeout=5) as r:
            return json.loads(r.read())

    d = jar_call("login", {"username": "tester", "password": PASSWORD, "no_session": True})
    assert d["token"]
    assert jar_call("me")["user"] is None          # the cookie alone is not logged in
    assert call(server, "summary", token=d["token"])[0] == 200
    jar_call("login", {"username": "tester", "password": PASSWORD})   # normal login still sets a session
    assert jar_call("me")["user"] == "tester"


# ── cron e-mail script ───────────────────────────────────────────────────────

@php
def test_weekly_email_dry_run(tmp_path):
    data = tmp_path / "d"
    (data / "state").mkdir(parents=True)
    now_ms = int(time.time() * 1000)
    (data / "state" / "neva.json").write_text(json.dumps({"state": {"quizlog": [
        {"date": "x", "label": "Chemistry HL", "got": 2, "max": 4, "pct": 50, "ts": now_ms,
         "topics": {"s1-1": {"l": "S1.1 Particles", "g": 0, "m": 2}}}]}, "rev": 3}))
    env = dict(os.environ, NEVAIB_DATA_DIR=str(data))
    script = str(ROOT / "server" / "weekly_email.php")
    r = subprocess.run([PHP, script, "--dry-run"], env=env, capture_output=True, text=True)
    assert r.returncode == 1 and "no config" in r.stderr
    (data / "config.json").write_text(json.dumps({"summary_email": {"to": "a@b.c\r\nBcc: x@y.z", "users": ["neva"]}}))
    r = subprocess.run([PHP, script, "--dry-run"], env=env, capture_output=True, text=True)
    assert r.returncode == 1 and "plain e-mail" in r.stderr   # header injection refused
    (data / "config.json").write_text(json.dumps({"summary_email": {"to": "parent@example.org", "users": ["neva"]}}))
    before = (data / "state" / "neva.json").read_bytes()
    r = subprocess.run([PHP, script, "--dry-run"], env=env, capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    assert "To: parent@example.org" in r.stdout and "Quizzes: 1 session(s), 50%" in r.stdout
    assert "S1.1 Particles — 0% in quizzes" in r.stdout
    assert (data / "state" / "neva.json").read_bytes() == before


def test_server_scripts_refuse_web_requests():
    for f in ("summary.php", "weekly_email.php"):
        src = (ROOT / "server" / f).read_text(encoding="utf-8")
        assert "http_response_code(404)" in src, f
