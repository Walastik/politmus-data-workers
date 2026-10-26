"""General-election ballots for races where FEC can't tell us who is on them.

FEC never records primary results, and its pre-general (12G) filings are a
poor stand-in: they land late, and a sitting member who lost the primary
keeps filing them (John Cornyn in Texas, 2026). For the races listed here,
this list decides who is on the November ballot instead.

Each nominee is keyed by FEC candidate ID. Nominees FEC has no financial
filings for (common for third-party candidates who raise under $5,000) have
no ID; races still list them by name.

Texas is maintained by hand below. Every other state comes from
ballot_wikipedia.py, which reads Wikipedia: its daily run saves
ballot_snapshots rows, and ballots_<cycle>.json is the committed copy used
when a state has no row. A state listed by hand here takes precedence over
both. Add a state's races together, with its source, and re-check them when
the state certifies its ballot. Write-in candidates are not listed.

A race is complete only on a hand-verified ballot. Generated races never
are: Wikipedia's results boxes can miss minor candidates (they missed two
Texas Libertarians), and races read from an infobox (no results box yet)
may miss third-party and independent candidates. We'd rather flag a list
that turns out to be whole than imply one is whole when it isn't.
"""

import json
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

GENERATED_CYCLES = (2026,)
MAJOR_PARTIES = {"Democratic", "Republican"}


@dataclass(frozen=True)
class Nominee:
    fec_candidate_id: Optional[str]
    name: str
    party: str
    # Official campaign site, for candidates FEC lists no website for.
    website: Optional[str] = None


@dataclass(frozen=True)
class StateBallot:
    source: str
    races: dict  # (office, district) -> tuple[Nominee, ...]
    # Races whose source may be missing candidates.
    partial: frozenset = field(default_factory=frozenset)
    # Checked by a person against the state's candidate lists.
    verified: bool = False


