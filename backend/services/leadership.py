"""The top posts in Congress: the Speaker and each chamber's floor leaders.

Two sources, both stored on officials:

- legislators_leadership: the post in unitedstates/congress-legislators'
  leadership_roles, which gives clean titles with chamber and dates. Loaded
  daily by `fec_client.py crosswalk`. This is the main source.
- congress_gov_leadership: the Congress.gov member detail `leadership` entries
  marked current, as Congress.gov words them ("Majority Leader", "Democratic
  Leader Chair of the Conference"). Loaded by `congress_client.py members`.

refresh() resolves officials.leadership_role, the title the app shows, and
reports each post the sources disagree on. congress-legislators wins a
disagreement; Congress.gov fills a post congress-legislators has no one in
(it can lag at the start of a Congress). A post neither source fills is
vacant.
"""

import re
from datetime import date

from models import Official

SPEAKER = "Speaker of the House"
HOUSE_MAJORITY_LEADER = "House Majority Leader"
HOUSE_MINORITY_LEADER = "House Minority Leader"
SENATE_MAJORITY_LEADER = "Senate Majority Leader"
SENATE_MINORITY_LEADER = "Senate Minority Leader"

# In display order; congress-legislators uses these exact titles.
TOP_POSTS = (
    SPEAKER,
    HOUSE_MAJORITY_LEADER,
    HOUSE_MINORITY_LEADER,
    SENATE_MAJORITY_LEADER,
    SENATE_MINORITY_LEADER,
)

# "Assistant Leader", "Majority Whip" and the like are not top posts.
_SIDE_LEADER = re.compile(r"^(Majority|Minority) Leader\b")
_PARTY_LEADER = re.compile(r"^(Democratic|Republican) Leader\b")
MAJOR_PARTIES = ("Democratic", "Republican")


def legislators_post(legislator, today=None):
    """The top post a congress-legislators entry holds today, or None.

    A role's end date is the day the next Congress convenes, so it is over
    on that day.
    """
    today = (today or date.today()).isoformat()
    for role in legislator.get("leadership_roles") or []:
        title = role.get("title")
        if title not in TOP_POSTS:
            continue
        if (role.get("start") or "") > today:
            continue
        if role.get("end") and role["end"] <= today:
            continue
        return title
    return None


def congress_gov_types(member):
    """Congress.gov member detail -> the leadership types marked current."""
    return [
        entry["type"]
        for entry in member.get("leadership") or []
        if entry.get("current") and entry.get("type")
    ]


def chamber_of(official):
    return "Senate" if official.office == "Senator" else "House"


def majority_party(officials, chamber):
    """The major party with the most current members in the chamber."""
    counts = {party: 0 for party in MAJOR_PARTIES}
    for official in officials:
        if chamber_of(official) == chamber and official.party in counts:
            counts[official.party] += 1
    if counts["Democratic"] == counts["Republican"]:
        return None
    return max(counts, key=counts.get)


def congress_gov_post(types, chamber, majority):
    """Map Congress.gov's current leadership types to a top post, or None.

    Congress.gov sometimes names a floor leader by party ("Democratic Leader
    Chair of the Conference"); that leader is the majority leader when their
    party holds the chamber.
    """
    for kind in types or []:
        if kind.startswith("Speaker"):
            return SPEAKER if chamber == "House" else None
        match = _SIDE_LEADER.match(kind)
        if match:
            return f"{chamber} {match.group(1)} Leader"
        match = _PARTY_LEADER.match(kind)
        if match and majority:
            side = "Majority" if match.group(1) == majority else "Minority"
            return f"{chamber} {side} Leader"
    return None


def resolve(officials):
    """Pick each top post's holder from the two sources.

    Returns ({official_id: title}, [disagreement messages]). Pass the current
    federal members. Congress.gov is only compared once it has been loaded
    (congress_gov_leadership is set on someone).
    """
    majority = {chamber: majority_party(officials, chamber) for chamber in ("House", "Senate")}
    congress_gov_loaded = any(o.congress_gov_leadership is not None for o in officials)
    named = {title: ([], []) for title in TOP_POSTS}
    for official in officials:
        if official.legislators_leadership in named:
            named[official.legislators_leadership][0].append(official)
        chamber = chamber_of(official)
        title = congress_gov_post(official.congress_gov_leadership, chamber, majority[chamber])
        if title:
            named[title][1].append(official)

    holders = {}
    problems = []
    for title, (legislators, congress_gov) in named.items():
        if len(legislators) == 1:
            holder = legislators[0]
        # Congress.gov fills an empty post, or picks between two listed holders.
        elif len(congress_gov) == 1 and (not legislators or congress_gov[0] in legislators):
            holder = congress_gov[0]
        else:
            holder = None
        if holder is not None:
            holders[holder.id] = title
        if not congress_gov_loaded:
            continue
        if {o.id for o in legislators} != {o.id for o in congress_gov} or len(legislators) > 1:
            problems.append(
                f"{title}: congress-legislators lists {_names(legislators)}, "
                f"Congress.gov lists {_names(congress_gov)}"
            )
    return holders, problems


def _names(officials):
    return " and ".join(sorted(o.display_name or o.id for o in officials)) or "no one"


def refresh(session, log=print):
    """Set officials.leadership_role from both sources and report disagreements.

    The caller commits. Warnings are printed as GitHub Actions annotations so
    a scheduled run surfaces them.
    """
    current = (
        session.query(Official)
        .filter(Official.current_member.is_(True), Official.level == "federal")
        .all()
    )
    holders, problems = resolve(current)
    for official in session.query(Official).filter(Official.leadership_role.isnot(None)):
        if official.id not in holders:
            official.leadership_role = None
    for official in current:
        if official.id in holders:
            official.leadership_role = holders[official.id]
    for problem in problems:
        log(f"::warning::Leadership sources disagree. {problem}")
    vacant = [title for title in TOP_POSTS if title not in holders.values()]
    log(
        f"Leadership: {len(holders)} of {len(TOP_POSTS)} top posts filled"
        + (f"; vacant: {', '.join(vacant)}" if vacant else "")
        + "."
    )
    return holders, problems
