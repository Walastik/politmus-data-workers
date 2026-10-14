import json
import os
import threading
import unittest
from datetime import datetime, timedelta
import tempfile
from pathlib import Path
from types import SimpleNamespace

os.environ.setdefault(
    "DATABASE_URL",
    "postgresql://postgres:postgres@localhost:5432/politmus_test",
)

from pydantic import ValidationError

from models import OfficialPositionSync
from services.official_positions import (
    POLICY_AREAS,
    Chunk,
    SourceText,
    StatedPosition,
    StatedPositionsOutput,
    VerifiedPosition,
    build_position_messages,
    chunk_source,
    combined_hash,
    extractor_version,
    make_link_selector,
    REJECT_BILL_TARGET,
    REJECT_QUOTE,
    is_bill_name,
    merge_positions,
    official_direction,
    parse_positions,
    clean_quote,
    quote_in_text,
    verify_positions,
)
from official_positions import LOCAL_CONFIG_PATH, Prompts, extract_positions, is_due, load_local_prompts

OFFICIAL = SimpleNamespace(
    id="E000001",
    name="Jane Example",
    party="Democratic",
    state="New York",
    district=99,
    office="Representative",
    website_url="https://example-rep.house.gov",
)

CONGRESS_TEXT = (
    "# Fighting for the 99th District\n\n"
    "These are the issues the Congresswoman is working on in Congress.\n\n"
    "## Climate\n\n"
    "The Congresswoman’s first bill was the Clean Jobs Act. The Clean Jobs Act would "
    "create millions of jobs and move our national energy grid to renewable sources.\n\n"
    "## Health Care\n\n"
    "Representative Example believes health care is a human right. She supports "
    "expanding Medicaid so every family in the district can see a doctor. "
    "She will fight against cuts to Medicaid.\n\n"
    "- Expand Medicaid in every state\n"
    "- Protect coverage for pre-existing conditions"
)


def position(**overrides) -> dict:
    data = {
        "issue_label": "Climate",
        "policy_area": "Energy",
        "target_name": "Renewable Energy",
        "mechanism": "funding",
        "direction": "increase",
        "stance": "supports",
        "emphasis": "high",
        "summary": "Supports moving the national grid to renewable energy.",
        "evidence_quote": (
            "The Clean Jobs Act would create millions of jobs and move our national "
            "energy grid to renewable sources."
        ),
    }
    data.update(overrides)
    return data


def model_json(*positions) -> str:
    return json.dumps({"positions": list(positions)})


class ChunkingTests(unittest.TestCase):
    def test_small_page_is_one_chunk_with_headings(self):
        chunks = chunk_source(SourceText("u", CONGRESS_TEXT))
        self.assertEqual(len(chunks), 1)
        self.assertIn("## Climate", chunks[0].text)
        self.assertEqual(chunks[0].heading, "Fighting for the 99th District")

    def test_sections_are_packed_without_splitting(self):
        chunks = chunk_source(SourceText("u", CONGRESS_TEXT), max_chars=300)
        self.assertGreater(len(chunks), 1)
        for chunk in chunks:
            self.assertLessEqual(len(chunk.text), 300)
        climate = next(c for c in chunks if "## Climate" in c.text)
        self.assertIn("renewable sources", climate.text)

    def test_long_section_parts_repeat_heading(self):
        body = " ".join(f"Sentence number {i} about clean water." for i in range(200))
        chunks = chunk_source(SourceText("u", f"## Water\n\n{body}"), max_chars=1000)
        self.assertGreater(len(chunks), 3)
        for chunk in chunks:
            self.assertTrue(chunk.text.startswith("## Water"))
            self.assertLessEqual(len(chunk.text), 1000)
            self.assertEqual(chunk.heading, "Water")

    def test_heading_only_sections_are_skipped(self):
        chunks = chunk_source(SourceText("u", "# Title\n\n## Empty\n\n## Real\n\nSome real text here."), max_chars=25)
        self.assertEqual([c.heading for c in chunks], ["Real"])


