import json
import os
import tempfile
import threading
import unittest
from datetime import date, datetime, timedelta
from pathlib import Path

os.environ.setdefault(
    "DATABASE_URL",
    "postgresql://postgres:postgres@localhost:5432/politmus_test",
)

from pydantic import ValidationError

from bill_classifier import (
    LOCAL_CONFIG_PATH,
    MAX_FAILED_ATTEMPTS,
    BillState,
    Prompts,
    is_due,
    load_local_prompts,
    select_bills,
)
from services.bill_classification import (
    MIN_SUMMARY_CHARS,
    REJECT_BILL_TARGET,
    REJECT_CITATION,
    BillClassification,
    BillIntent,
    BillIntentsOnly,
    BillSnapshot,
    BillSummaries,
    ClassificationResult,
    IncompleteSummaries,
    classifier_version,
    model_from_version,
    classify_bill,
    input_hash,
    merge_intents,
    metadata_is_complete,
    summary_text,
    verify_intents,
)
from services.official_positions import SourceText, chunk_source

BILL = BillSnapshot(
    id="119-hr-9999",
    title="Clean Water Funding Act",
    policy_area="Environmental Protection",
    sponsor_name="Jane Example",
    sponsor_party="D",
    status="Introduced",
    summary="",
)

FUNDING_SENTENCE = "This bill increases funding for the Clean Water State Revolving Fund by $2 billion."
REPORT_SENTENCE = (
    "It also requires the Environmental Protection Agency to report to Congress "
    "on lead pipe replacement."
)
SHORT_HTML = (
    "<p><strong>Clean Water Funding Act</strong></p>"
    f"<p>{FUNDING_SENTENCE} {REPORT_SENTENCE}</p>"
)
TLDR = "Adds $2 billion for clean water loans and an EPA lead pipe report."
ELI5 = "The government gives states more money to fix old water pipes."


def intent(**overrides) -> dict:
    data = {
        "citation": FUNDING_SENTENCE,
        "target": "Clean Water State Revolving Fund",
        "mechanism": "funding",
        "direction": "increase",
        "magnitude": "high",
        "relation": "core",
        "rationale": "Adds $2 billion to the fund.",
    }
    data.update(overrides)
    return data


def full_json(*intents, tldr=TLDR, eli5=ELI5) -> str:
    return json.dumps({"tldr": tldr, "eli5": eli5, "intents": list(intents)})


def schema_kind(schema) -> str:
    props = schema.get("properties", {})
    if "intents" in props and "tldr" in props:
        return "full"
    if "intents" in props:
        return "chunk"
    return "summaries"


def long_html(sections: int = 6, sentences: int = 8) -> str:
    """A CRS-style summary: an overview, then titles with (Sec. N) paragraphs."""
    parts = [
        "<p><strong>Big Omnibus Act</strong></p>",
        "<p>This bill makes changes to agriculture, health, and energy programs.</p>",
    ]
    for n in range(1, sections + 1):
        parts.append(f"<p><strong>TITLE {n}--PROGRAM {n}</strong></p>")
        body = " ".join(
            f"The bill expands Program {n} grants for item {k} in rural areas." for k in range(sentences)
        )
        parts.append(f"<p>(Sec. {n}01) {body}</p>")
    return "".join(parts)


# -- schema ------------------------------------------------------------------


class SchemaTests(unittest.TestCase):
    def test_tldr_and_eli5_are_required_and_non_blank(self):
        BillClassification.model_validate_json(full_json(intent()))
        for bad in ("", " " * 40, "too short"):
            with self.assertRaises(ValidationError):
                BillClassification.model_validate_json(full_json(intent(), tldr=bad))
            with self.assertRaises(ValidationError):
                BillClassification.model_validate_json(full_json(intent(), eli5=bad))
        with self.assertRaises(ValidationError):
            BillClassification.model_validate({"tldr": TLDR, "intents": []})

    def test_values_are_stripped(self):
        parsed = BillSummaries(tldr=f"  {TLDR}  ", eli5=ELI5)
        self.assertEqual(parsed.tldr, TLDR)

    def test_schema_requires_summaries_first_and_citation_first(self):
        schema = BillClassification.model_json_schema()
        self.assertEqual(list(schema["properties"]), ["tldr", "eli5", "intents"])
        self.assertEqual(set(schema["required"]), {"tldr", "eli5", "intents"})
        self.assertEqual(schema["properties"]["tldr"]["minLength"], MIN_SUMMARY_CHARS)
        self.assertIs(schema["additionalProperties"], False)
        intent_schema = schema["$defs"]["BillIntent"]
        self.assertEqual(list(intent_schema["properties"])[0], "citation")
        self.assertEqual(intent_schema["properties"]["mechanism"]["enum"], ["funding", "regulation", "oversight", "taxation"])

    def test_enums_and_extra_fields_are_rejected(self):
        with self.assertRaises(ValidationError):
            BillIntent.model_validate(intent(mechanism="spending"))
        with self.assertRaises(ValidationError):
            BillIntent.model_validate(intent(direction="up"))
        with self.assertRaises(ValidationError):
            BillIntent.model_validate({**intent(), "confidence": 0.9})
        with self.assertRaises(ValidationError):
            BillIntentsOnly.model_validate({"intents": [], "tldr": TLDR})

    def test_metadata_keeps_frontend_keys_and_adds_provenance(self):
        result = ClassificationResult(TLDR, ELI5, [BillIntent.model_validate(intent())], {REJECT_CITATION: 2, REJECT_BILL_TARGET: 0}, 3)
        data = result.metadata(model="m", version="v", classified_at="2026-10-01T12:00:00Z")
        self.assertEqual(data["tldr"], TLDR)
        self.assertEqual(data["eli5"], ELI5)
        self.assertEqual(
            set(data["intents"][0]),
            {"target", "mechanism", "direction", "magnitude", "relation", "rationale", "citation"},
        )
        self.assertEqual((data["model"], data["version"], data["chunks"]), ("m", "v", 3))
        self.assertEqual(data["rejected"], {REJECT_CITATION: 2})
        self.assertTrue(metadata_is_complete(data))

    def test_effects_output_maps_intents_to_bill_effects(self):
        result = ClassificationResult(TLDR, ELI5, [BillIntent.model_validate(intent())])
        effect = result.effects_output().effects[0]
        self.assertEqual(effect.target_name, "Clean Water State Revolving Fund")
        self.assertEqual((effect.mechanism, effect.direction, effect.magnitude), ("funding", "increase", "high"))
        self.assertIn(FUNDING_SENTENCE, effect.rationale)

    def test_legacy_metadata_completeness(self):
        self.assertFalse(metadata_is_complete(None))
        self.assertFalse(metadata_is_complete({"tldr": TLDR, "eli5": "", "intents": []}))
        self.assertFalse(metadata_is_complete({"tldr": TLDR, "eli5": None, "intents": []}))
        self.assertFalse(metadata_is_complete({"tldr": TLDR, "eli5": ELI5}))
        self.assertTrue(metadata_is_complete({"tldr": TLDR, "eli5": ELI5, "intents": []}))


