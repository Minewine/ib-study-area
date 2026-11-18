"""Tests for the Math AA SL course-calendar feature (ISL 2026–28).

Covers the quiz bank (library/questions/math-aa-course-calendar.json), the
flashcard deck (library/flashcards/math-course-calendar.json), manifest
registration, the generated teaching-plan card in math-aa-sl.html, canonical
calendar facts, and idempotent site regeneration. Read-only except for the
regeneration test, which is verified to be byte-stable.
"""

import json
import re
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
BANK_REL = "library/questions/math-aa-course-calendar.json"
DECK_REL = "library/flashcards/math-course-calendar.json"
QUESTIONS_MANIFEST = ROOT / "library" / "questions" / "manifest.json"
FLASHCARDS_MANIFEST = ROOT / "library" / "flashcards" / "manifest.json"

# Any YYYY-MM-DD / YYYY/MM/DD style absolute date — the calendar is
# week-numbered only, so nothing should ever match this.
ABSOLUTE_DATE_RE = re.compile(r"\b\d{4}[-/]\d{1,2}[-/]\d{1,2}\b")


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def all_strings(node) -> list[str]:
    """Recursively collect every string value in a JSON structure."""
    if isinstance(node, str):
        return [node]
    if isinstance(node, dict):
        out = []
        for value in node.values():
            out.extend(all_strings(value))
        return out
    if isinstance(node, list):
        out = []
        for value in node:
            out.extend(all_strings(value))
        return out
    return []


@pytest.fixture(scope="module")
def bank():
    return load_json(ROOT / BANK_REL)


@pytest.fixture(scope="module")
def deck():
    return load_json(ROOT / DECK_REL)


@pytest.fixture(scope="module")
def combined_text(bank, deck):
    """Every string in the bank plus the deck — for fact spot-checks."""
    return "\n".join(all_strings(bank) + all_strings(deck))


# ---------- quiz bank structure ----------


def test_bank_has_required_keys_and_exact_subject_topic(bank):
    assert bank["subject"] == "math-aa-sl"
    assert bank["topic"] == "course-calendar-2026-2028"
    for key in ("subject", "topic", "topicLabel", "items"):
        assert key in bank


def test_bank_has_exactly_42_items_with_unique_sequential_ids(bank):
    items = bank["items"]
    assert len(items) == 42
    ids = [it["id"] for it in items]
    assert len(set(ids)) == 42
    assert sorted(ids) == [f"cc-{n:02d}" for n in range(1, 43)]


def test_bank_format_totals_are_36_mcq_and_6_written(bank):
    # File order within the bank is free; only the per-format totals are
    # pinned (per-item schema validity is checked by the parametrized tests).
    formats = [it["format"] for it in bank["items"]]
    assert formats.count("mcq") == 36
    assert formats.count("written") == 6
    assert set(formats) == {"mcq", "written"}


@pytest.mark.parametrize(
    "item",
    [
        it
        for it in json.loads((ROOT / BANK_REL).read_text(encoding="utf-8"))["items"]
        if it["format"] == "mcq"
    ],
    ids=lambda it: it["id"],
)
def test_bank_mcq_items_have_valid_choices_answer_and_note(item):
    choices = item["choices"]
    assert isinstance(choices, list) and len(choices) >= 2
    assert all(isinstance(c, str) and c.strip() for c in choices)
    answer = item["answer"]
    assert isinstance(answer, int) and 0 <= answer < len(choices)
    assert isinstance(item["note"], str) and item["note"].strip()


@pytest.mark.parametrize(
    "item",
    [
        it
        for it in json.loads((ROOT / BANK_REL).read_text(encoding="utf-8"))["items"]
        if it["format"] == "written"
    ],
    ids=lambda it: it["id"],
)
def test_bank_written_items_have_marks_markscheme_tactic(item):
    assert isinstance(item["marks"], int) and item["marks"] >= 1
    markscheme = item["markscheme"]
    assert isinstance(markscheme, list) and len(markscheme) >= 1
    assert all(isinstance(line, str) and line.strip() for line in markscheme)
    assert isinstance(item["tactic"], str) and item["tactic"].strip()


