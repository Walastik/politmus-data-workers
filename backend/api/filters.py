from typing import Optional

# Congress.gov stores full party names. Accept the short codes a UI is likely to send.
PARTY_ALIASES = {
    "D": "Democratic",
    "DEM": "Democratic",
    "DEMOCRAT": "Democratic",
    "DEMOCRATIC": "Democratic",
    "R": "Republican",
    "REP": "Republican",
    "GOP": "Republican",
    "REPUBLICAN": "Republican",
    "I": "Independent",
    "IND": "Independent",
    "INDEPENDENT": "Independent",
    "ID": "Independent",
    "L": "Libertarian",
    "LIB": "Libertarian",
    "LIBERTARIAN": "Libertarian",
}

# Congress.gov stores full state names. Accept postal abbreviations too.
STATE_NAME_BY_ABBR = {
    "AL": "Alabama",
    "AK": "Alaska",
    "AZ": "Arizona",
    "AR": "Arkansas",
    "CA": "California",
    "CO": "Colorado",
    "CT": "Connecticut",
    "DE": "Delaware",
    "DC": "District of Columbia",
    "FL": "Florida",
    "GA": "Georgia",
    "HI": "Hawaii",
    "ID": "Idaho",
    "IL": "Illinois",
    "IN": "Indiana",
    "IA": "Iowa",
    "KS": "Kansas",
    "KY": "Kentucky",
    "LA": "Louisiana",
    "ME": "Maine",
    "MD": "Maryland",
    "MA": "Massachusetts",
    "MI": "Michigan",
    "MN": "Minnesota",
    "MS": "Mississippi",
    "MO": "Missouri",
    "MT": "Montana",
    "NE": "Nebraska",
    "NV": "Nevada",
    "NH": "New Hampshire",
    "NJ": "New Jersey",
    "NM": "New Mexico",
    "NY": "New York",
    "NC": "North Carolina",
    "ND": "North Dakota",
    "OH": "Ohio",
    "OK": "Oklahoma",
    "OR": "Oregon",
    "PA": "Pennsylvania",
    "RI": "Rhode Island",
    "SC": "South Carolina",
    "SD": "South Dakota",
    "TN": "Tennessee",
    "TX": "Texas",
    "UT": "Utah",
    "VT": "Vermont",
    "VA": "Virginia",
    "WA": "Washington",
    "WV": "West Virginia",
    "WI": "Wisconsin",
    "WY": "Wyoming",
    "AS": "American Samoa",
    "GU": "Guam",
    "MP": "Northern Mariana Islands",
    "PR": "Puerto Rico",
    "VI": "Virgin Islands",
}

STATE_ABBR_BY_NAME = {name.lower(): abbr for abbr, name in STATE_NAME_BY_ABBR.items()}

BIPARTISAN_SINGLE_PARTY = "single_party"
BIPARTISAN_BIPARTISAN = "bipartisan"
BIPARTISAN_TRIPARTISAN = "tripartisan"


def normalize_party(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    return PARTY_ALIASES.get(value.strip().upper(), value.strip())


def classify_bipartisan_type(sponsor_party, party_breakdown):
    """Classify a measure by how many distinct parties sponsored or cosponsored it.

    One party → single_party, two → bipartisan, three or more → tripartisan.
    Independent next to one other party is bipartisan, not tripartisan.
    Returns None when no party data is present.
    """
    parties = set()
    if sponsor_party:
        parties.add(sponsor_party)
    for party, count in (party_breakdown or {}).items():
        if count:
            parties.add(party)
    if not parties:
        return None
    if len(parties) >= 3:
        return BIPARTISAN_TRIPARTISAN
    if len(parties) == 2:
        return BIPARTISAN_BIPARTISAN
    return BIPARTISAN_SINGLE_PARTY


def normalize_state(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    stripped = value.strip()
    return STATE_NAME_BY_ABBR.get(stripped.upper(), stripped)


def name_search_pattern(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    stripped = value.strip()
    if not stripped:
        return None
    escaped = (
        stripped.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    )
    return f"%{escaped}%"
