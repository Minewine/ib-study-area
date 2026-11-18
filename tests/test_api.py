"""PHP API tests: server/api.php behind tools/dev_server.php on php -S with a temp
data dir. Skipped when no php binary is on PATH (CI installs one).

Covers auth, get/save, revisions + 409 on a stale base, partial saves keeping
other keys, legacy (rev-less) files and clients, history rotation and retrieval,
export, atomic writes, refusing to overwrite an unreadable file, lockout (per
username+IP and per IP, expiring), token handling, CSRF guards (JSON-only POST/PUT,
foreign Origin refused), security headers, and a PHP 7.2 syntax guard (the host runs 7.2)."""

import json
import os
import re
import shutil
import socket
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
API_SRC = ROOT / "server" / "api.php"
PHP = shutil.which("php")
PASSWORD = "testpass123"


def test_api_source_is_php72_compatible():
    """The host runs PHP 7.2: no 7.3+ syntax or functions in server code."""
    banned = {
        r"\bfn\s*\(": "arrow functions (7.4)",
        r"\?\?=": "null-coalescing assignment (7.4)",
        r"\bmatch\s*\(": "match (8.0)",
        r"\?->": "nullsafe operator (8.0)",
        r"\bstr_(contains|starts_with|ends_with)\s*\(": "str_* helpers (8.0)",
        r"\barray_key_(first|last)\s*\(": "array_key_first/last (7.3)",
        r"\bis_countable\s*\(": "is_countable (7.3)",
        r"\):\s*(never|mixed|static)\b": "8.x return types",
        r"\bpublic\s+\w+\s+\$": "typed properties (7.4)",
        r"\bJSON_THROW_ON_ERROR\b": "JSON_THROW_ON_ERROR (7.3)",
    }
    for f in (API_SRC, ROOT / "tools" / "dev_server.php"):
        src = re.sub(r"//[^\n]*|#[^\n]*|/\*.*?\*/", "", f.read_text(encoding="utf-8"), flags=re.S)
        for pat, what in banned.items():
            assert not re.search(pat, src), f"{f.name}: {what} is not available on PHP 7.2"




def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture()
def server(tmp_path):
    data = tmp_path / "data"
    (data / "state").mkdir(parents=True)
    h = subprocess.run([PHP, "-r", f"echo password_hash('{PASSWORD}', PASSWORD_DEFAULT);"],
                       capture_output=True, text=True, check=True).stdout
    (data / "users.json").write_text(json.dumps({"tester": h, "other": h}))
    port = free_port()
    env = dict(os.environ, NEVAIB_DATA_DIR=str(data))
    proc = subprocess.Popen([PHP, "-S", f"127.0.0.1:{port}", "-t", str(ROOT), str(ROOT / "tools" / "dev_server.php")],
                            env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    base = f"http://127.0.0.1:{port}/api/api.php"
    for _ in range(50):
        try:
            urllib.request.urlopen(base + "?action=me", timeout=1)
            break
        except Exception:
            time.sleep(0.1)
    yield {"base": base, "data": data}
    proc.terminate()
    proc.wait(timeout=5)


def call(srv, action, body=None, token=None, extra=""):
    req = urllib.request.Request(srv["base"] + "?action=" + action + extra, method="POST" if body is not None else "GET")
    if body is not None:
        req.data = json.dumps(body).encode()
        req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("X-Nevaib-Token", token)
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            return r.status, json.loads(r.read() or b"null"), dict(r.headers)
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"null"), dict(e.headers)


def login(srv, user="tester"):
    st, d, _ = call(srv, "login", {"username": user, "password": PASSWORD})
    assert st == 200, d
    return d["token"]


php = pytest.mark.skipif(PHP is None, reason="php not installed")


@php
def test_requires_login(server):
    assert call(server, "get-state")[0] == 401
    assert call(server, "save-state", {"state": {}})[0] == 401
    assert call(server, "export")[0] == 401
    assert call(server, "history")[0] == 401


@php
def test_revisions_and_conflict(server):
    tok = login(server)
    st, d, _ = call(server, "get-state", token=tok)
    assert (st, d["state"], d["rev"]) == (200, None, 0)
    # legacy client: no base_rev → accepted
    st, d, _ = call(server, "save-state", {"state": {"quizlog": [1]}}, tok)
    assert st == 200 and d["rev"] == 1
    st, d, _ = call(server, "save-state", {"state": {"fc-state": {"a": {"box": 1}}}, "base_rev": 1}, tok)
    assert st == 200 and d["rev"] == 2
    # stale base → 409 with the current state; nothing written
    st, d, _ = call(server, "save-state", {"state": {"quizlog": []}, "base_rev": 1}, tok)
    assert st == 409 and d["rev"] == 2 and d["state"]["quizlog"] == [1]
    st, d, _ = call(server, "get-state", token=tok)
    assert d["rev"] == 2
    # partial save keeps the other keys
    assert d["state"] == {"quizlog": [1], "fc-state": {"a": {"box": 1}}}


