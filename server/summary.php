<?php
// Weekly summary for a parent: pure functions over one user's stored state.
// Used by api.php (?action=summary) and weekly_email.php (cron). PHP 7.2 compatible.
// Nothing here writes anything: it only reads the state array it is given and the
// flashcard decks (to map card ids to subjects/topics).

declare(strict_types=1);

if (PHP_SAPI !== "cli" && isset($_SERVER["SCRIPT_FILENAME"]) && realpath((string)$_SERVER["SCRIPT_FILENAME"]) === realpath(__FILE__)) {
    http_response_code(404);   // library file: never a page of its own
    exit;
}

const NB_SUMMARY_WEAK_PCT = 70;          // a topic below this accuracy is "weak"
const NB_SUMMARY_SECONDS_PER_CARD = 20;  // rough time estimates (no timer data is stored)
const NB_SUMMARY_SECONDS_PER_MARK = 60;

// card id → [subject, subjectLabel, topic, topicLabel] from library/flashcards/*.json
function nb_card_index(string $dir): array {
    $idx = [];
    $files = glob($dir . "/*.json");
    if (!is_array($files)) return $idx;
    $labels = [];
    $man = $dir . "/manifest.json";
    if (is_file($man)) {
        $m = json_decode((string)file_get_contents($man), true);
        foreach ((is_array($m) ? ($m["decks"] ?? $m) : []) as $r) {
            if (is_array($r) && isset($r["subject"], $r["subjectLabel"])) $labels[(string)$r["subject"]] = (string)$r["subjectLabel"];
        }
    }
    foreach ($files as $f) {
        if (basename($f) === "manifest.json") continue;
        $d = json_decode((string)file_get_contents($f), true);
        if (!is_array($d) || !isset($d["cards"]) || !is_array($d["cards"])) continue;
        $subj = (string)($d["subject"] ?? "");
        foreach ($d["cards"] as $c) {
            if (!is_array($c) || !isset($c["id"])) continue;
            $idx[(string)$c["id"]] = [
                "subject" => $subj,
                "subjectLabel" => $labels[$subj] ?? $subj,
                "topic" => (string)($d["topic"] ?? ""),
                "topicLabel" => (string)($d["topicLabel"] ?? ($d["topic"] ?? "")),
            ];
        }
    }
    return $idx;
}

function nb_arr($v): array { return is_array($v) ? $v : []; }
function nb_num($v): float { return is_numeric($v) ? (float)$v : 0.0; }
function nb_pct(float $got, float $max) { return $max > 0 ? (int)round(100 * $got / $max) : null; }