# Texas, November 3, 2026. Major-party, independent and Green nominees from
# Wikipedia's 2026 Texas Senate and House election articles (general election
# results boxes); Libertarians from the Libertarian Party of Texas candidate
# page (lptexas.org/Candidates). Campaign websites from the House and Senate
# articles' "Official campaign websites" links. Checked 2026-10-25.
TX_2026 = {
    ("S", 0): (
        Nominee('S6TX00388', "Ken Paxton", "Republican", 'https://www.kenpaxton.com/'),
        Nominee('S6TX00479', "James Talarico", "Democratic", 'https://jamestalarico.com/'),
        Nominee('S4TX00888', "Ted Brown", "Libertarian", 'https://tedbrown.org/'),
    ),
    ("H", 1): (
        Nominee('H2TX01112', "Nathaniel Moran", "Republican", 'https://nathanielmoran.com/'),
        Nominee('H6TX01352', "Yolanda Prince", "Democratic", 'https://yolandaprince.com/'),
        Nominee(None, "Sonia Canciola", "Independent"),
    ),
    ("H", 2): (
        Nominee('H6TX08175', "Steve Toth", "Republican", 'https://stevetothforcongress.com/'),
        Nominee('H6TX02251', "Shaun Finnie", "Democratic", 'https://shaunfinnieforcongress.com/'),
    ),
    ("H", 3): (
        Nominee('H2TX00064', "Keith Self", "Republican", 'https://keithself.com/'),
        Nominee('H6TX03234', "Evan Hunt", "Democratic", 'https://www.electevanhunt.com/'),
    ),
    ("H", 4): (
        Nominee('H0TX04219', "Pat Fallon", "Republican", 'https://www.fallonforcongress.com/'),
        Nominee('H6TX04174', "Jason Pearce", "Democratic", 'https://www.pearcefortexas.com/'),
    ),
    ("H", 5): (
        Nominee('H8TX05144', "Lance Gooden", "Republican", 'https://www.lancegooden.com/'),
        Nominee('H6TX05189', "Chelsey Hockett", "Democratic", 'https://chelseyhockettforcongress.com/'),
    ),
    ("H", 6): (
        Nominee('H8TX06266', "Jake Ellzey", "Republican", 'https://ellzeyfortexas.com/'),
        Nominee('H6TX25203', "Danny Minton", "Democratic", 'https://dannyminton.com/'),
    ),
    ("H", 7): (
        Nominee('H8TX07140', "Lizzie Fletcher", "Democratic", 'https://www.lizziefletcher.com/'),
        Nominee('H6TX07151', "Alexander Hale", "Republican", 'https://www.halefortexas.com/'),
        Nominee('H6TX07177', "Espoir Ngabo", "Green", 'https://www.espoirfortexas.com/'),
    ),
    ("H", 8): (
        Nominee('H6TX08209', "Jessica Steinmann", "Republican", 'https://www.jessicasteinmann.com/'),
        Nominee('H0TX08145', "Laura Jones", "Democratic", 'https://www.laura4tx.com/'),
    ),
    ("H", 9): (
        Nominee('H6TX09231', "Leticia Gutierrez", "Democratic", 'https://www.leticiaforcongress.com/'),
        Nominee('H6TX09140', "Alex Mealer", "Republican", 'https://alexandramealer.com/'),
    ),
    ("H", 10): (
        Nominee('H6TX10221', "Chris Gober", "Republican", 'https://www.chrisgober.com/'),
        Nominee('H6TX31102', "Caitlin Rourk", "Democratic", 'https://www.caitlinrourk.com/'),
    ),
    ("H", 11): (
        Nominee('H0TX11230', "August Pfluger", "Republican", 'https://www.augustpfluger.com/'),
        Nominee('H6TX11112', "Claire Reynolds", "Democratic", 'https://clairereynoldsforcongress.org/'),
    ),
    ("H", 12): (
        Nominee('H4TX12065', "Craig Goldman", "Republican", 'https://www.craiggoldman.org/'),
        Nominee('H6TX12169', "Angela Rodriguez Prilliman", "Democratic", 'https://www.helifortexas.com/'),
    ),
    ("H", 13): (
        Nominee('H0TX13228', "Ronny Jackson", "Republican", 'https://ronnyjacksontx.com/'),
        Nominee('H6TX13159', "Mark Nair", "Democratic", 'https://www.marknair.com/'),
    ),
    ("H", 14): (
        Nominee('H2TX14149', "Randy Weber", "Republican", 'https://www.randyweber.org/'),
        Nominee('H6TX14181', "Thurman Bartie", "Democratic", 'https://votebartie.org/'),
    ),
    ("H", 15): (
        Nominee('H0TX15124', "Monica De La Cruz", "Republican", 'https://www.monicaforcongress.us/'),
        Nominee('H6TX15246', "Bobby Pulido", "Democratic", 'https://bobbypulidofortexas.com/'),
    ),
    ("H", 16): (
        Nominee('H8TX16109', "Veronica Escobar", "Democratic", 'https://veronicaescobar.com/'),
        Nominee('H6TX16152', "Adam Bauman", "Republican", 'https://www.adambaumanforcongress.com/'),
    ),
    ("H", 17): (
        Nominee('H2TX03126', "Pete Sessions", "Republican", 'https://www.petesessions.com/'),
        Nominee('H6TX17168', "Casey Shepard", "Democratic", 'https://caseyshepardforcongress.com/'),
    ),
    ("H", 18): (
        Nominee('H6TX18232', "Christian Menefee", "Democratic", 'https://christianmenefee.com/'),
        Nominee('H6TX18497', "Ronald Whitfield", "Republican"),
    ),
    ("H", 19): (
        Nominee('H6TX19206', "Tom Sell", "Republican", 'https://www.selltexastrue.com/'),
        Nominee('H6TX19198', "Kyle Rable", "Democratic", 'https://www.rableforwesttexas.com/'),
    ),
    ("H", 20): (
        Nominee('H2TX35011', "Joaquin Castro", "Democratic", 'https://castroforcongress.com/'),
        Nominee('H6TX20113', "Edgardo Baez", "Republican", 'https://www.drbaezforcongress.com/'),
    ),
    ("H", 21): (
        Nominee('H6TX21301', "Mark Teixeira", "Republican", 'https://teixeiraforcongress.com/'),
        Nominee('H4TX21108', "Kristin Hook", "Democratic", 'https://www.drkristinhook.org/'),
    ),
    ("H", 22): (
        Nominee('H6TX22283', "Trever Nehls", "Republican", 'https://www.trevernehlsforcongress.com/'),
        Nominee('H4TX22197', "Marquette Greene-Scott", "Democratic", 'https://marquettegreenescott.com/'),
    ),
    ("H", 23): (
        Nominee('H4TX23120', "Brandon Herrera", "Republican", 'https://brandonherreraforcongress.com/'),
        Nominee('H6TX23273', "Katy Padilla Stout", "Democratic", 'https://www.katyforcongress.com/'),
    ),
    ("H", 24): (
        Nominee('H0TX24209', "Beth Van Duyne", "Republican", 'https://bethfortexas.com/'),
        Nominee('H6TX24172', "Kevin Burge", "Democratic", 'https://www.burgeforcongress.com/'),
    ),
    ("H", 25): (
        Nominee('H2TX33040', "Roger Williams", "Republican", 'https://www.rogerforcongress.com/'),
        Nominee('H6TX25237', "Dione Sims", "Democratic", 'https://dionesimsforcongress.com/'),
    ),
    ("H", 26): (
        Nominee('H4TX26149', "Brandon Gill", "Republican", 'https://brandongillforcongress.com/'),
        Nominee('H6TX26144', "Steven Shook", "Democratic", 'https://shookforcongress2026.com/'),
        Nominee(None, "Phil Gray", "Libertarian"),
    ),
    ("H", 27): (
        Nominee('H8TX27049', "Michael Cloud", "Republican", 'https://www.cloudforcongress.com/'),
        Nominee('H4TX27089', "Tanya Lloyd", "Democratic", 'https://www.tanyafortexas.com/'),
        Nominee('H0TX20124', "Dan McQueen", "Independent", 'https://mcqueenforcongress.com/'),
    ),
    ("H", 28): (
        Nominee('H2TX23082', "Henry Cuellar", "Democratic", 'https://henrycuellar.com/'),
        Nominee('H6TX28124', "Tano Tijerina", "Republican", 'https://www.tanoforcongress.com/'),
    ),
    ("H", 29): (
        Nominee('H8TX29052', "Sylvia Garcia", "Democratic", 'https://www.sylviaforcongress.com/'),
        Nominee('H6TX29122', "Martha Fierro", "Republican", 'https://www.fierrofortexas.com/'),
    ),
    ("H", 30): (
        Nominee('H6TX30245', "Frederick Haynes III", "Democratic", 'https://www.haynesforcongress.com/'),
        Nominee('H6TX30211', "Everett Jackson", "Republican", 'https://jacksonfortexas.com/'),
    ),
    ("H", 31): (
        Nominee('H2TX31044', "John Carter", "Republican", 'https://www.johncarterforcongress.com/'),
        Nominee('H6TX31094', "Justin Early", "Democratic", 'https://www.votejustinearly.com/'),
    ),
    ("H", 32): (
        Nominee('H6TX32217', "Dan Barrios", "Democratic", 'https://www.danbarriosforcongress.com/'),
        Nominee('H6TX32225', "Jace Yarbrough", "Republican", 'https://www.jaceforcongress.com/'),
    ),
    ("H", 33): (
        Nominee('H8TX32098', "Colin Allred", "Democratic", 'https://colinallred.com/'),
        Nominee('H2TX33248', "Patrick Gillespie", "Republican", 'https://patrickgillespie4congress33.com/'),
    ),
    ("H", 34): (
        Nominee('H6TX15162', "Vicente Gonzalez", "Democratic", 'https://www.vicentegonzalez.com/'),
        Nominee('H6TX34080', "Eric Flores", "Republican", 'https://www.ericflores.com/'),
        Nominee(None, "Chris Royal", "Libertarian", 'https://chriscongress.com/'),
    ),
    ("H", 35): (
        Nominee('H6TX35095', "Johnny Garcia", "Democratic", 'https://www.votejohnnygarcia.com/'),
        Nominee('H6TX35087', "Carlos De La Cruz", "Republican", 'https://www.carlosforcongress.com/'),
    ),
    ("H", 36): (
        Nominee('H6TX02079', "Brian Babin", "Republican", 'https://www.babinforcongress.com/'),
        Nominee('H4TX14111', "Rhonda Hart", "Democratic", 'https://www.hart4congress.com/'),
    ),
    ("H", 37): (
        Nominee('H2TX35144', "Greg Casar", "Democratic", 'https://www.casarforcongress.com/'),
        Nominee('H6TX35038', "Lauren Peña", "Republican", 'https://www.lauren4congress.com/'),
    ),
    ("H", 38): (
        Nominee('H6TX02244', "Jon Bonck", "Republican", 'https://www.jonbonck.com/'),
        Nominee('H4TX38011', "Melissa McDonough", "Democratic", 'https://melissaforcongress.com/'),
    ),
}