@php
def test_legacy_file_without_rev(server):
    tok = login(server)
    legacy = {"state": {"q-errors": [{"key": "b01"}]}, "updated_at": "2026-11-01T10:00:00+00:00"}
    (server["data"] / "state" / "tester.json").write_text(json.dumps(legacy))
    st, d, _ = call(server, "get-state", token=tok)
    assert d["rev"] == 0 and d["state"]["q-errors"] == [{"key": "b01"}]
    st, d, _ = call(server, "save-state", {"state": {"quizlog": []}, "base_rev": 0}, tok)
    assert st == 200 and d["rev"] == 1
    stored = json.loads((server["data"] / "state" / "tester.json").read_text())
    assert stored["rev"] == 1 and stored["state"]["q-errors"] == [{"key": "b01"}]
    hist = list((server["data"] / "state" / "history" / "tester").glob("*.json"))
    assert len(hist) == 1 and json.loads(hist[0].read_text()) == legacy


@php
def test_history_rotation_and_retrieval(server):
    tok = login(server)
    rev = 0
    for i in range(33):
        st, d, _ = call(server, "save-state", {"state": {"quizlog": [i]}, "base_rev": rev}, tok)
        assert st == 200, d
        rev = d["rev"]
    files = sorted((server["data"] / "state" / "history" / "tester").glob("*.json"))
    assert len(files) == 30
    st, d, _ = call(server, "history", token=tok)
    names = [h["name"] for h in d["history"]]
    assert len(names) == 30 and names == sorted(names, reverse=True)
    st, d, _ = call(server, "history", token=tok, extra="&name=" + names[0])
    assert st == 200 and d["state"]["quizlog"] == [31] and d["rev"] == 32
    assert call(server, "history", token=tok, extra="&name=../users.json")[0] == 400
    # no temp files left behind (atomic write = temp + rename)
    assert not list((server["data"] / "state").glob("*.tmp-*"))


@php
def test_users_are_isolated(server):
    a, b = login(server, "tester"), login(server, "other")
    call(server, "save-state", {"state": {"quizlog": ["mine"]}}, a)
    st, d, _ = call(server, "get-state", token=b)
    assert d["state"] is None


@php
def test_export(server):
    tok = login(server)
    call(server, "save-state", {"state": {"fc-state": {"x": {"box": 2}}}}, tok)
    st, d, headers = call(server, "export", token=tok)
    assert st == 200 and d["format"] == "nevaib-server-export" and d["user"] == "tester"
    assert d["state"] == {"fc-state": {"x": {"box": 2}}} and d["rev"] == 1
    assert "attachment" in headers.get("Content-Disposition", "")


@php
def test_unreadable_state_is_never_overwritten(server):
    tok = login(server)
    p = server["data"] / "state" / "tester.json"
    p.write_text('{"state": {"fc-state": tru')
    assert call(server, "get-state", token=tok)[0] == 500
    assert call(server, "save-state", {"state": {"quizlog": []}}, tok)[0] == 500
    assert p.read_text() == '{"state": {"fc-state": tru'


@php
def test_bad_input_and_lockout(server):
    tok = login(server)
    assert call(server, "save-state", {"nostate": 1}, tok)[0] == 400
    assert call(server, "save-state", {"state": "x"}, tok)[0] == 400
    for _ in range(5):
        assert call(server, "login", {"username": "tester", "password": "wrong-password"})[0] == 401
    assert call(server, "login", {"username": "tester", "password": PASSWORD})[0] == 429


# ── security hardening ───────────────────────────────────────────────────────

def raw(srv, action, data=None, method=None, headers=None, extra=""):
    """Low-level request: arbitrary body bytes, method and headers."""
    req = urllib.request.Request(srv["base"] + "?action=" + action + extra, data=data,
                                 method=method or ("POST" if data is not None else "GET"))
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            return r.status, json.loads(r.read() or b"null"), dict(r.headers)
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"null"), dict(e.headers)


def bad_login(srv, user="tester"):
    return call(srv, "login", {"username": user, "password": "wrong-password"})


@php
def test_lockout_is_per_username_and_ip(server):
    for _ in range(5):
        st, d, _ = bad_login(server)
        assert st == 401 and d["error"] == "wrong username or password"
    # locked: even the right password is refused, with a generic message
    st, d, _ = call(server, "login", {"username": "tester", "password": PASSWORD})
    assert st == 429 and "password" not in d["error"]
    # a different account from the same IP is not locked out
    assert login(server, "other")
    # unknown usernames get the same answer as wrong passwords (no enumeration)
    st, d, _ = bad_login(server, "nobody-here")
    assert st == 401 and d["error"] == "wrong username or password"


