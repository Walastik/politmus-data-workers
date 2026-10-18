from datetime import date as Date, datetime
import re
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator
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
    points: int
    counted: bool = True
    reason: Optional[str] = None


class OfficialDetailOut(OfficialOut):
    votes: list[OfficialVoteOut] = Field(default_factory=list)
    stated_positions: list[OfficialStanceOut] = Field(default_factory=list)
    positions_sync: Optional[PositionsSyncOut] = None
    accountability: Optional[AccountabilityScoreOut] = None
    alignments: list[VoteAlignmentOut] = Field(default_factory=list)


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

