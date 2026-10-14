"""Template for the gitignored backend/scripts/llm_config.py.

Copy this file to llm_config.py (same folder) and write the prompts there.
The bill classifier (bill_classifier.py, run via scripts/classify_bills.py)
loads it by path. Changing either prompt changes the classifier version, so
every bill is re-classified on its next run.

The output schema is no longer defined here: it is
services.bill_classification (BillClassification for short summaries,
BillIntentsOnly per chunk of a long summary, BillSummaries for the TLDR/ELI5
call), and the model's output is schema-constrained to it. A
ClassificationMetadata class left in this file is ignored.
"""

from services.bill_effects import EFFECT_LABEL_DEFINITIONS  # shared mechanism/direction definitions

# System prompt for classifying a bill from its CRS summary (the whole
# summary, or one part of a long one, inside <summary> tags).
SYSTEM_PROMPT = """\
TODO: describe how to write the TLDR and ELI5 and how to extract policy intents.
""" + EFFECT_LABEL_DEFINITIONS

# Optional: system prompt for the TLDR/ELI5-only call (long bills, and the
# retry when a full answer had no TLDR/ELI5). Defaults to SYSTEM_PROMPT.
SUMMARY_PROMPT = """\
TODO: describe how to write the TLDR and ELI5 from the opening of the summary
and the list of intents found across the whole bill.
"""
