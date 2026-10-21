from datetime import date as Date, datetime
import re
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, computed_field, field_validator
from pydantic.alias_generators import to_camel


class OfficialOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: Optional[str] = None
    # Built from the name parts (Official.display_name); falls back to name.
    display_name: Optional[str] = None
    first_name: Optional[str] = None
    middle_name: Optional[str] = None
    last_name: Optional[str] = None
    suffix_name: Optional[str] = None
    nickname: Optional[str] = None
    honorific_name: Optional[str] = None
    state: Optional[str] = None
    party: Optional[str] = None
    office: Optional[str] = None
    district: Optional[int] = None
    current_member: bool = False
    phone: Optional[str] = None
    office_address: Optional[str] = None
    website_url: Optional[str] = None
    photo_url: Optional[str] = None
    photo_attribution: Optional[str] = None
    level: str = "federal"
    openstates_id: Optional[str] = None
    # Stated-positions worker status and saved count; None when not attempted.
    positions_status: Optional[str] = None
    positions_count: Optional[int] = None
    # Accountability score (services/accountability.py); None when unscored.
    score_points: Optional[int] = None
    score_pct: Optional[float] = None
    score_matches: Optional[int] = None


class OfficialVoteOut(BaseModel):
    bill_id: str
    bill_title: Optional[str] = None
    bill_summary: Optional[str] = None
    position: Optional[str] = None
    sponsor_name: Optional[str] = None
    roll_call_id: Optional[int] = None
    chamber: Optional[str] = None
    question: Optional[str] = None
    result: Optional[str] = None
    date: Optional[Date] = None


class OfficialStanceOut(BaseModel):
    """A policy position the official states, with the page it came from."""

    model_config = ConfigDict(from_attributes=True)

    issue_label: Optional[str] = None
    policy_area: Optional[str] = None
    target_name: Optional[str] = None
    mechanism: str
    direction: str
    stance: Optional[str] = None
    policy_direction: Optional[str] = None
    emphasis: Optional[str] = None
    scope: Optional[str] = None
    summary: Optional[str] = None
    evidence_quote: Optional[str] = None
    source_url: Optional[str] = None
    source_type: str = "official_site"
    extracted_at: Optional[datetime] = None
    extractor_version: Optional[str] = None
    model: Optional[str] = None


class PositionsSyncOut(BaseModel):
    """The stated-positions worker's last attempt for one official."""

    model_config = ConfigDict(from_attributes=True)

    status: str
    last_attempt_at: Optional[datetime] = None
    last_success_at: Optional[datetime] = None
    attempts: int = 0
    pages_found: Optional[int] = None
    stances_saved: Optional[int] = None
    last_error: Optional[str] = None
    extractor_version: Optional[str] = None


class AccountabilityScoreOut(BaseModel):
    """Totals from official_scores."""

    model_config = ConfigDict(from_attributes=True)

    points: int = 0
    aligned: int = 0
    conflicting: int = 0
    bills_scored: int = 0
    stances_matched: int = 0
    alignment_pct: Optional[float] = None
    by_policy_area: Optional[dict[str, dict[str, int]]] = None
    engine_version: str
    computed_at: datetime


class VoteAlignmentOut(BaseModel):
    """One scored match: the vote, what the bill does, what the official says."""

    model_config = ConfigDict(from_attributes=True)

    bill_id: str
    bill_title: Optional[str] = None
    roll_call_id: int
    chamber: Optional[str] = None
    vote_date: Optional[Date] = None
    vote_position: str
    target_name: Optional[str] = None
    mechanism: str
    effect_direction: str
    effect_magnitude: Optional[str] = None
    effect_rationale: Optional[str] = None
    stance_direction: str
    stance_emphasis: Optional[str] = None
    stance_summary: Optional[str] = None
    stance_evidence_quote: Optional[str] = None
    stance_source_url: Optional[str] = None
    policy_area: Optional[str] = None
    effect_relation: Optional[str] = None
    stance_scope: Optional[str] = None
    bill_effect_count: Optional[int] = None
    stance_target_name: Optional[str] = None
    match_similarity: Optional[float] = None
    match_inverse: bool = False
    points: int
    counted: bool = True
    reason: Optional[str] = None


