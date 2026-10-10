import os
import json
from ollama import Client
from sqlalchemy.orm import Session
import sys

# Ensure backend directory is in path so we can import modules
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

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
                receipts.append({
                    "target": intent.target,
                    "mechanism": intent.mechanism,
                    "stance_direction": stance_dir,
                    "effect_direction": effect_dir,
                    "simulated_vote": "Yea",
                    "score_delta": score,
                    "rationale": intent.rationale
                })

    return total_score, receipts

def main():
    ollama_host = os.environ.get("OLLAMA_HOST", "http://localhost:11434")
    client = Client(host=ollama_host)
    
    db = SessionLocal()
    try:
        # Find one bill where classification_metadata is null
        bill = db.query(Bill).filter(Bill.classification_metadata == None).first()
        if not bill:
            print("No bills found with null classification_metadata.")
            return

        print(f"Found bill: {bill.id} - {bill.title}")

        text_to_analyze = bill.summary or bill.title or "No text available."

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
