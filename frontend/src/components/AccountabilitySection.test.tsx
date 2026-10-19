import { fireEvent, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { formatPoints } from '../accountability'
import MemberDrawer from '../MemberDrawer'
import type { AccountabilityScore, Official, OfficialDetail, VoteAlignment } from '../types'
import AccountabilitySection from './AccountabilitySection'
import ScoreHeadline from './ScoreHeadline'

const clerk = vi.hoisted(() => ({ signedIn: true }))

vi.mock('@clerk/clerk-react', () => ({
  SignedIn: ({ children }: { children: ReactNode }) => (clerk.signedIn ? <>{children}</> : null),
}))

function alignment(overrides: Partial<VoteAlignment> = {}): VoteAlignment {
  return {
    bill_id: '119-hr-1',
    bill_title: 'Medicaid Expansion Act',
    roll_call_id: 1,
    chamber: 'House',
    vote_date: '2026-03-01',
    vote_position: 'Yes',
    target_name: 'Medicaid',
    mechanism: 'funding',
    effect_direction: 'increase',
    effect_magnitude: 'high',
    effect_rationale: null,
    stance_direction: 'increase',
    stance_emphasis: 'high',
    stance_summary: null,
    stance_evidence_quote: 'I will fight every cut to Medicaid.',
    stance_source_url: 'https://www.example.house.gov/issues/health/',
    policy_area: 'Health',
    points: 1,
    ...overrides,
  }
}

const score: AccountabilityScore = {
  points: 4,
  aligned: 6,
  conflicting: 2,
  bills_scored: 5,
  stances_matched: 3,
  alignment_pct: 75,
  by_policy_area: {
    Health: { points: 5, aligned: 5, conflicting: 0 },
    Immigration: { points: -1, aligned: 1, conflicting: 2 },
  },
  engine_version: 'accountability-v1',
  computed_at: '2026-10-16T12:00:00',
}

describe('formatPoints', () => {
  it('signs points', () => {
    expect(formatPoints(5)).toBe('+5')
    expect(formatPoints(-3)).toBe('−3')
    expect(formatPoints(0)).toBe('0')
  })
})

describe('ScoreHeadline', () => {
  it('shows the litmus percentage and raw points', () => {
    render(<ScoreHeadline points={4} pct={75} matches={8} />)
    const headline = screen.getByTestId('score-headline')
    expect(within(headline).getByText('75%')).toBeInTheDocument()
    expect(within(headline).getByText('+4')).toBeInTheDocument()
    expect(within(headline).getByText('8 scored votes')).toBeInTheDocument()
  })

  it('holds back the percentage until there are enough scored votes', () => {
    render(<ScoreHeadline points={-2} pct={0} matches={2} />)
    expect(screen.queryByText('0%')).not.toBeInTheDocument()
    expect(screen.getByText('—')).toBeInTheDocument()
    expect(screen.getByText('−2')).toBeInTheDocument()
    expect(screen.getByText(/% after 5/)).toBeInTheDocument()
  })

  it('says when positions exist but no votes are scored', () => {
    render(<ScoreHeadline points={0} pct={null} matches={0} />)
    expect(screen.getByText(/no passage votes on their stated positions yet/)).toBeInTheDocument()
  })

  it('renders nothing for an unscored official', () => {
    const { container } = render(<ScoreHeadline points={null} pct={null} matches={null} />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('AccountabilitySection', () => {
  it('scores a vote once and explains matches that do not count', () => {
    render(
      <AccountabilitySection
        score={score}
        alignments={[
          alignment({ bill_id: '119-s-1071', bill_title: 'NDAA', roll_call_id: 7 }),
          alignment({
            bill_id: '119-s-1071',
            bill_title: 'NDAA',
            roll_call_id: 7,
            target_name: 'ICE',
            effect_relation: 'secondary',
            stance_direction: 'decrease',
            points: -1,
          }),
          alignment({
            bill_id: '119-s-1071',
            bill_title: 'NDAA',
            roll_call_id: 7,
            target_name: 'Military Bases',
            stance_emphasis: 'low',
            points: 1,
            counted: false,
            reason: 'low_emphasis',
          }),
        ]}
      />,
    )
    // +1 and -1 counted on one vote: one card, mixed.
    expect(screen.getAllByRole('button', { name: 'Open details for NDAA' })).toHaveLength(1)
    expect(screen.getByLabelText('Mixed, no points')).toHaveTextContent('0')
    expect(screen.getByText(/increases ICE funding/)).toHaveTextContent('(via an unrelated provision)')
    expect(
      screen.getByText(/Not counted: the position is only implied by a general statement/),
    ).toBeInTheDocument()
  })

  it('names the position target when it only nearly matches the bill', () => {
    render(
      <AccountabilitySection
        score={score}
        alignments={[
          alignment({
            target_name: 'Voter Registration',
            stance_target_name: 'Automatic Voter Registration',
            match_similarity: 0.91,
          }),
        ]}
        onSelectBill={vi.fn()}
      />,
    )
    expect(screen.getByText(/increases Voter Registration funding/)).toHaveTextContent(
      'wants it increased (their position is on Automatic Voter Registration).',
    )
  })

  it('says when the position target moves the opposite way', () => {
    render(
      <AccountabilitySection
        score={score}
        alignments={[
          alignment({
            target_name: 'Voter Registration Requirements',
            stance_target_name: 'Automatic Voter Registration',
            match_similarity: 0.82,
            match_inverse: true,
            vote_position: 'No',
          }),
        ]}
        onSelectBill={vi.fn()}
      />,
    )
    expect(screen.getByText(/increases Voter Registration Requirements/)).toHaveTextContent(
      '(their position is on Automatic Voter Registration, which moves the opposite way).',
    )
  })

  it('lists each scored vote with its verdict and evidence', () => {
    const onSelectBill = vi.fn()
    render(
      <AccountabilitySection
        score={score}
        alignments={[
          alignment(),
          alignment({
            roll_call_id: 2,
            bill_id: '119-hr-2',
            bill_title: 'Border Act',
            target_name: 'Border Patrol',
            stance_direction: 'decrease',
            points: -1,
          }),
        ]}
        onSelectBill={onSelectBill}
      />,
    )
    expect(screen.getByText(/6 votes matched and 2 contradicted/)).toBeInTheDocument()
    expect(screen.getByText(/increases Medicaid funding/)).toHaveTextContent('consistent: wants it increased')
    expect(screen.getByText(/increases Border Patrol funding/)).toHaveTextContent('contradicts: wants it cut')
    expect(screen.getByLabelText('Contradicts, minus one')).toHaveTextContent('−1')
    expect(screen.getByLabelText('Score by policy area')).toHaveTextContent('Immigration −1')
    expect(screen.getAllByText(/I will fight every cut to Medicaid/)).toHaveLength(2)

    fireEvent.click(screen.getByRole('button', { name: 'Open details for Border Act' }))
    expect(onSelectBill).toHaveBeenCalledWith(expect.objectContaining({ bill_id: '119-hr-2' }))
  })

  it('shows ten votes until expanded', () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      alignment({ roll_call_id: i + 1, bill_title: `Bill ${i + 1}` }),
    )
    render(<AccountabilitySection score={score} alignments={many} />)
    expect(screen.queryByText('Bill 11')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Show all 12' }))
    expect(screen.getByText('Bill 11')).toBeInTheDocument()
  })
})

describe('MemberDrawer accountability', () => {
  const official: Official = {
    id: 'A000001',
    name: 'Jane Example',
    state: 'New York',
    party: 'Democratic',
    office: 'Representative',
    district: 1,
    current_member: true,
    phone: null,
    office_address: null,
    website_url: null,
    score_points: 4,
    score_pct: 75,
    score_matches: 8,
  }
  const detail: OfficialDetail = {
    ...official,
    votes: [],
    stated_positions: [],
    positions_sync: null,
    accountability: score,
    alignments: [alignment()],
  }

  beforeEach(() => {
    clerk.signedIn = true
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(detail), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows the headline score and scorecard to signed-in users', async () => {
    render(<MemberDrawer
        official={official}
        onClose={() => {}}
        selectedBill={null}
        onSelectBill={() => {}}
        onCloseBill={() => {}}
      />)
    expect(await screen.findByText('Says vs. votes')).toBeInTheDocument()
    expect(screen.getByTestId('score-headline')).toHaveTextContent('75%')
  })

  it('hides scores when signed out', async () => {
    clerk.signedIn = false
    render(<MemberDrawer
        official={official}
        onClose={() => {}}
        selectedBill={null}
        onSelectBill={() => {}}
        onCloseBill={() => {}}
      />)
    expect(await screen.findByText('No recorded votes in the ingested bills.')).toBeInTheDocument()
    expect(screen.queryByText('Says vs. votes')).not.toBeInTheDocument()
    expect(screen.queryByTestId('score-headline')).not.toBeInTheDocument()
  })
})
