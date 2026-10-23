from sqlalchemy import BigInteger, Boolean, CheckConstraint, Column, Date, DateTime, Float, ForeignKey, Index, Integer, LargeBinary, Numeric, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship
from database import Base

class Official(Base):
    __tablename__ = 'officials'

    id = Column(String, primary_key=True)
    # Congress.gov's inverted form ("Adams, Alma S."); used for sorting and matching.
    name = Column(String)
    # Name parts as the source gives them (Congress.gov member detail, or
    # OpenStates given/family name). display_name is built from these.
    first_name = Column(String, nullable=True)
    middle_name = Column(String, nullable=True)
    last_name = Column(String, nullable=True)
    suffix_name = Column(String, nullable=True)
    nickname = Column(String, nullable=True)
    honorific_name = Column(String, nullable=True)
    state = Column(String)
    party = Column(String)
    office = Column(String)
    district = Column(Integer, nullable=True)
    current_member = Column(Boolean, nullable=False, default=False, server_default='false')
    phone = Column(String, nullable=True)
    office_address = Column(String, nullable=True)
    website_url = Column(String, nullable=True)
    # Official portrait from Congress.gov member detail (depiction.imageUrl),
    # hotlinked by the frontend. attribution is the credit line, when given.
    photo_url = Column(String, nullable=True)
    photo_attribution = Column(String, nullable=True)
    level = Column(String, nullable=False, default='federal', server_default='federal')
    openstates_id = Column(String, nullable=True, unique=True)
    # From unitedstates/congress-legislators (fec_client.py crosswalk). A member
    # who ran for the House and the Senate has one FEC candidate ID per race.
    fec_candidate_ids = Column(JSONB, nullable=True)
    opensecrets_id = Column(String, nullable=True)
    # Campaign committees per FEC candidate ID, for Schedule A lookups:
    # {"S6MN00267": [{"committee_id", "designation", "cycles"}]}.
    fec_committees = Column(JSONB, nullable=True)
    # From Wikidata (wikidata_client.py), matched on FEC candidate ID.
    wikidata_id = Column(String, nullable=True)
    wikipedia_url = Column(String, nullable=True)
    # Last name search for an unmatched candidate; searched again after 30 days.
    wikidata_searched_at = Column(DateTime, nullable=True)
    # {"description", "birth_date", "occupations": [...], "education": [...],
    #  "positions_held": [...]}.
    bio = Column(JSONB, nullable=True)

    bills = relationship("Bill", back_populates="sponsor")

    @property
    def display_name(self):
        """How the app shows the name. Change the format here; the parts are stored."""
        if self.first_name and self.last_name:
            parts = [self.first_name, self.middle_name, self.last_name, self.suffix_name]
            return " ".join(part for part in parts if part)
        return self.name

