import json
import os
import unittest
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

os.environ.setdefault(
    "DATABASE_URL",
    "postgresql://postgres:postgres@localhost:5432/politmus_test",
)

from pydantic import ValidationError

from models import Bill, BillEffect, ExtractionGuideline, PolicyTarget
from services.bill_effects import (
    DIRECTIONS,
    MAGNITUDES,
    MECHANISMS,
    BillEffectsOutput,
    ExtractedEffect,
    build_messages,
    clean_target_name,
    dedupe_effects,
    extract_one_bill,
    parse_effects,
    persist_bill_effects,
    plain_summary,
    resolve_or_create_target,
    slugify_target,
)

SAVE_ACT_JSON = json.dumps({
    "effects": [
        {
            "target_name": "ICE",
            "mechanism": "funding",
            "direction": "increase",
            "magnitude": "high",
            "rationale": "The bill appropriates additional funds for DHS and ICE.",
        },
        {
            "target_name": "Voting Eligibility",
            "mechanism": "regulation",
            "direction": "increase",
            "magnitude": "high",
            "rationale": "Requires documentary proof of citizenship to register to vote.",
        },
    ]
})


class PlainSummaryTests(unittest.TestCase):
    def test_strips_crs_html_and_entities(self):
        html = "<p>Appropriates&nbsp;$5 billion for <b>highways</b>.</p>"
        self.assertEqual(
            plain_summary(html),
            "Appropriates $5 billion for highways.",
        )

    def test_blank_and_none_are_empty(self):
        self.assertEqual(plain_summary(None), "")
        self.assertEqual(plain_summary("   "), "")
        self.assertEqual(plain_summary("<p>  </p>"), "")


class TargetNameTests(unittest.TestCase):
    def test_slugify_lowercases_and_hyphenates(self):
        self.assertEqual(slugify_target("ICE"), "ice")
        self.assertEqual(
            slugify_target("Voting Eligibility"),
            "voting-eligibility",
        )
        self.assertEqual(
            slugify_target("Immigration and Customs Enforcement"),
            "immigration-and-customs-enforcement",
        )

    def test_slugify_strips_punctuation(self):
        self.assertEqual(slugify_target("D.H.S."), "d-h-s")
        self.assertEqual(slugify_target("  Taxes & Tariffs  "), "taxes-and-tariffs")

    def test_clean_collapses_whitespace(self):
        self.assertEqual(clean_target_name("  Voting   Eligibility "), "Voting Eligibility")


class SchemaTests(unittest.TestCase):
    def test_json_schema_lists_effect_enums(self):
        schema = ExtractedEffect.model_json_schema()
        self.assertEqual(
            set(schema["properties"]),
            {"target_name", "mechanism", "direction", "magnitude", "rationale"},
        )
        self.assertEqual(schema["properties"]["mechanism"]["enum"], list(MECHANISMS))
        self.assertEqual(schema["properties"]["direction"]["enum"], list(DIRECTIONS))
        self.assertEqual(schema["properties"]["magnitude"]["enum"], list(MAGNITUDES))

    def test_output_schema_wraps_effects_list(self):
        schema = BillEffectsOutput.model_json_schema()
        self.assertIn("effects", schema["properties"])

    def test_parse_accepts_save_act_style_list(self):
        result = parse_effects(SAVE_ACT_JSON)
        self.assertEqual(len(result.effects), 2)
        self.assertEqual(result.effects[0].target_name, "ICE")
        self.assertEqual(result.effects[0].mechanism, "funding")
        self.assertEqual(result.effects[0].direction, "increase")
        self.assertEqual(result.effects[1].target_name, "Voting Eligibility")
        self.assertEqual(result.effects[1].mechanism, "regulation")

    def test_parse_strips_markdown_fences(self):
        result = parse_effects("```json\n" + SAVE_ACT_JSON + "\n```")
        self.assertEqual(len(result.effects), 2)

    def test_parse_rejects_invalid_mechanism(self):
        with self.assertRaises(ValidationError):
            parse_effects(
                '{"effects":[{"target_name":"ICE","mechanism":"vibes",'
                '"direction":"increase","magnitude":"high","rationale":"x"}]}'
            )

    def test_parse_rejects_empty_payload(self):
        with self.assertRaises(ValueError):
            parse_effects("  ")