HAND_MAINTAINED = {
    (2026, "TX"): StateBallot(
        source="Wikipedia and the Libertarian Party of Texas, checked Oct. 25, 2026",
        races=TX_2026,
        verified=True,
    ),
}


def ballot_from_data(source, races):
    """A StateBallot from ballot_wikipedia.py's race dicts."""
    return StateBallot(
        source=source,
        races={
            (race["office"], race["district"]): tuple(Nominee(**n) for n in race["nominees"])
            for race in races
        },
        partial=frozenset(
            (race["office"], race["district"]) for race in races if not race.get("complete", True)
        ),
    )


def load_generated(cycle, path=None):
    """(cycle, state) -> StateBallot from ballots_<cycle>.json, if it exists."""
    path = path or Path(__file__).with_name(f"ballots_{cycle}.json")
    if not path.exists():
        return {}
    data = json.loads(path.read_text())
    return {
        (cycle, state): ballot_from_data(ballot["source"], ballot["races"])
        for state, ballot in data["states"].items()
    }


BALLOTS = {
    **{key: ballot for cycle in GENERATED_CYCLES for key, ballot in load_generated(cycle).items()},
    **HAND_MAINTAINED,
}

# Snapshot rows change once a day; re-read them at most this often.
SNAPSHOT_CACHE_SECONDS = 600
_snapshot_cache = {"at": None, "ballots": None}


