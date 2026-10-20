"""Derived campaign-finance figures for the /finance endpoint.

Everything here works on stored official_finance_totals rows, so the API
never calls OpenFEC. Peer comparisons only compare members of the same
chamber: Senate totals span six years and House totals two.
"""

from collections import defaultdict
from datetime import date
from decimal import Decimal

# Funding-mix slices in display order. Receipts also include loans from
# others, offsets and other receipts; those go in "other" so the slices
# always add up to receipts.
FUNDING_MIX = (
    ("small_donors", "Small donors ($200 or less)"),
    ("large_donors", "Larger individual donors"),
    ("joint_fundraising", "Joint fundraising transfers"),
    ("pacs", "PACs"),
    ("party", "Party committees"),
    ("candidate", "Candidate's own money"),
    ("other", "Other"),
)

PEER_METRICS = (
    ("receipts", "Raised"),
    ("small_donor_share", "Share from small donors"),
    ("in_state_share", "Share from home state"),
    ("pac_share", "Share from PACs"),
)

CHAMBER_SENATE = "senate"
CHAMBER_HOUSE = "house"
CHAMBER_LABELS = {CHAMBER_SENATE: "senators", CHAMBER_HOUSE: "House members"}


def _float(value):
    return None if value is None else float(value)


def share(part, whole):
    if part is None or not whole:
        return None
    return round(float(part) / float(whole), 4)


def chamber_for_office(office):
    return CHAMBER_SENATE if (office or "").strip().lower() == "senator" else CHAMBER_HOUSE


def funding_mix(row):
    """Receipts split into FUNDING_MIX slices; None without receipts."""
    receipts = _float(row.receipts)
    if not receipts:
        return None
    amounts = {
        "small_donors": _float(row.individual_unitemized) or 0.0,
        "large_donors": _float(row.individual_itemized) or 0.0,
        "joint_fundraising": _float(row.joint_fundraising_transfers) or 0.0,
        "pacs": _float(row.pac_contributions) or 0.0,
        "party": _float(row.party_contributions) or 0.0,
        "candidate": (_float(row.candidate_contributions) or 0.0)
        + (_float(row.candidate_loans) or 0.0),
    }
    amounts["other"] = max(receipts - sum(amounts.values()), 0.0)
    return [
        {
            "key": key,
            "label": label,
            "amount": round(amounts[key], 2),
            "share": share(amounts[key], receipts),
        }
        for key, label in FUNDING_MIX
    ]


def small_donor_share(row):
    """Individual money from donors whose gifts totaled $200 or less."""
    return share(row.individual_unitemized, row.individual_contributions)


def in_state_share(row):
    states = row.state_breakdown or {}
    return share(states.get("in_state"), states.get("total"))


def pac_share(row):
    return share(row.pac_contributions, row.receipts)


def metric_values(row):
    return {
        "receipts": _float(row.receipts),
        "small_donor_share": small_donor_share(row),
        "in_state_share": in_state_share(row),
        "pac_share": pac_share(row),
    }


def is_completed(election_year, today=None):
    """An election counts as finished once its calendar year is over."""
    today = today or date.today()
    return election_year < today.year


def latest_completed(rows, today=None):
    """The most recent finished election with money raised, or None.

    A member with two IDs for the same seat and year keeps the larger one.
    """
    candidates = [
        row for row in rows if row.receipts and is_completed(row.election_year, today)
    ]
    if not candidates:
        return None
    return max(candidates, key=lambda row: (row.election_year, row.receipts or Decimal(0)))


def percentile(value, others):
    """Share of `others` strictly below `value`; None without a comparison."""
    others = [other for other in others if other is not None]
    if value is None or not others:
        return None
    return round(sum(1 for other in others if other < value) / len(others), 4)


def peer_comparison(official, rows_by_official, officials_by_id, today=None):
    """Percentiles for the official's latest finished election.

    rows_by_official: official_id -> finance rows (current federal members).
    officials_by_id: official_id -> Official, for chamber and party.
    """
    target = latest_completed(rows_by_official.get(official.id, []), today)
    if target is None:
        return None

    chamber = chamber_for_office(official.office)
    peer_values = defaultdict(list)
    party_values = defaultdict(list)
    for other_id, rows in rows_by_official.items():
        other = officials_by_id.get(other_id)
        if other_id == official.id or other is None:
            continue
        if chamber_for_office(other.office) != chamber:
            continue
        latest = latest_completed(rows, today)
        if latest is None:
            continue
        same_party = bool(official.party) and other.party == official.party
        for key, value in metric_values(latest).items():
            peer_values[key].append(value)
            if same_party:
                party_values[key].append(value)

    values = metric_values(target)
    metrics = []
    for key, label in PEER_METRICS:
        chamber_others = [v for v in peer_values[key] if v is not None]
        party_others = [v for v in party_values[key] if v is not None]
        metrics.append(
            {
                "key": key,
                "label": label,
                "value": values[key],
                "chamber_percentile": percentile(values[key], chamber_others),
                "chamber_count": len(chamber_others),
                "party_percentile": percentile(values[key], party_others),
                "party_count": len(party_others),
            }
        )
    return {
        "election_year": target.election_year,
        "fec_candidate_id": target.fec_candidate_id,
        "chamber": chamber,
        "chamber_label": CHAMBER_LABELS[chamber],
        "party": official.party,
        "metrics": metrics,
    }
