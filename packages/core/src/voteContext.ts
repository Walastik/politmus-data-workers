import type {
  Bill,
  BillRollCall,
  ChamberVoteSummary,
  VoteChamber,
} from './types'

const CHAMBER_LABELS: Record<VoteChamber, string> = { house: 'House', senate: 'Senate' }

// A chamber's yes (or no) share at or above this is "nearly unanimous".
const NEAR_UNANIMOUS = 0.9
// Each major party's majority must be at least this share of its members'
// yes/no votes, on opposite sides, for a "party line" split.
const PARTY_LINE = 0.75

/** The roll call a chamber's tally counts (the API's tally_roll_call_ids). */
export function tallyRollCall(bill: Bill, chamber: VoteChamber): BillRollCall | null {
  const id = bill.tally_roll_call_ids?.[chamber]
  if (id == null) return null
  return bill.roll_calls?.find((rollCall) => rollCall.id === id) ?? null
}

/**
 * One plain sentence on what a non-passage vote decides, or null for a vote
 * on passage. Procedural votes are often read as votes on the bill itself.
 */
export function voteKindNote(rollCall: BillRollCall | null | undefined): string | null {
  if (!rollCall || rollCall.vote_kind === 'passage' || !rollCall.vote_kind) return null
  const q = (rollCall.question ?? '').toLowerCase()
  if (rollCall.vote_kind === 'amendment') {
    return 'A vote on an amendment, which would change the bill’s text. It is not a vote on passing the bill.'
  }
  if (rollCall.vote_kind !== 'procedural') {
    return 'This vote is not on passing the bill.'
  }
  if (q.includes('cloture') && q.includes('proceed')) {
    return 'Cloture on the motion to proceed: a vote to end debate on whether to start considering the bill. It usually needs 60 votes in the Senate and is not a vote on passing the bill.'
  }
  if (q.includes('cloture')) {
    return 'Cloture: a vote to end debate so the Senate can move to a final vote. It usually needs 60 votes and is not a vote on passing the bill.'
  }
  if (q.includes('proceed')) {
    return 'Motion to proceed: a vote on whether to start considering the bill, not on passing it.'
  }
  if (q.includes('commit')) {
    return 'Motion to recommit: a vote on sending the bill back to committee, not on passing it.'
  }
  if (q.includes('table')) {
    return 'Motion to table: a vote to set a motion or amendment aside without voting on it directly.'
  }
  if (q.includes('previous question')) {
    return 'Ordering the previous question: a vote to end debate on a rule and vote on it. It is not a vote on passing the bill.'
  }
  if (q.includes('waive')) {
    return 'Motion to waive: a vote to set aside a budget or procedural rule. It is not a vote on passing the bill.'
  }
  return 'A procedural vote, not a vote on passing the bill.'
}

export type ChamberPattern = 'near_unanimous' | 'party_line' | 'mixed' | 'none'

function share(summary: ChamberVoteSummary | undefined) {
  const yes = summary?.Yes ?? 0
  const no = summary?.No ?? 0
  return { yes, no, recorded: yes + no }
}

/** How a chamber's tally divided. */
export function chamberPattern(bill: Bill, chamber: VoteChamber): ChamberPattern {
  const total = share(bill.votes_summary?.[chamber])
  if (total.recorded === 0) return 'none'
  const yesShare = total.yes / total.recorded
  if (yesShare >= NEAR_UNANIMOUS || yesShare <= 1 - NEAR_UNANIMOUS) return 'near_unanimous'
  const dem = share(bill.votes_by_party?.[chamber]?.Democratic)
  const rep = share(bill.votes_by_party?.[chamber]?.Republican)
  if (dem.recorded === 0 || rep.recorded === 0) return 'mixed'
  const demYes = dem.yes / dem.recorded
  const repYes = rep.yes / rep.recorded
  const opposite =
    (demYes >= PARTY_LINE && repYes <= 1 - PARTY_LINE) ||
    (repYes >= PARTY_LINE && demYes <= 1 - PARTY_LINE)
  return opposite ? 'party_line' : 'mixed'
}

function tallyText(summary: ChamberVoteSummary | undefined) {
  const { yes, no } = share(summary)
  return `${yes}–${no}`
}

/**
 * A neutral note when one chamber was nearly unanimous and the other split
 * along party lines, with what kind of vote each was. States only what the
 * votes show; it does not say why members voted as they did.
 */
export function chamberDivergenceNote(bill: Bill): string | null {
  const house = chamberPattern(bill, 'house')
  const senate = chamberPattern(bill, 'senate')
  const pair = [house, senate].sort().join('|')
  if (pair !== 'near_unanimous|party_line') return null
  const unanimous: VoteChamber = house === 'near_unanimous' ? 'house' : 'senate'
  const split: VoteChamber = unanimous === 'house' ? 'senate' : 'house'
  const parts = [
    `The ${CHAMBER_LABELS[unanimous]} vote was nearly unanimous (${tallyText(bill.votes_summary?.[unanimous])}), ` +
      `while the ${CHAMBER_LABELS[split]} vote split largely along party lines (${tallyText(bill.votes_summary?.[split])}).`,
  ]
  for (const chamber of [unanimous, split]) {
    const rollCall = tallyRollCall(bill, chamber)
    if (rollCall?.vote_kind && rollCall.vote_kind !== 'passage') {
      parts.push(
        `The ${CHAMBER_LABELS[chamber]} vote was ${rollCall.vote_kind === 'amendment' ? 'on an amendment' : 'procedural'}, not on passage.`
      )
    }
  }
  return parts.join(' ')
}