# ---------- flashcard deck structure ----------


def test_deck_has_40_cards_matching_id_pattern(deck):
    cards = deck["cards"]
    assert len(cards) == 40
    ids = [c["id"] for c in cards]
    assert all(re.fullmatch(r"fc-math-cc-\d{2}", cid) for cid in ids)
    assert len(set(ids)) == 40
    assert sorted(ids) == [f"fc-math-cc-{n:02d}" for n in range(1, 41)]


@pytest.mark.parametrize(
    "card",
    json.loads((ROOT / DECK_REL).read_text(encoding="utf-8"))["cards"],
    ids=lambda c: c["id"],
)
def test_deck_cards_have_valid_type_tags_and_faces(card):
    assert card["type"] in ("qa", "term")
    assert isinstance(card["tags"], list) and len(card["tags"]) >= 1
    assert all(isinstance(t, str) and t.strip() for t in card["tags"])
    assert isinstance(card["front"], str) and card["front"].strip()
    assert isinstance(card["back"], str) and card["back"].strip()


def test_deck_subject_and_topic_match_bank(deck, bank):
    assert deck["subject"] == bank["subject"] == "math-aa-sl"
    assert deck["topic"] == bank["topic"] == "course-calendar-2026-2028"


def test_card_ids_globally_unique_across_all_manifest_decks():
    manifest = load_json(FLASHCARDS_MANIFEST)
    seen: dict[str, str] = {}
    for entry in manifest:
        for card in load_json(ROOT / entry["file"])["cards"]:
            cid = card["id"]
            if cid in seen:
                pytest.fail(
                    f"card id {cid} duplicated across {seen[cid]} and {entry['file']}"
                )
            seen[cid] = entry["file"]
    # the 40 calendar cards are all registered somewhere
    for n in range(1, 41):
        assert f"fc-math-cc-{n:02d}" in seen


# ---------- manifest registration ----------


def test_questions_manifest_registers_the_bank():
    entries = [e for e in load_json(QUESTIONS_MANIFEST) if e["file"] == BANK_REL]
    assert len(entries) == 1
    entry = entries[0]
    assert entry["subject"] == "math-aa-sl"
    assert entry["subjectLabel"] == "Math AA SL"
    assert entry["label"] == "Course calendar 2026–28 — teaching order & milestones"


def test_flashcards_manifest_registers_the_deck_without_label():
    entries = [e for e in load_json(FLASHCARDS_MANIFEST) if e["file"] == DECK_REL]
    assert len(entries) == 1
    entry = entries[0]
    assert entry["subject"] == "math-aa-sl"
    assert entry["subjectLabel"] == "Math AA SL"
    assert "label" not in entry  # flashcards manifest entries carry no label


@pytest.mark.parametrize(
    "manifest_path",
    [QUESTIONS_MANIFEST, FLASHCARDS_MANIFEST],
    ids=["questions", "flashcards"],
)
def test_every_manifest_file_exists_on_disk(manifest_path):
    for entry in load_json(manifest_path):
        target = ROOT / entry["file"]
        assert target.is_file(), f"manifest references missing file {entry['file']}"


# ---------- generated page (math-aa-sl.html as it sits in the tree) ----------


@pytest.fixture(scope="module")
def math_page():
    return (ROOT / "math-aa-sl.html").read_text(encoding="utf-8")


def test_page_contains_teaching_plan_heading_and_year_labels(math_page):
    assert "Two-year teaching plan (ISL 2026–28)" in math_page
    assert "Y12 2026/27" in math_page
    assert "Y13 2027/28" in math_page


def test_page_milestone_rows_are_bolded_and_teaching_rows_are_not(math_page):
    # milestone rows render as <strong>, teaching rows as plain <td>
    for milestone in (
        "<strong>Y12 exams</strong>",
        "<strong>IA first draft</strong>",
        "<strong>IA deadline</strong>",
        "<strong>Revision + Mock exams</strong>",
    ):
        assert milestone in math_page
    assert "<td>Differentiation</td>" in math_page  # teaching row stays plain


# ---------- canonical calendar facts ----------


