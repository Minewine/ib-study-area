#!/usr/bin/env bash
# NevaIB developer helper. Run ./dev.sh help
set -euo pipefail
cd "$(dirname "$0")"

PORT="${PORT:-8018}"
DATA_DIR="${NEVAIB_DATA_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/nevaib-dev-data}"

usage() {
  cat <<'USAGE'
./dev.sh start [--lan]     serve the site + API locally (php -S + tools/dev_server.php)
                           on 127.0.0.1:$PORT (default 8018), dev data in
                           $NEVAIB_DATA_DIR (default ~/.cache/nevaib-dev-data).
                           Without php: static only (python http.server, no login).
                           --lan binds 0.0.0.0 and serves ONLY the built deploy/nevaib
                           copy (never the working tree: .git, deploy/.ftp-credentials).
./dev.sh adduser NAME      create/replace a dev account in the dev data dir
                           (student by default; adduser --admin NAME for admin)
./dev.sh test              python tests (pytest) + JS tests (node --test) + php -l
./dev.sh e2e               headless-Chrome end-to-end run (tests/e2e; needs npm + Chrome)
./dev.sh validate          content validator (tools/validate_content.py)
./dev.sh build             regenerate pages (build_site.py) and the deploy folder
./dev.sh deploy [--confirm] [--prune]
                           push_deploy.py --rebuild --dry-run (default: shows what would
                           change, uploads nothing). A real upload needs --confirm.
USAGE
}

have() { command -v "$1" >/dev/null 2>&1; }

cmd_start() {
  local lan=0
  [[ "${1:-}" == "--lan" ]] && lan=1
  if [[ $lan == 1 ]]; then
    echo "WARNING: --lan makes the site reachable from every device on this network over plain HTTP." >&2
    echo "         Serving only the built copy in deploy/nevaib (rebuilding it now)." >&2
    python3 -I tools/build_deploy.py >/dev/null
    mkdir -p "$DATA_DIR/state"
    if have php; then
      echo "http://0.0.0.0:$PORT/index.html  (API: /api/api.php, data: $DATA_DIR)"
      NEVAIB_DATA_DIR="$DATA_DIR" exec php -S "0.0.0.0:$PORT" -t deploy/nevaib
    fi
    exec python3 -m http.server "$PORT" --bind 0.0.0.0 --directory deploy/nevaib
  fi
  if have php; then
    mkdir -p "$DATA_DIR/state"
    echo "http://127.0.0.1:$PORT/index.html — practice app: /app/index.html"
    echo "API: http://127.0.0.1:$PORT/api/api.php (data: $DATA_DIR; create a login with ./dev.sh adduser NAME)"
    echo "Open a page once with ?nbapi=/api/api.php to point it at this local API (localhost only; ?nbapi= resets)."
    NEVAIB_DATA_DIR="$DATA_DIR" exec php -S "127.0.0.1:$PORT" -t . tools/dev_server.php
  fi
  echo "php not found — static only (no login/sync): http://127.0.0.1:$PORT/index.html"
  exec python3 -m http.server "$PORT" --bind 127.0.0.1
}

cmd_adduser() {
  local role="student"
  if [[ "${1:-}" == "--admin" ]]; then role="admin"; shift; fi
  local name="${1:-}"
  [[ -n "$name" ]] || { echo "usage: ./dev.sh adduser [--admin] NAME" >&2; exit 2; }
  have php || { echo "php is required" >&2; exit 1; }
  [[ "$name" =~ ^[a-z0-9._-]{2,30}$ ]] || { echo "NAME: 2-30 chars, lowercase letters/digits/._-" >&2; exit 2; }
  mkdir -p "$DATA_DIR/state"
  read -rsp "password for $name (8+ chars): " pw; echo
  [[ ${#pw} -ge 8 ]] || { echo "too short" >&2; exit 2; }
  # new-format record {"h": ..., "role": ...}; the decode/encode round-trip carries
  # every other entry (including legacy plain-string hashes) through untouched
  NB_USER="$name" NB_PASS="$pw" NB_ROLE="$role" NB_FILE="$DATA_DIR/users.json" php -r '
    $f = getenv("NB_FILE"); $u = is_file($f) ? json_decode(file_get_contents($f), true) : [];
    if (!is_array($u)) $u = [];
    $u[getenv("NB_USER")] = ["h" => password_hash(getenv("NB_PASS"), PASSWORD_DEFAULT), "role" => getenv("NB_ROLE")];
    file_put_contents($f, json_encode($u, JSON_PRETTY_PRINT));'
  echo "dev account '$name' ($role) saved in $DATA_DIR/users.json"
}

cmd_test() {
  local rc=0
  echo "== python (pytest)"
  if have uv; then uv run pytest -q || rc=1; else python3 -m pytest -q || rc=1; fi
  echo "== javascript (node --test)"
  if have node; then node --test tests/js/*.test.js || rc=1; else echo "node not found — JS tests skipped" >&2; rc=1; fi
  echo "== php -l"
  if have php; then for f in server/*.php tools/*.php; do php -l "$f" >/dev/null || rc=1; done; echo "php syntax ok"
  else echo "php not found — PHP lint and API tests skipped" >&2; fi
  for f in assets/*.js; do node --check "$f" || rc=1; done
  [[ $rc == 0 ]] && echo "ALL TESTS PASSED" || echo "SOME TESTS FAILED" >&2
  return $rc
}

cmd_e2e() {
  have node || { echo "node is required" >&2; exit 1; }
  [[ -d tests/e2e/node_modules ]] || npm install --prefix tests/e2e --no-audit --no-fund
  node tests/e2e/e2e.js
}

cmd_validate() { python3 -I tools/validate_content.py; }

cmd_build() {
  python3 -I tools/build_site.py
  if [[ -d library/notes ]]; then python3 -I tools/build_library_manifest.py
  else echo "library/notes not present — keeping the committed library-manifest.json"; fi
  python3 -I tools/build_deploy.py
}

cmd_deploy() {
  local confirm=0 extra=()
  for a in "$@"; do
    case "$a" in
      --confirm) confirm=1 ;;
      --prune) extra+=(--prune) ;;
      *) echo "unknown option $a" >&2; exit 2 ;;
    esac
  done
  if [[ $confirm == 1 ]]; then
    echo "Real deploy to rametric.com/nevaib. Upload api/api.php before or with the assets (DEPLOY.md)."
    read -rp "Type DEPLOY to continue: " ans
    [[ "$ans" == "DEPLOY" ]] || { echo "aborted"; exit 1; }
    exec python3 -I tools/push_deploy.py --rebuild "${extra[@]}"
  fi
  exec python3 -I tools/push_deploy.py --rebuild --dry-run "${extra[@]}"
}

case "${1:-help}" in
  start) shift; cmd_start "$@" ;;
  adduser) shift; cmd_adduser "$@" ;;
  test) cmd_test ;;
  e2e) cmd_e2e ;;
  validate) cmd_validate ;;
  build) cmd_build ;;
  deploy) shift; cmd_deploy "$@" ;;
  help|-h|--help) usage ;;
  *) usage; exit 2 ;;
esac
