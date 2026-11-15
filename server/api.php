<?php
// Rametric practice app — auth + per-user state API.
// Shared-hosting safe: PHP sessions, JSON file storage, no database, no shell.
// Deploy inside public_html/nevaib/api/ ; state lives OUTSIDE the web root.

declare(strict_types=1);

session_set_cookie_params(["lifetime" => 60 * 60 * 24 * 30, "path" => "/", "httponly" => true, "secure" => $COOKIE_SECURE, "samesite" => "Lax"]);
session_start();
header("Content-Type: application/json; charset=utf-8");
header("X-Content-Type-Options: nosniff");

// ── configuration ────────────────────────────────────────────────────────────
// State directory: OUTSIDE public_html. Adjust to the cPanel home layout:
//   public_html/nevaib/api/api.php  →  $DATA_DIR = dirname(__DIR__, 3) . "/nevaib-data";
$DATA_DIR = dirname(__DIR__, 3) . "/nevaib-data";   // cPanel home: ~/nevaib-data (OUTSIDE public_html)
$USERS_FILE = $DATA_DIR . "/users.json";
$STATE_DIR = $DATA_DIR . "/state";
$SESSION_NAME = "nevaibsess";
$MAX_LOGIN_FAILS = 5;
// One-time account creation: set a long random key here, create accounts, then blank it.
$SETUP_KEY = "";  // e.g. "paste-a-long-random-string"; empty = setup disabled
$COOKIE_SECURE = ($_SERVER["HTTPS"] ?? "") !== "" || ($_SERVER["HTTP_X_FORWARDED_PROTO"] ?? "") === "https" || ($_SERVER["SERVER_PORT"] ?? "") === "443";

// ── helpers ──────────────────────────────────────────────────────────────────
function fail(string $msg, int $code = 400): never {
    http_response_code($code);
    echo json_encode(["ok" => false, "error" => $msg]);
    exit;
}
function ok(array $data = []): never {
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
function save_users(array $u): void {
    global $USERS_FILE;
    file_put_contents($USERS_FILE, json_encode($u, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE), LOCK_EX);
}
function state_path(string $user): string {
    global $STATE_DIR;
    return $STATE_DIR . "/" . preg_replace("/[^a-z0-9._-]/", "", strtolower($user)) . ".json";
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
    file_put_contents($f, json_encode($all), LOCK_EX);
}
function clear_fails(string $user): void {
    global $DATA_DIR;
    $f = $DATA_DIR . "/login-fails.json";
    $all = login_fails();
    unset($all[$user]);
    file_put_contents($f, json_encode($all), LOCK_EX);
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
    ok(["user" => $user]);
}

if ($action === "logout") {
    $_SESSION = [];
    session_destroy();
    ok([]);
}

if ($action === "me") {
    if (empty($_SESSION["user"])) ok(["user" => null]);
    ok(["user" => $_SESSION["user"]]);
}

// everything below requires a session
if (empty($_SESSION["user"])) fail("not logged in", 401);
$user = $_SESSION["user"];

if ($action === "get-state") {
    $p = state_path($user);
    if (!is_file($p)) { ok(["state" => null, "updated_at" => null]); }
    $raw = file_get_contents($p);
    $d = json_decode($raw, true);
    ok(["state" => $d["state"] ?? null, "updated_at" => $d["updated_at"] ?? null]);
}

if ($action === "save-state") {
    $body = json_decode(file_get_contents("php://input"), true);
    if (!is_array($body) || !isset($body["state"])) fail("missing 'state'");
    if (!is_array($body["state"])) fail("'state' must be an object");
    // light size guard (5 MB)
    $encoded = json_encode(["state" => $body["state"], "updated_at" => gmdate("c")], JSON_UNESCAPED_UNICODE);
    if (strlen($encoded) > 5 * 1024 * 1024) fail("state too large", 413);
    file_put_contents(state_path($user), $encoded, LOCK_EX);
    ok(["saved" => true, "updated_at" => gmdate("c")]);
}

fail("unknown action");
