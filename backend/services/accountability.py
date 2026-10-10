from sqlalchemy.orm import Session
from models import OfficialStance, Vote, RollCall, Bill, PolicyTarget

def calculate_alignment_score(stance_direction: str, effect_direction: str, vote_position: str) -> int:
    """
    Calculate alignment score using +1/-1/0 matrix rules.
    If stance direction matches effect direction:
        Yea -> +1, Nay -> -1
    If stance direction opposes effect direction:
        Yea -> -1, Nay -> +1
    If vote is absent or abstain -> 0
    """
    if vote_position not in ['Yea', 'Nay']:
        return 0

    if stance_direction == effect_direction:
        return 1 if vote_position == 'Yea' else -1
    elif stance_direction in ['increase', 'decrease'] and effect_direction in ['increase', 'decrease']:
        # They are opposites
        return -1 if vote_position == 'Yea' else 1
    
    # For mixed/maintain or other edge cases not strictly aligned
    return 0

def calculate_official_accountability(official_id: str, db_session: Session):
    """
    Calculates the accountability score for an official based on their stances and votes.
    Returns the total score and receipts of each evaluated alignment.
    """
    # 1. Get official's stances
    stances = db_session.query(OfficialStance).filter(OfficialStance.official_id == official_id).all()
    if not stances:
        return {"total_score": 0, "receipts": []}

    # Map stance by (target_id, mechanism) for quick lookup
    stance_map = {(s.target_id, s.mechanism): s for s in stances}

    # 2. Get official's votes
    votes = db_session.query(Vote).filter(Vote.official_id == official_id).all()

    total_score = 0
    receipts = []

    for vote in votes:
        roll_call = db_session.query(RollCall).filter(RollCall.id == vote.roll_call_id).first()
        if not roll_call:
            continue

        bill = db_session.query(Bill).filter(Bill.id == roll_call.bill_id).first()
        if not bill:
            continue

        # Look at the bill's effects (which match PolicyTargets)
        for effect in bill.effects:
            key = (effect.target_id, effect.mechanism)
            if key in stance_map:
                stance = stance_map[key]
                score = calculate_alignment_score(stance.direction, effect.direction, vote.position)
                
                if score != 0:
                    total_score += score
                    receipts.append({
                        "bill_id": bill.id,
                        "roll_call_id": roll_call.id,
                        "target_id": effect.target_id,
                        "mechanism": effect.mechanism,
                        "stance_direction": stance.direction,
                        "effect_direction": effect.direction,
                        "vote": vote.position,
                        "score_delta": score
                    })

    return {
        "total_score": total_score,
        "receipts": receipts
    }