class QuoteVerificationTests(unittest.TestCase):
    def test_accepts_typographic_and_whitespace_variants(self):
        self.assertTrue(quote_in_text(
            "The Congresswoman's first bill was the Clean   Jobs Act.", CONGRESS_TEXT
        ))
        self.assertTrue(quote_in_text("“Expand Medicaid in every state”", CONGRESS_TEXT))

    def test_accepts_quote_spanning_list_items(self):
        self.assertTrue(quote_in_text(
            "Expand Medicaid in every state Protect coverage for pre-existing conditions",
            CONGRESS_TEXT,
        ))

    def test_rejects_paraphrase_and_too_short_quotes(self):
        self.assertFalse(quote_in_text("She wants a Green New Deal for all.", CONGRESS_TEXT))
        self.assertFalse(quote_in_text("Medicaid", CONGRESS_TEXT))
        self.assertFalse(quote_in_text("create millions of jobs ... renewable sources", CONGRESS_TEXT))

    def test_stored_quote_drops_markdown_markers(self):
        output = parse_positions(model_json(position(
            evidence_quote="## Climate\n\nThe Congresswoman’s first bill was the Clean Jobs Act.",
        )))
        kept, _ = verify_positions(output, Chunk("u", "Climate", CONGRESS_TEXT))
        self.assertEqual(kept[0].position.evidence_quote, "Climate The Congresswoman’s first bill was the Clean Jobs Act.")

    def test_verify_drops_unverified_and_counts_them(self):
        output = parse_positions(model_json(
            position(),
            position(target_name="Fossil Fuels", mechanism="regulation", evidence_quote="We will ban fracking nationwide immediately."),
        ))
        kept, rejected = verify_positions(output, Chunk("https://x.gov/congress", "Climate", CONGRESS_TEXT, 7))
        self.assertEqual(rejected, {REJECT_QUOTE: 1, REJECT_BILL_TARGET: 0})
        self.assertEqual([k.position.target_name for k in kept], ["Renewable Energy"])
        self.assertEqual(kept[0].source_url, "https://x.gov/congress")
        self.assertEqual(kept[0].page_id, 7)


class SchemaTests(unittest.TestCase):
    def test_schema_constrains_enums(self):
        schema = json.dumps(StatedPositionsOutput.model_json_schema())
        for value in ("funding", "taxation", "mixed", "Environmental Protection"):
            self.assertIn(value, schema)

    def test_parse_rejects_unknown_policy_area_and_extra_fields(self):
        with self.assertRaises(ValidationError):
            parse_positions(model_json(position(policy_area="Vibes")))
        with self.assertRaises(ValidationError):
            parse_positions(model_json({**position(), "confidence": 0.9}))

    def test_parse_rejects_empty_and_strips_fences(self):
        with self.assertRaises(ValueError):
            parse_positions("  ")
        parsed = parse_positions("```json\n" + model_json(position()) + "\n```")
        self.assertEqual(len(parsed.positions), 1)

    def test_policy_areas_are_unique(self):
        self.assertEqual(len(POLICY_AREAS), len(set(POLICY_AREAS)))


class PromptTests(unittest.TestCase):
    def test_messages_wrap_page_and_list_vocabulary(self):
        chunk = Chunk("https://x.gov/congress", "Climate", "Some text.", None)
        messages = build_position_messages("SYSTEM", OFFICIAL, chunk, ["Medicaid", "ICE"])
        self.assertEqual(messages[0], {"role": "system", "content": "SYSTEM"})
        user = messages[1]["content"]
        self.assertIn("Jane Example (Democratic, New York, district 99)", user)
        self.assertIn("<page>\nSome text.\n</page>", user)
        self.assertIn("Medicaid; ICE", user)
        self.assertIn("Section: Climate", user)

    def test_link_selector_maps_numbers_to_urls_and_ignores_out_of_range(self):
        candidates = [SimpleNamespace(url=f"https://x.gov/{i}", text=f"L{i}") for i in range(3)]
        sent = []

        def chat_fn(messages, schema):
            sent.append(messages)
            return json.dumps({"link_numbers": [2, 9, 0]})

        select = make_link_selector(chat_fn, OFFICIAL, "PICK LINKS")
        self.assertEqual(select(candidates), ["https://x.gov/1"])
        self.assertEqual(sent[0][0]["content"], "PICK LINKS")