class OfficialBioOut(BaseModel):
    """From Wikidata; lists are as Wikidata labels them."""

    description: Optional[str] = None
    birth_date: Optional[Date] = None
    occupations: list[str] = Field(default_factory=list)
    education: list[str] = Field(default_factory=list)
    positions_held: list[str] = Field(default_factory=list)


class CandidacyOut(BaseModel):
    """One race the official is running in (FEC)."""

    model_config = ConfigDict(from_attributes=True)

    fec_candidate_id: str
    election_year: int
    state: str
    office: str
    district: int = 0
    # services.candidate_races, filled in by the route.
    race_label: str = ""
    election_date: Optional[Date] = None
    party: Optional[str] = None
    # I (incumbent), C (challenger) or O (open seat).
    incumbent_challenge: Optional[str] = None
    in_general_election: bool = False
    receipts: Optional[float] = None
    cash_on_hand: Optional[float] = None
    coverage_end_date: Optional[Date] = None


class OfficialDetailOut(OfficialOut):
    votes: list[OfficialVoteOut] = Field(default_factory=list)
    stated_positions: list[OfficialStanceOut] = Field(default_factory=list)
    positions_sync: Optional[PositionsSyncOut] = None
    accountability: Optional[AccountabilityScoreOut] = None
    alignments: list[VoteAlignmentOut] = Field(default_factory=list)
    wikipedia_url: Optional[str] = None
    bio: Optional[OfficialBioOut] = None
    # Newest election first.
    candidacies: list[CandidacyOut] = Field(default_factory=list)


class RaceCandidateOut(BaseModel):
    official_id: str
    fec_candidate_id: str
    name: Optional[str] = None
    party: Optional[str] = None
    photo_url: Optional[str] = None
    website_url: Optional[str] = None
    incumbent_challenge: Optional[str] = None
    # True when official_id is a member's bioguide row (opens the roster drawer).
    is_member: bool = False
    current_member: bool = False
    in_general_election: bool = False
    receipts: Optional[float] = None
    disbursements: Optional[float] = None
    cash_on_hand: Optional[float] = None
    coverage_end_date: Optional[Date] = None
    positions_count: Optional[int] = None
    # From the detail sync (official_finance_totals), when it has run.
    small_donor_share: Optional[float] = None
    outside_support: Optional[float] = None
    outside_oppose: Optional[float] = None


class RaceOut(BaseModel):
    key: str
    election_year: int
    election_date: Date
    state: str
    state_name: str
    office: str
    district: int = 0
    label: str
    total_receipts: float = 0
    # True when the race only shows campaigns that filed a pre-general report.
    ballot_filtered: bool = False
    # Filers the default view leaves out (primary losers, tiny campaigns).
    hidden_count: int = 0
    candidates: list[RaceCandidateOut] = Field(default_factory=list)


class RacesPageOut(BaseModel):
    total_count: int
    items: list[RaceOut] = Field(default_factory=list)
    source: str = "Federal Election Commission (OpenFEC)"


class FinanceSizeBucketOut(BaseModel):
    # Lower bound in dollars: 0 ($200 and under), 200, 500, 1000, 2000 (and up).
    size: int
    total: float
    count: Optional[int] = None


class FinanceStateOut(BaseModel):
    state: str
    total: float
    count: Optional[int] = None


class FundingMixItemOut(BaseModel):
    key: str
    label: str
    amount: float
    share: Optional[float] = None


class OutsideSpenderOut(BaseModel):
    committee_id: Optional[str] = None
    name: Optional[str] = None
    total: float


class OutsideSpendingOut(BaseModel):
    """Independent expenditures (Schedule E) other groups made for or against."""

    support_total: float = 0
    oppose_total: float = 0
    support_count: int = 0
    oppose_count: int = 0
    top_support: list[OutsideSpenderOut] = Field(default_factory=list)
    top_oppose: list[OutsideSpenderOut] = Field(default_factory=list)