# -- verification / merge ----------------------------------------------------


def parsed(*items) -> list[BillIntent]:
    return [BillIntent.model_validate(i) for i in items]


class VerifyIntentsTests(unittest.TestCase):
    text = summary_text(SHORT_HTML)

    def test_accepts_typographic_and_whitespace_variants(self):
        variant = "This  bill increases\nfunding for the “Clean Water State Revolving Fund” by $2 billion"
        text = self.text.replace("the Clean Water State Revolving Fund", "the \"Clean Water State Revolving Fund\"")
        kept, rejected = verify_intents(parsed(intent(citation=variant)), text)
        self.assertEqual(len(kept), 1)
        self.assertEqual(rejected[REJECT_CITATION], 0)

    def test_rejects_paraphrases_and_ellipses(self):
        kept, rejected = verify_intents(parsed(
            intent(citation="The bill gives the Clean Water fund two billion dollars."),
            intent(citation="This bill increases funding ... by $2 billion."),
        ), self.text)
        self.assertEqual(kept, [])
        self.assertEqual(rejected[REJECT_CITATION], 2)

    def test_rejects_bill_name_targets_but_keeps_standing_laws(self):
        kept, rejected = verify_intents(parsed(
            intent(target="Clean Water Funding Act"),
            intent(target="H.R. 9999", mechanism="oversight"),
            intent(target="Clean Water Act", mechanism="regulation"),
        ), self.text)
        self.assertEqual([i.target for i in kept], ["Clean Water Act"])
        self.assertEqual(rejected[REJECT_BILL_TARGET], 2)


class MergeIntentsTests(unittest.TestCase):
    def test_duplicates_merge_keeping_the_higher_magnitude(self):
        merged = merge_intents(parsed(
            intent(target="Medicaid", magnitude="low", rationale="first"),
            intent(target="medicaid ", magnitude="high", rationale="second"),
            intent(target="Medicaid", mechanism="regulation", magnitude="medium"),
        ))
        self.assertEqual([(i.target.strip(), i.mechanism, i.magnitude) for i in merged], [
            ("medicaid", "funding", "high"),
            ("Medicaid", "regulation", "medium"),
        ])

    def test_weighted_vote_and_exact_tie_becomes_mixed(self):
        merged = merge_intents(parsed(
            intent(target="SNAP", direction="decrease", magnitude="high"),
            intent(target="SNAP", direction="increase", magnitude="low"),
        ))
        self.assertEqual((merged[0].direction, merged[0].magnitude), ("decrease", "high"))
        merged = merge_intents(parsed(
            intent(target="SNAP", direction="decrease", magnitude="medium"),
            intent(target="SNAP", direction="increase", magnitude="medium"),
        ))
        self.assertEqual(merged[0].direction, "mixed")

    def test_cap_keeps_strongest(self):
        items = parsed(*[intent(target=f"Program {n}", magnitude="low") for n in range(5)], intent(target="Big", magnitude="high"))
        merged = merge_intents(items, limit=3)
        self.assertEqual(merged[0].target, "Big")
        self.assertEqual(len(merged), 3)


# -- CRS text and chunking ---------------------------------------------------


