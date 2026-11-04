from election_results import (
    CLARITY_HOUSE,
    CLARITY_SENATE,
    EV_HOUSE,
    EV_SENATE,
    NC_HOUSE,
    RI_TOWN_COUNTY,
    TV_HOUSE,
    TV_SENATE,
    clean_name,
    county_key,
    display_name,
    fold_localities,
    sc_contest,
    tv_county_votes,
    tv_district,
    tv_updated,
    nc_timestamp,
    oh_race_key,
    party_code,
    same_person,
)


def test_clean_name_strips_party_and_marks_incumbent():
    assert clean_name("Jon Ossoff (I) (Dem)") == ("Jon Ossoff", True)
    assert clean_name("Mike Collins (Rep)") == ("Mike Collins", False)


def test_county_key_matches_map_names():
    assert county_key("APPLING COUNTY") == "Appling"
    assert county_key("Appling County") == "Appling"
    assert county_key("ALEXANDRIA CITY") == "Alexandria city"
    assert county_key("Fairfax County") == "Fairfax"
    assert county_key("DeKalb County") == "DeKalb"
    assert county_key("MCDOWELL") == "McDowell"
    assert county_key("NEW HANOVER") == "New Hanover"


def test_party_codes():
    assert party_code("Dem") == "DEM"
    assert party_code("R") == "REP"
    assert party_code("LBR") == "LIB"
    assert party_code("UNA") == "IND"
    assert party_code("FWD") == "OTH"
    assert party_code("") == ""


def test_federal_contest_names():
    assert EV_SENATE.search("Senator in Congress")
    assert EV_HOUSE.search("Representative in Congress District 2").group(2) == "2"
    assert EV_SENATE.search("US Senate")
    assert EV_SENATE.search("Member, United States Senate")
    assert not EV_SENATE.search("State Senate - District 1")
    assert EV_HOUSE.search("US House of Representatives - District 14").group(2) == "14"
    assert EV_HOUSE.search("Member, House of Representatives (2nd District)").group(2) == "2"
    assert not EV_HOUSE.search("State House of Representatives - District 1")
    assert not EV_HOUSE.search("Member, House of Delegates (20th District)")
    assert CLARITY_SENATE.search("United States Senator")
    assert CLARITY_HOUSE.search("Representative to the 120th United States Congress - District 8").group(1) == "8"
    assert CLARITY_HOUSE.search("United States Representative District 3").group(1) == "3"
    assert not CLARITY_HOUSE.search("State Board of Education Member - Congressional District 1")
    assert NC_HOUSE.match("US HOUSE OF REPRESENTATIVES DISTRICT 05 (VOTE FOR 1)").group(1) == "05"
    assert oh_race_key("U.S. Senator") == ("S", 0)
    assert oh_race_key("Representative to Congress - District 02") == ("H", 2)
    assert oh_race_key("State Representative - District 90") is None


def test_same_person_tolerates_fec_name_forms():
    assert same_person("Ashley Hinson Arenholz", "Ashley Hinson")
    assert same_person("Robert J. Wittman", 'Robert J. "Rob" Wittman')
    assert same_person("Richard N. Ojeda II", "Richard N. Ojeda II")
    assert not same_person("Mike Collins", "Jon Ossoff")


def test_nc_timestamp_is_eastern():
    assert nc_timestamp("November 4, 2026 6:35 am") == "2026-11-04T06:35:00-05:00"
    assert nc_timestamp(None) is None


def test_party_codes_take_the_first_fusion_party():
    assert party_code("Democrat, Working Families") == "DEM"
    assert party_code("Republican, Libertarian") == "REP"
    assert party_code("By Petition") == "IND"


def test_display_name_fixes_all_caps_only():
    assert display_name("BEN R LUJAN") == "Ben R Lujan"
    assert display_name('MICHAEL "DR. MIKE" KATZ') == 'Michael "Dr. Mike" Katz'
    assert display_name("SARAH MCBRIDE") == "Sarah McBride"
    assert display_name("Pete Ricketts") == "Pete Ricketts"


def test_county_aliases_match_the_map():
    assert county_key("Lewis & Clark") == "Lewis and Clark"
    assert county_key("Dona Ana") == "Doña Ana"


def test_rhode_island_towns_fold_into_counties():
    assert len(RI_TOWN_COUNTY) == 39
    folded = fold_localities({"Warwick": [10, 5], "Coventry": [3, 4], "Newport": [7, 1], "Federal Precincts": [9, 9]}, RI_TOWN_COUNTY)
    assert folded == {"Kent": [13, 9], "Newport": [7, 1]}


def test_totalvote_contest_names():
    assert TV_SENATE.search("UNITED STATES SENATOR")
    assert TV_SENATE.search("US Senator")
    assert TV_HOUSE.search("For Representative in Congress - 2 Year Term - District 01")
    assert not TV_HOUSE.search("STATE REPRESENTATIVE DISTRICT 1")
    assert tv_district("UNITED STATES REPRESENTATIVE 2ND CONGRESSIONAL") == 2
    assert tv_district("US Representative, 4th District") == 4
    assert tv_district("For Representative in Congress - 2 Year Term - District 03") == 3
    assert tv_district("United States Representative") == 0


def test_totalvote_times():
    assert tv_updated("Results last updated: 11/4/2026 | 1:00 PM PT", "America/Los_Angeles") == "2026-11-04T13:00:00-08:00"
    assert tv_updated("Results last updated: 11/4/2026 2:05:25 PM MT", "America/Denver") == "2026-11-04T14:05:00-07:00"
    assert tv_updated("no stamp", "America/Denver") is None


def test_totalvote_county_export_merges_vote_centers():
    sheet = [
        ["2026 Unofficial General Election Results"],
        ["United States Senator", "County", "Brian L Bengs", "Mike  Rounds"],
        [None, "Brown", "100", "200"],
        [None, "Brown (Vote Center)", "10", "20"],
        [None, "Lewis & Clark", "1", "2"],
        [None, "TOTALS", "111", "222"],
    ]
    assert tv_county_votes({"s": sheet}, ["Mike Rounds", "Brian L Bengs"]) == {"Brown": [220, 110], "Lewis and Clark": [2, 1]}


def test_south_carolina_contest_sheet():
    block = ["Election Day", "Early Voting", "Total Votes"]
    rows = [
        ["U.S.  Senate (Vote For 1)"],
        [None, None, "REP Darline Graham", None, None, "DEM Annie Andrews", None, None, "Write-In", None, None, ""],
        ["County", "Registered Voters", *block, *block, *block, "Total"],
        ["Abbeville", "15697", "1", "2", "3", "4", "5", "9", "0", "0", "0", "12"],
        ["Aiken", "116511", "10", "20", "30", "40", "50", "90", "1", "0", "1", "121"],
        ["Total:", "", "11", "22", "33", "44", "55", "99", "1", "0", "1", "133"],
    ]
    candidates, counties = sc_contest(rows)
    assert [(c.name, c.party, c.votes, c.write_in) for c in candidates] == [
        ("Darline Graham", "REP", 33, False),
        ("Annie Andrews", "DEM", 99, False),
        ("Write-In", "", 1, True),
    ]
    assert counties == {"Abbeville": [3, 9, 0], "Aiken": [30, 90, 1]}
