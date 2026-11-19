"""PHP API tests: server/api.php behind tools/dev_server.php on php -S with a temp
data dir. Skipped when no php binary is on PATH (CI installs one).

Covers auth, get/save, revisions + 409 on a stale base, partial saves keeping
other keys, legacy (rev-less) files and clients, history rotation and retrieval,
export, atomic writes, refusing to overwrite an unreadable file, lockout (per
username+IP and per IP, expiring), token handling, CSRF guards (JSON-only POST/PUT,
foreign Origin refused), security headers, roles (migrate-on-read user records) and
the admin account API (create-user / list-users / set-profile), and a PHP 7.2
syntax guard (the host runs 7.2)."""

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
    for f in (*sorted((ROOT / "server").glob("*.php")), ROOT / "tools" / "dev_server.php"):
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
    # "tester" is a legacy pre-roles record (bare hash string); "other" is the new
    # format {"h": ..., "role": ...} and the admin tests log in with it
    (data / "users.json").write_text(json.dumps({"tester": h, "other": {"h": h, "role": "admin"}}))
    port = free_port()
    env = dict(os.environ, NEVAIB_DATA_DIR=str(data), NEVAIB_SETUP_KEY="test-setup-key")
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


# ── multi-user: roles on user records + admin account management ─────────────

@php
def test_legacy_hash_user_still_logs_in_as_student(server):
    st, d, _ = call(server, "me", token=login(server, "tester"))
    assert st == 200 and d["user"] == "tester" and d["role"] == "student"


@php
def test_me_and_login_report_role(server):
    st, d, _ = call(server, "login", {"username": "other", "password": PASSWORD})
    assert st == 200 and d["role"] == "admin"
    st, d, _ = call(server, "me", token=d["token"])
    assert st == 200 and d["user"] == "other" and d["role"] == "admin"


@php
def test_setup_creates_admin_student_or_rejects_role(server):
    body = {"setup_key": "test-setup-key", "password": PASSWORD}
    assert call(server, "setup", dict(body, username="parent", role="admin"))[0] == 200
    assert call(server, "setup", dict(body, username="kid"))[0] == 200   # default role
    assert call(server, "setup", dict(body, username="x", role="teacher"))[0] == 400
    users = json.loads((server["data"] / "users.json").read_text())
    assert users["parent"]["role"] == "admin" and users["parent"]["h"].startswith("$2")
    assert users["kid"]["role"] == "student"
    assert isinstance(users["tester"], str)   # legacy entries survive a setup save untouched


@php
def test_create_user_gate_and_csrf(server):
    assert call(server, "create-user", {"username": "kid", "password": PASSWORD})[0] == 401
    assert call(server, "create-user", {"username": "kid", "password": PASSWORD}, login(server, "tester"))[0] == 403
    assert raw(server, "create-user")[0] == 405   # write actions are POST/PUT-only
    assert raw(server, "create-user", b"username=kid",
               headers={"Content-Type": "application/x-www-form-urlencoded"})[0] == 415
    assert raw(server, "set-profile", b"{}", headers={"Content-Type": "text/plain"})[0] == 415


@php
def test_create_user_happy_path(server):
    tok = login(server, "other")
    st, d, _ = call(server, "create-user",
                    {"username": "kid", "password": "kidpass123", "role": "student",
                     "subjects": ["math-aa-sl", " biology-hl ", "", "math-aa-sl"]}, tok)
    assert st == 200 and d == {"ok": True, "user": "kid", "role": "student"}
    users = json.loads((server["data"] / "users.json").read_text())
    assert users["kid"]["role"] == "student" and users["kid"]["h"].startswith("$2")
    assert isinstance(users["tester"], str)   # legacy entries stay untouched
    # the account's state file is seeded with the sanitized subject profile
    state = json.loads((server["data"] / "state" / "kid.json").read_text())
    assert state["rev"] == 1 and state["state"]["profile"]["subjects"] == ["math-aa-sl", "biology-hl"]
    assert state["updated_at"]
    # first write, no previous version → no history snapshot (same as save-state)
    assert not (server["data"] / "state" / "history" / "kid").exists()
    # the new account can log in and reads its seeded profile
    st, d, _ = call(server, "login", {"username": "kid", "password": "kidpass123"})
    assert st == 200 and d["role"] == "student"
    st, d, _ = call(server, "get-state", token=d["token"])
    assert d["state"]["profile"]["subjects"] == ["math-aa-sl", "biology-hl"]


@php
def test_create_user_validation_and_duplicate(server):
    tok = login(server, "other")
    assert call(server, "create-user", {"username": "Bad Name", "password": "kidpass123"}, tok)[0] == 400
    assert call(server, "create-user", {"username": "ok-name", "password": "short"}, tok)[0] == 400
    assert call(server, "create-user", {"username": "ok-name", "password": "kidpass123", "role": "teacher"}, tok)[0] == 400
    # subjects: non-array/non-strings refused; >64 chars and >12 entries refused
    assert call(server, "create-user", {"username": "ok-name", "password": "kidpass123", "subjects": "math-aa-sl"}, tok)[0] == 400
    assert call(server, "create-user", {"username": "ok-name", "password": "kidpass123", "subjects": [42]}, tok)[0] == 400
    assert call(server, "create-user", {"username": "ok-name", "password": "kidpass123", "subjects": ["s" * 65]}, tok)[0] == 400
    assert call(server, "create-user", {"username": "ok-name", "password": "kidpass123",
                                        "subjects": [str(i) for i in range(13)]}, tok)[0] == 400
    assert call(server, "create-user", {"username": "kid", "password": "kidpass123"}, tok)[0] == 200
    assert call(server, "create-user", {"username": "kid", "password": "kidpass123"}, tok)[0] == 409
    assert not (server["data"] / "state" / "ok-name.json").exists()   # nothing half-written


