"""Build and push deploy/nevaib/ to rametric.com/nevaib over FTPS.

Run:  python3 -I tools/push_deploy.py [--rebuild] [--prune] [--dry-run]

  --rebuild   run tools/build_deploy.py first (fresh deploy/ from the repo)
  --prune     also delete remote files that are no longer in the build
  --dry-run   show what would be uploaded/deleted, touch nothing
  --allow-setup-key
              refuse-by-default to push an api.php with an armed $SETUP_KEY
              (re-enabling public account creation). Pass this flag only when
              you deliberately want setup mode back on.

Credentials (FTP account scoped to public_html/nevaib, created in cPanel):
  env  NEVAIB_FTP_HOST / NEVAIB_FTP_USER / NEVAIB_FTP_PASS   take precedence,
  else a deploy/.ftp-credentials file with HOST=/USER=/PASS= lines.
The login is user@rametric.com (cPanel FTP convention).
"""

import argparse
import calendar
import ftplib
import os
import re
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "deploy" / "nevaib"
CRED_FILE = ROOT / "deploy" / ".ftp-credentials"
DEFAULT_HOST = "ftp.rametric.com"


def api_is_armed(api_text: str) -> bool:
    """True when the built api.php enables public account creation.

    That is exactly a non-empty quoted literal assigned to $SETUP_KEY itself
    (the ARMED_KEY_LINE baked by build_deploy.py). The NEVAIB_SETUP_KEY
    env-override lines are never "armed" — they only matter on hosts where
    someone deliberately set the environment variable — and a blank key is
    not armed. The old startswith/'""' heuristic false-positived on the
    env-override line ($SETUP_KEY_ENV = getenv(...)) and blocked deploys.
    """
    return any(
        re.search(r'\$SETUP_KEY\s*=\s*"[^"]+"', line)
        for line in api_text.splitlines()
    )


def parse_mdtm(raw: str) -> int | None:
    """'213 20261115095312' or '20261115095312' → epoch seconds (UTC)."""
    parts = raw.split()
    if not parts:
        return None
    stamp = parts[-1]
    if len(stamp) != 14 or not stamp.isdigit():
        return None
    return calendar.timegm(
        (
            int(stamp[0:4]),
            int(stamp[4:6]),
            int(stamp[6:8]),
            int(stamp[8:10]),
            int(stamp[10:12]),
            int(stamp[12:14]),
            0,
            0,
            0,
        )
    )


def load_credentials(env: dict[str, str], cred_file: Path) -> tuple[str, str, str]:
    """HOST, USER, PASS from env vars, else from the gitignored cred file."""
    host, user, pw = (
        env.get("NEVAIB_FTP_HOST"),
        env.get("NEVAIB_FTP_USER"),
        env.get("NEVAIB_FTP_PASS"),
    )
    if user and pw:
        return host or DEFAULT_HOST, user, pw
    if cred_file.exists():
        vals = {}
        for line in cred_file.read_text(encoding="utf-8").splitlines():
            if "=" in line:
                k, _, v = line.partition("=")
                vals[k.strip().upper()] = v.strip()
        host = host or vals.get("HOST") or DEFAULT_HOST
        user = user or vals.get("USER")
        pw = pw or vals.get("PASS")
        if user and pw:
            return host, user, pw
    sys.exit(
        "No FTP credentials found.\n"
        "Set NEVAIB_FTP_HOST / NEVAIB_FTP_USER / NEVAIB_FTP_PASS, or create\n"
        f"{cred_file} with HOST=/USER=/PASS= lines (the FTP login is\n"
        "user@rametric.com, account scoped to public_html/nevaib)."
    )


def collect_local(out: Path) -> dict[str, tuple[int, int]]:
    """relpath → (size, mtime) for every file in the built folder."""
    files: dict[str, tuple[int, int]] = {}
    for f in sorted(out.rglob("*")):
        if f.is_file():
            st = f.stat()
            files[f.relative_to(out).as_posix()] = (st.st_size, int(st.st_mtime))
    return files


def remote_walk(ftp: ftplib.FTP_TLS) -> dict[str, tuple[int, int]] | None:
    """Recursive relpath → (size, mtime) via MLSD; None if unsupported."""
    try:
        result: dict[str, tuple[int, int]] = {}

        def walk(dirpath: str, relprefix: str) -> None:
            for name, facts in ftp.mlsd(dirpath):
                if facts.get("type") not in ("file", "dir", "cdir", "pdir"):
                    continue
                rel = f"{relprefix}{name}"
                if facts.get("type") == "dir":
                    walk(f"{dirpath}/{name}", f"{rel}/")
                elif facts.get("type") == "file":
                    size = int(facts.get("size", -1))
                    mtime = parse_mdtm(facts.get("modify", ""))
                    result[rel] = (size, mtime if mtime is not None else 0)

        walk(".", "")
        return result
    except ftplib.all_errors:
        return None


