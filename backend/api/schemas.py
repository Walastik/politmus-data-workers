from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class OfficialOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: Optional[str] = None
    state: Optional[str] = None
    party: Optional[str] = None


class BillOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    title: Optional[str] = None
    sponsor_id: Optional[str] = None
    sponsor_bioguide_id: Optional[str] = None
    sponsor_name: Optional[str] = None


class BillDetailOut(BillOut):
    votes_summary: dict[str, int] = Field(default_factory=dict)


class HealthOut(BaseModel):
    status: str
    service: str