class BillNameTargetTests(unittest.TestCase):
    def test_bill_and_act_names_are_detected(self):
        for name in (
            "National Defense Authorization Act",
            "Medicare for All Act of 2021",
            "One Big Beautiful Bill Act",
            "Inflation Reduction Act",
            "H.R. 1976",
            "S. 22",
        ):
            self.assertTrue(is_bill_name(name), name)

    def test_policy_nouns_and_standing_laws_are_kept(self):
        for name in (
            "Medicaid",
            "Faircloth Amendment",
            "Affordable Care Act",
            "voting rights act",
            "Clean Water Act Enforcement",
            "Impact Aid",
        ):
            self.assertFalse(is_bill_name(name), name)

    def test_verify_rejects_bill_name_targets_separately(self):
        output = parse_positions(model_json(
            position(),
            position(
                target_name="Clean Jobs Act",
                mechanism="regulation",
                evidence_quote="The Congresswoman’s first bill was the Clean Jobs Act.",
            ),
        ))
        kept, rejected = verify_positions(output, Chunk("u", "Climate", CONGRESS_TEXT))
        self.assertEqual([k.position.target_name for k in kept], ["Renewable Energy"])
        self.assertEqual(rejected, {REJECT_QUOTE: 0, REJECT_BILL_TARGET: 1})


class StanceTests(unittest.TestCase):
    def test_official_direction_follows_stance(self):
        cases = {
            ("increase", "supports"): "increase",
            ("decrease", "supports"): "decrease",
            ("maintain", "supports"): "maintain",
            ("increase", "opposes"): "decrease",
            ("decrease", "opposes"): "increase",  # fights cuts -> wants more
            ("maintain", "opposes"): "mixed",
            ("mixed", "opposes"): "mixed",
        }
        for (direction, stance), wanted in cases.items():
            p = StatedPosition(**position(direction=direction, stance=stance))
            self.assertEqual(official_direction(p), wanted, (direction, stance))
            self.assertEqual(VerifiedPosition(p, "u", None).direction, wanted)

    def test_stance_is_required(self):
        data = position()
        del data["stance"]
        with self.assertRaises(ValidationError):
            parse_positions(model_json(data))


class MergeTests(unittest.TestCase):
    def _verified(self, **overrides):
        return VerifiedPosition(StatedPosition(**position(**overrides)), "u", None)

    def test_support_and_opposed_opposite_agree(self):
        merged = merge_positions([
            self._verified(target_name="Medicaid", direction="increase", stance="supports"),
            self._verified(target_name="Medicaid", direction="decrease", stance="opposes"),
        ])
        self.assertEqual(len(merged), 1)
        self.assertEqual(merged[0].direction, "increase")

    def test_weighted_majority_wins_over_a_weaker_conflict(self):
        # AOC: "Voting Rights" came out "mixed" from one off-phrased chunk.
        merged = merge_positions([
            self._verified(direction="increase", emphasis="high", summary="strong"),
            self._verified(target_name="renewable energy", direction="decrease", emphasis="low"),
        ])
        self.assertEqual(len(merged), 1)
        self.assertEqual(merged[0].direction, "increase")
        self.assertEqual(merged[0].position.summary, "strong")

    def test_two_weaker_statements_outvote_one_strong(self):
        merged = merge_positions([
            self._verified(direction="increase", emphasis="high"),
            self._verified(direction="decrease", emphasis="medium", summary="a"),
            self._verified(direction="decrease", emphasis="medium", summary="b"),
        ])
        self.assertEqual(merged[0].direction, "decrease")
        self.assertEqual(merged[0].position.direction, "decrease")

    def test_exact_tie_becomes_mixed(self):
        merged = merge_positions([
            self._verified(direction="increase", emphasis="medium"),
            self._verified(direction="decrease", emphasis="medium"),
        ])
        self.assertEqual(merged[0].direction, "mixed")

    def test_highest_emphasis_supplies_statement_and_sorts_first(self):
        merged = merge_positions([
            self._verified(target_name="Medicaid", policy_area="Health", emphasis="low", summary="low"),
            self._verified(emphasis="medium", summary="medium"),
            self._verified(emphasis="high", summary="high"),
        ])
        self.assertEqual([m.position.target_name for m in merged], ["Renewable Energy", "Medicaid"])
        self.assertEqual(merged[0].position.summary, "high")

    def test_different_mechanisms_are_kept_separately(self):
        merged = merge_positions([self._verified(), self._verified(mechanism="regulation")])
        self.assertEqual(len(merged), 2)


