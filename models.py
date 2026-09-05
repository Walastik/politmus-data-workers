from sqlalchemy import Column, String, Integer, ForeignKey
from sqlalchemy.orm import relationship
from database import Base

class Official(Base):
    __tablename__ = 'officials'

    id = Column(String, primary_key=True)
    name = Column(String)
    state = Column(String)
    party = Column(String)

    bills = relationship("Bill", back_populates="sponsor")

class Bill(Base):
    __tablename__ = 'bills'

    id = Column(String, primary_key=True)
    title = Column(String)
    sponsor_id = Column(String, ForeignKey('officials.id'))

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
