from sqlalchemy import text

from database import engine, Base
from models import *

def ensure_schema():
    """Create tables and add columns that create_all will not alter in place."""
    Base.metadata.create_all(bind=engine)
    with engine.begin() as conn:
        conn.execute(text(
            "ALTER TABLE officials ADD COLUMN IF NOT EXISTS office VARCHAR"
        ))
        conn.execute(text(
            "ALTER TABLE officials ADD COLUMN IF NOT EXISTS district INTEGER"
        ))
        # Existing rows were loaded from the current roster; new inserts default false.
        conn.execute(text(
            "ALTER TABLE officials ADD COLUMN IF NOT EXISTS current_member "
            "BOOLEAN NOT NULL DEFAULT TRUE"
        ))
        conn.execute(text(
            "ALTER TABLE officials ALTER COLUMN current_member SET DEFAULT FALSE"
        ))
        conn.execute(text(
            "ALTER TABLE officials ADD COLUMN IF NOT EXISTS phone VARCHAR"
        ))
        conn.execute(text(
            "ALTER TABLE officials ADD COLUMN IF NOT EXISTS office_address VARCHAR"
        ))
        conn.execute(text(
            "ALTER TABLE officials ADD COLUMN IF NOT EXISTS website_url VARCHAR"
        ))
        conn.execute(text(
            "ALTER TABLE officials ADD COLUMN IF NOT EXISTS level VARCHAR "
            "NOT NULL DEFAULT 'federal'"
        ))
        conn.execute(text(
            "ALTER TABLE officials ADD COLUMN IF NOT EXISTS openstates_id VARCHAR"
        ))
        conn.execute(text(
            "CREATE UNIQUE INDEX IF NOT EXISTS ix_officials_openstates_id "
            "ON officials (openstates_id) WHERE openstates_id IS NOT NULL"
        ))
        conn.execute(text(
            """
            UPDATE officials
            SET level = 'federal'
            WHERE level IS NULL OR level = ''
            """
        ))
        conn.execute(text(
            "ALTER TABLE bills ADD COLUMN IF NOT EXISTS sponsor_bioguide_id VARCHAR"
        ))
        conn.execute(text(
            "ALTER TABLE bills ADD COLUMN IF NOT EXISTS sponsor_name VARCHAR"
        ))
        conn.execute(text(
            "ALTER TABLE bills ADD COLUMN IF NOT EXISTS sponsor_party VARCHAR"
        ))
        conn.execute(text(
            "ALTER TABLE bills ADD COLUMN IF NOT EXISTS "
            "cosponsor_party_breakdown JSONB"
        ))
        conn.execute(text(
            "ALTER TABLE bills ADD COLUMN IF NOT EXISTS bipartisan_type VARCHAR"
        ))
        conn.execute(text(
            "ALTER TABLE bills ADD COLUMN IF NOT EXISTS policy_area VARCHAR"
        ))
        conn.execute(text(
            "ALTER TABLE bills ADD COLUMN IF NOT EXISTS summary TEXT"
        ))
        conn.execute(text(
            "ALTER TABLE bills ADD COLUMN IF NOT EXISTS introduced_date DATE"
        ))
        conn.execute(text(
            "ALTER TABLE bills ADD COLUMN IF NOT EXISTS voted_date DATE"
        ))
        conn.execute(text(
            """
            UPDATE bills
            SET sponsor_bioguide_id = sponsor_id
            WHERE sponsor_bioguide_id IS NULL AND sponsor_id IS NOT NULL
            """
        ))
        conn.execute(text(
            """
            UPDATE bills AS b
            SET sponsor_name = o.name
            FROM officials AS o
            WHERE b.sponsor_id = o.id AND b.sponsor_name IS NULL
            """
        ))
        conn.execute(text(
            "CREATE UNIQUE INDEX IF NOT EXISTS "
            "uq_senate_roll_calls_congress_session_vote "
            "ON senate_roll_calls (congress, session, vote_number)"
        ))


def main():
    "Initialize the database tables"

    ensure_schema()
    print("Database tables created.")

if __name__ == "__main__":
    main()
