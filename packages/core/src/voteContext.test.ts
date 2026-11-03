import { describe, expect, it } from 'vitest'

import type { Bill, BillRollCall } from './types'
import { chamberDivergenceNote, chamberPattern, tallyRollCall, voteKindNote } from './voteContext'

function rollCall(overrides: Partial<BillRollCall>): BillRollCall {
  return {
    id: 1,
    chamber: 'House',
    date: '2026-09-16',
    question: 'On Motion to Suspend the Rules and Pass, as Amended',
    result: 'Passed',
    requires: '2/3',
    source_roll_call_id: 'house-119-2-00312',
    vote_kind: 'passage',
    ...overrides,
  }
}

// 119-hr-9340: 417-3 in the House, a failed party-line Senate cloture vote.
const BILL = {
  id: '119-hr-9340',
  votes_summary: { house: { Yes: 417, No: 3 }, senate: { Yes: 57, No: 42 } },
  votes_by_party: {
    house: { Democratic: { Yes: 205, No: 3 }, Republican: { Yes: 212 } },
    senate: {
      Democratic: { Yes: 4, No: 40 },
      Republican: { Yes: 53 },
      Independent: { No: 2 },
    },
  },
  roll_calls: [
    rollCall({
      id: 2,
      chamber: 'Senate',
      question: 'On Cloture on the Motion to Proceed H.R. 9340',
      result: 'Cloture on the Motion to Proceed Rejected',
      requires: '3/5',
      vote_kind: 'procedural',
    }),
    rollCall({ id: 1 }),
  ],
  tally_roll_call_ids: { house: 1, senate: 2 },
} as unknown as Bill

describe('voteKindNote', () => {
  it('is empty for passage and explains procedural votes', () => {
    expect(voteKindNote(rollCall({}))).toBeNull()
    expect(voteKindNote(tallyRollCall(BILL, 'senate'))).toMatch(/^Cloture on the motion to proceed/)
    expect(voteKindNote(rollCall({ vote_kind: 'amendment', question: 'On the Amendment' }))).toMatch(
      /amendment/
    )
  })
})

describe('chamberPattern', () => {
  it('reads a near-unanimous and a party-line chamber', () => {
    expect(chamberPattern(BILL, 'house')).toBe('near_unanimous')
    expect(chamberPattern(BILL, 'senate')).toBe('party_line')
  })

  it('is mixed when both parties split', () => {
    const bill = {
      votes_summary: { house: { Yes: 230, No: 190 } },
      votes_by_party: {
        house: { Democratic: { Yes: 100, No: 110 }, Republican: { Yes: 130, No: 80 } },
      },
    } as unknown as Bill
    expect(chamberPattern(bill, 'house')).toBe('mixed')
    expect(chamberPattern(bill, 'senate')).toBe('none')
  })
})

describe('chamberDivergenceNote', () => {
  it('states the split and that the Senate vote was procedural', () => {
    expect(chamberDivergenceNote(BILL)).toBe(
      'The House vote was nearly unanimous (417–3), while the Senate vote split largely along party ' +
        'lines (57–42). The Senate vote was procedural, not on passage.'
    )
  })

  it('is empty when the chambers voted alike', () => {
    const bill = {
      ...BILL,
      votes_summary: { house: { Yes: 417, No: 3 }, senate: { Yes: 95, No: 2 } },
    } as unknown as Bill
    expect(chamberDivergenceNote(bill)).toBeNull()
  })
})
