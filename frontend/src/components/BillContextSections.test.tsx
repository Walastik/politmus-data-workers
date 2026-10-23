import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { committeeReportUrl, type BillAmendment, type BillDebate, type DebatePoint } from '../types'
import { AmendmentsSection, DebateSection } from './BillContextSections'

function point(overrides: Partial<DebatePoint>): DebatePoint {
  return {
    point: 'Says the bill passed the House 417 to 3.',
    quote: 'It passed the House 417 to 3.',
    source_id: 1,
    speaker: 'Husted',
    party: 'Republican',
    state: 'Ohio',
    chamber: 'Senate',
    kind: 'floor_speech',
    title: 'RATEPAYER PROTECTION ACT',
    date: '2026-09-30',
    url: 'https://www.congress.gov/119/crec/x.htm',
    ...overrides,
  }
}

describe('DebateSection', () => {
  it('shows the dispute and both sides with speakers and sources', () => {
    const debate: BillDebate = {
      key_dispute: 'Members disagreed over whether the standard should be advisory or mandatory.',
      supporters: [point({})],
      opponents: [
        point({
          source_id: 2,
          speaker: 'Heinrich',
          party: 'Democratic',
          state: 'New Mexico',
          point: 'Says the bill does not require data centers to pay.',
          quote: 'This bill has no requirement that data centers actually pay for their own grid upgrades.',
        }),
      ],
      sources_considered: 7,
    }
    render(<DebateSection debate={debate} />)
    expect(screen.getByText(/advisory or mandatory/)).toBeInTheDocument()
    expect(screen.getByText('Supporters say')).toBeInTheDocument()
    expect(screen.getByText('Opponents say')).toBeInTheDocument()
    expect(screen.getByText('Sen. Heinrich')).toBeInTheDocument()
    expect(screen.getByText('D-New Mexico')).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: 'Congressional Record' })).toHaveLength(2)
    expect(screen.getByText(/7 stored floor statements/)).toBeInTheDocument()
  })

  it('says when a side made no arguments, and renders nothing without points', () => {
    const { rerender } = render(
      <DebateSection debate={{ key_dispute: null, supporters: [point({})], opponents: [] }} />
    )
    expect(screen.getByText(/No arguments against the bill/)).toBeInTheDocument()
    rerender(<DebateSection debate={{ key_dispute: null, supporters: [], opponents: [] }} />)
    expect(screen.queryByText('Where the sides disagree')).not.toBeInTheDocument()
  })
})

describe('AmendmentsSection', () => {
  it('counts amendments by party and expands to the list', () => {
    const amendment = (number: string): BillAmendment => ({
      id: `119-samdt-${number}`,
      chamber: 'Senate',
      number,
      sponsor_name: 'Sen. Van Hollen, Chris [D-MD]',
      sponsor_party: 'Democratic',
      submitted_date: '2026-09-29',
      purpose: null,
      latest_action_text: null,
      latest_action_date: null,
      text_url: null,
      text_excerpt: 'SEC. 2. SENSE OF CONGRESS.',
    })
    render(<AmendmentsSection amendments={[amendment('6840'), amendment('6845')]} />)
    const toggle = screen.getByRole('button', { name: /Amendments filed \(2: 2 D\)/ })
    expect(screen.queryByText('S.Amdt. 6840')).not.toBeInTheDocument()
    fireEvent.click(toggle)
    expect(screen.getByText('S.Amdt. 6840')).toBeInTheDocument()
    expect(screen.getAllByText('Filed; no vote or other action recorded.')).toHaveLength(2)
  })
})

describe('committeeReportUrl', () => {
  it('links House and Senate reports', () => {
    expect(committeeReportUrl('H. Rept. 119-814')).toBe(
      'https://www.congress.gov/congressional-report/119th-congress/house-report/814'
    )
    expect(committeeReportUrl('S. Rept. 118-12')).toContain('/118th-congress/senate-report/12')
    expect(committeeReportUrl('nonsense')).toBeNull()
  })
})
