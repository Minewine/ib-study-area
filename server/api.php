<?php
// Rametric practice app — auth + per-user state API.
// Shared-hosting safe: PHP sessions, JSON file storage, no database, no shell.
// Deploy inside public_html/nevaib/api/ ; state lives OUTSIDE the web root.

declare(strict_types=1);

$COOKIE_SECURE = ($_SERVER["HTTPS"] ?? "") !== "" || ($_SERVER["HTTP_X_FORWARDED_PROTO"] ?? "") === "https" || ($_SERVER["SERVER_PORT"] ?? "") === "443";
// positional form (PHP 7.2 compatible; the array form needs 7.3+). No SameSite
// attribute on 7.2 — modern browsers treat a SameSite-less cookie as Lax, which
// is the behaviour we want; cross-origin callers use the token header instead.
session_set_cookie_params(60 * 60 * 24 * 30, "/", "", $COOKIE_SECURE, true);
session_start();
header("Content-Type: application/json; charset=utf-8");
header("X-Content-Type-Options: nosniff");

// ── CORS: the study site runs on other origins (localhost dev etc.) where
// cookies can never cross — those callers authenticate by token instead.
// Preflights carry no credentials, so answer them before any auth logic.
$ORIGIN = $_SERVER["HTTP_ORIGIN"] ?? "";
if ($ORIGIN !== "" && (preg_match("/^https:\/\/(www\.)?rametric\.com$/", $ORIGIN)
    || preg_match("/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/", $ORIGIN)
    // LAN study-site use (DEPLOY.md option A): the token, not CORS, is the auth gate
    || preg_match("/^http:\/\/(192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?$/", $ORIGIN))) {
    header("Access-Control-Allow-Origin: " . $ORIGIN);
    header("Vary: Origin");
}
if (($_SERVER["REQUEST_METHOD"] ?? "") === "OPTIONS") {
    header("Access-Control-Allow-Methods: GET, POST, OPTIONS");
    header("Access-Control-Allow-Headers: Content-Type, X-Nevaib-Token");
    header("Access-Control-Max-Age: 86400");
    http_response_code(204);
    exit;
}

// ── configuration ────────────────────────────────────────────────────────────
// State directory: OUTSIDE public_html. Adjust to the cPanel home layout:
//   public_html/nevaib/api/api.php  →  $DATA_DIR = dirname(__DIR__, 3) . "/nevaib-data";
$DATA_DIR = getenv("NEVAIB_DATA_DIR") ?: (dirname(__DIR__, 3) . "/nevaib-data");   // cPanel home: ~/nevaib-data (OUTSIDE public_html); NEVAIB_DATA_DIR overrides for local testing
$USERS_FILE = $DATA_DIR . "/users.json";
$STATE_DIR = $DATA_DIR . "/state";
$SESSION_NAME = "nevaibsess";
$MAX_LOGIN_FAILS = 5;
$TOKEN_TTL = 90 * 86400;  // login tokens expire after 90 days
// One-time account creation: set a long random key here, create accounts, then blank it.
$SETUP_KEY = "";  // e.g. "paste-a-long-random-string"; empty = setup disabled
$HISTORY_KEEP = 30;  // previous versions kept per user in state/history/<user>/

