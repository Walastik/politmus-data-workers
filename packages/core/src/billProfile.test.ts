import { describe, expect, it } from 'vitest'

import { breadthNote, chamberCounts, cosponsorLine, crsSummaryBlocks, legalForceNote, partyCounts, votePieSlices } from './billProfile'
import { financeSelection } from './campaignFinance'
import type { Bill, ClassificationIntent, OfficialFinance } from './types'

const intent = (partial: Partial<ClassificationIntent> = {}): ClassificationIntent => ({
  target: 'Broadband',
  mechanism: 'funding',
  direction: 'increase',
  magnitude: 'low',
  ...partial,
})

describe('crsSummaryBlocks', () => {
  it('splits paragraphs and list items, keeping bold runs and entities', () => {
    const blocks = crsSummaryBlocks(
      '<p><strong>Safe Roads Act</strong></p><p>This bill funds roads &amp; bridges.</p><ul><li>Adds a grant</li></ul>',
    )
    expect(blocks).toEqual([
      { kind: 'paragraph', runs: [{ text: 'Safe Roads Act', strong: true }] },
      { kind: 'paragraph', runs: [{ text: 'This bill funds roads & bridges.', strong: false }] },
      { kind: 'item', runs: [{ text: 'Adds a grant', strong: false }] },
    ])
  })

  it('keeps plain text as paragraphs', () => {
    expect(crsSummaryBlocks('One.\n\nTwo.').map((b) => b.runs[0].text)).toEqual(['One.', 'Two.'])
  })
})

describe('vote tally', () => {
  it('counts a chamber and draws whole or split pies', () => {
    expect(chamberCounts({ Yes: 3, No: 1, 'Not Voting': 2 })).toMatchObject({ total: 6, yesPct: 75, noPct: 25 })
    expect(votePieSlices(0, 0)).toEqual([{ fill: '#334155', circle: true }])
    expect(votePieSlices(5, 0)).toEqual([{ fill: '#10b981', circle: true }])
    expect(votePieSlices(1, 1)).toHaveLength(2)
  })
})

describe('bill notes', () => {
  it('flags broad bills and unrelated provisions', () => {
    expect(breadthNote([intent()])).toBeNull()
    const note = breadthNote([intent(), intent({ target: 'Ports', relation: 'secondary' })])
    expect(note).toEqual({
      broad: null,
      unrelatedLabel: 'Includes 1 provision unrelated to its main purpose:',
      unrelatedList: 'Ports (funding).',
    })
    expect(breadthNote(Array.from({ length: 10 }, () => intent()))?.broad).toContain('10 separate policy effects')
  })

  it('says when provisions are non-binding', () => {
    expect(legalForceNote([intent({ legal_force: 'advisory' })])?.label).toBe('Non-binding:')
    expect(legalForceNote([intent({ legal_force: 'advisory' }), intent()])?.label).toBe('1 of 2 provisions are non-binding:')
  })

  it('writes the sponsor and party lines', () => {
    expect(cosponsorLine({ sponsor_party: 'Republican', cosponsor_party_breakdown: {} } as unknown as Bill)).toBe(
      'Sponsor Republican · No cosponsors',
    )
    expect(partyCounts(['Democratic', 'Democratic', null])).toBe('2 D, 1 ?')
  })
})

describe('financeSelection', () => {
  it('keeps peer and race comparisons on their own election only', () => {
    const e2024 = { election_year: 2024, fec_candidate_id: 'H1' }
    const e2026 = { election_year: 2026, fec_candidate_id: 'H1' }
    const finance = {
      elections: [e2026, e2024],
      peer_comparison: { election_year: 2024, fec_candidate_id: 'H1' },
      race_comparison: { election_year: 2026 },
    } as unknown as OfficialFinance
    const picked = financeSelection(finance, 'H1-2024')
    expect(picked.selected).toBe(e2024)
    expect(picked.compared).not.toBeNull()
    expect(picked.raced).toBeNull()
  })
})

describe('formatCompactMoney', () => {
  it('matches Intl compact notation without needing it', async () => {
    const { formatCompactMoney } = await import('./campaignFinance')
    const intl = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 })
    for (const value of [0, 7, 950, 999, 1000, 1049, 1500, 99_950, 496_092.4, 999_960, 1_000_000, 14_265_889.7, 2.5e9, -1500]) {
      expect(formatCompactMoney(value)).toBe(intl.format(value))
    }
  })
})