class VersionAndHashTests(unittest.TestCase):
    def test_combined_hash_ignores_order_and_tracks_content(self):
        a = combined_hash([("u1", "h1"), ("u2", "h2")])
        self.assertEqual(a, combined_hash([("u2", "h2"), ("u1", "h1")]))
        self.assertNotEqual(a, combined_hash([("u1", "h1"), ("u2", "changed")]))

    def test_extractor_version_changes_with_either_prompt_and_model(self):
        base = extractor_version(("positions", "links"), "m1")
        self.assertEqual(base, extractor_version(("positions", "links"), "m1"))
        self.assertNotEqual(base, extractor_version(("positions", "links"), "m2"))
        self.assertNotEqual(base, extractor_version(("positions v2", "links"), "m1"))
        self.assertNotEqual(base, extractor_version(("positions", "links v2"), "m1"))


class ProgressTests(unittest.TestCase):
    def test_eta_after_first_official(self):
        from official_positions import _progress

        self.assertEqual(_progress(0, 10, 0), "")
        self.assertEqual(_progress(2, 10, 600), "  (elapsed 10m, ~40m left)")
        self.assertEqual(_progress(5, 200, 3 * 3600), "  (elapsed 3h00m, ~117h00m left)")


class LocalPromptsTests(unittest.TestCase):
    def _config(self, body: str) -> Path:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        path = Path(directory.name) / "positions_llm_config.py"
        path.write_text(body, encoding="utf-8")
        return path

    def test_default_path_is_in_scripts(self):
        self.assertEqual(LOCAL_CONFIG_PATH.parent.name, "scripts")

    def test_missing_local_config_explains_how_to_create_it(self):
        with self.assertRaises(RuntimeError) as ctx:
            load_local_prompts(Path(tempfile.gettempdir()) / "no_such_dir" / "positions_llm_config.py")
        self.assertIn("scripts/positions_llm_config.example.py", str(ctx.exception))

    def test_empty_prompts_are_rejected(self):
        path = self._config('POSITIONS_SYSTEM_PROMPT = "  "\nLINK_SELECTION_PROMPT = "links"\n')
        with self.assertRaises(RuntimeError):
            load_local_prompts(path)

    def test_loads_both_prompts(self):
        path = self._config('POSITIONS_SYSTEM_PROMPT = "positions"\nLINK_SELECTION_PROMPT = "links"\n')
        self.assertEqual(load_local_prompts(path), Prompts("positions", "links"))

    def test_example_template_loads(self):
        example = LOCAL_CONFIG_PATH.with_name("positions_llm_config.example.py")
        prompts = load_local_prompts(example)
        self.assertIn("mechanism:", prompts.positions)


class IsDueTests(unittest.TestCase):
    now = datetime(2026, 10, 1, 12, 0, 0)

    def sync(self, **fields):
        base = dict(
            official_id="E",
            status="ok",
            last_attempt_at=self.now - timedelta(days=1),
            last_success_at=self.now - timedelta(days=1),
            extractor_version="v1",
            attempts=0,
        )
        base.update(fields)
        return OfficialPositionSync(**base)

    def due(self, sync, **kwargs):
        return is_due(sync, now=self.now, version="v1", max_age_days=30, **kwargs)

    def test_new_official_is_due(self):
        self.assertTrue(self.due(None))

    def test_recent_success_is_not_due_until_max_age(self):
        self.assertFalse(self.due(self.sync()))
        self.assertTrue(self.due(self.sync(last_success_at=self.now - timedelta(days=31))))
        self.assertTrue(self.due(self.sync(), force=True))

    def test_version_change_makes_extracted_officials_due(self):
        self.assertTrue(self.due(self.sync(extractor_version="v0")))
        # A blocked site is not retried early just because the prompt changed.
        self.assertFalse(self.due(self.sync(status="blocked", extractor_version=None, last_success_at=None)))

    def test_failures_back_off_then_cap(self):
        recent = self.sync(status="failed", attempts=2, last_attempt_at=self.now - timedelta(hours=11))
        self.assertFalse(self.due(recent))
        older = self.sync(status="failed", attempts=2, last_attempt_at=self.now - timedelta(hours=13))
        self.assertTrue(self.due(older))
        capped = self.sync(status="failed", attempts=5, last_attempt_at=self.now - timedelta(days=2))
        self.assertFalse(self.due(capped))