class SummaryTextTests(unittest.TestCase):
    def test_bold_paragraphs_become_headings_and_entities_decode(self):
        text = summary_text(
            "<p><strong>TITLE I--AGRICULTURE</strong></p><p><strong>Subtitle A--Nutrition</strong></p>"
            "<p>(Sec. 10101) This section limits <em>SNAP</em> benefits &amp; work rules , as specified.</p>"
            "<ul><li>one</li><li>two</li></ul>"
        )
        self.assertEqual(text.splitlines()[0], "## TITLE I--AGRICULTURE / Subtitle A--Nutrition")
        self.assertIn("(Sec. 10101) This section limits SNAP benefits & work rules, as specified.", text)
        self.assertIn("- one", text)

    def test_plain_text_and_empty_summaries(self):
        self.assertEqual(summary_text(None), "")
        self.assertEqual(summary_text("<p> </p>"), "")
        self.assertEqual(summary_text("Plain text summary."), "Plain text summary.")

    def test_long_summaries_are_not_truncated(self):
        html = long_html(sections=40, sentences=40)
        text = summary_text(html)
        self.assertGreater(len(text), 60_000)
        self.assertIn("(Sec. 4001)", text)

    def test_chunks_split_at_titles_and_repeat_headings(self):
        text = summary_text(long_html(sections=4, sentences=30))
        chunks = chunk_source(SourceText("b", text), 1000)
        self.assertGreater(len(chunks), 4)
        for chunk in chunks:
            self.assertLessEqual(len(chunk.text), 1000)
        title_chunks = [c for c in chunks if c.heading == "TITLE 2--PROGRAM 2"]
        self.assertGreater(len(title_chunks), 1)
        for chunk in title_chunks:
            self.assertTrue(chunk.text.startswith("## TITLE 2--PROGRAM 2"))
            self.assertNotIn("Program 3", chunk.text)


# -- classify_bill -----------------------------------------------------------


class FakeModel:
    """Answers by schema kind; records (kind, user message) per call."""

    def __init__(self, full=None, chunk=None, summaries=None):
        self.full = full
        self.chunk = chunk
        self.summaries = summaries
        self.calls = []
        self.lock = threading.Lock()

    def __call__(self, messages, schema):
        kind = schema_kind(schema)
        user = messages[-1]["content"]
        with self.lock:
            self.calls.append((kind, user))
        handler = getattr(self, kind)
        return handler(user) if callable(handler) else handler

    def kinds(self):
        return [k for k, _ in self.calls]


class ClassifyShortBillTests(unittest.TestCase):
    text = summary_text(SHORT_HTML)

    def test_one_call_returns_verified_intents(self):
        model = FakeModel(full=full_json(
            intent(),
            intent(citation=REPORT_SENTENCE, target="EPA", mechanism="oversight", magnitude="low"),
            intent(citation="Invented sentence that is not in the summary.", target="Other"),
        ))
        result = classify_bill(BILL, self.text, prompt="P", chat_fn=model)
        self.assertEqual(model.kinds(), ["full"])
        self.assertEqual((result.tldr, result.eli5), (TLDR, ELI5))
        self.assertEqual([i.target for i in result.intents], ["Clean Water State Revolving Fund", "EPA"])
        self.assertEqual(result.rejected[REJECT_CITATION], 1)
        self.assertIn("<summary>", model.calls[0][1])
        self.assertIn("Title: Clean Water Funding Act", model.calls[0][1])

    def test_missing_eli5_is_filled_by_a_summaries_call(self):
        model = FakeModel(
            full=full_json(intent(), eli5=""),
            summaries=json.dumps({"tldr": TLDR, "eli5": ELI5}),
        )
        result = classify_bill(BILL, self.text, prompt="P", summary_prompt="S", chat_fn=model)
        self.assertEqual(model.kinds(), ["full", "summaries"])
        self.assertEqual(result.eli5, ELI5)
        self.assertIn("Clean Water State Revolving Fund / funding / increase", model.calls[1][1])
        self.assertIn("previous answer left tldr or eli5 empty", model.calls[1][1])

    def test_still_missing_raises_incomplete(self):
        model = FakeModel(full=full_json(intent(), tldr=" "), summaries=json.dumps({"tldr": "", "eli5": ELI5}))
        with self.assertRaises(IncompleteSummaries):
            classify_bill(BILL, self.text, prompt="P", chat_fn=model)
        self.assertEqual(model.kinds(), ["full", "summaries"])

    def test_invalid_intents_fail(self):
        model = FakeModel(full=json.dumps({"tldr": TLDR, "eli5": ELI5}))
        with self.assertRaises(ValueError):
            classify_bill(BILL, self.text, prompt="P", chat_fn=model)
        model = FakeModel(full="")
        with self.assertRaises(ValueError):
            classify_bill(BILL, self.text, prompt="P", chat_fn=model)


