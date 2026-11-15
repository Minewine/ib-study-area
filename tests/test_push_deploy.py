"""Tests for tools/push_deploy.py (offline logic only — no network)."""

import importlib.util
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent

spec = importlib.util.spec_from_file_location(
    "push_deploy", ROOT / "tools" / "push_deploy.py"
)
push_deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(push_deploy)  # safe: network work lives under main()


# ---------- parse_mdtm ----------


def test_parse_mdtm_with_code_prefix():
    assert push_deploy.parse_mdtm("213 20261115095312") == 1794736392


def test_parse_mdtm_plain_stamp():
    assert push_deploy.parse_mdtm("20260101000000") == 1767225600


def test_parse_mdtm_garbage_returns_none():
    assert push_deploy.parse_mdtm("213 not-a-date") is None
    assert push_deploy.parse_mdtm("") is None


# ---------- load_credentials ----------


def test_credentials_from_env():
    env = {
        "NEVAIB_FTP_HOST": "ftp.example.com",
        "NEVAIB_FTP_USER": "u",
        "NEVAIB_FTP_PASS": "p",
    }
    assert push_deploy.load_credentials(env, ROOT / "deploy" / "no-such-file") == (
        "ftp.example.com",
        "u",
        "p",
    )


def test_credentials_env_host_default(monkeypatch):
    assert push_deploy.load_credentials(
        {"NEVAIB_FTP_USER": "u", "NEVAIB_FTP_PASS": "p"},
        ROOT / "deploy" / "no-such-file",
    ) == ("ftp.rametric.com", "u", "p")


def test_credentials_from_file(tmp_path):
    f = tmp_path / ".ftp-credentials"
    f.write_text(
        "HOST=ftp.example.com\nUSER=fileuser\nPASS=filepass\n", encoding="utf-8"
    )
    assert push_deploy.load_credentials({}, f) == (
        "ftp.example.com",
        "fileuser",
        "filepass",
    )


def test_credentials_env_beats_file(tmp_path):
    f = tmp_path / ".ftp-credentials"
    f.write_text("USER=fileuser\nPASS=filepass\n", encoding="utf-8")
    env = {"NEVAIB_FTP_USER": "envuser", "NEVAIB_FTP_PASS": "envpass"}
    assert push_deploy.load_credentials(env, f) == (
        "ftp.rametric.com",
        "envuser",
        "envpass",
    )


def test_credentials_missing_exits_with_instructions(tmp_path, monkeypatch):
    for var in ("NEVAIB_FTP_HOST", "NEVAIB_FTP_USER", "NEVAIB_FTP_PASS"):
        monkeypatch.delenv(var, raising=False)
    with pytest.raises(SystemExit) as exc:
        push_deploy.load_credentials({}, tmp_path / "missing")
    assert "NEVAIB_FTP_USER" in str(exc.value)


# ---------- plan_sync ----------


def test_plan_sync_remote_unsupported_uploads_all():
    local = {"a.html": (1, 1), "b.js": (2, 2)}
    assert push_deploy.plan_sync(local, None) == (["a.html", "b.js"], [])


def test_plan_sync_skips_unchanged():
    local = {"same.html": (10, 100), "new.html": (5, 200)}
    remote = {"same.html": (10, 100)}
    assert push_deploy.plan_sync(local, remote) == (["new.html"], ["same.html"])


def test_plan_sync_reuploads_changed():
    local = {"changed.js": (10, 100)}
    remote = {"changed.js": (10, 99)}  # same size, older mtime → changed
    assert push_deploy.plan_sync(local, remote) == (["changed.js"], [])


# ---------- collect_local ----------


def test_collect_local_maps_relative_posix_paths(tmp_path):
    (tmp_path / "sub").mkdir()
    (tmp_path / "top.html").write_text("x")
    (tmp_path / "sub" / "n.json").write_text("y")
    files = push_deploy.collect_local(tmp_path)
    assert set(files) == {"top.html", "sub/n.json"}
    assert all(isinstance(v, tuple) and len(v) == 2 for v in files.values())


# ---------- push dry-run (no server writes) ----------


class _NoMlsdStub:
    """FTP stub whose MLSD fails → remote listing unavailable."""

    def mlsd(self, path):
        raise OSError("MLSD unsupported")


def test_push_dry_run_touches_nothing(tmp_path):
    (tmp_path / "index.html").write_text("hello")
    plan = push_deploy.push(_NoMlsdStub(), tmp_path, dry_run=True)
    assert plan["uploaded"] == ["index.html"]
    assert plan["skipped"] == []
    assert plan["deleted"] == []
    assert plan["dry_run"]  # marks the plan as a dry run


# ---------- set_remote_mtime ----------


class _RecordingStub:
    def __init__(self, fail_after=10):
        self.commands = []
        self.fail_after = fail_after

    def voidcmd(self, cmd):
        self.commands.append(cmd)
        if len(self.commands) > self.fail_after:
            raise OSError("unsupported")


def test_set_remote_mtime_sends_mfmt_utc():
    ftp = _RecordingStub()
    push_deploy.set_remote_mtime(ftp, "index.html", 1794736392)
    assert ftp.commands == ["MFMT 20261115095312 index.html"]


def test_set_remote_mtime_falls_back_to_site_utime():
    ftp = _RecordingStub(fail_after=0)
    push_deploy.set_remote_mtime(ftp, "a.js", 0)
    assert ftp.commands[0] == "MFMT 19700101000000 a.js"
    assert ftp.commands[1] == "SITE UTIME a.js 19700101000000"


def test_set_remote_mtime_swallows_total_failure():
    ftp = _RecordingStub(fail_after=0)
    ftp.voidcmd = lambda cmd: (_ for _ in ()).throw(OSError("no"))
    push_deploy.set_remote_mtime(ftp, "x", 1)  # must not raise


if __name__ == "__main__":
    sys.exit(pytest.main([__file__]))
