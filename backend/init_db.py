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
            "ALTER TABLE bills ADD COLUMN IF NOT EXISTS sponsor_bioguide_id VARCHAR"
        ))
        conn.execute(text(
            "ALTER TABLE bills ADD COLUMN IF NOT EXISTS sponsor_name VARCHAR"
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


def main():
    "Initialize the database tables"

    ensure_schema()
    print("Database tables created.")

if __name__ == "__main__":
    main()