class ClassifyLongBillTests(unittest.TestCase):
    text = summary_text(long_html(sections=6, sentences=8))

    @staticmethod
    def chunk_answer(user):
        """Cite the first Program grant sentence found in this chunk, plus one
        sentence from another title (which must fail verification)."""
        intents = []
        for n in range(1, 7):
            sentence = f"The bill expands Program {n} grants for item 0 in rural areas."
            if sentence in user:
                intents.append(intent(citation=sentence, target=f"Program {n}", magnitude="medium"))
                other = 1 if n != 1 else 2
                intents.append(intent(
                    citation=f"The bill expands Program {other} grants for item 0 in rural areas.",
                    target=f"Program {other}",
                ) if f"Program {other} grants" not in user else intent(citation=sentence, target=f"Program {n}", magnitude="low"))
        return json.dumps({"intents": intents})

    def test_map_reduce_then_summaries(self):
        model = FakeModel(chunk=self.chunk_answer, summaries=json.dumps({"tldr": TLDR, "eli5": ELI5}))
        logs = []
        result = classify_bill(BILL, self.text, prompt="P", summary_prompt="S", chat_fn=model, chunk_chars=700, concurrency=2, log=logs.append)
        kinds = model.kinds()
        self.assertGreater(result.chunks, 3)
        self.assertEqual(kinds.count("chunk"), result.chunks)
        self.assertEqual(kinds[-1], "summaries")
        self.assertEqual(sorted(i.target for i in result.intents), [f"Program {n}" for n in range(1, 7)])
        self.assertTrue(all(i.magnitude == "medium" for i in result.intents))
        self.assertGreater(result.rejected[REJECT_CITATION], 0)
        summary_user = model.calls[-1][1]
        self.assertIn("Program 3 / funding / increase", summary_user)
        self.assertIn("Big Omnibus Act", summary_user)
        self.assertTrue(any("chunk 1/" in line for line in logs))
        for _, user in model.calls[:-1]:
            self.assertIn("Part ", user)
        # Later chunks see the summary's opening so they can tell core from add-on effects.
        chunk_users = [user for _, user in model.calls[:-1]]
        self.assertNotIn("<overview>", next(u for u in chunk_users if f"Part 1 of {result.chunks}" in u))
        self.assertIn("<overview>", next(u for u in chunk_users if f"Part 2 of {result.chunks}" in u))

    def test_chunk_failure_names_the_chunk(self):
        def chunk(user):
            if "Program 4 grants" in user:
                raise TimeoutError("Ollama did not answer within 900s")
            return json.dumps({"intents": []})

        model = FakeModel(chunk=chunk, summaries=json.dumps({"tldr": TLDR, "eli5": ELI5}))
        with self.assertRaises(RuntimeError) as ctx:
            classify_bill(BILL, self.text, prompt="P", chat_fn=model, chunk_chars=700)
        self.assertRegex(str(ctx.exception), r"chunk \d+/\d+ \[TITLE 4--PROGRAM 4\]: Ollama did not answer")
        self.assertNotIn("summaries", model.kinds())

    def test_summaries_retry_then_incomplete(self):
        answers = iter([json.dumps({"tldr": "", "eli5": ""}), json.dumps({"tldr": TLDR, "eli5": ELI5})])
        model = FakeModel(chunk=json.dumps({"intents": []}), summaries=lambda _u: next(answers))
        result = classify_bill(BILL, self.text, prompt="P", chat_fn=model, chunk_chars=700)
        self.assertEqual(model.kinds().count("summaries"), 2)
        self.assertEqual(result.intents, [])
        self.assertEqual(result.tldr, TLDR)

        model = FakeModel(chunk=json.dumps({"intents": []}), summaries=json.dumps({"tldr": "", "eli5": ""}))
        with self.assertRaises(IncompleteSummaries):
            classify_bill(BILL, self.text, prompt="P", chat_fn=model, chunk_chars=700)


# -- due / version -----------------------------------------------------------


class VersionTests(unittest.TestCase):
    def test_version_changes_with_prompts_and_model(self):
        base = classifier_version(("system",), "qwen3.6:27b")
        self.assertTrue(base.startswith("bills-v2|p"))
        self.assertTrue(base.endswith("|qwen3.6:27b"))
        self.assertNotEqual(base, classifier_version(("system2",), "qwen3.6:27b"))
        self.assertNotEqual(base, classifier_version(("system", "summary"), "qwen3.6:27b"))
        self.assertNotEqual(base, classifier_version(("system",), "other:7b"))
        self.assertEqual(Prompts("s").for_version(), ("s",))
        self.assertEqual(Prompts("s", "t").for_version(), ("s", "t"))

    def test_model_from_version(self):
        self.assertEqual(model_from_version(classifier_version(("s",), "qwen3.6:27b")), "qwen3.6:27b")
        self.assertIsNone(model_from_version(None))
        self.assertIsNone(model_from_version(""))
        self.assertIsNone(model_from_version("x"))
        self.assertIsNone(model_from_version("bills-v1|pabc|"))

    def test_input_hash_tracks_title_area_and_summary(self):
        h = input_hash("t", "a", "s")
        self.assertEqual(h, BillSnapshot("x", title="t", policy_area="a", summary="s").input_hash)
        self.assertNotEqual(h, input_hash("t", "a", "s2"))
        self.assertNotEqual(h, input_hash("t2", "a", "s"))


