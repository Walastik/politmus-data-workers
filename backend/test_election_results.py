from election_results import (
    clarity_name,
    CLARITY_HOUSE,
    CLARITY_SENATE,
    EV_HOUSE,
    EV_SENATE,
    NC_HOUSE,
    LA_PARISHES,
    MN_COUNTIES,
    RI_TOWN_COUNTY,
    ak_name,
    ak_races,
    fl_races,
    la_choice,
    mn_races,
    TV_HOUSE,
    TV_SENATE,
    clean_name,
    county_key,
    display_name,
    fold_localities,
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
    assert CLARITY_HOUSE.search("U.S.  House of Representatives, District  7").group(1) == "7"
    assert CLARITY_SENATE.search("U.S.  Senate")
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


def test_minnesota_county_file():
    text = "\n".join(
        [
            "MN;01;;0102;U.S. Senator;;0403;Peggy Flanagan;;;DFL;51;51;2964;33.10;8954",
            "MN;01;;0102;U.S. Senator;;0302;Michele Tafoya;;;R;51;51;5800;64.8;8954",
            "MN;27;;0102;U.S. Senator;;0403;Peggy Flanagan;;;DFL;400;420;300000;70;400000",
            "MN;27;;0102;U.S. Senator;;0302;Michele Tafoya;;;R;400;420;100000;25;400000",
            "MN;27;;0102;U.S. Senator;;9901;WRITE-IN;;;WI;400;420;50;0.01;400000",
            "MN;27;;0108;U.S. Representative District 5;05;0401;Ilhan Omar;;I;DFL;200;200;262702;80;300000",
            "MN;27;;0302;State Senator District 1;01;0401;Someone;;;DFL;1;1;5;50;10",
        ]
    )
    senate, house = mn_races(text)
    assert MN_COUNTIES[26] == "Hennepin" and len(MN_COUNTIES) == 87
    assert [(c.name, c.party, c.votes, c.write_in) for c in senate.candidates] == [
        ("Peggy Flanagan", "DEM", 302964, False),
        ("Michele Tafoya", "REP", 105800, False),
        ("Write-in", "", 50, True),
    ]
    assert senate.counties["Hennepin"] == [300000, 100000, 50]
    assert senate.reporting == {"done": 451, "total": 471, "unit": "precincts"}
    assert (house.office, house.district, house.candidates[0].incumbent) == ("H", 5, True)


def test_florida_file_skips_repeated_rows():
    header = "ElectionDate\tPartyCode\tPartyName\tRaceCode\tRaceName\tCountyCode\tCountyName\tJuris1num\tJuris2num\tPrecincts\tPrecinctsReporting\tCanNameLast\tCanNameFirst\tCanNameMiddle\tCanVotes"
    row = "11/03/2026\t{p}\tx\t{rc}\t{rn}\tALA\tAlachua\t \t \t63\t63\t{last}\t{first}\t\t{v}"
    lines = [
        header,
        row.format(p="REP", rc="USS", rn="United States Senator", last="Moody", first="Ashley", v=34791),
        row.format(p="REP", rc="USS", rn="United States Senator", last="Moody", first="Ashley", v=34791),
        row.format(p="DEM", rc="USS", rn="United States Senator", last="Nixon", first="Angie", v=69665),
        row.format(p="REP", rc="USR", rn="Representative in Congress, District 3", last="Cammack", first="Kat", v=100),
        row.format(p="REP", rc="GOV", rn="Governor", last="Donalds", first="Byron", v=1),
    ]
    senate, house = fl_races("\n".join(lines))
    assert [(c.name, c.votes) for c in senate.candidates] == [("Ashley Moody", 34791), ("Angie Nixon", 69665)]
    assert senate.counties == {"Alachua": [34791, 69665]}
    assert (house.district, house.candidates[0].name) == (3, "Kat Cammack")


def test_louisiana_choices_and_parishes():
    assert la_choice('"Jamie" Davis (DEM)') == ('"Jamie" Davis', "DEM")
    assert la_choice('E. "Liddy" Glass (NOPTY)') == ('E. "Liddy" Glass', "IND")
    assert len(LA_PARISHES) == 64 and LA_PARISHES[35] == "Orleans"


def test_alaska_precinct_file():
    assert ak_name("Sullivan, Dan S.") == "Dan S. Sullivan"
    assert ak_name("Sullivan, Daniel J. Jr.") == "Daniel J. Sullivan Jr."
    head = "Pct_Id,Reg_voters,Contest_title,candidate_name,Party_Code,total_ballots,total_votes"
    text = "\n".join(
        [
            head,
            '01-600,2235,U.S. Senator,"Peltola, Mary",DEM,491,263',
            '01-600,2235,U.S. Senator,"Sullivan, Dan S.",REP,491,200',
            '01-610,1000,U.S. Senator,"Peltola, Mary",DEM,0,0',
            '01-610,1000,U.S. Senator,"Sullivan, Dan S.",REP,0,0',
            '01-600,2235,State House District 1,"Someone, A.",REP,491,400',
        ]
    )
    races, registered, ballots = ak_races(text)
    assert races[0].label == "U.S. Senate (first choices)"
    assert [(c.name, c.votes) for c in races[0].candidates] == [("Mary Peltola", 263), ("Dan S. Sullivan", 200)]
    assert races[0].reporting == {"done": 1, "total": 2, "unit": "precincts"}
    assert (registered, ballots) == (3235, 491)


def test_clarity_names_drop_a_party_prefix():
    assert clarity_name("REP Darline Graham", "REP") == "Darline Graham"
    assert clarity_name("Jon Ossoff", "DEM") == "Jon Ossoff"
