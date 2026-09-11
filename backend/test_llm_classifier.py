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

from models import Bill, ClassificationGuideline
from services.bill_classification import (
    IMPACT_LEVELS,
    BillImpactClassification,
    build_messages,
    classification_record,
    classify_one_bill,
    parse_classification,
    plain_summary,
)


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


class SchemaTests(unittest.TestCase):
    def test_json_schema_lists_impact_enums(self):
        schema = BillImpactClassification.model_json_schema()
        self.assertEqual(set(schema["properties"]), {
            "funding_impact",
            "regulatory_impact",
            "reasoning",
        })
        self.assertEqual(
            schema["properties"]["funding_impact"]["enum"],
            list(IMPACT_LEVELS),
        )
        self.assertEqual(
            schema["properties"]["regulatory_impact"]["enum"],
            list(IMPACT_LEVELS),
        )

    def test_parse_accepts_strict_json(self):
        result = parse_classification(
            '{"funding_impact":"high","regulatory_impact":"low",'
            '"reasoning":"The bill appropriates funds."}'
        )
        self.assertEqual(result.funding_impact, "high")
        self.assertEqual(result.regulatory_impact, "low")

    def test_parse_strips_markdown_fences(self):
        result = parse_classification(
            "```json\n"
            '{"funding_impact":"none","regulatory_impact":"none",'
            '"reasoning":"Ceremonial naming bill."}\n'
            "```"
        )
        self.assertEqual(result.funding_impact, "none")

    def test_parse_rejects_invalid_levels(self):
        with self.assertRaises(ValidationError):
            parse_classification(
                '{"funding_impact":"extreme","regulatory_impact":"none",'
                '"reasoning":"nope"}'
            )

    def test_parse_rejects_empty_payload(self):
        with self.assertRaises(ValueError):
            parse_classification("  ")


class PromptTests(unittest.TestCase):
    def test_messages_include_guidelines_and_summary(self):
        bill = Bill(
            id="119-hr-1",
            title="Highway Funding Act",
            policy_area="Transportation and Public Works",
            summary="<p>Appropriates $5 billion for highways.</p>",
        )
        messages = build_messages("Score funding and regulation.", bill)
        self.assertEqual(messages[0]["role"], "system")
        self.assertIn("Score funding", messages[0]["content"])
        user = messages[1]["content"]
        self.assertIn("119-hr-1", user)
        self.assertIn("Highway Funding Act", user)
        self.assertIn("Transportation and Public Works", user)
        self.assertIn("Appropriates $5 billion for highways.", user)
        self.assertNotIn("<p>", user)


class RecordTests(unittest.TestCase):
    def test_stores_scores_and_guideline_metadata(self):
        result = BillImpactClassification(
            funding_impact="medium",
            regulatory_impact="low",
            reasoning="Creates a grant program.",
        )
        guideline = ClassificationGuideline(
            id=7,
            name="default",
            is_active=True,
            prompt="rules",
            updated_at=datetime(2026, 1, 2, tzinfo=timezone.utc),
        )
        payload = classification_record(
            result,
            model="qwen2.5-coder:32b",
            guideline=guideline,
            classified_at=datetime(2026, 9, 11, tzinfo=timezone.utc),
        )
        self.assertEqual(payload["funding_impact"], "medium")
        self.assertEqual(payload["regulatory_impact"], "low")
        self.assertEqual(payload["model"], "qwen2.5-coder:32b")
        self.assertEqual(payload["guidelines_id"], 7)
        self.assertTrue(payload["classified_at"].startswith("2026-09-11"))
        self.assertTrue(payload["guidelines_updated_at"].startswith("2026-01-02"))


class ClassifyOneBillTests(unittest.TestCase):
    def test_calls_chat_with_schema_and_returns_record(self):
        bill = Bill(
            id="119-hr-1",
            title="Test",
            summary="Authorizes a new reporting requirement for banks.",
        )
        guideline = ClassificationGuideline(
            id=1,
            name="default",
            is_active=True,
            prompt="Classify bills.",
            updated_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
        )
        seen = {}

        def chat_fn(messages, schema):
            seen["messages"] = messages
            seen["schema"] = schema
            return (
                '{"funding_impact":"none","regulatory_impact":"medium",'
                '"reasoning":"Imposes bank reporting rules."}'
            )

        payload = classify_one_bill(bill, guideline, "test-model", chat_fn)
        self.assertEqual(payload["funding_impact"], "none")
        self.assertEqual(payload["regulatory_impact"], "medium")
        self.assertEqual(payload["model"], "test-model")
        self.assertEqual(seen["messages"][0]["content"], "Classify bills.")
        self.assertIn("properties", seen["schema"])

    def test_skips_bills_without_summary_text(self):
        bill = Bill(id="119-hr-2", title="Empty", summary="<p></p>")
        guideline = ClassificationGuideline(
            id=1, name="default", is_active=True, prompt="x",
            updated_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
        )
        with self.assertRaisesRegex(ValueError, "usable summary"):
            classify_one_bill(bill, guideline, "test-model", lambda *_: "{}")


class RunClassificationTests(unittest.TestCase):
    def _bill(self, bill_id="119-hr-1", classification=None):
        return SimpleNamespace(
            id=bill_id,
            title="Test Act",
            policy_area="Finance",
            summary="Appropriates $2 billion for a new agency program.",
            classification=classification,
        )

    def _guideline(self):
        return ClassificationGuideline(
            id=3,
            name="default",
            is_active=True,
            prompt="Classify bills.",
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

    @patch("llm_classifier.ensure_schema")
    def test_saves_classification_and_continues_after_failure(self, _schema):
        from llm_classifier import run_classification

        good = self._bill("119-hr-1")
        bad = self._bill("119-hr-2")
        guideline = self._guideline()
        session = self._session([good, bad], guideline)

        def chat_fn(messages, schema):
            if "119-hr-2" in messages[1]["content"]:
                raise TimeoutError("Ollama timed out")
            return (
                '{"funding_impact":"high","regulatory_impact":"low",'
                '"reasoning":"Large appropriation."}'
            )

        stats = run_classification(
            limit=10,
            chat_fn=chat_fn,
            session_factory=lambda: session,
        )
        self.assertEqual(stats["bills_pending"], 2)
        self.assertEqual(stats["classified"], 1)
        self.assertEqual(stats["failed"], 1)
        self.assertEqual(good.classification["funding_impact"], "high")
        self.assertIsNone(bad.classification)
        self.assertEqual(session.commit.call_count, 1)
        session.rollback.assert_called()

    @patch("llm_classifier.ensure_schema")
    def test_dry_run_does_not_call_model(self, _schema):
        from llm_classifier import run_classification

        bill = self._bill()
        session = self._session([bill], self._guideline())
        called = []
        stats = run_classification(
            dry_run=True,
            chat_fn=lambda *args: called.append(args) or "{}",
            session_factory=lambda: session,
        )
        self.assertEqual(called, [])
        self.assertEqual(stats["skipped"], 1)
        self.assertEqual(stats["classified"], 0)
        self.assertIsNone(bill.classification)


if __name__ == "__main__":
    unittest.main()