def test_ia_draft_and_deadline_weeks_present(combined_text):
    assert re.search(r"\bwk 9\b.*\bdraft|\bdraft.*\bwk 9\b", combined_text)
    assert re.search(r"\bwk 15\b.*\bdeadline|\bdeadline.*\bwk 15\b", combined_text)


def test_y12_exam_windows_present(combined_text):
    assert re.search(r"[Ww]k 19 \(Jan\)", combined_text)
    assert "32–34" in combined_text  # en-dashed range, as published


def test_key_teaching_windows_present(combined_text):
    assert "22–25" in combined_text  # trig equations & functions
    assert "36–37" in combined_text  # integration first pass
    assert "11–12" in combined_text  # probability
    assert "19–20" in combined_text  # statistics
    assert "16–18" in combined_text  # revision + mocks
    assert "23–24+" in combined_text  # final Y13 revision run


def test_trip_weeks_are_y12_wk4_and_y13_wk3(combined_text):
    # Both trip weeks with their September disambiguator, bank and deck.
    assert "Y12 wk 4 (Sep) and Y13 wk 3 (Sep)" in combined_text
    assert "Wk 4 (Sep); Jeûne fédéral follows in wk 5" in combined_text
    assert "Wk 3 (Sep); Jeûne fédéral follows in wk 4" in combined_text


def test_no_string_claims_a_trip_week_in_wk_5(bank, deck):
    # wk 5 (Y12) / wk 4 (Y13) belong to Jeûne fédéral, never to a trip week.
    # Distractor choices and trap notes legitimately mention wk 5 in items
    # about trips, but only by attributing it to Jeûne fédéral or restating
    # the correct wk 4/wk 3 pair — so ban only a tight same-sentence
    # "trip … wk 5" attribution span (20 chars: covers "trip week falls in
    # wk 5" phrasings, but cannot bridge the ≥26-char or full-stop-bounded
    # attributions the real content uses).
    bad = re.compile(r"trip[^.\n]{0,20}wk 5|wk 5[^.\n]{0,20}trip", re.IGNORECASE)
    for s in all_strings(bank) + all_strings(deck):
        assert not bad.search(s), f"string ties a trip week to wk 5: {s!r}"


def test_jeune_federal_is_y12_wk5_and_y13_wk4(combined_text):
    assert "Jeûne fédéral is wk 5 of Y12 and wk 4 of Y13" in combined_text
    assert "Y12 wk 5 · Y13 wk 4" in combined_text  # deck, middle-dot separated


@pytest.mark.parametrize(
    ("pattern", "fact"),
    [
        (r"(?:Eight|8)\s*[—:]\s*prior learning", "Y12 teaching blocks = 8"),
        (r"Y13 has only four", "Y13 teaching blocks = 4 (bank)"),
        (r"\b4\s*—\s*integration continued", "Y13 teaching blocks = 4 (deck)"),
        (r"(?:Four|4)\s*[—:]\s*wk 18\b", "revision windows across both years = 4"),
        (r"= 4 exam weeks in Y12", "Y12 exam weeks = 4"),
    ],
    ids=[
        "y12-blocks-8",
        "y13-blocks-4-bank",
        "y13-blocks-4-deck",
        "revision-4",
        "y12-exam-weeks-4",
    ],
)
def test_calendar_count_facts_appear(combined_text, pattern, fact):
    assert re.search(pattern, combined_text), f"missing count fact: {fact}"


@pytest.mark.parametrize(
    ("pattern", "fact"),
    [
        (
            r"6 weeks[^\n]{0,30}\bwk 15\b|\bwk 15\b[^\n]{0,30}6 weeks",
            "IA draft (wk 9) → deadline (wk 15) = 6 weeks",
        ),
        (r"the very next week", "deadline → mocks is the next week, no gap"),
        (
            r"starts the week after the wk 15 deadline",
            "deck: mocks start the week after the deadline",
        ),
        (
            r"starts the week after the mocks end",
            "mocks end wk 18 → Statistics starts wk 19",
        ),
        (
            r"Back-to-back — mocks wks 16–18, statistics wks 19–20",
            "deck: mocks → statistics back-to-back",
        ),
    ],
    ids=[
        "draft-to-deadline-6w",
        "deadline-to-mocks-next-week",
        "deck-no-slack",
        "mocks-to-statistics",
        "deck-back-to-back",
    ],
)
def test_calendar_interval_facts_appear(combined_text, pattern, fact):
    assert re.search(pattern, combined_text), f"missing interval fact: {fact}"