class IsDueTests(unittest.TestCase):
    now = datetime(2026, 10, 1, 12, 0, 0)
    version = "bills-v1|pabc|m"

    def state(self, **overrides):
        data = dict(
            id="b", has_summary=True, has_metadata=True, metadata_complete=True,
            status="ok", version=self.version, input_hash="h", current_hash="h",
            attempts=0, attempted_at=self.now - timedelta(days=1),
        )
        data.update(overrides)
        return BillState(**data)

    def due(self, state, **kwargs):
        return is_due(state, now=self.now, version=self.version, max_age_days=30, **kwargs)

    def test_classified_and_unchanged_is_not_due(self):
        self.assertFalse(self.due(self.state()))
        self.assertTrue(self.due(self.state(), force=True))

    def test_never_classified_is_due(self):
        self.assertTrue(self.due(self.state(has_metadata=False, metadata_complete=False, status=None, version=None, input_hash=None)))

    def test_legacy_rows_missing_tldr_or_eli5_are_due(self):
        self.assertTrue(self.due(self.state(status=None, version=None, input_hash=None, metadata_complete=False)))
        # Legacy complete rows predate versioning, so they re-run once too.
        self.assertTrue(self.due(self.state(status=None, version=None, input_hash=None)))

    def test_version_or_input_change_is_due(self):
        self.assertTrue(self.due(self.state(version="bills-v1|pold|m")))
        self.assertTrue(self.due(self.state(current_hash="new")))

    def test_failures_back_off_then_cap(self):
        for status in ("failed", "incomplete"):
            failed = self.state(status=status, attempts=1, attempted_at=self.now - timedelta(hours=5))
            self.assertFalse(self.due(failed))
            self.assertTrue(self.due(self.state(status=status, attempts=1, attempted_at=self.now - timedelta(hours=7))))
            self.assertFalse(self.due(self.state(status=status, attempts=2, attempted_at=self.now - timedelta(hours=11))))
            capped = self.state(status=status, attempts=MAX_FAILED_ATTEMPTS, attempted_at=self.now - timedelta(days=10))
            self.assertFalse(self.due(capped))
            self.assertTrue(self.due(self.state(status=status, attempts=MAX_FAILED_ATTEMPTS, attempted_at=self.now - timedelta(days=31))))

    def test_no_summary_is_recorded_once_then_due_when_summary_appears(self):
        missing = self.state(has_summary=False, has_metadata=False, metadata_complete=False, status=None)
        self.assertTrue(self.due(missing))
        recorded = self.state(has_summary=False, has_metadata=False, metadata_complete=False, status="no_summary")
        self.assertFalse(self.due(recorded))
        self.assertTrue(self.due(self.state(has_metadata=False, metadata_complete=False, status="no_summary", current_hash="new")))

    def test_order_and_filters(self):
        states = [
            self.state(id="retry", status="failed", attempts=1, attempted_at=self.now - timedelta(days=1), voted_date=date(2026, 9, 1)),
            self.state(id="stale", version="old", voted_date=date(2026, 9, 1)),
            self.state(id="new-old", has_metadata=False, metadata_complete=False, status=None, introduced_date=date(2025, 1, 1)),
            self.state(id="new-voted", has_metadata=False, metadata_complete=False, status=None, voted_date=date(2026, 1, 1)),
            self.state(id="new-recent", has_metadata=False, metadata_complete=False, status=None, introduced_date=date(2026, 5, 1)),
            self.state(id="legacy-incomplete", status=None, version=None, metadata_complete=False),
            self.state(id="done"),
            self.state(id="nosum", has_summary=False, has_metadata=False, metadata_complete=False, status=None),
        ]
        due, unchanged = select_bills(states, version=self.version, now=self.now)
        self.assertEqual([s.id for s in due], ["new-voted", "new-recent", "new-old", "stale", "legacy-incomplete", "retry"])
        self.assertEqual(unchanged, 1)
        due, _ = select_bills(states, version=self.version, now=self.now, limit=2)
        self.assertEqual([s.id for s in due], ["new-voted", "new-recent"])
        due, _ = select_bills(states, version=self.version, now=self.now, existing_only=True)
        self.assertEqual([s.id for s in due], ["stale", "legacy-incomplete", "retry"])
        due, _ = select_bills(states, version=self.version, now=self.now, only_incomplete=True)
        self.assertEqual([s.id for s in due], ["legacy-incomplete"])


# -- local config / runtime --------------------------------------------------


class LocalPromptsTests(unittest.TestCase):
    def _config(self, body: str) -> Path:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        path = Path(directory.name) / "llm_config.py"
        path.write_text(body, encoding="utf-8")
        return path

    def test_default_path_is_the_gitignored_scripts_file(self):
        self.assertEqual((LOCAL_CONFIG_PATH.parent.name, LOCAL_CONFIG_PATH.name), ("scripts", "llm_config.py"))
        gitignore = (Path(__file__).resolve().parent.parent / ".gitignore").read_text()
        self.assertIn("backend/scripts/llm_config.py", gitignore)

    def test_missing_file_explains_how_to_create_it(self):
        with self.assertRaises(RuntimeError) as ctx:
            load_local_prompts(Path(tempfile.gettempdir()) / "no_such_dir" / "llm_config.py")
        self.assertIn("scripts/llm_config.example.py", str(ctx.exception))

    def test_system_prompt_required_summary_prompt_optional(self):
        with self.assertRaises(RuntimeError):
            load_local_prompts(self._config('SYSTEM_PROMPT = "  "\n'))
        self.assertEqual(load_local_prompts(self._config('SYSTEM_PROMPT = "s"\n')), Prompts("s", None))
        self.assertEqual(load_local_prompts(self._config('SYSTEM_PROMPT = "s"\nSUMMARY_PROMPT = "t"\n')), Prompts("s", "t"))

    def test_old_classification_metadata_class_is_ignored(self):
        logs = []
        path = self._config(
            "from pydantic import BaseModel\n"
            "class ClassificationMetadata(BaseModel):\n    tldr: str | None = None\n"
            'SYSTEM_PROMPT = "s"\n'
        )
        self.assertEqual(load_local_prompts(path, log=logs.append), Prompts("s", None))
        self.assertIn("no longer used", logs[0])

    def test_example_template_loads(self):
        prompts = load_local_prompts(LOCAL_CONFIG_PATH.with_name("llm_config.example.py"))
        self.assertIn("mechanism:", prompts.system)
        self.assertTrue(prompts.summary)