class PeerMetricOut(BaseModel):
    key: str
    label: str
    value: Optional[float] = None
    # Share of the comparison group below this official (0.82 = "more than 82%").
    chamber_percentile: Optional[float] = None
    chamber_count: int = 0
    party_percentile: Optional[float] = None
    party_count: int = 0


class PeerComparisonOut(BaseModel):
    """Latest finished election compared with the rest of the chamber."""

    election_year: int
    fec_candidate_id: str
    chamber: str
    chamber_label: str
    party: Optional[str] = None
    metrics: list[PeerMetricOut] = Field(default_factory=list)


class FinanceElectionOut(BaseModel):
    """OpenFEC totals for one candidate ID and election."""

    model_config = ConfigDict(from_attributes=True)

    fec_candidate_id: str
    election_year: int
    coverage_start_date: Optional[Date] = None
    coverage_end_date: Optional[Date] = None
    receipts: Optional[float] = None
    contributions: Optional[float] = None
    individual_contributions: Optional[float] = None
    individual_itemized: Optional[float] = None
    individual_unitemized: Optional[float] = None
    pac_contributions: Optional[float] = None
    party_contributions: Optional[float] = None
    candidate_contributions: Optional[float] = None
    candidate_loans: Optional[float] = None
    joint_fundraising_transfers: Optional[float] = None
    disbursements: Optional[float] = None
    cash_on_hand: Optional[float] = None
    debts: Optional[float] = None
    size_breakdown: Optional[list[FinanceSizeBucketOut]] = None
    # Share of individual giving in the $200-and-under bucket (per gift).
    small_dollar_share: Optional[float] = None
    # Share of individual money from donors whose gifts totaled $200 or less.
    small_donor_share: Optional[float] = None
    pac_share: Optional[float] = None
    funding_mix: Optional[list[FundingMixItemOut]] = None
    # Itemized individual giving only.
    home_state: Optional[str] = None
    in_state_share: Optional[float] = None
    top_states: Optional[list[FinanceStateOut]] = None
    outside_spending: Optional[OutsideSpendingOut] = None
    fetched_at: Optional[datetime] = None

    @computed_field
    @property
    def fec_url(self) -> str:
        return f"https://www.fec.gov/data/candidate/{self.fec_candidate_id}/"


class OfficialFinanceOut(BaseModel):
    official_id: str
    fec_candidate_ids: list[str] = Field(default_factory=list)
    opensecrets_id: Optional[str] = None
    opensecrets_url: Optional[str] = None
    source: str = "Federal Election Commission (OpenFEC)"
    # Newest election first.
    elections: list[FinanceElectionOut] = Field(default_factory=list)
    peer_comparison: Optional[PeerComparisonOut] = None
    # The race the official is running in this cycle, side by side.
    race_comparison: Optional[RaceOut] = None


class PacCategoryOut(BaseModel):
    key: str
    label: str
    total: float
    share: Optional[float] = None
    pac_count: int
    gift_count: int


class PacOut(BaseModel):
    """All of one PAC's gifts to the official in one election, combined."""

    # contributor committee ID, or the name when FEC has no ID; pass it back
    # to /finance/pacs/gifts.
    pac_key: str
    committee_id: Optional[str] = None
    name: Optional[str] = None
    category: str
    category_label: str
    total: float
    gift_count: int
    first_date: Optional[Date] = None
    last_date: Optional[Date] = None


class PacSummaryOut(BaseModel):
    official_id: str
    fec_candidate_id: str
    election_year: int
    total: float = 0
    # FEC's reported PAC total for the election, to check the itemized sum.
    reported_total: Optional[float] = None
    # Newest itemized gift; FEC processes itemized data weeks after totals.
    itemized_through: Optional[Date] = None
    reported_through: Optional[Date] = None
    gift_count: int = 0
    pac_count: int = 0
    categories: list[PacCategoryOut] = Field(default_factory=list)
    top_pacs: list[PacOut] = Field(default_factory=list)
    # False until fec_client.py pacs has fetched this official.
    synced: bool = False
    last_fetched_at: Optional[datetime] = None