class ExtractPositionsTests(unittest.TestCase):
    def test_runs_chunks_in_parallel_and_merges(self):
        threads = set()
        sources = [
            SourceText("https://x.gov/congress", CONGRESS_TEXT),
            SourceText("https://x.gov/issues/health-care", "## Health Care\n\nExpand Medicaid in every state."),
        ]

        def chat_fn(messages, schema):
            threads.add(threading.get_ident())
            if "x.gov/congress" in messages[1]["content"]:
                return model_json(position(), position(target_name="Ghost", evidence_quote="Not on the page at all, really."))
            return model_json(position(
                issue_label="Health Care",
                policy_area="Health",
                target_name="Medicaid",
                evidence_quote="Expand Medicaid in every state.",
            ))

        merged, chunks, rejected = extract_positions(
            OFFICIAL, sources, prompt="P", chat_fn=chat_fn, vocabulary=[], concurrency=2
        )
        self.assertEqual(chunks, 2)
        self.assertEqual(rejected[REJECT_QUOTE], 1)
        self.assertEqual(sorted(m.position.target_name for m in merged), ["Medicaid", "Renewable Energy"])

    def test_any_chunk_failure_raises(self):
        def chat_fn(messages, schema):
            raise TimeoutError("Ollama timed out")

        with self.assertRaises(RuntimeError) as ctx:
            extract_positions(
                OFFICIAL, [SourceText("https://x.gov/congress", CONGRESS_TEXT)],
                prompt="P", chat_fn=chat_fn, vocabulary=[], concurrency=2,
            )
        self.assertIn("chunk 1/1 https://x.gov/congress", str(ctx.exception))
        self.assertIn("Ollama timed out", str(ctx.exception))


class FakeOllamaClient:
    """Returns queued responses and records each chat() call."""

    def __init__(self, responses, reject_think=False):
        self.responses = list(responses)
        self.calls = []
        self.reject_think = reject_think

    def chat(self, **kwargs):
        self.calls.append(kwargs)
        if self.reject_think and "think" in kwargs:
            raise ValueError('"nemo" does not support thinking')
        return self.responses.pop(0)


def ollama_response(content="", thinking="", done_reason="stop", eval_count=10):
    return SimpleNamespace(
        message=SimpleNamespace(content=content, thinking=thinking),
        done_reason=done_reason,
        eval_count=eval_count,
    )


