"""Map raw legislative action text to a small set of bill-status labels.

Congress.gov and OpenStates describe the same milestones in different jargon.
Matching is ordered from terminal outcomes (law, veto, failure) down to
introduction so a phrase like "Became Public Law" is not classified as a
chamber passage.
"""

import re

STATUS_BECAME_LAW = "Became Law"
STATUS_VETOED = "Vetoed"
STATUS_FAILED = "Failed"
STATUS_TO_EXECUTIVE = "To President / Governor"
STATUS_PASSED_BOTH = "Passed Both Chambers"
STATUS_PASSED_SENATE = "Passed Senate"
STATUS_PASSED_HOUSE = "Passed House"
STATUS_INTRODUCED = "Introduced"

BILL_STATUSES = (
    STATUS_BECAME_LAW,
    STATUS_VETOED,
    STATUS_FAILED,
    STATUS_TO_EXECUTIVE,
    STATUS_PASSED_BOTH,
    STATUS_PASSED_SENATE,
    STATUS_PASSED_HOUSE,
    STATUS_INTRODUCED,
)

HOUSE_BILL_TYPES = frozenset({"hr", "hres", "hjres", "hconres"})
SENATE_BILL_TYPES = frozenset({"s", "sres", "sjres", "sconres"})

_PASSAGE_QUESTION_RE = re.compile(
    r"\bon passage\b|\bon the passage\b|\bpassage\b",
    re.IGNORECASE,
)
_PASSED_RESULT_RE = re.compile(
    r"\bpassed\b|\bagreed to\b|\boverridden\b",
    re.IGNORECASE,
)
_FAILED_RESULT_RE = re.compile(
    r"\bfailed\b|\brejected\b|\bnot agreed to\b",
    re.IGNORECASE,
)


def origin_chamber_from_bill_id(bill_id):
    """House or Senate from a federal id like 119-hr-1; None for OpenStates ids."""
    if not bill_id:
        return None
    text = str(bill_id).strip()
    if text.startswith("ocd-bill/"):
        return None
    parts = text.split("-")
    if len(parts) < 3:
        return None
    bill_type = parts[1].lower()
    if bill_type in HOUSE_BILL_TYPES:
        return "house"
    if bill_type in SENATE_BILL_TYPES:
        return "senate"
    return None


def origin_chamber_from_identifier(identifier):
    """Chamber of origin from labels like HB 1, SB 12, or AB 5."""
    if not identifier:
        return None
    prefix = re.match(r"[^0-9]*", str(identifier).strip())
    key = re.sub(r"[^a-z]", "", (prefix.group(0) if prefix else "").lower())
    if not key:
        return None
    if key.startswith(("hb", "hr", "hjr", "hcr", "hcon", "ab")):
        return "house"
    if key.startswith(("sb", "sr", "sjr", "scr", "scon")):
        return "senate"
    return None


def _norm(action_text):
    return re.sub(r"\s+", " ", str(action_text or "").strip().lower())


def _attr(item, name):
    if item is None:
        return None
    if isinstance(item, dict):
        return item.get(name)
    return getattr(item, name, None)


def _chamber_key(value):
    text = str(value or "").strip().lower()
    if text in {"house", "senate"}:
        return text
    return None


def _is_passage_roll_call(roll_call):
    question = str(_attr(roll_call, "question") or "")
    return bool(_PASSAGE_QUESTION_RE.search(question))


def _passage_by_chamber(roll_calls):
    passed = {"house": False, "senate": False}
    failed = {"house": False, "senate": False}
    for item in roll_calls or []:
        chamber = _chamber_key(_attr(item, "chamber"))
        if not chamber or not _is_passage_roll_call(item):
            continue
        result = str(_attr(item, "result") or "")
        if _FAILED_RESULT_RE.search(result) and not _PASSED_RESULT_RE.search(result):
            failed[chamber] = True
        elif _PASSED_RESULT_RE.search(result):
            passed[chamber] = True
    return passed, failed


def _status_from_roll_calls(roll_calls):
    passed, failed = _passage_by_chamber(roll_calls)
    if passed["house"] and passed["senate"]:
        return STATUS_PASSED_BOTH
    if failed["house"] or failed["senate"]:
        if not passed["house"] and not passed["senate"]:
            return STATUS_FAILED
    if passed["house"]:
        return STATUS_PASSED_HOUSE
    if passed["senate"]:
        return STATUS_PASSED_SENATE
    return None


def _rank(status):
    try:
        return BILL_STATUSES.index(status)
    except ValueError:
        return len(BILL_STATUSES)


def _prefer(current, candidate):
    """Keep the more advanced (lower index) of two statuses."""
    if candidate is None:
        return current
    if current is None:
        return candidate
    return candidate if _rank(candidate) < _rank(current) else current


def _status_from_action_text(action_text, origin_chamber=None):
    text = _norm(action_text)
    if not text:
        return STATUS_INTRODUCED

    if re.search(
        r"became public law|public law no|signed by (the )?president|"
        r"signed by governor|became law|\benacted\b|\bchaptered\b|"
        r"effective on |effective date",
        text,
    ):
        return STATUS_BECAME_LAW

    if re.search(r"passed over (the )?veto|veto override (agreed|passed)", text):
        return STATUS_PASSED_BOTH
    if re.search(r"\bvetoed\b|pocket veto|veto message", text):
        return STATUS_VETOED

    if re.search(
        r"failed of passage|failed/not agreed|not agreed to in (the )?(house|senate)|"
        r"failed by (the )?yeas|motion to (suspend the rules and )?pass.*"
        r"fail",
        text,
    ):
        return STATUS_FAILED

    if re.search(
        r"presented to (the )?president|to president|"
        r"sent to (the )?governor|to governor|"
        r"presented to (the )?governor",
        text,
    ):
        return STATUS_TO_EXECUTIVE

    passed_house = bool(
        re.search(r"passed/agreed to in (the )?house|passed (the )?house", text)
    )
    passed_senate = bool(
        re.search(r"passed/agreed to in (the )?senate|passed (the )?senate", text)
    )
    passed_assembly = bool(
        re.search(r"passed (the )?assembly|passed/agreed to in (the )?assembly", text)
    )
    if passed_assembly:
        passed_house = True

    if re.search(r"passed both|agreed to in both|cleared for (the )?(white house|president)", text):
        return STATUS_PASSED_BOTH

    if passed_house and passed_senate:
        return STATUS_PASSED_BOTH
    if origin_chamber == "house" and passed_senate:
        return STATUS_PASSED_BOTH
    if origin_chamber == "senate" and passed_house:
        return STATUS_PASSED_BOTH
    if passed_senate:
        return STATUS_PASSED_SENATE
    if passed_house:
        return STATUS_PASSED_HOUSE

    return STATUS_INTRODUCED


def derive_bill_status(action_text, origin_chamber=None, roll_calls=None):
    """Return one of BILL_STATUSES for raw action text.

    `origin_chamber` is "house" or "senate" when known, so a House bill whose
    latest action is Senate passage can be labeled Passed Both Chambers.
    `roll_calls` (models or dicts with chamber/question/result) can raise a
    still-Introduced bill when a recorded passage vote already happened.
    """
    status = _status_from_action_text(action_text, origin_chamber=origin_chamber)
    from_votes = _status_from_roll_calls(roll_calls)
    if status == STATUS_INTRODUCED:
        return from_votes or status
    if status in {STATUS_PASSED_HOUSE, STATUS_PASSED_SENATE}:
        return _prefer(status, from_votes)
    return status
