import { describe, expect, it } from 'vitest'

import { activeCandidacies, billFromAlignment, telHref, voteMatchesSearch, voteMeta } from './memberProfile'
import type { Candidacy, OfficialVote, VoteAlignment } from './types'

const vote = (partial: Partial<OfficialVote>): OfficialVote => ({
  bill_id: '119-hr-1744',
  bill_title: 'Religious Freedom Reauthorization Act',
  bill_summary: '<p>Reauthorizes the <strong>commission</strong> through 2028.</p>',
  position: 'Yes',
  sponsor_name: null,
  ...partial,
})

describe('voteMatchesSearch', () => {
  it('matches yes/no by position only', () => {
    expect(voteMatchesSearch(vote({}), 'yes')).toBe(true)
    expect(voteMatchesSearch(vote({}), 'no')).toBe(false)
  })

  it('matches bill IDs loosely but never by text for an ID-shaped query', () => {
    expect(voteMatchesSearch(vote({}), 'HR 1744')).toBe(true)
    expect(voteMatchesSearch(vote({}), '119hr1744')).toBe(true)
    expect(voteMatchesSearch(vote({}), '119hr9999')).toBe(false)
  })

  it('matches words in the title or summary, ignoring HTML', () => {
    expect(voteMatchesSearch(vote({}), 'freedom act')).toBe(true)
    expect(voteMatchesSearch(vote({}), 'commission 2028')).toBe(true)
    expect(voteMatchesSearch(vote({}), 'strong')).toBe(false)
  })
})

describe('member profile helpers', () => {
  it('builds tel: links and the vote line', () => {
    expect(telHref('(202) 224-2934')).toBe('tel:2022242934')
    expect(telHref('none')).toBeUndefined()
    expect(voteMeta(vote({ chamber: 'House', result: 'Passed', question: 'On Passage' }))).toBe('House · Passed · On Passage')
    expect(voteMeta(vote({}))).toBeNull()
  })

  it('keeps this cycle’s candidacies', () => {
    const c = (year: number) => ({ election_year: year }) as Candidacy
    expect(activeCandidacies([c(2024), c(2026), c(2028)], new Date('2026-10-29')).map((x) => x.election_year)).toEqual([2026, 2028])
  })

  it('opens the voted bill for an alignment, or a stub when the vote is missing', () => {
    const alignment = { roll_call_id: 7, bill_id: '119-s-5', bill_title: 'A bill', vote_position: 'No' } as VoteAlignment
    expect(billFromAlignment(alignment, [vote({ roll_call_id: 7, bill_id: '119-hr-1744' })]).id).toBe('119-hr-1744')
    const stub = billFromAlignment(alignment, [])
    expect(stub).toMatchObject({ id: '119-s-5', title: 'A bill' })
  })
})