class PromptTests(unittest.TestCase):
    def test_messages_include_guidelines_and_summary(self):
        bill = Bill(
            id="119-hr-22",
            title="SAVE Act",
            policy_area="Government Operations and Politics",
            summary="<p>Requires proof of citizenship to vote and funds ICE.</p>",
        )
        messages = build_messages("Extract every distinct policy effect.", bill)
        self.assertEqual(messages[0]["role"], "system")
        self.assertIn("Extract every distinct", messages[0]["content"])
        user = messages[1]["content"]
        self.assertIn("119-hr-22", user)
        self.assertIn("SAVE Act", user)
        self.assertIn("Requires proof of citizenship to vote and funds ICE.", user)
        self.assertNotIn("<p>", user)


class DedupeTests(unittest.TestCase):
    def test_keeps_last_effect_per_target_and_mechanism(self):
        effects = dedupe_effects([
            ExtractedEffect(
                target_name="ICE",
                mechanism="funding",
                direction="increase",
                magnitude="low",
                rationale="first",
            ),
            ExtractedEffect(
                target_name="ice",
                mechanism="funding",
                direction="increase",
                magnitude="high",
                rationale="second",
            ),
            ExtractedEffect(
                target_name="ICE",
                mechanism="regulation",
                direction="increase",
                magnitude="medium",
                rationale="rules",
            ),
        ])
        by_key = {(slugify_target(e.target_name), e.mechanism): e for e in effects}
        self.assertEqual(len(effects), 2)
        self.assertEqual(by_key[("ice", "funding")].magnitude, "high")
        self.assertEqual(by_key[("ice", "regulation")].rationale, "rules")


class ResolveTargetTests(unittest.TestCase):
    def _session(self, found):
        session = MagicMock()
        query = MagicMock()
        query.filter.return_value = query
        if isinstance(found, list):
            query.one_or_none.side_effect = found
        else:
            query.one_or_none.return_value = found
        session.query.return_value = query
        return session

    def test_returns_existing_slug_without_insert(self):
        existing = PolicyTarget(id=3, name="ICE", slug="ice")
        session = self._session(existing)
        target = resolve_or_create_target(session, "ICE")
        self.assertIs(target, existing)
        session.add.assert_not_called()

    def test_creates_target_when_missing(self):
        session = self._session([None, None])
        added = []
        session.add.side_effect = added.append
        target = resolve_or_create_target(session, "Voting Eligibility")
        self.assertEqual(len(added), 1)
        self.assertEqual(added[0].name, "Voting Eligibility")
        self.assertEqual(added[0].slug, "voting-eligibility")
        self.assertIs(target, added[0])
        session.flush.assert_called()

    def test_rejects_empty_target_name(self):
        session = MagicMock()
        with self.assertRaisesRegex(ValueError, "invalid target name"):
            resolve_or_create_target(session, "???")


class PersistEffectsTests(unittest.TestCase):
    def test_inserts_effect_for_resolved_target(self):
        target = PolicyTarget(id=4, name="ICE", slug="ice")
        session = MagicMock()
        query = MagicMock()
        query.filter.return_value = query
        query.filter_by.return_value = query
        query.one_or_none.return_value = None
        session.query.return_value = query
        added = []
        session.add.side_effect = added.append
        bill = Bill(id="119-hr-22", summary="Funds ICE.")
        output = parse_effects(json.dumps({
            "effects": [{
                "target_name": "ICE",
                "mechanism": "funding",
                "direction": "increase",
                "magnitude": "high",
                "rationale": "Appropriates funds for ICE.",
            }]
        }))
        with patch(
            "services.bill_effects.resolve_or_create_target",
            return_value=target,
        ):
            rows = persist_bill_effects(session, bill, output)
        self.assertEqual(len(rows), 1)
        self.assertEqual(added[0].bill_id, "119-hr-22")
        self.assertEqual(added[0].target_id, 4)
        self.assertEqual(added[0].mechanism, "funding")
        self.assertEqual(added[0].direction, "increase")
        self.assertEqual(added[0].magnitude, "high")

    def test_updates_existing_effect_instead_of_duplicating(self):
        target = PolicyTarget(id=4, name="ICE", slug="ice")
        existing = BillEffect(
            id=9,
            bill_id="119-hr-22",
            target_id=4,
            mechanism="funding",
            direction="decrease",
            magnitude="low",
            rationale="old",
        )
        session = MagicMock()
        query = MagicMock()
        query.filter.return_value = query
        query.filter_by.return_value = query
        query.one_or_none.return_value = existing
        session.query.return_value = query
        output = parse_effects(json.dumps({
            "effects": [{
                "target_name": "ICE",
                "mechanism": "funding",
                "direction": "increase",
                "magnitude": "high",
                "rationale": "new",
            }]
        }))
        with patch(
            "services.bill_effects.resolve_or_create_target",
            return_value=target,
        ):
            rows = persist_bill_effects(
                session, Bill(id="119-hr-22"), output
            )
        self.assertEqual(rows, [existing])
        self.assertEqual(existing.direction, "increase")
        self.assertEqual(existing.magnitude, "high")
        self.assertEqual(existing.rationale, "new")
        session.add.assert_not_called()

    def test_force_deletes_existing_effects(self):
        session = MagicMock()
        query = MagicMock()
        query.filter.return_value = query
        query.filter_by.return_value = query
        query.one_or_none.return_value = None
        session.query.return_value = query
        persist_bill_effects(
            session,
            Bill(id="119-hr-22"),
            BillEffectsOutput(effects=[]),
            replace_existing=True,
        )
        query.delete.assert_called()