class PacListOut(BaseModel):
    total_count: int
    items: list[PacOut] = Field(default_factory=list)


class PacGiftOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    sub_id: str
    receipt_date: Optional[Date] = None
    amount: float
    two_year_period: int
    pdf_url: Optional[str] = None


class PositionsProgressItemOut(BaseModel):
    official_id: str
    name: Optional[str] = None
    display_name: Optional[str] = None
    state: Optional[str] = None
    party: Optional[str] = None
    office: Optional[str] = None
    district: Optional[int] = None
    status: str
    stances_saved: Optional[int] = None
    pages_found: Optional[int] = None
    last_attempt_at: Optional[datetime] = None
    last_error: Optional[str] = None


class ExtractorVersionCountOut(BaseModel):
    extractor_version: Optional[str] = None
    count: int


class PositionsProgressOut(BaseModel):
    population: int
    attempted: int
    by_status: dict[str, int] = Field(default_factory=dict)
    not_attempted: int
    stances_total: int
    last_success_at: Optional[datetime] = None
    current_versions: list[ExtractorVersionCountOut] = Field(default_factory=list)
    recent: list[PositionsProgressItemOut] = Field(default_factory=list)
    problems: list[PositionsProgressItemOut] = Field(default_factory=list)


class BillOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    title: Optional[str] = None
    sponsor_id: Optional[str] = None
    sponsor_bioguide_id: Optional[str] = None
    sponsor_name: Optional[str] = None
    sponsor_party: Optional[str] = None
    cosponsor_party_breakdown: Optional[dict[str, int]] = None
    bipartisan_type: Optional[str] = None
    policy_area: Optional[str] = None
    summary: Optional[str] = None
    introduced_date: Optional[Date] = None
    voted_date: Optional[Date] = None
    days_to_vote: Optional[int] = None
    velocity_bucket: Optional[str] = None
    latest_action_date: Optional[Date] = None
    latest_action_text: Optional[str] = None
    status: Optional[str] = None
    level: str = "federal"
    classification_metadata: Optional[dict] = None
    # Model that produced classification_metadata (from classification_version).
    classification_model: Optional[str] = None


class RollCallOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    chamber: str
    date: Optional[Date] = None
    question: Optional[str] = None
    result: Optional[str] = None
    requires: Optional[str] = None
    source_roll_call_id: str


class BillDetailOut(BillOut):
    votes_summary: dict[str, dict[str, int]] = Field(default_factory=dict)
    votes_by_party: dict[str, dict[str, dict[str, int]]] = Field(
        default_factory=dict
    )
    roll_calls: list[RollCallOut] = Field(default_factory=list)


class BillPageOut(BaseModel):
    items: list[BillDetailOut]
    total: int


class FeedItemOut(BaseModel):
    id: int
    # bill_introduced | bill_status_changed | vote_held | official_seated | official_departed
    kind: str
    occurred_at: Date
    detected_at: datetime
    headline: str
    subline: Optional[str] = None
    level: str = "federal"
    state: Optional[str] = None
    bill: Optional[BillOut] = None
    official: Optional[OfficialOut] = None
    roll_call: Optional[RollCallOut] = None
    # Positions on roll_call by party, e.g. {"Republican": {"Yes": 50, "No": 2}}.
    tally_by_party: Optional[dict[str, dict[str, int]]] = None
    payload: Optional[dict] = None


class FeedPageOut(BaseModel):
    items: list[FeedItemOut]
    # Opaque; pass back as ?cursor= for the next (older) page. None at the end.
    next_cursor: Optional[str] = None


class BillVoterOut(BaseModel):
    official_id: str
    name: str
    position: Optional[str] = None


class BillVotersOut(BaseModel):
    bill_id: str
    chamber: str
    party: str
    voters: list[BillVoterOut] = Field(default_factory=list)