def plan_sync(
    local: dict[str, tuple[int, int]], remote: dict[str, tuple[int, int]] | None
) -> tuple[list[str], list[str]]:
    """→ (relpaths to upload, relpaths skipped as unchanged)."""
    if remote is None:
        return sorted(local), []
    upload, skip = [], []
    for rel, (size, mtime) in local.items():
        rsize, rmtime = remote.get(rel, (-1, -1))
        if size == rsize and mtime == rmtime:
            skip.append(rel)
        else:
            upload.append(rel)
    return upload, skip


def ensure_dirs(ftp: ftplib.FTP_TLS, relpath: str) -> None:
    parts = relpath.split("/")[:-1]
    path = ""
    for part in parts:
        path = f"{path}/{part}" if path else part
        try:
            ftp.mkd(path)
        except ftplib.all_errors:
            pass  # exists (or unusable) — STOR will surface real errors


def set_remote_mtime(ftp: ftplib.FTP_TLS, relpath: str, mtime: int) -> None:
    """Stamp the uploaded file so skip-unchanged works on the next push."""
    stamp = time.strftime("%Y%m%d%H%M%S", time.gmtime(mtime))
    try:
        ftp.voidcmd(f"MFMT {stamp} {relpath}")
    except ftplib.all_errors:
        try:
            ftp.voidcmd(f"SITE UTIME {relpath} {stamp}")
        except ftplib.all_errors:
            pass  # server lacks both — pushes stay correct, just less skippy


def push(
    ftp: ftplib.FTP_TLS,
    out: Path,
    dry_run: bool = False,
    prune: bool = False,
) -> dict[str, list[str]]:
    local = collect_local(out)
    remote = remote_walk(ftp)
    upload, skip = plan_sync(local, remote)
    deleted: list[str] = []
    if prune and remote is not None:
        deleted = sorted(set(remote) - set(local))
    if dry_run:
        return {
            "uploaded": upload,
            "skipped": skip,
            "deleted": deleted,
            "dry_run": ["1"],
        }
    for rel in upload:
        ensure_dirs(ftp, rel)
        with (out / rel).open("rb") as fh:
            ftp.storbinary(f"STOR {rel}", fh)
        set_remote_mtime(ftp, rel, local[rel][1])
    if prune and remote is not None:
        for rel in deleted:
            try:
                ftp.delete(rel)
            except ftplib.all_errors as e:
                print(f"  ! could not delete {rel}: {e}")
    return {"uploaded": upload, "skipped": skip, "deleted": deleted, "dry_run": []}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument(
        "--rebuild", action="store_true", help="run tools/build_deploy.py first"
    )
    ap.add_argument(
        "--prune",
        action="store_true",
        help="delete remote files no longer in the build",
    )
    ap.add_argument(
        "--dry-run",
        action="store_true",
        help="show the plan without touching the server",
    )
    ap.add_argument(
        "--allow-setup-key",
        action="store_true",
        help="permit pushing an api.php with an armed $SETUP_KEY",
    )
    args = ap.parse_args()

    if args.rebuild:
        subprocess.run(
            [sys.executable, "-I", str(ROOT / "tools/build_deploy.py")], check=True
        )
    if not OUT.is_dir():
        sys.exit(
            f"{OUT} missing — run with --rebuild or python3 -I tools/build_deploy.py"
        )

    api = (OUT / "api/api.php").read_text(encoding="utf-8")
    if api_is_armed(api) and not args.allow_setup_key:
        sys.exit(
            "deploy/nevaib/api/api.php has an ARMED $SETUP_KEY — pushing it would\n"
            "re-enable public account creation. Delete deploy/.setup-key and\n"
            "rebuild, or pass --allow-setup-key if you really mean it."
        )

    host, user, pw = load_credentials(dict(os.environ), CRED_FILE)
    ftp = ftplib.FTP_TLS(host, timeout=30)
    ftp.login(user, pw)
    ftp.prot_p()

    if args.dry_run:
        plan = push(ftp, OUT, dry_run=True, prune=args.prune)
        ftp.quit()
        print(
            f"dry run: {len(plan['uploaded'])} to upload, {len(plan['skipped'])} unchanged, "
            f"{len(plan['deleted'])} to delete"
        )
        for rel in plan["uploaded"]:
            print("  ↑", rel)
        for rel in plan["deleted"]:
            print("  ✕", rel)
        return

    result = push(ftp, OUT, prune=args.prune)
    ftp.quit()
    print(
        f"pushed: {len(result['uploaded'])} uploaded, {len(result['skipped'])} unchanged, "
        f"{len(result['deleted'])} deleted"
    )
    for rel in result["uploaded"]:
        print("  ↑", rel)


if __name__ == "__main__":
    main()