// ── helpers ──────────────────────────────────────────────────────────────────
function fail(string $msg, int $code = 400) {   // PHP 7.2 target: no "never" return type (8.1+)
    http_response_code($code);
    echo json_encode(["ok" => false, "error" => $msg]);
    exit;
}
function ok(array $data = []) {
    echo json_encode(["ok" => true] + $data);
    exit;
}
function data_dir(): string {
    global $DATA_DIR, $STATE_DIR, $USERS_FILE;
    foreach ([$DATA_DIR, $STATE_DIR] as $d) {
        if (!is_dir($d)) { mkdir($d, 0770, true); }
    }
    return $DATA_DIR;
}
function users(): array {
    global $USERS_FILE;
    if (!is_file($USERS_FILE)) return [];
    $raw = file_get_contents($USERS_FILE);
    $arr = json_decode($raw, true);
    return is_array($arr) ? $arr : [];
}
// Write via a temp file in the same directory + rename(): readers see either the
// old or the new file, never a truncated one (file_put_contents truncates first).
function write_atomic(string $path, string $data): bool {
    $tmp = $path . ".tmp-" . bin2hex(random_bytes(6));
    if (file_put_contents($tmp, $data, LOCK_EX) !== strlen($data)) { @unlink($tmp); return false; }
    @chmod($tmp, 0660);
    if (!@rename($tmp, $path)) { @unlink($tmp); return false; }
    return true;
}
function save_users(array $u): void {
    global $USERS_FILE;
    write_atomic($USERS_FILE, json_encode($u, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
}
function safe_user(string $user): string {
    return preg_replace("/[^a-z0-9._-]/", "", strtolower($user));
}
function state_path(string $user): string {
    global $STATE_DIR;
    return $STATE_DIR . "/" . safe_user($user) . ".json";
}
function history_dir(string $user): string {
    global $STATE_DIR;
    return $STATE_DIR . "/history/" . safe_user($user);
}
// Stored file: {"state": {...}, "updated_at": "...", "rev": N}. Files written before
// revisions existed have no "rev" and read as rev 0 — no migration step needed.
function read_state(string $user): array {
    $p = state_path($user);
    if (!is_file($p)) return ["state" => null, "updated_at" => null, "rev" => 0, "exists" => false];
    $d = json_decode((string)file_get_contents($p), true);
    if (!is_array($d)) fail("stored state is unreadable — not overwriting it; restore from state/history", 500);
    $st = (isset($d["state"]) && is_array($d["state"])) ? $d["state"] : null;
    return ["state" => $st, "updated_at" => $d["updated_at"] ?? null, "rev" => (int)($d["rev"] ?? 0), "exists" => true];
}
// keep the newest $keep snapshots of a user's state file
function prune_history(string $dir, int $keep): void {
    $files = glob($dir . "/*.json");
    if (!is_array($files) || count($files) <= $keep) return;
    sort($files);
    foreach (array_slice($files, 0, count($files) - $keep) as $f) @unlink($f);
}
function history_list(string $user): array {
    $files = glob(history_dir($user) . "/*.json");
    if (!is_array($files)) return [];
    rsort($files);
    $out = [];
    foreach ($files as $f) $out[] = ["name" => basename($f), "bytes" => filesize($f)];
    return $out;
}
function login_fails(): array {
    global $DATA_DIR;
    $f = $DATA_DIR . "/login-fails.json";
    if (!is_file($f)) return [];
    $d = json_decode(file_get_contents($f), true);
    return is_array($d) ? $d : [];
}
function record_fail(string $user): void {
    global $DATA_DIR;
    $f = $DATA_DIR . "/login-fails.json";
    $all = login_fails();
    $entry = $all[$user] ?? ["count" => 0, "last" => 0];
    if (!is_array($entry)) $entry = ["count" => 0, "last" => 0];
    $entry["count"] = ($entry["count"] ?? 0) + 1;
    $entry["last"] = time();
    $all[$user] = $entry;
    write_atomic($f, json_encode($all));
}
function clear_fails(string $user): void {
    global $DATA_DIR;
    $f = $DATA_DIR . "/login-fails.json";
    $all = login_fails();
    unset($all[$user]);
    write_atomic($f, json_encode($all));
}
function tokens(): array {
    global $DATA_DIR;
    $f = $DATA_DIR . "/tokens.json";
    if (!is_file($f)) return [];
    $d = json_decode(file_get_contents($f), true);
    return is_array($d) ? $d : [];
}
function save_tokens(array $t): void {
    global $DATA_DIR;
    write_atomic($DATA_DIR . "/tokens.json", json_encode($t, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
}

data_dir();

// accept both JSON and form-encoded bodies
$JSON_BODY = json_decode(file_get_contents("php://input"), true);
if (!is_array($JSON_BODY)) $JSON_BODY = $_POST;

$action = $_GET["action"] ?? ($_POST["action"] ?? "");

// ── one-time setup: create accounts (requires SETUP_KEY in this file) ───────
if ($action === "setup") {
    global $SETUP_KEY;
    $key = (string)($JSON_BODY["setup_key"] ?? "");
    if ($SETUP_KEY === "" || !hash_equals($SETUP_KEY, $key)) fail("setup disabled or wrong key", 403);
    $user = trim((string)($JSON_BODY["username"] ?? ""));
    $pass = (string)($JSON_BODY["password"] ?? "");
    if (!preg_match("/^[a-z0-9._-]{2,30}$/", $user)) fail("username: 2-30 chars, lowercase letters/digits/._-");
    if (strlen($pass) < 8) fail("password: at least 8 characters");
    $users = users();
    if (isset($users[$user])) fail("user already exists", 409);
    $users[$user] = password_hash($pass, PASSWORD_DEFAULT);
    save_users($users);
    ok(["created" => $user]);
}



// ── actions ──────────────────────────────────────────────────────────────────
if ($action === "login") {
    $user = trim((string)($JSON_BODY["username"] ?? ""));
    $pass = (string)($JSON_BODY["password"] ?? "");
    if ($user === "" || $pass === "") fail("username and password required");
    $fails = login_fails();
    if (($fails[$user]["count"] ?? 0) >= $GLOBALS["MAX_LOGIN_FAILS"]
        && (time() - ($fails[$user]["last"] ?? 0)) < 300) {
        fail("too many failed attempts — wait 5 minutes", 429);
    }
    $users = users();
    if (!isset($users[$user]) || !password_verify($pass, $users[$user])) {
        record_fail($user);
        usleep(300000); // slow brute force slightly
        fail("wrong username or password", 401);
    }
    clear_fails($user);
    session_regenerate_id(true);
    $_SESSION["user"] = $user;
    // token for cross-origin callers — cookies can't cross origins (SameSite)
    $token = bin2hex(random_bytes(32));
    $tokens = array_filter(tokens(), function ($e) { return (time() - (int)($e["t"] ?? 0)) < $GLOBALS["TOKEN_TTL"]; }); // prune expired
    $tokens[hash("sha256", $token)] = ["u" => $user, "t" => time()];
    $mine = array_keys(array_filter($tokens, function ($e) use ($user) { return ($e["u"] ?? "") === $user; }));
    if (count($mine) > 8) {   // keep at most 8 tokens per user — drop the oldest
        usort($mine, function ($a, $b) use ($tokens) { return $tokens[$a]["t"] <=> $tokens[$b]["t"]; });
        foreach (array_slice($mine, 0, count($mine) - 8) as $h) unset($tokens[$h]);
    }
    save_tokens($tokens);
    ok(["user" => $user, "token" => $token]);
}

if ($action === "logout") {
    $tok = (string)($_SERVER["HTTP_X_NEVAIB_TOKEN"] ?? "");
    if ($tok !== "") {   // retire the presented token alongside the session
        $tokens = tokens();
        $h = hash("sha256", $tok);
        if (isset($tokens[$h])) { unset($tokens[$h]); save_tokens($tokens); }
    }
    $_SESSION = [];
    session_destroy();
    ok([]);
}

// resolve the caller: PHP session, else X-Nevaib-Token header (tokens expire after 90 days)
$user = $_SESSION["user"] ?? null;
if (!$user) {
    $tok = (string)($_SERVER["HTTP_X_NEVAIB_TOKEN"] ?? "");
    $all = $tok === "" ? [] : tokens();
    $h = hash("sha256", $tok);
    if (isset($all[$h]) && (time() - (int)$all[$h]["t"]) < $TOKEN_TTL) $user = (string)$all[$h]["u"];
}

if ($action === "me") {
    ok(["user" => $user ?: null]);
}

// everything below requires a resolved user
if (empty($user)) fail("not logged in", 401);

if ($action === "get-state") {
    $cur = read_state($user);
    ok(["state" => $cur["state"], "updated_at" => $cur["updated_at"], "rev" => $cur["rev"]]);
}

if ($action === "save-state") {
    global $HISTORY_KEEP;
    $body = json_decode(file_get_contents("php://input"), true);
    if (!is_array($body) || !isset($body["state"])) fail("missing 'state'");
    if (!is_array($body["state"])) fail("'state' must be an object");
    $incoming = $body["state"];

    // one writer at a time per user: read-check-write happens under this lock
    $lock = fopen(state_path($user) . ".lock", "c");
    if ($lock === false || !flock($lock, LOCK_EX)) fail("could not lock state", 503);
    $cur = read_state($user);

    // Optimistic concurrency: a client that sends base_rev must have seen the current
    // revision, otherwise it gets 409 + the current state, merges, and retries.
    // Clients that send no base_rev (older cached auth.js) keep the old behaviour.
    if (array_key_exists("base_rev", $body) && $body["base_rev"] !== null && (int)$body["base_rev"] !== $cur["rev"]) {
        http_response_code(409);
        echo json_encode(["ok" => false, "error" => "conflict: state changed on another device",
            "rev" => $cur["rev"], "updated_at" => $cur["updated_at"], "state" => $cur["state"]], JSON_UNESCAPED_UNICODE);
        exit;
    }

    // Keep stored top-level keys the client didn't send. Clients never delete a synced
    // key, so a missing key only means "this client version doesn't know it" (e.g. a
    // cached older auth.js without q-errors) or a partial push of changed keys only.
    if (is_array($cur["state"])) {
        foreach ($cur["state"] as $k => $v) {
            if (!array_key_exists($k, $incoming)) $incoming[$k] = $v;
        }
    }
    $rev = $cur["rev"] + 1;
    $now = gmdate("c");
    $encoded = json_encode(["state" => (object)$incoming, "updated_at" => $now, "rev" => $rev], JSON_UNESCAPED_UNICODE);
    if ($encoded === false) fail("state could not be encoded", 400);
    if (strlen($encoded) > 5 * 1024 * 1024) fail("state too large", 413); // light size guard (5 MB)

    // previous version → history (kept: newest $HISTORY_KEEP)
    if ($cur["exists"]) {
        $hd = history_dir($user);
        if (!is_dir($hd)) mkdir($hd, 0770, true);
        $name = $hd . "/" . gmdate("Ymd\THis") . "-r" . str_pad((string)$cur["rev"], 6, "0", STR_PAD_LEFT) . ".json";
        if (!@copy(state_path($user), $name)) fail("could not keep the previous version — not saving", 500);
        prune_history($hd, $HISTORY_KEEP);
    }
    if (!write_atomic(state_path($user), $encoded)) fail("could not write state", 500);
    flock($lock, LOCK_UN);
    fclose($lock);
    ok(["saved" => true, "updated_at" => $now, "rev" => $rev]);
}

// full copy of this user's stored state (for backups — replaces the temporary dumper)
if ($action === "export") {
    $cur = read_state($user);
    header("Content-Disposition: attachment; filename=\"nevaib-" . safe_user($user) . "-" . gmdate("Ymd-His") . ".json\"");
    echo json_encode(["ok" => true, "format" => "nevaib-server-export", "user" => $user,
        "exported_at" => gmdate("c"), "rev" => $cur["rev"], "updated_at" => $cur["updated_at"],
        "state" => $cur["state"], "history" => history_list($user)], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
    exit;
}

// previous versions: ?action=history lists them, ?action=history&name=<file> returns one
if ($action === "history") {
    $name = (string)($_GET["name"] ?? "");
    if ($name === "") ok(["history" => history_list($user)]);
    if (!preg_match('/^\d{8}T\d{6}-r\d{6,}\.json$/', $name)) fail("bad name");
    $f = history_dir($user) . "/" . $name;
    if (!is_file($f)) fail("not found", 404);
    $d = json_decode((string)file_get_contents($f), true);
    ok(["name" => $name, "state" => $d["state"] ?? null, "updated_at" => $d["updated_at"] ?? null, "rev" => (int)($d["rev"] ?? 0)]);
}

fail("unknown action");