@pytest.mark.parametrize(
    ("pattern", "fact"),
    [
        (
            r"circular trig[^\n]{0,40}\bwk 13\b|\bwk 13\b[^\n]{0,40}circular trig",
            "wk 13 Y12 → circular trig",
        ),
        (
            r"further differentiation[^\n]{0,40}\bwk 28\b|\bwk 28\b[^\n]{0,40}further differentiation",
            "wk 28 Y12 → further differentiation",
        ),
        (
            r"IA first draft[^\n]{0,40}\bwk 9\b|\bwk 9\b[^\n]{0,40}IA first draft",
            "wk 9 Y13 → IA first draft",
        ),
        (
            r"statistics[^\n]{0,40}wks 19–20|wks 19–20[^\n]{0,40}statistics",
            "wks 19–20 Y13 → statistics",
        ),
    ],
    ids=[
        "wk13-circular-trig",
        "wk28-further-diff",
        "wk9-ia-draft",
        "wks19-20-statistics",
    ],
)
def test_reverse_recall_week_to_topic_facts_appear(combined_text, pattern, fact):
    assert re.search(pattern, combined_text, re.IGNORECASE), (
        f"missing reverse-recall fact: {fact}"
    )


def test_five_teaching_blocks_before_y12_jan_exams(bank, deck, combined_text):
    # Everything taught before the wk 19 (Jan) Y12 exams, in teaching order.
    assert "The 5 blocks to master before the Y12 Jan exams (wk 19)" in combined_text
    assert "Y12 January exams fall in wk 19" in combined_text
    blocks = [
        "prior learning",
        "functions & quadratics",
        "differentiation",
        "circular trig",
        "exponentials & logs",
    ]
    enumerated = []
    for s in all_strings(bank) + all_strings(deck):
        low = s.lower()
        if all(b in low for b in blocks):
            indexes = [low.index(b) for b in blocks]
            if indexes == sorted(indexes):
                enumerated.append(s)
    assert enumerated, (
        "no single bank/deck string enumerates the five pre-exam blocks in teaching order"
    )


def test_no_absolute_dates_in_bank_or_deck(combined_text):
    hits = ABSOLUTE_DATE_RE.findall(combined_text)
    assert hits == [], f"fabricated absolute date(s) found: {hits}"


def test_no_absolute_dates_in_teaching_plan_card(math_page):
    start = math_page.index("Two-year teaching plan")
    end = math_page.index("Syllabus checklist", start)
    card = math_page[start:end]
    hits = ABSOLUTE_DATE_RE.findall(card)
    assert hits == [], f"fabricated absolute date(s) in rendered card: {hits}"


# ---------- idempotent regeneration ----------


def test_rebuilding_site_leaves_all_generated_files_byte_identical():
    """build_site.py regenerates in place; every checked-in file it writes must
    be current, not just math-aa-sl.html.

    Snapshots all root-level pages plus the generated assets (the generator
    never touches hand-maintained pages, so they cannot false-positive). The
    original bytes are restored if regeneration disagrees, so the working tree
    is left untouched either way.
    """
    targets = sorted(ROOT.glob("*.html")) + [
        ROOT / "assets" / "style.css",
        ROOT / "assets" / "app.js",
    ]
    before = {p: p.read_bytes() for p in targets}
    subprocess.run(
        [sys.executable, "-I", str(ROOT / "tools" / "build_site.py")],
        check=True,
        capture_output=True,
        cwd=ROOT,
    )
    changed = [p.name for p, old in before.items() if p.read_bytes() != old]
    if changed:
        for p, old in before.items():  # keep the tree pristine for the failure report
            p.write_bytes(old)
    assert changed == [], (
        f"stale generated file(s) {changed}: build_site.py produces different bytes "
        "(run `python3 -I tools/build_site.py` and commit the result)"
    )
