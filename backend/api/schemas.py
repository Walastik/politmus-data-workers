from datetime import date
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


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
    position: Optional[str] = None
    sponsor_name: Optional[str] = None


class OfficialDetailOut(OfficialOut):
    votes: list[OfficialVoteOut] = Field(default_factory=list)


class BillOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    title: Optional[str] = None
    sponsor_id: Optional[str] = None
    sponsor_bioguide_id: Optional[str] = None
    sponsor_name: Optional[str] = None
    policy_area: Optional[str] = None
    summary: Optional[str] = None
    introduced_date: Optional[date] = None
    voted_date: Optional[date] = None


class BillDetailOut(BillOut):
    votes_summary: dict[str, dict[str, int]] = Field(default_factory=dict)


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