class HealthOut(BaseModel):
    status: str
    service: str


class CivicAddressOut(BaseModel):
    line1: Optional[str] = None
    line2: Optional[str] = None
    line3: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    zip: Optional[str] = None


class CivicChannelOut(BaseModel):
    type: Optional[str] = None
    id: Optional[str] = None


class CivicDivisionOut(BaseModel):
    ocd_id: str
    name: str


class CivicRepresentativeOut(BaseModel):
    id: Optional[str] = None
    name: str
    office: str
    division_id: Optional[str] = None
    division_name: Optional[str] = None
    party: Optional[str] = None
    levels: list[str] = Field(default_factory=list)
    roles: list[str] = Field(default_factory=list)
    phones: list[str] = Field(default_factory=list)
    emails: list[str] = Field(default_factory=list)
    urls: list[str] = Field(default_factory=list)
    photo_url: Optional[str] = None
    addresses: list[CivicAddressOut] = Field(default_factory=list)
    channels: list[CivicChannelOut] = Field(default_factory=list)


class CivicLookupOut(BaseModel):
    normalized_input: Optional[CivicAddressOut] = None
    divisions: list[CivicDivisionOut] = Field(default_factory=list)
    representatives: list[CivicRepresentativeOut] = Field(default_factory=list)


class CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class VoterInfoRequest(CamelModel):
    address: str = Field(..., min_length=1, max_length=300)
    election_id: Optional[str] = None
    # Two-letter state from the representative lookup, used only to choose the
    # election. Anything else is ignored rather than rejected.
    state: Optional[str] = None

    @field_validator("state", mode="before")
    @classmethod
    def normalize_state(cls, v: object) -> Optional[str]:
        if isinstance(v, str) and re.fullmatch(r"[A-Za-z]{2}", v.strip()):
            return v.strip().upper()
        return None

    @field_validator("address")
    @classmethod
    def validate_address(cls, v: str) -> str:
        cleaned = v.strip()
        if not cleaned:
            raise ValueError("address must not be empty or whitespace only")
        if len(cleaned) > 300:
            raise ValueError("address must be at most 300 characters")
        return cleaned


class ElectionOut(CamelModel):
    id: str
    name: str
    date: Optional[str] = None


class SourceOut(CamelModel):
    name: Optional[str] = None
    official: Optional[bool] = None


class LocationOut(CamelModel):
    location_name: Optional[str] = None
    line1: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    zip: Optional[str] = None
    polling_hours: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    notes: Optional[str] = None
    sources: list[SourceOut] = Field(default_factory=list)


class AdminBodyOut(CamelModel):
    name: Optional[str] = None
    election_info_url: Optional[str] = None
    election_registration_url: Optional[str] = None
    election_registration_confirmation_url: Optional[str] = None
    absentee_voting_info_url: Optional[str] = None
    voting_location_finder_url: Optional[str] = None
    ballot_info_url: Optional[str] = None
    hours_of_operation: Optional[str] = None
    physical_address: Optional[CivicAddressOut] = None
    phone: Optional[str] = None
    email: Optional[str] = None


class AdminBodiesOut(CamelModel):
    state: Optional[AdminBodyOut] = None
    local: Optional[AdminBodyOut] = None


class VoterInfoOut(CamelModel):
    ui_state: str
    upstream_status: str
    election: Optional[ElectionOut] = None
    mail_only: bool = False
    polling_locations: list[LocationOut] = Field(default_factory=list)
    early_vote_sites: list[LocationOut] = Field(default_factory=list)
    drop_off_locations: list[LocationOut] = Field(default_factory=list)
    admin_bodies: AdminBodiesOut = Field(default_factory=AdminBodiesOut)
    other_elections: list[ElectionOut] = Field(default_factory=list)
    fetched_at: str


class VoterInfoErrorOut(CamelModel):
    ui_state: str = "unavailable"
    upstream_status: str
    detail: str



class UpcomingElectionsOut(CamelModel):
    elections: list[ElectionOut]