class Bill(Base):
    __tablename__ = 'bills'

    id = Column(String, primary_key=True)
    title = Column(String)
    sponsor_id = Column(String, ForeignKey('officials.id'), nullable=True)
    # Congress.gov sponsor identity, kept even when the member is not in officials.
    sponsor_bioguide_id = Column(String, nullable=True)
    sponsor_name = Column(String, nullable=True)
    sponsor_party = Column(String, nullable=True)
    # Current (non-withdrawn) cosponsor counts by party, e.g. {"Democratic": 12, "Republican": 3}.
    cosponsor_party_breakdown = Column(JSONB, nullable=True)
    # single_party (1), bipartisan (2), or tripartisan (3+ distinct parties).
    bipartisan_type = Column(String, nullable=True)
    policy_area = Column(String, nullable=True)
    summary = Column(Text, nullable=True)
    introduced_date = Column(Date, nullable=True)
    voted_date = Column(Date, nullable=True)
    # Days from introduced_date to the stored recorded-vote date.
    days_to_vote = Column(Integer, nullable=True)
    # very_fast, fast, average, slow, or very_slow vs the corpus distribution.
    velocity_bucket = Column(String, nullable=True)
    latest_action_date = Column(Date, nullable=True)
    latest_action_text = Column(Text, nullable=True)
    # Became Law, Vetoed, Failed, To President / Governor, Passed Both
    # Chambers, Passed Senate, Passed House, or Introduced.
    status = Column(String, nullable=True)
    level = Column(String, nullable=False, default="federal", server_default="federal")
    classification_metadata = Column(JSONB, nullable=True)
    # Bill classifier state (scripts/classify_bills.py):
    # ok | incomplete | failed | no_summary; NULL = never run by classifier v2.
    classification_status = Column(String, nullable=True)
    # Schema version + local prompt hash + model of the stored metadata.
    classification_version = Column(String, nullable=True)
    # sha256 of title, policy area and summary the metadata was made from.
    classification_input_hash = Column(String, nullable=True)
    # Consecutive failed/incomplete attempts (drives retry backoff).
    classification_attempts = Column(Integer, nullable=False, default=0, server_default="0")
    classification_error = Column(Text, nullable=True)
    classification_attempted_at = Column(DateTime, nullable=True)
    classified_at = Column(DateTime, nullable=True)
    # Congress.gov actions, newest first: [{"date", "text", "type", "chamber"}].
    actions = Column(JSONB, nullable=True)
    # Links from bill detail: {"short_titles": [...], "committee_reports":
    # [{"citation", "title", "url"}], "cbo_cost_estimates": [{"title",
    # "description", "date", "url"}]}.
    documents = Column(JSONB, nullable=True)
    # bill_context.py: when amendments / floor speeches / committee views were
    # last fetched, and the latest action they were fetched for.
    context_synced_at = Column(DateTime, nullable=True)
    context_input = Column(String, nullable=True)
    # services/bill_debate.py output: {"key_dispute", "supporters",
    # "opponents", "model", "version", "input_hash", "generated_at"}.
    debate_metadata = Column(JSONB, nullable=True)
    # ok | failed | no_sources; NULL = never run.
    debate_status = Column(String, nullable=True)
    debate_attempted_at = Column(DateTime, nullable=True)

    sponsor = relationship("Official", back_populates="bills")
    roll_calls = relationship("RollCall", back_populates="bill")
    effects = relationship(
        "BillEffect", back_populates="bill", cascade="all, delete-orphan"
    )


class PolicyTarget(Base):
    """Reusable noun the accountability engine can join bills and claims against.

    Grows as the extractor (and later member claims) mention new agencies,
    programs, or rights. parent_id is for optional rollups (ICE -> DHS).
    """
    __tablename__ = "policy_targets"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String, unique=True, nullable=False, index=True)
    slug = Column(String, unique=True, nullable=False)
    parent_id = Column(Integer, ForeignKey("policy_targets.id"), nullable=True)

    parent = relationship(
        "PolicyTarget", remote_side=[id], back_populates="children"
    )
    children = relationship("PolicyTarget", back_populates="parent")
    effects = relationship("BillEffect", back_populates="target")


class TargetEmbedding(Base):
    """One policy target's name embedding (services/target_matching.py)."""
    __tablename__ = "target_embeddings"

    target_id = Column(Integer, ForeignKey("policy_targets.id", ondelete="CASCADE"), primary_key=True)
    model = Column(String, nullable=False)
    # float32 vector, L2-normalized.
    vector = Column(LargeBinary, nullable=False)


class TargetMatch(Base):
    """Two targets whose names mean nearly the same thing, stored once with
    target_a < target_b. Scoring treats pairs at or above
    TARGET_MATCH_THRESHOLD as one target."""
    __tablename__ = "target_matches"
    __table_args__ = (Index("ix_target_matches_target_b", "target_b"),)

    target_a = Column(Integer, ForeignKey("policy_targets.id", ondelete="CASCADE"), primary_key=True)
    target_b = Column(Integer, ForeignKey("policy_targets.id", ondelete="CASCADE"), primary_key=True)
    similarity = Column(Float, nullable=False)
    # Model review: same | inverse | unrelated; NULL until reviewed.
    verdict = Column(String, nullable=True)


