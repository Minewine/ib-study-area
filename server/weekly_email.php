<?php
// Weekly summary e-mail for a parent — run from cron (CLI only, never over the web).
//
//   php ~/public_html/nevaib/api/weekly_email.php            # send
//   php ~/public_html/nevaib/api/weekly_email.php --dry-run  # print, send nothing
//
// Reads $DATA_DIR/config.json (outside public_html, never committed):
//   {"summary_email": {"to": "parent@example.org", "from": "nevaib@your-domain",
//                      "users": ["<student-username>"], "days": 7},
//    "timezone": "Europe/Zurich"}
// Uses PHP mail() (the host's local mailer) — no external service. Read-only on state.
// PHP 7.2 compatible.

declare(strict_types=1);

if (PHP_SAPI !== "cli") { http_response_code(404); exit; }

require_once __DIR__ . "/summary.php";

$DATA_DIR = getenv("NEVAIB_DATA_DIR") ?: (dirname(__DIR__, 3) . "/nevaib-data");
$dry = in_array("--dry-run", $argv, true);

function wl_fail(string $msg) { fwrite(STDERR, "weekly_email: " . $msg . "\n"); exit(1); }

$cfgFile = $DATA_DIR . "/config.json";
if (!is_file($cfgFile)) wl_fail("no config at " . $cfgFile . " (see server/deploy-notes.md)");
$cfg = json_decode((string)file_get_contents($cfgFile), true);
if (!is_array($cfg) || !isset($cfg["summary_email"]) || !is_array($cfg["summary_email"])) wl_fail("config.json has no summary_email block");
$em = $cfg["summary_email"];
$to = trim((string)($em["to"] ?? ""));
$from = trim((string)($em["from"] ?? ""));
$users = is_array($em["users"] ?? null) ? $em["users"] : [];
$days = (int)($em["days"] ?? 7);
$tz = (string)($cfg["timezone"] ?? "Europe/Zurich");
// header-injection guard: single plain addresses only
$addr = '/^[^@\s<>,;:"\r\n]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/';
if (!preg_match($addr, $to)) wl_fail("summary_email.to must be one plain e-mail address");
if ($from !== "" && !preg_match($addr, $from)) wl_fail("summary_email.from must be one plain e-mail address");
if (!$users) wl_fail("summary_email.users is empty");

$index = nb_card_index(dirname(__DIR__) . "/library/flashcards");
$parts = [];
foreach ($users as $u) {
    $u = preg_replace("/[^a-z0-9._-]/", "", strtolower((string)$u));
    if ($u === "") continue;
    $p = $DATA_DIR . "/state/" . $u . ".json";
    $d = is_file($p) ? json_decode((string)file_get_contents($p), true) : null;
    $state = (is_array($d) && isset($d["state"]) && is_array($d["state"])) ? $d["state"] : [];
    $parts[] = nb_summary_text($u, nb_summary($state, $days, time(), $index, $tz));
}
$body = implode("\n----\n\n", $parts) . "\n(Sent by NevaIB weekly_email.php — reply-free. Details: the Weekly summary page.)\n";
$subject = "NevaIB weekly summary — " . date("j M Y");

if ($dry) { echo "To: " . $to . "\nSubject: " . $subject . "\n\n" . $body; exit(0); }

$headers = "Content-Type: text/plain; charset=utf-8\r\n";
if ($from !== "") $headers .= "From: " . $from . "\r\n";
$encSubject = "=?UTF-8?B?" . base64_encode($subject) . "?=";
if (!mail($to, $encSubject, $body, $headers)) wl_fail("mail() returned false — check the host's mail setup");
echo "sent to " . $to . "\n";