class RuntimeTests(unittest.TestCase):
    def test_timeout_names_the_classifier_setting(self):
        import httpx
        from services.llm_runtime import make_chat_fn

        class SlowClient:
            def chat(self, **kwargs):
                raise httpx.ReadTimeout("timed out")

        chat_fn = make_chat_fn("m", "h", 900, 16384, 100, client=SlowClient(), timeout_env="BILL_CLASSIFIER_TIMEOUT_SECONDS")
        with self.assertRaises(TimeoutError) as ctx:
            chat_fn([], {})
        self.assertIn("BILL_CLASSIFIER_TIMEOUT_SECONDS", str(ctx.exception))

    def test_lock_rejects_an_overlapping_run(self):
        from services.llm_runtime import run_lock

        path = os.path.join(tempfile.mkdtemp(), "bills.lock")
        with run_lock(path, "bill classifier"):
            with self.assertRaises(RuntimeError) as ctx:
                with run_lock(path, "bill classifier"):
                    pass
        self.assertIn("another bill classifier run", str(ctx.exception))
        with run_lock(path, "bill classifier"):
            pass


# -- database ----------------------------------------------------------------


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
class RunClassifierDatabaseTests(unittest.TestCase):
    """End-to-end worker runs against a real *_test database."""

    BILL_ID = "zztest-hr-1"
    LONG_ID = "zztest-hr-2"
    EMPTY_ID = "zztest-hr-3"
    IDS = [BILL_ID, LONG_ID, EMPTY_ID]

    @classmethod
    def setUpClass(cls):
        from init_db import ensure_schema

        ensure_schema()

    def setUp(self):
        from database import SessionLocal
        from models import Bill, PolicyTarget

        self.SessionLocal = SessionLocal
        self._cleanup()
        session = SessionLocal()
        self.existing_targets = {t.id for t in session.query(PolicyTarget).all()}
        session.add(Bill(id=self.BILL_ID, title="Clean Water Funding Act", policy_area="Environmental Protection",
                         summary=SHORT_HTML, voted_date=date(2026, 9, 1), level="federal"))
        session.commit()
        session.close()
        self.calls = []
        self.clock = [datetime(2026, 10, 1, 12, 0, 0)]

    def tearDown(self):
        from models import PolicyTarget

        self._cleanup()
        session = self.SessionLocal()
        session.query(PolicyTarget).filter(~PolicyTarget.id.in_(self.existing_targets or {-1})).delete(
            synchronize_session=False
        )
        session.commit()
        session.close()

    def _cleanup(self):
        from models import Bill, BillEffect

        session = self.SessionLocal()
        session.query(BillEffect).filter(BillEffect.bill_id.in_(self.IDS)).delete(synchronize_session=False)
        session.query(Bill).filter(Bill.id.in_(self.IDS)).delete(synchronize_session=False)
        session.commit()
        session.close()

    def _add(self, bill_id, summary, **fields):
        from models import Bill

        session = self.SessionLocal()
        session.add(Bill(id=bill_id, title=fields.pop("title", "Big Omnibus Act"), summary=summary, level="federal", **fields))
        session.commit()
        session.close()

    def _update(self, bill_id, **fields):
        from models import Bill

        session = self.SessionLocal()
        session.query(Bill).filter(Bill.id == bill_id).update(fields, synchronize_session=False)
        session.commit()
        session.close()

    def _chat(self, messages, schema):
        self.calls.append(messages)
        kind = schema_kind(schema)
        if kind == "summaries":
            return json.dumps({"tldr": TLDR, "eli5": ELI5})
        if kind == "chunk":
            return ClassifyLongBillTests.chunk_answer(messages[-1]["content"])
        return full_json(
            intent(),
            intent(citation=REPORT_SENTENCE, target="Environmental Protection Agency", mechanism="oversight", magnitude="low"),
            intent(citation="Invented sentence that is not in the summary.", target="Other"),
            intent(target="Clean Water Funding Act", mechanism="regulation"),
        )

    def _run(self, **kwargs):
        from bill_classifier import run_classifier

        kwargs.setdefault("bill_ids", self.IDS)
        return run_classifier(
            chat_fn=kwargs.pop("chat_fn", self._chat),
            session_factory=self.SessionLocal,
            prompts=kwargs.pop("prompts", Prompts("SYSTEM PROMPT")),
            model=kwargs.pop("model", "test-model"),
            now_fn=lambda: self.clock[0],
            log=lambda _m: None,
            **kwargs,
        )

    def _bill(self, bill_id=None):
        from models import Bill

        session = self.SessionLocal()
        bill = session.get(Bill, bill_id or self.BILL_ID)
        session.expunge_all()
        session.close()
        return bill

    def _effects(self, bill_id=None):
        from models import BillEffect, PolicyTarget

        session = self.SessionLocal()
        rows = (
            session.query(PolicyTarget.name, BillEffect.mechanism, BillEffect.direction, BillEffect.magnitude)
            .join(PolicyTarget, PolicyTarget.id == BillEffect.target_id)
            .filter(BillEffect.bill_id == (bill_id or self.BILL_ID))
            .order_by(PolicyTarget.name)
            .all()
        )
        session.close()
        return [tuple(r) for r in rows]

    def test_first_run_saves_and_second_run_skips_model(self):
        stats = self._run()
        self.assertEqual((stats["selected"], stats["ok"], stats["failed"]), (1, 1, 0))
        self.assertEqual(stats["intents_saved"], 2)
        self.assertEqual((stats["rejected_citation"], stats["rejected_bill_target"]), (1, 1))
        bill = self._bill()
        self.assertEqual(bill.classification_status, "ok")
        self.assertEqual(bill.classification_version, stats["version"])
        self.assertTrue(bill.classification_version.endswith("|test-model"))
        self.assertEqual(bill.classification_input_hash, input_hash(bill.title, bill.policy_area, bill.summary))
        self.assertEqual((bill.classification_attempts, bill.classification_error), (0, None))
        self.assertEqual(bill.classified_at, self.clock[0])
        meta = bill.classification_metadata
        self.assertEqual((meta["tldr"], meta["eli5"]), (TLDR, ELI5))
        self.assertEqual([i["target"] for i in meta["intents"]], ["Clean Water State Revolving Fund", "Environmental Protection Agency"])
        self.assertEqual(meta["model"], "test-model")
        self.assertEqual(self._effects(), [
            ("Clean Water State Revolving Fund", "funding", "increase", "high"),
            ("Environmental Protection Agency", "oversight", "increase", "low"),
        ])
        calls = len(self.calls)

        self.clock[0] += timedelta(hours=1)
        stats = self._run()
        self.assertEqual((stats["selected"], stats["unchanged"]), (0, 1))
        self.assertEqual(len(self.calls), calls)

        # A new prompt or model re-runs; status/latest action changes do not.
        self._update(self.BILL_ID, status="Passed House", latest_action_text="Passed.")
        self.assertEqual(self._run()["selected"], 0)
        self.assertEqual(self._run(model="other-model")["ok"], 1)
        self.assertEqual(self._run(prompts=Prompts("SYSTEM PROMPT", "SUMMARY"), model="other-model")["ok"], 1)

    def test_python_and_sql_input_hashes_agree(self):
        from bill_classifier import load_states

        self._update(self.BILL_ID, summary=SHORT_HTML + "<p>Ünïcode “quotes” — and more.</p>", policy_area=None)
        session = self.SessionLocal()
        state = load_states(session, [self.BILL_ID])[0]
        session.close()
        bill = self._bill()
        self.assertEqual(state.current_hash, input_hash(bill.title, bill.policy_area, bill.summary))

    def test_summary_change_reclassifies(self):
        self._run()
        self._update(self.BILL_ID, summary=SHORT_HTML + "<p>It also renames a post office.</p>")
        stats = self._run()
        self.assertEqual(stats["ok"], 1)
        self.assertEqual(len([c for c in self.calls]), 2)

    def test_failure_keeps_previous_metadata_and_backs_off(self):
        self._run()
        before = self._bill().classification_metadata
        self._update(self.BILL_ID, summary=SHORT_HTML + "<p>Changed.</p>")

        def broken(messages, schema):
            raise TimeoutError("Ollama did not answer within 900s")

        stats = self._run(chat_fn=broken)
        self.assertEqual(stats["failed"], 1)
        bill = self._bill()
        self.assertEqual(bill.classification_metadata, before)
        self.assertEqual((bill.classification_status, bill.classification_attempts), ("failed", 1))
        self.assertIn("Ollama did not answer", bill.classification_error)
        self.assertEqual(len(self._effects()), 2)

        self.clock[0] += timedelta(hours=1)
        self.assertEqual(self._run(chat_fn=broken)["selected"], 0)  # backing off
        self.clock[0] += timedelta(hours=6)
        self._run(chat_fn=broken)
        self.assertEqual(self._bill().classification_attempts, 2)

        self.clock[0] += timedelta(hours=13)
        stats = self._run()
        self.assertEqual(stats["ok"], 1)
        bill = self._bill()
        self.assertEqual((bill.classification_status, bill.classification_attempts, bill.classification_error), ("ok", 0, None))

    def test_incomplete_output_is_never_marked_ok(self):
        def no_summaries(messages, schema):
            self.calls.append(messages)
            if schema_kind(schema) == "summaries":
                return json.dumps({"tldr": "", "eli5": ""})
            return full_json(intent(), tldr="", eli5="")

        stats = self._run(chat_fn=no_summaries)
        self.assertEqual(stats["incomplete"], 1)
        bill = self._bill()
        self.assertEqual(bill.classification_status, "incomplete")
        self.assertIsNone(bill.classification_metadata)
        self.assertEqual(bill.classification_attempts, 1)
        self.assertEqual(self._effects(), [])

    def test_legacy_metadata_missing_eli5_is_redone(self):
        self._update(self.BILL_ID, classification_metadata={"tldr": "Old.", "eli5": None, "intents": []})
        stats = self._run(only_incomplete=True)
        self.assertEqual(stats["ok"], 1)
        self.assertEqual(self._bill().classification_metadata["eli5"], ELI5)

    def test_bills_without_summary_are_recorded_then_classified_later(self):
        self._add(self.EMPTY_ID, "<p> </p>")
        stats = self._run()
        self.assertEqual((stats["no_summary"], stats["selected"]), (1, 1))
        self.assertEqual(self._bill(self.EMPTY_ID).classification_status, "no_summary")
        self.assertEqual(self._run()["no_summary"], 0)

        self._update(self.EMPTY_ID, summary=SHORT_HTML)
        calls = len(self.calls)
        stats = self._run()
        self.assertEqual(stats["ok"], 1)
        self.assertEqual(len(self.calls), calls + 1)
        self.assertEqual(self._bill(self.EMPTY_ID).classification_status, "ok")

    def test_long_bill_is_chunked_and_saved(self):
        self._update(self.BILL_ID, classification_metadata={"tldr": TLDR, "eli5": ELI5, "intents": []},
                     classification_status="ok", classification_version="x", classification_input_hash="x")
        self._add(self.LONG_ID, long_html(sections=6, sentences=8), voted_date=date(2026, 9, 2))
        stats = self._run(chunk_chars=700, limit=1)
        self.assertEqual(stats["selected"], 1)
        bill = self._bill(self.LONG_ID)
        self.assertEqual(bill.classification_status, "ok")
        self.assertGreater(bill.classification_metadata["chunks"], 3)
        self.assertEqual(len(self._effects(self.LONG_ID)), 6)

    def test_dry_run_writes_nothing(self):
        self._add(self.EMPTY_ID, None)
        stats = self._run(dry_run=True)
        self.assertEqual(stats["ok"], 1)
        bill = self._bill()
        self.assertIsNone(bill.classification_metadata)
        self.assertIsNone(bill.classification_status)
        self.assertIsNone(self._bill(self.EMPTY_ID).classification_status)
        self.assertEqual(self._effects(), [])

    def test_bill_id_runs_even_when_not_due(self):
        self._run()
        calls = len(self.calls)
        stats = self._run(bill_id=self.BILL_ID, bill_ids=None)
        self.assertEqual(stats["ok"], 1)
        self.assertEqual(len(self.calls), calls + 1)

    def _held_connections_during_model_calls(self, **kwargs):
        from sqlalchemy import event
        from database import engine

        held = {"now": 0}
        seen = []

        def checkout(*_args):
            held["now"] += 1

        def checkin(*_args):
            held["now"] -= 1

        def chat(messages, schema):
            seen.append(held["now"])
            return self._chat(messages, schema)

        event.listen(engine, "checkout", checkout)
        event.listen(engine, "checkin", checkin)
        try:
            stats = self._run(chat_fn=chat, **kwargs)
        finally:
            event.remove(engine, "checkout", checkout)
            event.remove(engine, "checkin", checkin)
        return stats, seen

    def test_no_db_connection_is_held_while_the_model_runs(self):
        """Regression: the old worker loaded all bills up front; after each
        commit the next bill's attribute access opened a transaction that
        stayed open through the minutes-long model call."""
        self._add(self.LONG_ID, long_html(sections=6, sentences=8))
        stats, seen = self._held_connections_during_model_calls(chunk_chars=700)
        self.assertEqual((stats["ok"], stats["failed"]), (2, 0))
        self.assertGreater(len(seen), 5)
        self.assertEqual(set(seen), {0})

        stats, seen = self._held_connections_during_model_calls(dry_run=True, force=True, chunk_chars=700)
        self.assertEqual(set(seen), {0})

    def test_saves_after_the_server_drops_connections_mid_run(self):
        """The server closing every pooled connection while the model runs
        (what Fly does to idle connections) must not lose the save."""
        from sqlalchemy import create_engine, text
        from sqlalchemy.pool import NullPool
        from database import DATABASE_URL

        self._add(self.LONG_ID, SHORT_HTML, title="Second Bill")
        killer = create_engine(DATABASE_URL, poolclass=NullPool)

        def chat(messages, schema):
            with killer.connect() as conn:
                conn.execute(text(
                    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
                    "WHERE datname = current_database() AND pid <> pg_backend_pid()"
                ))
            return self._chat(messages, schema)

        try:
            stats = self._run(chat_fn=chat)
        finally:
            killer.dispose()
        self.assertEqual((stats["ok"], stats["failed"]), (2, 0))
        self.assertEqual(self._bill().classification_status, "ok")
        self.assertEqual(self._bill(self.LONG_ID).classification_status, "ok")

    def test_report_counts_statuses(self):
        from bill_classifier import report

        self._add(self.EMPTY_ID, None)
        self._add(self.LONG_ID, SHORT_HTML, classification_metadata={"tldr": "x", "eli5": "", "intents": []})
        self._run(limit=1)
        lines = []
        result = report(self.SessionLocal, prompts=Prompts("SYSTEM PROMPT"), model="test-model",
                        now_fn=lambda: self.clock[0], log=lines.append)
        self.assertGreaterEqual(result["counts"].get("ok", 0), 1)
        self.assertGreaterEqual(result["counts"].get("no_summary", 0), 1)
        self.assertGreaterEqual(result["counts"].get("metadata missing TLDR/ELI5/intents", 0), 1)
        self.assertIsNotNone(result["due"])
        self.assertTrue(any("By status" in line for line in lines))


if __name__ == "__main__":
    unittest.main()
