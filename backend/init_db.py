from sqlalchemy import text

from database import engine, Base
from models import *
from services.bill_effects import (
    DEFAULT_GUIDELINES_NAME,
    DEFAULT_EXTRACTION_PROMPT,
)

def _votes_use_legacy_bill_id(conn):
    """True when `votes` still links officials directly to bills."""
    return conn.execute(text(
        """
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'votes'
          AND column_name = 'bill_id'
        """
    )).scalar() is not None


def ensure_schema():
    """Create tables and add columns that create_all will not alter in place."""
    with engine.begin() as conn:
        # Member positions now hang off roll_calls. Dropping the old votes
        # table is intentional; re-run bills / senate-votes ingest to backfill.
        if _votes_use_legacy_bill_id(conn):
            conn.execute(text("DROP TABLE IF EXISTS votes"))
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
        # Filled by `congress_client.py members` / `backfill-name-parts` and
        # the OpenStates sync.
        for column in (
            "first_name",
            "middle_name",
            "last_name",
            "suffix_name",
            "nickname",
            "honorific_name",
        ):
            conn.execute(text(
                f"ALTER TABLE officials ADD COLUMN IF NOT EXISTS {column} VARCHAR"
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
            "ALTER TABLE bills ADD COLUMN IF NOT EXISTS days_to_vote INTEGER"
        ))
        conn.execute(text(
            "ALTER TABLE bills ADD COLUMN IF NOT EXISTS velocity_bucket VARCHAR"
        ))
        conn.execute(text(
            "ALTER TABLE bills ADD COLUMN IF NOT EXISTS latest_action_date DATE"
        ))
        conn.execute(text(
            "ALTER TABLE bills ADD COLUMN IF NOT EXISTS latest_action_text TEXT"
        ))
        conn.execute(text(
            "ALTER TABLE bills ADD COLUMN IF NOT EXISTS status VARCHAR"
        ))
        conn.execute(text(
            "ALTER TABLE bills ADD COLUMN IF NOT EXISTS level VARCHAR "
            "NOT NULL DEFAULT 'federal'"
        ))
        conn.execute(text(
            """
            UPDATE bills
            SET level = 'federal'
            WHERE level IS NULL OR level = ''
            """
        ))
        conn.execute(text(
            "ALTER TABLE bills ADD COLUMN IF NOT EXISTS classification_metadata JSONB"
        ))
        for column_sql in (
            "classification_status VARCHAR",
            "classification_version VARCHAR",
            "classification_input_hash VARCHAR",
            "classification_attempts INTEGER NOT NULL DEFAULT 0",
            "classification_error TEXT",
            "classification_attempted_at TIMESTAMP",
            "classified_at TIMESTAMP",
        ):
            conn.execute(text(
                f"ALTER TABLE bills ADD COLUMN IF NOT EXISTS {column_sql}"
            ))
        conn.execute(text(
            "ALTER TABLE bills DROP COLUMN IF EXISTS classification"
        ))
        conn.execute(text("DROP TABLE IF EXISTS classification_guidelines"))
        conn.execute(text(
            """
            INSERT INTO extraction_guidelines
                (name, is_active, prompt, updated_at)
            SELECT :name, TRUE, :prompt, (NOW() AT TIME ZONE 'utc')
            WHERE NOT EXISTS (
                SELECT 1 FROM extraction_guidelines WHERE name = :name
            )
            """
        ), {
            "name": DEFAULT_GUIDELINES_NAME,
            "prompt": DEFAULT_EXTRACTION_PROMPT,
        })
        # official_stances predates the positions worker with only
        # official/target/mechanism/direction; add provenance columns.
        for column_sql in (
            "target_name VARCHAR",
            "target_slug VARCHAR",
            "stance VARCHAR",
            "policy_direction VARCHAR",
            "emphasis VARCHAR",
            "policy_area VARCHAR",
            "issue_label VARCHAR",
            "summary TEXT",
            "evidence_quote TEXT",
            "source_url VARCHAR",
            "source_page_id INTEGER REFERENCES official_source_pages(id) "
            "ON DELETE SET NULL",
            "source_type VARCHAR NOT NULL DEFAULT 'official_site'",
            "extracted_at TIMESTAMP",
            "extractor_version VARCHAR",
            "model VARCHAR",
            "scope VARCHAR",
        ):
            conn.execute(text(
                f"ALTER TABLE official_stances ADD COLUMN IF NOT EXISTS {column_sql}"
            ))
        conn.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_official_stances_target_slug "
            "ON official_stances (target_slug)"
        ))
        conn.execute(text(
            "CREATE UNIQUE INDEX IF NOT EXISTS "
            "uq_official_stances_official_target_mechanism_source "
            "ON official_stances (official_id, target_id, mechanism, source_type)"
        ))
        conn.execute(text(
            "CREATE UNIQUE INDEX IF NOT EXISTS "
            "uq_official_source_pages_official_url "
            "ON official_source_pages (official_id, url)"
        ))
        conn.execute(text(
            "CREATE UNIQUE INDEX IF NOT EXISTS ix_policy_targets_slug "
            "ON policy_targets (slug)"
        ))
        conn.execute(text("ALTER TABLE bill_effects ADD COLUMN IF NOT EXISTS relation VARCHAR"))
        for column_sql in (
            "effect_relation VARCHAR",
            "stance_scope VARCHAR",
            "bill_effect_count INTEGER",
            "counted BOOLEAN NOT NULL DEFAULT true",
            "reason VARCHAR",
        ):
            conn.execute(text(
                f"ALTER TABLE vote_alignments ADD COLUMN IF NOT EXISTS {column_sql}"
            ))
        conn.execute(text(
            "CREATE UNIQUE INDEX IF NOT EXISTS "
            "uq_bill_effects_bill_target_mechanism "
            "ON bill_effects (bill_id, target_id, mechanism)"
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
        conn.execute(text(
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_roll_calls_source_id "
            "ON roll_calls (source_roll_call_id)"
        ))
        conn.execute(text(
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_votes_roll_call_official "
            "ON votes (roll_call_id, official_id)"
        ))


def main():
    "Initialize the database tables"

    ensure_schema()
    print("Database tables created.")

if __name__ == "__main__":
    main()
