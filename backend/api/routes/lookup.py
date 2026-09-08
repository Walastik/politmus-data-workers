from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_
from sqlalchemy.orm import Session

from api.census import CensusUnavailable, geocode_address
from api.schemas import CivicAddressOut, CivicDivisionOut, CivicLookupOut, CivicRepresentativeOut
from database import get_db
from models import Official

router = APIRouter()

HOUSE_OFFICES = ("Representative", "Delegate", "Resident Commissioner")


def _office_roles(office: Optional[str]) -> tuple[list[str], list[str]]:
    if office == "Senator":
        return ["country"], ["legislatorUpperBody"]
    return ["country"], ["legislatorLowerBody"]


def _house_district_filter(census_district: int):
    if census_district == 0:
        return or_(
            Official.district.is_(None),
            Official.district.in_([0, 98]),
        )
    return Official.district == census_district


def _representative_from_official(
    official: Official,
    *,
    division_id: str,
    division_name: str,
) -> CivicRepresentativeOut:
    phones = [official.phone] if official.phone else []
    urls = [official.website_url] if official.website_url else []
    addresses = []
    if official.office_address:
        addresses.append(CivicAddressOut(line1=official.office_address))
    levels, roles = _office_roles(official.office)
    return CivicRepresentativeOut(
        id=official.id,
        name=official.name or "Unknown",
        office=official.office or "Member of Congress",
        division_id=division_id,
        division_name=division_name,
        party=official.party,
        levels=levels,
        roles=roles,
        phones=phones,
        urls=urls,
        addresses=addresses,
    )


@router.get("", response_model=CivicLookupOut)
def lookup_civic_info(
    address: str = Query(
        ...,
        min_length=1,
        max_length=300,
        description="Street address whose elected officials should be returned.",
    ),
    db: Session = Depends(get_db),
):
    """Resolve an address to congressional districts, then load local officials.

    Census geocodes the address. FastAPI then returns current senators and the
    House member for that district from Postgres. The frontend only sends an address.
    """
    address = address.strip()
    if not address:
        raise HTTPException(status_code=400, detail="address is required")

    try:
        match = geocode_address(address)
    except CensusUnavailable:
        raise HTTPException(
            status_code=502,
            detail="Unable to reach the Census geocoder",
        ) from None

    if match is None:
        raise HTTPException(
            status_code=404,
            detail="No civic information found for that address",
        )

    state_ocd = f"ocd-division/country:us/state:{match.state_abbr.lower()}"
    district_ocd = f"{state_ocd}/cd:{match.district}"
    divisions = [
        CivicDivisionOut(ocd_id=state_ocd, name=match.state_name),
        CivicDivisionOut(ocd_id=district_ocd, name=match.district_label),
    ]

    senators = (
        db.query(Official)
        .filter(Official.state.ilike(match.state_name))
        .filter(Official.current_member.is_(True))
        .filter(Official.office == "Senator")
        .order_by(Official.name)
        .all()
    )
    house_members = (
        db.query(Official)
        .filter(Official.state.ilike(match.state_name))
        .filter(Official.current_member.is_(True))
        .filter(Official.office.in_(HOUSE_OFFICES))
        .filter(_house_district_filter(match.district))
        .order_by(Official.name)
        .all()
    )

    representatives = [
        _representative_from_official(
            official,
            division_id=state_ocd,
            division_name=match.state_name,
        )
        for official in senators
    ]
    representatives.extend(
        _representative_from_official(
            official,
            division_id=district_ocd,
            division_name=match.district_label,
        )
        for official in house_members
    )

    return CivicLookupOut(
        normalized_input=CivicAddressOut(
            line1=match.line1,
            city=match.city,
            state=match.state_abbr,
            zip=match.zip,
        ),
        divisions=divisions,
        representatives=representatives,
    )
