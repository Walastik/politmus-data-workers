from datetime import date as Date, datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator
from pydantic.alias_generators import to_camel


class OfficialOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: Optional[str] = None
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
    emphasis: Optional[str] = None
    summary: Optional[str] = None
    evidence_quote: Optional[str] = None
    source_url: Optional[str] = None
    source_type: str = "official_site"
    extracted_at: Optional[datetime] = None


class OfficialDetailOut(OfficialOut):
    votes: list[OfficialVoteOut] = Field(default_factory=list)
    stated_positions: list[OfficialStanceOut] = Field(default_factory=list)


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