class BillEffect(Base):
    """One extracted policy fact on a bill (target + mechanism + direction)."""
    __tablename__ = "bill_effects"
    __table_args__ = (
        UniqueConstraint(
            "bill_id",
            "target_id",
            "mechanism",
            name="uq_bill_effects_bill_target_mechanism",
        ),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    bill_id = Column(String, ForeignKey("bills.id"), nullable=False)
    target_id = Column(Integer, ForeignKey("policy_targets.id"), nullable=False)
    # funding | regulation | oversight | taxation
    mechanism = Column(String, nullable=False)
    # increase | decrease | maintain | mixed
    direction = Column(String, nullable=False)
    # low | medium | high
    magnitude = Column(String, nullable=False)
    rationale = Column(Text, nullable=True)
    # core (the bill's stated purpose) | secondary (an unrelated add-on);
    # NULL for effects classified before the field existed.
    relation = Column(String, nullable=True)
    # binding | conditional | advisory | expresses_view (see
    # LEGAL_FORCE_DEFINITIONS); NULL for effects classified before the field.
    legal_force = Column(String, nullable=True)

    bill = relationship("Bill", back_populates="effects")
    target = relationship("PolicyTarget", back_populates="effects")


class ExtractionGuideline(Base):
    """Prompt text that tells the local LLM how to extract bill effects.

    Stored in Postgres so guidelines can change without redeploying the worker.
    The extractor loads the newest active row each run.
    """
    __tablename__ = "extraction_guidelines"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String, unique=True, nullable=False)
    is_active = Column(Boolean, nullable=False, default=True, server_default="true")
    prompt = Column(Text, nullable=False)
    updated_at = Column(DateTime, nullable=False)


class BillAmendment(Base):
    """An amendment filed to a bill (Congress.gov /bill/.../amendments)."""

    __tablename__ = "bill_amendments"

    # e.g. 119-samdt-6840
    id = Column(String, primary_key=True)
    bill_id = Column(String, ForeignKey("bills.id", ondelete="CASCADE"), nullable=False, index=True)
    chamber = Column(String, nullable=True)
    number = Column(String, nullable=False)
    sponsor_name = Column(String, nullable=True)
    sponsor_bioguide_id = Column(String, nullable=True)
    sponsor_party = Column(String, nullable=True)
    submitted_date = Column(Date, nullable=True)
    purpose = Column(Text, nullable=True)
    latest_action_text = Column(Text, nullable=True)
    latest_action_date = Column(Date, nullable=True)
    text_url = Column(String, nullable=True)
    # Start of the amendment's text from its Congressional Record page.
    text_excerpt = Column(Text, nullable=True)


class BillSource(Base):
    """Words about a bill from its debate: one member's floor speech in one
    Congressional Record article, or a committee report's minority /
    dissenting / additional views. Input to the debate summary."""

    __tablename__ = "bill_sources"
    __table_args__ = (UniqueConstraint("source_key", name="uq_bill_sources_source_key"),)

    id = Column(Integer, primary_key=True, autoincrement=True)
    bill_id = Column(String, ForeignKey("bills.id", ondelete="CASCADE"), nullable=False, index=True)
    # floor_speech | committee_views
    kind = Column(String, nullable=False)
    # Article URL + speaker, or report citation + heading.
    source_key = Column(String, nullable=False)
    date = Column(Date, nullable=True)
    chamber = Column(String, nullable=True)
    # Record article title, or e.g. "H. Rept. 119-814: Dissenting Views".
    title = Column(String, nullable=True)
    speaker_name = Column(String, nullable=True)
    speaker_state = Column(String, nullable=True)
    speaker_official_id = Column(String, nullable=True)
    speaker_party = Column(String, nullable=True)
    text = Column(Text, nullable=False)
    url = Column(String, nullable=True)