class ChatFnTests(unittest.TestCase):
    def make(self, client, **kwargs):
        from official_positions import make_chat_fn

        return make_chat_fn("m", "h", 1, num_ctx=16384, num_predict=100, client=client, **kwargs)

    def test_thinking_is_off_and_context_fixed(self):
        client = FakeOllamaClient([ollama_response('{"positions": []}')])
        self.assertEqual(self.make(client)([], {}), '{"positions": []}')
        call = client.calls[0]
        self.assertIs(call["think"], False)
        self.assertEqual(call["options"]["num_ctx"], 16384)
        self.assertEqual(call["options"]["num_predict"], 100)

    def test_empty_answer_retries_with_double_budget(self):
        client = FakeOllamaClient([
            ollama_response("", thinking="x" * 500, done_reason="length", eval_count=100),
            ollama_response('{"positions": []}'),
        ])
        self.assertEqual(self.make(client)([], {}), '{"positions": []}')
        self.assertEqual([c["options"]["num_predict"] for c in client.calls], [100, 200])
        self.assertEqual(client.calls[0]["options"]["num_ctx"], client.calls[1]["options"]["num_ctx"])

    def test_timeout_names_the_setting_to_raise(self):
        import httpx
        from official_positions import make_chat_fn

        class SlowClient:
            def chat(self, **kwargs):
                raise httpx.ReadTimeout("timed out")

        chat_fn = make_chat_fn("m", "h", 900, num_ctx=16384, num_predict=100, client=SlowClient())
        with self.assertRaises(TimeoutError) as ctx:
            chat_fn([], {})
        self.assertIn("within 900s", str(ctx.exception))
        self.assertIn("--timeout", str(ctx.exception))

    def test_retry_budget_stays_inside_the_context_window(self):
        from official_positions import make_chat_fn

        client = FakeOllamaClient([ollama_response(""), ollama_response('{"positions": []}')])
        chat_fn = make_chat_fn("m", "h", 1, num_ctx=16384, num_predict=8192, client=client)
        chat_fn([{"role": "user", "content": "x" * 15000}], {})  # ~5000 prompt tokens
        budgets = [c["options"]["num_predict"] for c in client.calls]
        self.assertEqual(budgets[0], 8192)
        self.assertLessEqual(budgets[1], 16384 - 5000)
        self.assertGreaterEqual(budgets[1], 8192)

    def test_error_explains_why_the_answer_was_empty(self):
        client = FakeOllamaClient([
            ollama_response("", thinking="x" * 500, done_reason="length", eval_count=100),
            ollama_response("  ", thinking="y" * 900, done_reason="length", eval_count=200),
        ])
        with self.assertRaises(ValueError) as ctx:
            self.make(client)([], {})
        message = str(ctx.exception)
        self.assertIn("done_reason=length", message)
        self.assertIn("thinking_chars=900", message)
        self.assertIn("--num-predict", message)

    def test_models_without_thinking_mode_drop_the_parameter(self):
        client = FakeOllamaClient(
            [ollama_response('{"positions": []}'), ollama_response('{"positions": []}')],
            reject_think=True,
        )
        chat_fn = self.make(client)
        chat_fn([], {})
        chat_fn([], {})
        self.assertEqual(["think" in c for c in client.calls], [True, False, False])

    def test_think_flag_is_passed_through(self):
        client = FakeOllamaClient([ollama_response('{"positions": []}')])
        self.make(client, think=True)([], {})
        self.assertIs(client.calls[0]["think"], True)


def _test_database_available() -> bool:
    url = os.environ.get("DATABASE_URL", "")
    if not url.rstrip("/").endswith("_test"):
        return False
    try:
        from database import engine

        with engine.connect():
            return True
    except Exception:
        return False


