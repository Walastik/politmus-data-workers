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


def normalize_party(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    return PARTY_ALIASES.get(value.strip().upper(), value.strip())


def normalize_state(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    stripped = value.strip()
    return STATE_NAME_BY_ABBR.get(stripped.upper(), stripped)