class RollCall(Base):
    """One House or Senate roll-call event on a bill.

    Member positions live in `votes` and point here, not directly at `bills`.
    `source_roll_call_id` is the Congress.gov / Senate.gov identity so ingest
    can upsert without duplicating the same vote.
    """
    __tablename__ = "roll_calls"
    __table_args__ = (
        UniqueConstraint(
            "source_roll_call_id",
            name="uq_roll_calls_source_id",
        ),
        CheckConstraint(
            "chamber IN ('House', 'Senate')",
            name="ck_roll_calls_chamber",
        ),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    bill_id = Column(String, ForeignKey("bills.id"), nullable=False, index=True)
    # House or Senate
    chamber = Column(String, nullable=False)
    date = Column(Date, nullable=True)
    question = Column(String, nullable=True)
    result = Column(String, nullable=True)
    # Threshold when the source publishes one, e.g. 1/2, 3/5, 2/3.
    requires = Column(String, nullable=True)
    source_roll_call_id = Column(String, nullable=False)

    bill = relationship("Bill", back_populates="roll_calls")
    votes = relationship("Vote", back_populates="roll_call")


class Vote(Base):
    __tablename__ = "votes"
    __table_args__ = (
        UniqueConstraint(
            "roll_call_id",
            "official_id",
            name="uq_votes_roll_call_official",
        ),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    roll_call_id = Column(Integer, ForeignKey("roll_calls.id"), nullable=False, index=True)
    official_id = Column(String, ForeignKey("officials.id"), nullable=False, index=True)
    position = Column(String)

    roll_call = relationship("RollCall", back_populates="votes")
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



class OfficialStance(Base):
    """One policy position an official states publicly (e.g. on their website).

    target_id + mechanism + direction use the same vocabulary as bill_effects
    so services/accountability.py can join them. target_slug matches
    slugify_target() of bills.classification_metadata intents, and
    policy_area uses the CRS policy area list stored on bills.policy_area.
    """
    __tablename__ = "official_stances"
    __table_args__ = (
        UniqueConstraint(
            "official_id",
            "target_id",
            "mechanism",
            "source_type",
            name="uq_official_stances_official_target_mechanism_source",
        ),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    official_id = Column(String, ForeignKey("officials.id"), nullable=False, index=True)
    target_id = Column(Integer, ForeignKey("policy_targets.id"), nullable=False)
    mechanism = Column(String, nullable=False)
    # What the official wants for the target (what accountability compares).
    direction = Column(String, nullable=False)
    # supports | opposes, and the direction of the policy action they were
    # talking about ("opposes" a Medicaid funding "decrease" -> direction increase).
    stance = Column(String, nullable=True)
    policy_direction = Column(String, nullable=True)
    # Noun as the model wrote it, plus its slug for classification_metadata joins.
    target_name = Column(String, nullable=True)
    target_slug = Column(String, nullable=True, index=True)
    # low | medium | high: how directly the quote states the change
    # (high: names the change; medium: clearly implies it; low: inferred
    # from a slogan or value statement).
    emphasis = Column(String, nullable=True)
    # national | local (one district, state, facility, or project).
    scope = Column(String, nullable=True)
    # One of the CRS policy areas (same list as bills.policy_area).
    policy_area = Column(String, nullable=True)
    # The site's own heading for the issue, e.g. "Climate".
    issue_label = Column(String, nullable=True)
    summary = Column(Text, nullable=True)
    # Verbatim excerpt from the source page; verified before saving.
    evidence_quote = Column(Text, nullable=True)
    source_url = Column(String, nullable=True)
    source_page_id = Column(
        Integer, ForeignKey("official_source_pages.id", ondelete="SET NULL"), nullable=True
    )
    # official_site today; campaign_site etc. later.
    source_type = Column(
        String, nullable=False, default="official_site", server_default="official_site"
    )
    extracted_at = Column(DateTime, nullable=True)
    extractor_version = Column(String, nullable=True)
    model = Column(String, nullable=True)

    official = relationship("Official")
    target = relationship("PolicyTarget")
    source_page = relationship("OfficialSourcePage")


class OfficialSourcePage(Base):
    """One crawled page from an official's website, stored as cleaned text.

    content_hash feeds official_position_sync.combined_hash, which lets the
    positions worker skip the LLM when nothing on the site changed.
    """
    __tablename__ = "official_source_pages"
    __table_args__ = (
        UniqueConstraint(
            "official_id",
            "url",
            name="uq_official_source_pages_official_url",
        ),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    official_id = Column(String, ForeignKey("officials.id"), nullable=False, index=True)
    url = Column(String, nullable=False)
    # home | issues_index | issue_detail
    page_kind = Column(String, nullable=True)
    title = Column(String, nullable=True)
    http_status = Column(Integer, nullable=True)
    content_hash = Column(String, nullable=True)
    text = Column(Text, nullable=True)
    fetched_at = Column(DateTime, nullable=True)
    # False once a later crawl no longer finds this URL.
    is_current = Column(Boolean, nullable=False, default=True, server_default="true")
    error = Column(Text, nullable=True)


class OfficialPositionSync(Base):
    """Per-official cursor for the stated-positions worker.

    Lets runs be idempotent (skip unchanged sites) and round-robin by
    last_attempt_at, like state_sync_log does for OpenStates.
    """
    __tablename__ = "official_position_sync"

    official_id = Column(String, ForeignKey("officials.id"), primary_key=True)
    # ok | no_positions | no_website | no_issue_pages | blocked | needs_js | thin_site | failed
    status = Column(String, nullable=False)
    last_attempt_at = Column(DateTime, nullable=True)
    last_success_at = Column(DateTime, nullable=True)
    # Hash of every current page's content_hash, in URL order.
    combined_hash = Column(String, nullable=True)
    extractor_version = Column(String, nullable=True)
    attempts = Column(Integer, nullable=False, default=0, server_default="0")
    pages_found = Column(Integer, nullable=True)
    stances_saved = Column(Integer, nullable=True)
    last_error = Column(Text, nullable=True)


class VoteAlignment(Base):
    """One scored match: an official's passage vote on a bill intent they
    have a stated position on (services/accountability.py).

    Rows are snapshots, not FKs to bill_effects / official_stances: both are
    deleted and re-inserted when re-extracted, so the engine rewrites an
    official's rows whenever their inputs change.
    """
    __tablename__ = "vote_alignments"

    id = Column(Integer, primary_key=True, autoincrement=True)
    official_id = Column(
        String, ForeignKey("officials.id", ondelete="CASCADE"), nullable=False, index=True
    )
    bill_id = Column(String, ForeignKey("bills.id", ondelete="CASCADE"), nullable=False, index=True)
    roll_call_id = Column(Integer, ForeignKey("roll_calls.id", ondelete="CASCADE"), nullable=False)
    chamber = Column(String, nullable=True)
    vote_date = Column(Date, nullable=True)
    # Yes | No
    vote_position = Column(String, nullable=False)
    target_id = Column(Integer, ForeignKey("policy_targets.id", ondelete="CASCADE"), nullable=False)
    target_name = Column(String, nullable=True)
    # The position's own target: the same as target_id, or a near match.
    stance_target_id = Column(Integer, nullable=True)
    stance_target_name = Column(String, nullable=True)
    # Name similarity for a near match; NULL when the targets are the same.
    match_similarity = Column(Float, nullable=True)
    # True when more of the bill's target means less of the position's, so
    # the bill's direction was flipped before comparing.
    match_inverse = Column(Boolean, nullable=False, default=False, server_default="false")
    mechanism = Column(String, nullable=False)
    # What the bill does to the target, and what the official says they want.
    effect_direction = Column(String, nullable=False)
    effect_magnitude = Column(String, nullable=True)
    effect_rationale = Column(Text, nullable=True)
    stance_direction = Column(String, nullable=False)
    stance_emphasis = Column(String, nullable=True)
    stance_summary = Column(Text, nullable=True)
    stance_evidence_quote = Column(Text, nullable=True)
    stance_source_url = Column(String, nullable=True)
    policy_area = Column(String, nullable=True)
    effect_relation = Column(String, nullable=True)
    effect_legal_force = Column(String, nullable=True)
    stance_scope = Column(String, nullable=True)
    # bill_effects rows on the bill; BROAD_BILL_MIN_EFFECTS or more is broad.
    bill_effect_count = Column(Integer, nullable=True)
    # +1 voted for what they say they want, -1 against it.
    points = Column(Integer, nullable=False)
    # False when a rule keeps the match out of the score; reason says which.
    counted = Column(Boolean, nullable=False, default=True, server_default="true")
    reason = Column(String, nullable=True)
    computed_at = Column(DateTime, nullable=False)


class OfficialScore(Base):
    """Accountability totals for one official with stated positions.

    inputs_hash covers every alignment row plus the engine version, so
    incremental runs skip officials whose score cannot have changed.
    """
    __tablename__ = "official_scores"

    official_id = Column(String, ForeignKey("officials.id", ondelete="CASCADE"), primary_key=True)
    # Raw points: aligned - conflicting.
    points = Column(Integer, nullable=False, default=0, server_default="0")
    aligned = Column(Integer, nullable=False, default=0, server_default="0")
    conflicting = Column(Integer, nullable=False, default=0, server_default="0")
    # Distinct bills / roll calls with at least one scored match.
    bills_scored = Column(Integer, nullable=False, default=0, server_default="0")
    # Distinct stances (target + mechanism) matched by at least one vote.
    stances_matched = Column(Integer, nullable=False, default=0, server_default="0")
    # aligned / (aligned + conflicting) * 100; NULL with no matches.
    alignment_pct = Column(Float, nullable=True)
    # {"Health": {"points": 3, "aligned": 4, "conflicting": 1}, ...}
    by_policy_area = Column(JSONB, nullable=True)
    engine_version = Column(String, nullable=False)
    inputs_hash = Column(String, nullable=False)
    computed_at = Column(DateTime, nullable=False)


class StateSyncLog(Base):
    """Last successful OpenStates ingest per standard US state.

    Incremental runs (`--limit N`) pick the N rows with the oldest
    `last_synced_at` so we round-robin instead of hitting every jurisdiction
    in one batch.
    """
    __tablename__ = "state_sync_log"

    state_code = Column(String, primary_key=True)
    last_synced_at = Column(DateTime, nullable=True)


class OfficialFinanceTotal(Base):
    """OpenFEC campaign totals for one candidate ID and one election.

    election_year is FEC's candidate_election_year: amounts cover the whole
    election period (2 years for the House, 6 for the Senate). size_breakdown
    and state_breakdown come from Schedule A aggregates and are only fetched
    for the most recent elections (see fec_client.py).
    """
    __tablename__ = "official_finance_totals"

    official_id = Column(String, ForeignKey("officials.id"), primary_key=True)
    fec_candidate_id = Column(String, primary_key=True)
    election_year = Column(Integer, primary_key=True)
    coverage_start_date = Column(Date, nullable=True)
    coverage_end_date = Column(Date, nullable=True)
    receipts = Column(Numeric(14, 2), nullable=True)
    contributions = Column(Numeric(14, 2), nullable=True)
    individual_contributions = Column(Numeric(14, 2), nullable=True)
    individual_itemized = Column(Numeric(14, 2), nullable=True)
    individual_unitemized = Column(Numeric(14, 2), nullable=True)
    pac_contributions = Column(Numeric(14, 2), nullable=True)
    party_contributions = Column(Numeric(14, 2), nullable=True)
    candidate_contributions = Column(Numeric(14, 2), nullable=True)
    candidate_loans = Column(Numeric(14, 2), nullable=True)
    # Transfers from joint fundraising committees: mostly individual donors'
    # money raised together with other candidates or the party.
    joint_fundraising_transfers = Column(Numeric(14, 2), nullable=True)
    disbursements = Column(Numeric(14, 2), nullable=True)
    cash_on_hand = Column(Numeric(14, 2), nullable=True)
    debts = Column(Numeric(14, 2), nullable=True)
    # [{"size": 0, "total": ..., "count": ...}, ...]; size is the bucket's lower
    # bound in dollars (0 = $200 and under, which includes unitemized gifts).
    size_breakdown = Column(JSONB, nullable=True)
    # Itemized individual contributions only: {"home_state", "in_state",
    # "out_of_state", "total", "top_states": [{"state", "total", "count"}]}.
    state_breakdown = Column(JSONB, nullable=True)
    # coverage_end_date the breakdowns were fetched at; equal means up to date.
    breakdown_coverage_end_date = Column(Date, nullable=True)
    # Schedule E independent expenditures for/against this candidate:
    # {"support_total", "oppose_total", "support_count", "oppose_count",
    #  "top_support": [{"committee_id", "name", "total"}], "top_oppose": [...]}.
    outside_spending = Column(JSONB, nullable=True)
    outside_spending_fetched_at = Column(DateTime, nullable=True)
    fetched_at = Column(DateTime, nullable=True)

    official = relationship("Official")


class PacContribution(Base):
    """One itemized gift from a PAC or other political committee (Form 3 line 11C).

    sub_id is FEC's unique ID for the Schedule A line, so re-fetching a
    period replaces rows instead of duplicating them.
    """
    __tablename__ = "pac_contributions"

    sub_id = Column(String, primary_key=True)
    official_id = Column(String, ForeignKey("officials.id"), nullable=False, index=True)
    fec_candidate_id = Column(String, nullable=False)
    # The official's campaign committee that received the gift.
    committee_id = Column(String, nullable=False)
    two_year_period = Column(Integer, nullable=False)
    contributor_committee_id = Column(String, nullable=True, index=True)
    contributor_name = Column(String, nullable=True)
    amount = Column(Numeric(14, 2), nullable=False)
    receipt_date = Column(Date, nullable=True, index=True)
    # services/finance_insights.pac_category of the three FEC codes below.
    category = Column(String, nullable=False)
    committee_type = Column(String, nullable=True)
    organization_type = Column(String, nullable=True)
    designation = Column(String, nullable=True)
    pdf_url = Column(String, nullable=True)


class PacContributionSync(Base):
    """When one committee's PAC gifts for one two-year period were last fetched."""
    __tablename__ = "pac_contribution_sync"

    official_id = Column(String, ForeignKey("officials.id"), primary_key=True)
    committee_id = Column(String, primary_key=True)
    two_year_period = Column(Integer, primary_key=True)
    # The election's coverage_end_date at fetch time; a change means new filings.
    coverage_end_date = Column(Date, nullable=True)
    # Newest gift fetched; FEC's itemized data lags the totals by weeks.
    latest_receipt_date = Column(Date, nullable=True)
    row_count = Column(Integer, nullable=False, default=0)
    fetched_at = Column(DateTime, nullable=False)


class FeedEvent(Base):
    """Something feed-worthy that ingest noticed: a new bill, a status change, a vote.

    Rows are appended by the ingest workers (services/feed_events.py) and never
    rewritten. `dedupe_key` makes recording idempotent, so workers can call the
    recorders on every upsert and re-runs add nothing.
    """
    __tablename__ = "feed_events"
    __table_args__ = (
        UniqueConstraint("dedupe_key", name="uq_feed_events_dedupe_key"),
        Index("ix_feed_events_occurred", "occurred_at", "id"),
        Index("ix_feed_events_state_occurred", "state", "occurred_at"),
    )

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    # bill_introduced | bill_status_changed | vote_held | official_seated | official_departed
    kind = Column(String, nullable=False, index=True)
    # When it happened in the real world (source date, or detection day if the source has none).
    occurred_at = Column(Date, nullable=False)
    detected_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    official_id = Column(String, ForeignKey("officials.id"), nullable=True, index=True)
    bill_id = Column(String, ForeignKey("bills.id"), nullable=True, index=True)
    roll_call_id = Column(Integer, ForeignKey("roll_calls.id"), nullable=True)
    state = Column(String, nullable=True)
    level = Column(String, nullable=False, default="federal", server_default="federal")
    # Small snapshot of what changed, e.g. {"from": "Passed House", "to": "Became Law"}.
    payload = Column(JSONB, nullable=True)
    dedupe_key = Column(String, nullable=False)


class Candidacy(Base):
    """One FEC candidate ID running in one federal election (fec_client.py candidates).

    official_id is the sitting member's bioguide row when FEC lists one of
    their candidate IDs, and otherwise a level='candidate' official whose id
    is the FEC candidate ID. The totals are a snapshot from /candidates/totals/
    for ranking races; official_finance_totals holds the full detail.
    """
    __tablename__ = "candidacies"
    __table_args__ = (
        Index("ix_candidacies_race", "election_year", "state", "office", "district"),
    )

    fec_candidate_id = Column(String, primary_key=True)
    election_year = Column(Integer, primary_key=True)
    official_id = Column(String, ForeignKey("officials.id"), nullable=False, index=True)
    # Postal abbreviation, S or H, and the House district (0 for Senate and at-large).
    state = Column(String, nullable=False)
    office = Column(String, nullable=False)
    district = Column(Integer, nullable=False, default=0)
    party = Column(String, nullable=True)
    # I (incumbent), C (challenger) or O (open seat).
    incumbent_challenge = Column(String, nullable=True)
    candidate_status = Column(String, nullable=True)
    receipts = Column(Numeric(14, 2), nullable=True)
    disbursements = Column(Numeric(14, 2), nullable=True)
    cash_on_hand = Column(Numeric(14, 2), nullable=True)
    coverage_end_date = Column(Date, nullable=True)
    # True once their campaign files a pre-general (12G) report, which only
    # candidates on the general-election ballot file. FEC records no primary
    # results, so this is how primary losers drop out of a race.
    in_general_election = Column(Boolean, nullable=False, default=False, server_default="false")
    fetched_at = Column(DateTime, nullable=True)
    # Last totals sync; oldest go first.
    detail_fetched_at = Column(DateTime, nullable=True)
    # coverage_end_date as of that sync. When the daily load moves
    # coverage_end_date past it, the candidacy has new filings to fetch.
    detail_coverage_end_date = Column(Date, nullable=True)

    official = relationship("Official")