@php
def test_lockout_expires_after_window(server):
    for _ in range(5):
        bad_login(server)
    assert call(server, "login", {"username": "tester", "password": PASSWORD})[0] == 429
    f = server["data"] / "login-fails.json"
    fails = json.loads(f.read_text())
    for e in fails.values():   # pretend the window has passed
        e["first"] -= 16 * 60
        e["last"] -= 16 * 60
    f.write_text(json.dumps(fails))
    assert login(server)


@php
def test_success_resets_pair_counter(server):
    for _ in range(4):
        bad_login(server)
    login(server)
    for _ in range(4):   # counter restarted: 4 more fails still leave a try
        assert bad_login(server)[0] == 401
    assert login(server)


@php
def test_per_ip_cap_across_usernames(server):
    for i in range(20):
        assert bad_login(server, f"spray{i}")[0] == 401
    # the IP is now capped, whichever account it tries
    assert call(server, "login", {"username": "other", "password": PASSWORD})[0] == 429


@php
def test_fail_counters_store_no_raw_identifiers(server):
    bad_login(server)
    text = (server["data"] / "login-fails.json").read_text()
    assert "tester" not in text and "127.0.0.1" not in text
    assert not list(server["data"].glob("*.tmp-*"))


@php
def test_legacy_fail_file_is_tolerated(server):
    (server["data"] / "login-fails.json").write_text(json.dumps({"tester": {"count": 9, "last": int(time.time())}}))
    assert login(server)


@php
def test_tokens_random_hashed_and_expiring(server):
    a, b = login(server), login(server)
    assert a != b and re.fullmatch(r"[0-9a-f]{64}", a)
    stored = (server["data"] / "tokens.json").read_text()
    assert a not in stored and b not in stored   # only sha256 hashes are kept
    assert call(server, "me", token=a)[1]["user"] == "tester"
    # expire every token
    toks = json.loads(stored)
    for e in toks.values():
        e["t"] -= 91 * 86400
    (server["data"] / "tokens.json").write_text(json.dumps(toks))
    assert call(server, "get-state", token=a)[0] == 401


@php
def test_token_only_via_header(server):
    tok = login(server)
    assert call(server, "get-state", extra="&token=" + tok)[0] == 401
    assert call(server, "get-state", token="not-a-token")[0] == 401
    assert call(server, "get-state", token="0" * 64)[0] == 401


@php
def test_logout_retires_token(server):
    tok = login(server)
    assert call(server, "logout", {}, tok)[0] == 200
    assert call(server, "get-state", token=tok)[0] == 401


@php
def test_writes_require_json_post(server):
    tok = login(server)
    form = b"username=tester&password=" + PASSWORD.encode()
    # cross-site HTML forms can only send these content types
    for ct in ("application/x-www-form-urlencoded", "text/plain", "multipart/form-data; boundary=x"):
        assert raw(server, "login", form, headers={"Content-Type": ct})[0] == 415
        assert raw(server, "save-state", b'{"state":{"quizlog":[1]}}',
                   headers={"Content-Type": ct, "X-Nevaib-Token": tok})[0] == 415
    assert raw(server, "login", extra="&username=tester&password=" + PASSWORD)[0] == 405
    assert raw(server, "logout", headers={"X-Nevaib-Token": tok})[0] == 405
    # nothing was written
    assert not (server["data"] / "state" / "tester.json").exists()
    # PUT with JSON still works (older clients / e2e)
    st, d, _ = raw(server, "save-state", b'{"state":{"quizlog":[1]}}', method="PUT",
                   headers={"Content-Type": "application/json", "X-Nevaib-Token": tok})
    assert st == 200 and d["rev"] == 1


@php
def test_cross_origin_writes_refused(server):
    tok = login(server)
    body = json.dumps({"state": {"quizlog": [1]}}).encode()
    hdr = {"Content-Type": "application/json", "X-Nevaib-Token": tok}
    assert raw(server, "save-state", body, headers=dict(hdr, Origin="https://evil.example"))[0] == 403
    st, _, h = raw(server, "save-state", body, headers=dict(hdr, Origin="https://rametric.com"))
    assert st == 200 and h.get("Access-Control-Allow-Origin") == "https://rametric.com"
    # same-origin (Origin == Host) is fine too
    host = server["base"].split("/")[2]
    assert raw(server, "save-state", json.dumps({"state": {"quizlog": [2]}, "base_rev": 1}).encode(),
               headers=dict(hdr, Origin="http://" + host))[0] == 200
    # disallowed origins get no CORS grant
    _, _, h = raw(server, "me", headers={"Origin": "https://evil.example"})
    assert "Access-Control-Allow-Origin" not in h


@php
def test_security_headers(server):
    _, _, h = call(server, "me")
    assert h.get("X-Content-Type-Options") == "nosniff"
    assert h.get("Referrer-Policy") == "no-referrer"
    assert h.get("X-Frame-Options") == "DENY"
    assert "frame-ancestors 'none'" in h.get("Content-Security-Policy", "")
    assert "no-store" in h.get("Cache-Control", "")