@unittest.skipUnless(_test_database_available(), "needs a reachable *_test Postgres database")
class RunPositionsDatabaseTests(unittest.TestCase):
    """End-to-end worker runs against a real *_test database."""

    OFFICIAL_ID = "ZZTEST0001"

    @classmethod
    def setUpClass(cls):
        from init_db import ensure_schema

        ensure_schema()

    def setUp(self):
        from database import SessionLocal
        from models import Official, PolicyTarget

        self.SessionLocal = SessionLocal
        self._cleanup()
        session = SessionLocal()
        self.existing_targets = {t.id for t in session.query(PolicyTarget).all()}
        session.add(Official(
            id=self.OFFICIAL_ID,
            name="Jane Example",
            state="New York",
            party="Democratic",
            office="Representative",
            district=99,
            current_member=True,
            website_url="https://example-rep.house.gov",
            level="federal",
        ))
        session.commit()
        session.close()
        self.calls = []
        self.pages = {"https://example-rep.house.gov/congress": CONGRESS_TEXT}
        self.clock = [datetime(2026, 10, 1, 12, 0, 0)]

    def tearDown(self):
        from models import PolicyTarget

        self._cleanup_extra()
        self._cleanup()
        session = self.SessionLocal()
        session.query(PolicyTarget).filter(~PolicyTarget.id.in_(self.existing_targets or {-1})).delete(
            synchronize_session=False
        )
        session.commit()
        session.close()

    def _cleanup(self):
        from models import Official, OfficialPositionSync, OfficialSourcePage, OfficialStance

        session = self.SessionLocal()
        for model in (OfficialStance, OfficialSourcePage, OfficialPositionSync):
            session.query(model).filter(model.official_id == self.OFFICIAL_ID).delete()
        session.query(Official).filter(Official.id == self.OFFICIAL_ID).delete()
        session.commit()
        session.close()

    def _crawler(self):
        from services.site_crawler import CrawlResult, CrawledPage, content_hash

        test = self

        class FakeCrawler:
            def crawl(self, website_url, select_links_fn=None):
                return CrawlResult(
                    status="ok",
                    start_url=website_url,
                    pages=[
                        CrawledPage(url, "issues_index", "In Congress", text, content_hash(text), 200)
                        for url, text in sorted(test.pages.items())
                    ],
                )

            def close(self):
                pass

        return FakeCrawler()

    def _chat(self, messages, schema):
        self.calls.append(messages)
        return model_json(
            position(),
            # Opposing a cut: stored as wanting Medicaid funding to increase.
            position(
                issue_label="Health Care",
                policy_area="Health",
                target_name="Medicaid",
                direction="decrease",
                stance="opposes",
                emphasis="medium",
                summary="Opposes cuts to Medicaid.",
                evidence_quote="She will fight against cuts to Medicaid.",
            ),
            position(target_name="Invented", evidence_quote="This sentence is nowhere on the page."),
        )

    def _run(self, **kwargs):
        from official_positions import run_positions

        return run_positions(
            official_id=self.OFFICIAL_ID,
            chat_fn=kwargs.pop("chat_fn", self._chat),
            crawler=self._crawler(),
            session_factory=self.SessionLocal,
            prompts=Prompts("POSITIONS PROMPT", "LINKS PROMPT"),
            model="test-model",
            now_fn=lambda: self.clock[0],
            log=lambda _m: None,
            **kwargs,
        )

    def _stances(self):
        from models import OfficialStance

        session = self.SessionLocal()
        rows = session.query(OfficialStance).filter(OfficialStance.official_id == self.OFFICIAL_ID).all()
        out = sorted((r.target_name, r.mechanism, r.direction, r.source_url, r.source_page_id is not None) for r in rows)
        session.close()
        return out

    def _sync(self):
        session = self.SessionLocal()
        sync = session.get(OfficialPositionSync, self.OFFICIAL_ID)
        session.expunge_all()
        session.close()
        return sync

    def test_first_run_saves_verified_stances_and_second_run_skips_model(self):
        stats = self._run()
        self.assertEqual(stats["extracted"], 1)
        self.assertEqual(stats["stances_saved"], 2)
        self.assertEqual(stats["rejected_unverified"], 1)
        url = "https://example-rep.house.gov/congress"
        self.assertEqual(self._stances(), [
            ("Medicaid", "funding", "increase", url, True),
            ("Renewable Energy", "funding", "increase", url, True),
        ])
        sync = self._sync()
        self.assertEqual((sync.status, sync.stances_saved, sync.pages_found), ("ok", 2, 1))
        from models import OfficialStance

        session = self.SessionLocal()
        medicaid = session.query(OfficialStance).filter_by(
            official_id=self.OFFICIAL_ID, target_name="Medicaid"
        ).one()
        self.assertEqual(
            (medicaid.direction, medicaid.stance, medicaid.policy_direction),
            ("increase", "opposes", "decrease"),
        )
        session.close()
        calls_after_first = len(self.calls)

        self.clock[0] += timedelta(hours=1)
        stats = self._run()
        self.assertEqual(stats["unchanged"], 1)
        self.assertEqual(len(self.calls), calls_after_first)
        self.assertEqual(len(self._stances()), 2)

    def test_changed_page_re_extracts_and_failure_keeps_prior_stances(self):
        self._run()
        self.pages["https://example-rep.house.gov/congress"] = CONGRESS_TEXT + "\n\nNew paragraph."

        def broken(messages, schema):
            raise TimeoutError("Ollama timed out")

        stats = self._run(chat_fn=broken)
        self.assertEqual(stats["failed"], 1)
        self.assertEqual(len(self._stances()), 2)
        sync = self._sync()
        self.assertEqual((sync.status, sync.attempts), ("failed", 1))

        stats = self._run()
        self.assertEqual(stats["extracted"], 1)
        self.assertEqual(self._sync().status, "ok")
        self.assertEqual(self._sync().attempts, 0)

    def test_background_crawls_never_touch_the_session(self):
        """Regression: the prefetch thread read expired ORM attributes
        (official.website_url / name) while the main thread used the session,
        which Postgres sessions reject ("concurrent operations are not
        permitted"). Several officials, slow crawls and model calls, and a
        crawler that uses the link-selection fallback (describe_official)."""
        import time as _time
        from models import Official
        from official_positions import run_positions
        from services.site_crawler import CrawlResult, CrawledPage, content_hash

        session = self.SessionLocal()
        for n in (2, 3, 4):
            session.add(Official(
                id=f"ZZTEST000{n}", name=f"Rep {n}", state="Ohio", party="Independent",
                office="Representative", district=n, current_member=True,
                website_url=f"https://rep{n}.example.gov", level="zztest",
            ))
        session.query(Official).filter(Official.id == self.OFFICIAL_ID).update({"level": "zztest"})
        session.commit()
        session.close()

        test = self

        class SlowCrawler:
            def crawl(self, website_url, select_links_fn=None):
                _time.sleep(0.15)
                if select_links_fn is not None:
                    select_links_fn([SimpleNamespace(url=website_url + "/issues", text="Issues")])
                return CrawlResult(status="ok", start_url=website_url, pages=[
                    CrawledPage(website_url + "/issues", "issues_index", "Issues", CONGRESS_TEXT, content_hash(CONGRESS_TEXT), 200)
                ])

            def close(self):
                pass

        def chat(messages, schema):
            _time.sleep(0.05)
            if "link_numbers" in json.dumps(schema):
                return json.dumps({"link_numbers": [1]})
            return test._chat(messages, schema)

        from sqlalchemy import event
        from database import engine

        sql_threads = set()

        def record_thread(*_args):
            sql_threads.add(threading.get_ident())

        event.listen(engine, "before_cursor_execute", record_thread)
        try:
            stats = run_positions(
                limit=0, level="zztest", chat_fn=chat, crawler=SlowCrawler(),
                session_factory=self.SessionLocal, prompts=Prompts("P", "L"),
                model="test-model", now_fn=lambda: self.clock[0], log=lambda _m: None,
            )
        finally:
            event.remove(engine, "before_cursor_execute", record_thread)
        # Every query ran on the caller's thread, never on the crawl thread.
        self.assertEqual(sql_threads, {threading.get_ident()})
        self.assertEqual(stats["selected"], 4)
        self.assertEqual(stats["failed"], 0)
        self.assertEqual(stats["extracted"], 4)

    def test_crawler_exception_is_recorded_not_fatal(self):
        from official_positions import run_positions

        class Exploding:
            def crawl(self, website_url, select_links_fn=None):
                raise RuntimeError("socket exploded")

            def close(self):
                pass

        stats = run_positions(
            official_id=self.OFFICIAL_ID, chat_fn=self._chat, crawler=Exploding(),
            session_factory=self.SessionLocal, prompts=Prompts("P", "L"),
            model="test-model", now_fn=lambda: self.clock[0], log=lambda _m: None,
        )
        self.assertEqual(stats["failed"], 1)
        sync = self._sync()
        self.assertEqual(sync.status, "failed")
        self.assertIn("socket exploded", sync.last_error)

    def _cleanup_extra(self):
        from models import Official, OfficialPositionSync, OfficialSourcePage, OfficialStance

        session = self.SessionLocal()
        ids = [f"ZZTEST000{n}" for n in (2, 3, 4)]
        for model in (OfficialStance, OfficialSourcePage, OfficialPositionSync):
            session.query(model).filter(model.official_id.in_(ids)).delete(synchronize_session=False)
        session.query(Official).filter(Official.id.in_(ids)).delete(synchronize_session=False)
        session.commit()
        session.close()

    def test_dry_run_writes_nothing(self):
        stats = self._run(dry_run=True)
        self.assertEqual(stats["extracted"], 1)
        self.assertEqual(self._stances(), [])
        self.assertIsNone(self._sync())

    def test_extract_only_reuses_stored_pages(self):
        self._run(crawl_only=True)
        self.assertEqual(self.calls, [])
        self.assertIsNone(self._sync())
        stats = self._run(extract_only=True)
        self.assertEqual(stats["stances_saved"], 2)


if __name__ == "__main__":
    unittest.main()