@php
def test_list_users_shape_and_admin_gate(server):
    tok = login(server, "other")
    call(server, "create-user", {"username": "kid", "password": "kidpass123", "subjects": ["biology-hl"]}, tok)
    st, d, _ = call(server, "list-users", token=tok)
    assert st == 200
    rows = {u["user"]: u for u in d["users"]}
    assert rows["kid"] == {"user": "kid", "role": "student", "subjects": ["biology-hl"]}
    assert rows["tester"] == {"user": "tester", "role": "student", "subjects": None}   # legacy account: no profile yet
    assert rows["other"]["role"] == "admin"
    blob = json.dumps(d)   # hashes never leave the server
    assert "$2y$" not in blob and PASSWORD not in blob
    assert call(server, "list-users", token=login(server, "tester"))[0] == 403
    assert call(server, "list-users")[0] == 401


@php
def test_set_profile_rev_history_and_gates(server):
    tok = login(server, "other")
    call(server, "create-user", {"username": "kid", "password": "kidpass123", "subjects": ["biology-hl"]}, tok)
    st, d, _ = call(server, "set-profile", {"user": "kid", "subjects": ["math-aa-sl", "history-sl"]}, tok)
    assert st == 200 and d == {"ok": True, "rev": 2}
    state = json.loads((server["data"] / "state" / "kid.json").read_text())
    assert state["rev"] == 2 and state["state"]["profile"]["subjects"] == ["math-aa-sl", "history-sl"]
    hist = list((server["data"] / "state" / "history" / "kid").glob("*.json"))
    assert len(hist) == 1
    prev = json.loads(hist[0].read_text())
    assert prev["rev"] == 1 and prev["state"]["profile"]["subjects"] == ["biology-hl"]
    # clearing subjects is a normal update
    assert call(server, "set-profile", {"user": "kid", "subjects": []}, tok)[0] == 200
    assert call(server, "set-profile", {"user": "ghost", "subjects": []}, tok)[0] == 404
    assert call(server, "set-profile", {"user": "kid", "subjects": "math-aa-sl"}, tok)[0] == 400
    assert call(server, "set-profile", {"user": "kid", "subjects": []}, login(server, "tester"))[0] == 403


@php
def test_no_profile_is_null_not_empty_in_list_users(server):
    # null = "no profile yet" (admin.html renders the default-all editor for it);
    # [] is an explicit hide-everything profile — the two must stay distinct
    tok = login(server, "other")
    st, d, _ = call(server, "list-users", token=tok)
    assert st == 200
    rows = {u["user"]: u for u in d["users"]}
    assert rows["tester"]["subjects"] is None
    assert call(server, "set-profile", {"user": "tester", "subjects": []}, tok)[0] == 200
    st, d, _ = call(server, "list-users", token=tok)
    assert st == 200
    rows = {u["user"]: u for u in d["users"]}
    assert rows["tester"]["subjects"] == []


@php
def test_create_user_without_subjects_seeds_no_profile(server):
    tok = login(server, "other")
    assert call(server, "create-user", {"username": "noprofile", "password": "kidpass123"}, tok)[0] == 200
    st, d, _ = call(server, "list-users", token=tok)
    assert st == 200
    rows = {u["user"]: u for u in d["users"]}
    assert rows["noprofile"]["subjects"] is None
    # the account's own first save creates the state file — still without a profile
    st, d, _ = call(server, "login", {"username": "noprofile", "password": "kidpass123"})
    assert st == 200
    assert call(server, "save-state", {"state": {"quizlog": [1]}}, d["token"])[0] == 200
    state = json.loads((server["data"] / "state" / "noprofile.json").read_text())
    assert "profile" not in state["state"]


@php
def test_save_state_ignores_client_profile_key(server):
    admin, tok = login(server, "other"), login(server, "tester")
    call(server, "set-profile", {"user": "tester", "subjects": ["biology-hl"]}, admin)
    # "profile" is admin-set only: a client pushing its local copy must not clobber it
    st, _, _ = call(server, "save-state", {"state": {"profile": {"subjects": ["math-aa-sl"]}, "quizlog": [1]}}, tok)
    assert st == 200
    state = json.loads((server["data"] / "state" / "tester.json").read_text())
    assert state["state"]["profile"]["subjects"] == ["biology-hl"]
    assert state["state"]["quizlog"] == [1]


@php
def test_username_of_only_dots_is_refused(server):
    # ".." passes the charset regex but would produce state/...json path oddities
    assert call(server, "setup", {"setup_key": "test-setup-key", "username": "..", "password": PASSWORD})[0] == 400
    tok = login(server, "other")
    assert call(server, "create-user", {"username": "..", "password": "kidpass123"}, tok)[0] == 400