def current_ballots(session):
    """BALLOTS with the latest ballot_snapshots rows over the committed JSON;
    hand-maintained states still win."""
    from models import BallotSnapshot

    now = time.monotonic()
    if _snapshot_cache["at"] is None or now - _snapshot_cache["at"] >= SNAPSHOT_CACHE_SECONDS:
        snapshots = {
            (row.cycle, row.state): ballot_from_data(row.source, row.races)
            for row in session.query(BallotSnapshot).all()
        }
        _snapshot_cache.update(at=now, ballots=snapshots)
    return {
        **BALLOTS,
        **{key: ballot for key, ballot in _snapshot_cache["ballots"].items() if key not in HAND_MAINTAINED},
    }


def clear_snapshot_cache():
    _snapshot_cache.update(at=None, ballots=None)


def nominee_websites(ballots=None):
    """FEC candidate ID -> campaign website, across every listed ballot."""
    return {
        n.fec_candidate_id: n.website
        for ballot in (ballots or BALLOTS).values()
        for nominees in ballot.races.values()
        for n in nominees
        if n.fec_candidate_id and n.website
    }


def fill_websites(session):
    """Give nominees with no website on file their campaign site; returns how many.

    The positions worker (official_positions.py --level candidate) only crawls
    candidates with a website_url, and FEC committees often list none.
    """
    from models import Candidacy, Official

    websites = nominee_websites(current_ballots(session))
    rows = (
        session.query(Official)
        .join(Candidacy, Candidacy.official_id == Official.id)
        .filter(Candidacy.fec_candidate_id.in_(websites))
        .all()
    )
    filled = 0
    for official in rows:
        if official.website_url:
            continue
        site = next((websites[f] for f in official.fec_candidate_ids or [] if f in websites), None)
        if site:
            official.website_url = site
            filled += 1
    return filled


def ballot_for(year, state, office, district, ballots=None):
    """(nominees, source, complete) for a race on a listed ballot, else None."""
    ballot = (ballots or BALLOTS).get((year, state))
    if ballot is None:
        return None
    key = (office, district if office == "H" else 0)
    nominees = ballot.races.get(key)
    if nominees is None:
        return None
    return nominees, ballot.source, ballot.verified and key not in ballot.partial
