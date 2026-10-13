"""Template for the gitignored backend/positions_llm_config.py.

Copy this file to positions_llm_config.py and write the prompts there. The
official_positions.py worker imports both names; changing either one changes
the extractor version, so every official is re-extracted on their next run.

The model's output must match services.official_positions.StatedPositionsOutput
(positions are schema-constrained) and LinkSelectionOutput for link picking.
"""

from services.bill_effects import EFFECT_LABEL_DEFINITIONS  # shared mechanism/direction definitions

# System prompt for extracting an official's stated positions from one chunk
# of their website (sent inside <page> tags).
POSITIONS_SYSTEM_PROMPT = """\
TODO: describe how to extract stated policy positions.
""" + EFFECT_LABEL_DEFINITIONS

# System prompt for picking issue-page links from a numbered homepage link list
# when no nav link looks like an issues section.
LINK_SELECTION_PROMPT = """\
TODO: describe how to pick the links that lead to the official's issue pages.
"""
