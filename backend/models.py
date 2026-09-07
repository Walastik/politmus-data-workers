from sqlalchemy import Boolean, Column, String, Integer, ForeignKey, Text
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
