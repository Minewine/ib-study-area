"""PHP API tests: server/api.php behind tools/dev_server.php on php -S with a temp
data dir. Skipped when no php binary is on PATH (CI installs one).

Covers auth, get/save, revisions + 409 on a stale base, partial saves keeping
other keys, legacy (rev-less) files and clients, history rotation and retrieval,
export, atomic writes, refusing to overwrite an unreadable file, lockout, and a
PHP 7.2 syntax guard (the host runs 7.2)."""

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