class ExtractOneBillTests(unittest.TestCase):
    def test_calls_chat_with_schema_and_returns_effects(self):
        bill = Bill(
            id="119-hr-22",
            title="SAVE Act",
            summary="Requires proof of citizenship and funds ICE.",
        )
        seen = {}

        def chat_fn(messages, schema):
            seen["messages"] = messages
            seen["schema"] = schema
            return SAVE_ACT_JSON

        output = extract_one_bill(bill, "Extract effects.", chat_fn)
        self.assertEqual(len(output.effects), 2)
        self.assertEqual(seen["messages"][0]["content"], "Extract effects.")
        self.assertIn("properties", seen["schema"])

    def test_skips_bills_without_summary_text(self):
        bill = Bill(id="119-hr-2", title="Empty", summary="<p></p>")
        with self.assertRaisesRegex(ValueError, "usable summary"):
            extract_one_bill(bill, "prompt", lambda *_: "{}")


class RunExtractionTests(unittest.TestCase):
    def _bill(self, bill_id="119-hr-22"):
        return SimpleNamespace(
            id=bill_id,
            title="SAVE Act",
            policy_area="Elections",
            summary="Requires proof of citizenship to vote and funds ICE.",
        )

    def _guideline(self):
        return ExtractionGuideline(
            id=3,
            name="default",
            is_active=True,
            prompt="Extract effects.",
            updated_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
        )

    def _session(self, bills, guideline):
        session = MagicMock()
        query = MagicMock()
        query.filter.return_value = query
        query.order_by.return_value = query
        query.limit.return_value = query
        query.all.return_value = bills
        query.one_or_none.return_value = guideline
        query.first.return_value = guideline
        session.query.return_value = query
        return session

    @patch("llm_extractor.ensure_schema")
    def test_persists_effects_and_continues_after_failure(self, _schema):
        from llm_extractor import run_extraction

        good = self._bill("119-hr-22")
        bad = self._bill("119-hr-99")
        session = self._session([good, bad], self._guideline())
        persisted = []

        def chat_fn(messages, schema):
            if "119-hr-99" in messages[1]["content"]:
                raise TimeoutError("Ollama timed out")
            return SAVE_ACT_JSON

        def persist_fn(db, bill, output, replace_existing=False):
            persisted.append((bill.id, len(output.effects), replace_existing))
            return [object()] * len(output.effects)

        stats = run_extraction(
            limit=10,
            chat_fn=chat_fn,
            persist_fn=persist_fn,
            session_factory=lambda: session,
        )
        self.assertEqual(stats["bills_pending"], 2)
        self.assertEqual(stats["extracted"], 1)
        self.assertEqual(stats["failed"], 1)
        self.assertEqual(stats["effects_saved"], 2)
        self.assertEqual(persisted, [("119-hr-22", 2, False)])
        session.rollback.assert_called()

    @patch("llm_extractor.ensure_schema")
    def test_dry_run_does_not_call_model(self, _schema):
        from llm_extractor import run_extraction

        session = self._session([self._bill()], self._guideline())
        called = []
        stats = run_extraction(
            dry_run=True,
            chat_fn=lambda *args: called.append(args) or "{}",
            persist_fn=lambda *args, **kwargs: called.append("persist"),
            session_factory=lambda: session,
        )
        self.assertEqual(called, [])
        self.assertEqual(stats["skipped"], 1)
        self.assertEqual(stats["extracted"], 0)


if __name__ == "__main__":
    unittest.main()
