import os
import json
import re
from ollama import Client
from sqlalchemy.orm import Session
import sys

def clean_html(text: str | None) -> str:
    """Strip HTML tags and normalize whitespace from CRS summaries."""
    if not text:
        return ""
    text = (
        text.replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", '"')
    )
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return re.sub(r"\s+([.,;:!?])", r"\1", text)

# Ensure backend and scripts directories are in path
BACKEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
SCRIPTS_DIR = os.path.abspath(os.path.dirname(__file__))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)
if SCRIPTS_DIR not in sys.path:
    sys.path.insert(0, SCRIPTS_DIR)

from models import Bill, OfficialStance, PolicyTarget, Official
from database import SessionLocal
from llm_config import SYSTEM_PROMPT, ClassificationMetadata

def evaluate_intents(intents, stances):
    """Evaluate intents against official stances to generate scores and receipts."""
    total_score = 0
    receipts = []

    stance_map = {s['target']: s for s in stances}

    for intent in intents:
        if intent.target in stance_map:
            stance = stance_map[intent.target]
            if stance['mechanism'] != intent.mechanism:
                continue
                
            stance_dir = stance['direction']
            effect_dir = intent.direction

            # Simulate evaluation if they voted 'Yea'
            # Yea means they support the bill's intent
            if stance_dir == effect_dir:
                score = 1
            elif stance_dir in ['increase', 'decrease'] and effect_dir in ['increase', 'decrease']:
                score = -1
            else:
                score = 0

            if score != 0:
                total_score += score
                receipt = {
                    "target": intent.target,
                    "mechanism": intent.mechanism,
                    "stance_direction": stance_dir,
                    "effect_direction": effect_dir,
                    "simulated_vote": "Yea",
                    "score_delta": score,
                    "rationale": intent.rationale,
                }
                if getattr(intent, "citation", None):
                    receipt["citation"] = intent.citation
                receipts.append(receipt)

    return total_score, receipts

def main():
    ollama_host = os.environ.get("OLLAMA_HOST", "http://localhost:11434")
    client = Client(host=ollama_host)
    
    db = SessionLocal()
    try:
        # Allow passing a specific bill ID via command line argument: python test_classify.py [bill_id]
        target_bill_id = sys.argv[1] if len(sys.argv) > 1 else None

        if target_bill_id:
            bill = db.query(Bill).filter(Bill.id == target_bill_id).first()
            if not bill:
                print(f"Error: Bill with ID '{target_bill_id}' not found.")
                return
        else:
            # Find one bill where classification_metadata is null and has a non-empty summary
            bill = (
                db.query(Bill)
                .filter(
                    Bill.classification_metadata == None,
                    Bill.summary.isnot(None),
                    Bill.summary != "",
                )
                .first()
            )
            if not bill:
                print("No unclassified bills found with available summaries.")
                print("Tip: You can pass a specific bill ID: python backend/scripts/test_classify.py <bill_id>")
                return

        print(f"Found bill: {bill.id} - {bill.title}")
        if bill.summary:
            preview = bill.summary[:200] + ("..." if len(bill.summary) > 200 else "")
            print(f"Summary ({len(bill.summary)} chars): {preview}\n")
        else:
            print("Warning: Bill has no summary, relying on title.\n")

        # Provide all available bill context for comprehensive LLM extraction
        parts = [f"Bill ID: {bill.id}"]
        if bill.title:
            parts.append(f"Title: {bill.title}")
        if bill.policy_area:
            parts.append(f"Policy Area: {bill.policy_area}")
        if bill.sponsor_name:
            sponsor_info = bill.sponsor_name
            if bill.sponsor_party:
                sponsor_info += f" ({bill.sponsor_party})"
            parts.append(f"Sponsor: {sponsor_info}")
        if bill.bipartisan_type:
            parts.append(f"Bipartisan Status: {bill.bipartisan_type}")
        if bill.status:
            parts.append(f"Legislative Status: {bill.status}")
        if bill.latest_action_text:
            parts.append(f"Latest Action: {bill.latest_action_text}")
        if bill.summary:
            cleaned_summary = clean_html(bill.summary)
            parts.append(f"Congressional Research Service (CRS) Summary:\n{cleaned_summary}")
        text_to_analyze = "\n\n".join(parts)

        print("Running inference through nemotron-3.5-lightning:30b...")
        response = client.chat(
            model='nemotron-3.5-lightning:30b',
            messages=[
                {'role': 'system', 'content': SYSTEM_PROMPT},
                {'role': 'user', 'content': f"Analyze this bill:\n{text_to_analyze}"}
            ],
            format=ClassificationMetadata.model_json_schema()
        )

        parsed_json_str = response['message']['content']
        print("\nParsed JSON:")
        print(parsed_json_str)

        # Parse into Pydantic model
        parsed_data = ClassificationMetadata.model_validate_json(parsed_json_str)

        # Store the results back in the metadata
        bill.classification_metadata = json.loads(parsed_json_str)
        db.commit()
        print("\nSuccessfully saved classification_metadata to the database.")

        # Sample official stances for evaluation
        sample_stances = [
            {"target": "Immigration Enforcement", "mechanism": "funding", "direction": "increase"},
            {"target": "Taxation", "mechanism": "taxation", "direction": "decrease"},
            {"target": "Climate Change", "mechanism": "regulation", "direction": "increase"},
            {"target": "Healthcare", "mechanism": "funding", "direction": "increase"}
        ]

        print("\nEvaluating alignment matrix against sample official stances (Assuming 'Yea' vote)...")
        print("Sample Stances:", json.dumps(sample_stances, indent=2))
        
        total_score, receipts = evaluate_intents(parsed_data.intents, sample_stances)
        
        print(f"\nFinal Score (Simulated Yea): {total_score}")
        print("Receipts:")
        print(json.dumps(receipts, indent=2))
        
    finally:
        db.close()

if __name__ == "__main__":
    main()