// $state: the stored app state (assoc array). $days: window length. $now: unix time.
// $tz: the student's timezone (dates in quizlog are her local dates).
function nb_summary(array $state, int $days, int $now, array $cardIndex, string $tz = "Europe/Zurich"): array {
    $days = max(1, min(90, $days));
    try { $zone = new DateTimeZone($tz); } catch (Exception $e) { $zone = new DateTimeZone("UTC"); }
    $localDate = function (int $ts) use ($zone): string {
        $d = new DateTime("@" . $ts); $d->setTimezone($zone); return $d->format("Y-m-d");
    };
    $since = $now - $days * 86400;
    $sinceDate = $localDate($since + 86400);   // first full local day inside the window
    $today = $localDate($now);
    $active = [];

    // ── quizzes (quizlog: {date, label, got, max, pct, ts?, subject?, topics?}) ──
    $quiz = ["sessions" => 0, "got" => 0.0, "max" => 0.0, "by_subject" => [], "by_topic" => []];
    foreach (nb_arr($state["quizlog"] ?? null) as $e) {
        if (!is_array($e)) continue;
        $ts = isset($e["ts"]) && is_numeric($e["ts"]) ? (int)floor(((float)$e["ts"]) / 1000) : null;
        $date = $ts !== null ? $localDate($ts) : (string)($e["date"] ?? "");
        $in = $ts !== null ? ($ts > $since && $ts <= $now) : ($date >= $sinceDate && $date <= $today);
        if (!$in) continue;
        $active[$date] = true;
        $quiz["sessions"]++;
        $got = nb_num($e["got"] ?? 0); $max = nb_num($e["max"] ?? 0);
        $quiz["got"] += $got; $quiz["max"] += $max;
        $label = (string)($e["label"] ?? "Quiz");
        if (!isset($quiz["by_subject"][$label])) $quiz["by_subject"][$label] = ["label" => $label, "sessions" => 0, "got" => 0.0, "max" => 0.0];
        $quiz["by_subject"][$label]["sessions"]++;
        $quiz["by_subject"][$label]["got"] += $got;
        $quiz["by_subject"][$label]["max"] += $max;
        foreach (nb_arr($e["topics"] ?? null) as $tk => $t) {   // per-topic breakdown (newer clients)
            if (!is_array($t)) continue;
            $key = (string)$tk;
            if (!isset($quiz["by_topic"][$key])) $quiz["by_topic"][$key] = ["topic" => $key, "label" => (string)($t["l"] ?? $key), "subject" => $label, "got" => 0.0, "max" => 0.0];
            $quiz["by_topic"][$key]["got"] += nb_num($t["g"] ?? 0);
            $quiz["by_topic"][$key]["max"] += nb_num($t["m"] ?? 0);
        }
    }
    $bySubject = array_values($quiz["by_subject"]);
    foreach ($bySubject as &$s) { $s["pct"] = nb_pct($s["got"], $s["max"]); }
    unset($s);
    $byTopic = array_values($quiz["by_topic"]);
    foreach ($byTopic as &$t) { $t["pct"] = nb_pct($t["got"], $t["max"]); }
    unset($t);
    usort($byTopic, function ($a, $b) { return ($a["pct"] ?? 101) <=> ($b["pct"] ?? 101); });

    // ── questions missed this window (q-errors) ──
    $missed = [];
    foreach (nb_arr($state["q-errors"] ?? null) as $e) {
        if (!is_array($e)) continue;
        $last = (string)($e["lastMissed"] ?? ($e["firstMissed"] ?? ""));
        if ($last === "" || $last < $sinceDate || $last > $today) continue;
        if (!empty($e["resolved"])) continue;
        $key = (string)($e["topic"] ?? "") !== "" ? (string)$e["topic"] : (string)($e["topicLabel"] ?? "other");
        if (!isset($missed[$key])) $missed[$key] = ["topic" => $key, "label" => (string)($e["topicLabel"] ?? $key), "subject" => (string)($e["subject"] ?? ""), "count" => 0];
        $missed[$key]["count"]++;
    }

    // ── flashcards (fc-state: {id: {box, due, seen, t}}; t = last review, ms) ──
    $cards = ["reviewed" => 0, "by_subject" => [], "seen_total" => 0, "mastered_total" => 0, "due_now" => 0];
    foreach (nb_arr($state["fc-state"] ?? null) as $id => $c) {
        if (!is_array($c)) continue;
        if (nb_num($c["seen"] ?? 0) > 0) $cards["seen_total"]++;
        if (nb_num($c["box"] ?? 0) >= 4) $cards["mastered_total"]++;
        if (isset($c["due"]) && (string)$c["due"] <= $today) $cards["due_now"]++;
        if (!isset($c["t"]) || !is_numeric($c["t"])) continue;
        $ts = (int)floor(((float)$c["t"]) / 1000);
        if ($ts <= $since || $ts > $now) continue;
        $active[$localDate($ts)] = true;
        $cards["reviewed"]++;
        $info = $cardIndex[(string)$id] ?? null;
        $label = $info ? $info["subjectLabel"] : "My own cards";
        if (!isset($cards["by_subject"][$label])) $cards["by_subject"][$label] = ["label" => $label, "reviewed" => 0];
        $cards["by_subject"][$label]["reviewed"]++;
    }

    // ── weakest topics: quiz accuracy below threshold first, then most-missed ──
    $weak = [];
    foreach ($byTopic as $t) {
        if ($t["max"] >= 2 && $t["pct"] !== null && $t["pct"] < NB_SUMMARY_WEAK_PCT) {
            $weak[$t["topic"]] = ["topic" => $t["topic"], "label" => $t["label"], "pct" => $t["pct"], "missed" => $missed[$t["topic"]]["count"] ?? 0];
        }
    }
    $m = array_values($missed);
    usort($m, function ($a, $b) { return $b["count"] <=> $a["count"]; });
    foreach ($m as $e) {
        if (!isset($weak[$e["topic"]])) $weak[$e["topic"]] = ["topic" => $e["topic"], "label" => $e["label"], "pct" => null, "missed" => $e["count"]];
    }
    $weak = array_slice(array_values($weak), 0, 5);

    ksort($active);
    $estSeconds = $cards["reviewed"] * NB_SUMMARY_SECONDS_PER_CARD + (int)$quiz["max"] * NB_SUMMARY_SECONDS_PER_MARK;
    return [
        "days" => $days,
        "from" => $sinceDate,
        "to" => $today,
        "active_days" => count($active),
        "active_dates" => array_keys($active),
        "est_minutes" => (int)round($estSeconds / 60),
        "est_minutes_note" => "rough estimate: about 20 s per card reviewed + 1 min per quiz mark; the app does not time sessions",
        "quiz" => [
            "sessions" => $quiz["sessions"],
            "got" => $quiz["got"], "max" => $quiz["max"],
            "pct" => nb_pct($quiz["got"], $quiz["max"]),
            "by_subject" => $bySubject,
            "by_topic" => $byTopic,
        ],
        "cards" => [
            "reviewed" => $cards["reviewed"],
            "reviewed_note" => "distinct cards whose latest review is in this window",
            "by_subject" => array_values($cards["by_subject"]),
            "seen_total" => $cards["seen_total"],
            "mastered_total" => $cards["mastered_total"],
            "due_now" => $cards["due_now"],
        ],
        "missed_questions" => array_sum(array_map(function ($e) { return $e["count"]; }, $m)),
        "weakest_topics" => $weak,
    ];
}

