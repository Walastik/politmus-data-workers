from sqlalchemy import Boolean, Column, Date, DateTime, String, Integer, ForeignKey, Text, UniqueConstraint
from sqlalchemy.orm import relationship
from database import Base

class Official(Base):
    __tablename__ = 'officials'

    id = Column(String, primary_key=True)
    name = Column(String)
    state = Column(String)
    party = Column(String)
    office = Column(String)
    district = Column(Integer, nullable=True)
    current_member = Column(Boolean, nullable=False, default=False, server_default='false')
    phone = Column(String, nullable=True)
    office_address = Column(String, nullable=True)
    website_url = Column(String, nullable=True)
    level = Column(String, nullable=False, default='federal', server_default='federal')
    openstates_id = Column(String, nullable=True, unique=True)

    bills = relationship("Bill", back_populates="sponsor")

class Bill(Base):
    __tablename__ = 'bills'

    id = Column(String, primary_key=True)
    title = Column(String)
    sponsor_id = Column(String, ForeignKey('officials.id'), nullable=True)
    # Congress.gov sponsor identity, kept even when the member is not in officials.
    sponsor_bioguide_id = Column(String, nullable=True)
    sponsor_name = Column(String, nullable=True)
    policy_area = Column(String, nullable=True)
    summary = Column(Text, nullable=True)
    introduced_date = Column(Date, nullable=True)
    voted_date = Column(Date, nullable=True)

    sponsor = relationship("Official", back_populates="bills")
    votes = relationship("Vote", back_populates="bill")

class Vote(Base):
    __tablename__ = 'votes'

    id = Column(Integer, primary_key=True, autoincrement=True)
    bill_id = Column(String, ForeignKey('bills.id'))
    official_id = Column(String, ForeignKey('officials.id'))
    position = Column(String)

    bill = relationship("Bill", back_populates="votes")
    official = relationship("Official")


class SenateRollCall(Base):
    """One Senate.gov roll call we have already looked at.

    Incremental ingest compares this table to the Senate vote menu so we only
    fetch XML for new votes, plus retries (missing bill, fetch failure).
    """
    __tablename__ = "senate_roll_calls"
    __table_args__ = (
        UniqueConstraint(
            "congress",
            "session",
            "vote_number",
            name="uq_senate_roll_calls_congress_session_vote",
        ),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    congress = Column(Integer, nullable=False)
    session = Column(Integer, nullable=False)
    vote_number = Column(Integer, nullable=False)
    # Not an FK: skipped_no_bill rows are stored before the bill exists.
    bill_id = Column(String, nullable=True)
    status = Column(String, nullable=False)
    processed_at = Column(DateTime, nullable=True)


class StateSyncLog(Base):
    """Last successful OpenStates ingest per standard US state.

    Incremental runs (`--limit N`) pick the N rows with the oldest
    `last_synced_at` so we round-robin instead of hitting every jurisdiction
    in one batch.
    """
    __tablename__ = "state_sync_log"

    state_code = Column(String, primary_key=True)
    last_synced_at = Column(DateTime, nullable=True)