// plain-text rendering (email body)
function nb_summary_text(string $user, array $s): string {
    $L = [];
    $L[] = "NevaIB weekly summary for " . $user . " (" . $s["from"] . " to " . $s["to"] . ")";
    $L[] = "";
    $L[] = "Active days: " . $s["active_days"] . " of " . $s["days"] . "   ·   time: about " . $s["est_minutes"] . " min (" . $s["est_minutes_note"] . ")";
    $q = $s["quiz"];
    $L[] = "Quizzes: " . $q["sessions"] . " session(s)" . ($q["pct"] !== null ? ", " . $q["pct"] . "% overall (" . $q["got"] . "/" . $q["max"] . ")" : "");
    foreach ($q["by_subject"] as $b) $L[] = "  - " . $b["label"] . ": " . $b["sessions"] . " session(s), " . ($b["pct"] === null ? "—" : $b["pct"] . "%");
    $c = $s["cards"];
    $L[] = "Flashcards: " . $c["reviewed"] . " reviewed · " . $c["due_now"] . " due now · " . $c["mastered_total"] . " mastered of " . $c["seen_total"] . " seen";
    foreach ($c["by_subject"] as $b) $L[] = "  - " . $b["label"] . ": " . $b["reviewed"];
    $L[] = "";
    if ($s["weakest_topics"]) {
        $L[] = "Topics to revisit:";
        foreach ($s["weakest_topics"] as $w) {
            $L[] = "  - " . $w["label"] . ($w["pct"] !== null ? " — " . $w["pct"] . "% in quizzes" : "") . ($w["missed"] ? " — " . $w["missed"] . " question(s) missed" : "");
        }
    } else {
        $L[] = "No weak topics flagged this week.";
    }
    return implode("\n", $L) . "\n";
}
