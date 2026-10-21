import { fireEvent, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import MemberDrawer from '../MemberDrawer'
import { groupPositions, positionsStatusMessage } from '../positions'
import type { Official, OfficialDetail, OfficialStance, PositionsSync } from '../types'
import StatedPositionsSection from './StatedPositionsSection'

const clerk = vi.hoisted(() => ({ signedIn: true }))

vi.mock('@clerk/clerk-react', () => ({
  SignedIn: ({ children }: { children: ReactNode }) => (clerk.signedIn ? <>{children}</> : null),
}))

function stance(overrides: Partial<OfficialStance> = {}): OfficialStance {
  return {
    issue_label: 'Health Care',
    policy_area: 'Health',
    target_name: 'Medicaid',
    mechanism: 'funding',
    direction: 'increase',
    stance: 'opposes',
    policy_direction: 'decrease',
    emphasis: 'high',
    summary: 'Fights cuts to Medicaid.',
    evidence_quote: 'I will fight every cut to Medicaid.',
    source_url: 'https://www.example.house.gov/issues/health-care/',
    source_type: 'official_site',
    extracted_at: '2026-10-01T12:00:00',
    extractor_version: 'v1',
    model: 'qwen3.6:27b',
    ...overrides,
  }
}

const okSync: PositionsSync = {
  status: 'ok',
  last_attempt_at: '2026-10-11T12:00:00',
  last_success_at: '2026-10-11T12:00:00',
  attempts: 1,
  pages_found: 4,
  stances_saved: 3,
  last_error: null,
  extractor_version: 'v1',
}

// The section starts collapsed; click its header to show the positions.
function expand() {
  fireEvent.click(screen.getByRole('button', { name: 'Stated Positions (AI)' }))
}

describe('StatedPositionsSection', () => {
  it('starts collapsed, showing only the header and model', () => {
    render(<StatedPositionsSection sync={okSync} positions={[stance()]} />)

    const toggle = screen.getByRole('button', { name: 'Stated Positions (AI)' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByText('qwen3.6:27b')).toBeInTheDocument()
    expect(screen.queryByText('Medicaid')).not.toBeInTheDocument()

    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Medicaid')).toBeInTheDocument()

    fireEvent.click(toggle)
    expect(screen.queryByText('Medicaid')).not.toBeInTheDocument()
  })

  it('groups positions by policy area with the quote and source link', () => {
    render(
      <StatedPositionsSection
        sync={okSync}
        positions={[
          stance(),
          stance({
            target_name: 'Border Patrol',
            policy_area: 'Immigration',
            emphasis: 'medium',
            stance: 'supports',
            policy_direction: 'increase',
            evidence_quote: 'More agents at the border.',
          }),
          stance({ target_name: 'Community health centers', emphasis: 'low' }),
        ]}
      />,
    )
    expand()

    expect(screen.getByText('Stated Positions (AI)')).toBeInTheDocument()
    expect(screen.getByText('qwen3.6:27b')).toBeInTheDocument()

    const health = screen.getByText('Health').parentElement as HTMLElement
    const healthTargets = within(health)
      .getAllByRole('listitem')
      .map((item) => item.querySelector('span')?.textContent)
    expect(healthTargets).toEqual(['Medicaid', 'Community health centers'])
    expect(screen.getByText('Immigration')).toBeInTheDocument()

    expect(screen.getAllByText('opposes a funding decrease')).toHaveLength(2)
    expect(screen.getByText('supports a funding increase')).toBeInTheDocument()
    expect(screen.getAllByText('wants ↑ increase')).toHaveLength(3)
    expect(screen.getByText('“More agents at the border.”')).toBeInTheDocument()

    const links = screen.getAllByRole('link', { name: /Source: example\.house\.gov\/issues\/health-care$/ })
    expect(links[0]).toHaveAttribute('href', 'https://www.example.house.gov/issues/health-care/')
    expect(links[0]).toHaveAttribute('target', '_blank')
    expect(links[0]).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('shows the first 10 positions, then all on request', () => {
    const positions = Array.from({ length: 13 }, (_, i) =>
      stance({ target_name: `Target ${i + 1}`, policy_area: i % 2 ? 'Health' : 'Taxation' }),
    )
    render(<StatedPositionsSection sync={okSync} positions={positions} />)
    expand()

    expect(screen.getAllByRole('listitem')).toHaveLength(10)
    fireEvent.click(screen.getByRole('button', { name: 'Show all 13' }))
    expect(screen.getAllByRole('listitem')).toHaveLength(13)
    fireEvent.click(screen.getByRole('button', { name: 'Show fewer' }))
    expect(screen.getAllByRole('listitem')).toHaveLength(10)
  })

  it('shows a quote shared by several positions once, with them listed under it', () => {
    render(
      <StatedPositionsSection
        sync={okSync}
        positions={[
          stance(),
          stance({ target_name: 'CHIP', emphasis: 'medium' }),
          stance({
            target_name: 'Hospitals',
            emphasis: 'low',
            evidence_quote: '  i will fight EVERY cut to\n Medicaid.  ',
          }),
          stance({ target_name: 'Clinics', evidence_quote: 'Clinics need funding.' }),
        ]}
      />,
    )
    expand()

    expect(screen.getAllByText('“I will fight every cut to Medicaid.”')).toHaveLength(1)
    expect(screen.getByText('Supports 3 positions')).toBeInTheDocument()
    expect(screen.getByText('“Clinics need funding.”')).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: /^Source:/ })).toHaveLength(2)
    expect(screen.getAllByRole('listitem')).toHaveLength(4)
  })

  it('toggles the raw JSON', () => {
    render(<StatedPositionsSection sync={okSync} positions={[stance()]} />)
    expand()
    fireEvent.click(screen.getByRole('button', { name: 'View raw JSON' }))
    expect(screen.getByText(/"stated_positions"/)).toBeInTheDocument()
  })

  it('puts the full error in a tooltip for failed attempts', () => {
    const error = `ollama timed out ${'x'.repeat(300)}`
    render(
      <StatedPositionsSection
        sync={{ ...okSync, status: 'failed', last_error: error }}
        positions={[]}
      />,
    )
    expand()
    const line = screen.getByText(/^Last attempt failed: ollama timed out x+…$/)
    expect(line).toHaveAttribute('title', error)
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument()
  })
})

describe('groupPositions', () => {
  it('only merges positions with the same source and quote', () => {
    const [health] = groupPositions([
      stance({ target_name: 'A' }),
      stance({ target_name: 'B', source_url: 'https://www.example.house.gov/other' }),
      stance({ target_name: 'C', evidence_quote: '“I will fight every cut to Medicaid.”' }),
      stance({ target_name: 'D', evidence_quote: null }),
      stance({ target_name: 'E', evidence_quote: null }),
    ])

    expect(
      health.blocks.map((block) => block.positions.map((position) => position.target_name)),
    ).toEqual([['A', 'C'], ['B'], ['D'], ['E']])
  })
})

describe('positionsStatusMessage', () => {
  const now = new Date('2026-10-13T12:00:00Z')
  const withStatus = (status: string, extra: Partial<PositionsSync> = {}) => ({
    ...okSync,
    status,
    ...extra,
  })

  it.each([
    [okSync, 'Processed 2 days ago · 3 positions from 4 pages'],
    [withStatus('ok', { stances_saved: 1, pages_found: 1 }), 'Processed 2 days ago · 1 position from 1 page'],
    [withStatus('no_positions'), 'Site processed; no stated positions found'],
    [withStatus('no_issue_pages'), 'Site processed; no stated positions found'],
    [withStatus('blocked'), 'Site blocked our crawler'],
    [withStatus('needs_js'), 'Site needs JavaScript; not readable yet'],
    [withStatus('thin_site'), 'Site has almost no readable content'],
    [withStatus('no_website'), 'No official website on file'],
    [withStatus('failed', { last_error: 'HTTP 500' }), 'Last attempt failed: HTTP 500'],
    [null, 'Not processed yet'],
  ])('%#: %s', (sync, expected) => {
    expect(positionsStatusMessage(sync, now)).toBe(expected)
  })
})

describe('MemberDrawer stated positions', () => {
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
  }
  const detail: OfficialDetail = {
    ...official,
    votes: [],
    stated_positions: [stance()],
    positions_sync: okSync,
  }

  beforeEach(() => {
    // The drawer also loads campaign finance; each call needs its own Response.
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) =>
      new Response(
        JSON.stringify(
          String(input).endsWith('/finance')
            ? { official_id: official.id, fec_candidate_ids: [], source: 'FEC', elections: [] }
            : detail,
        ),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
  })

  afterEach(() => {
    clerk.signedIn = true
    vi.restoreAllMocks()
  })

  it('renders the section for signed-in users', async () => {
    render(
      <MemberDrawer
        official={official}
        onClose={() => {}}
        selectedBill={null}
        onSelectBill={() => {}}
        onCloseBill={() => {}}
      />,
    )
    expect(await screen.findByText('Stated Positions (AI)')).toBeInTheDocument()
    expect(screen.queryByText('Medicaid')).not.toBeInTheDocument()
    expand()
    expect(screen.getByText('Medicaid')).toBeInTheDocument()
  })

  it('shows the name in the top bar once it scrolls out of view', async () => {
    const { container } = render(
      <MemberDrawer
        official={official}
        onClose={() => {}}
        selectedBill={null}
        onSelectBill={() => {}}
        onCloseBill={() => {}}
      />,
    )
    await screen.findByText('Stated Positions (AI)')
    const header = container.querySelector('header') as HTMLElement
    const title = screen.getByRole('heading', { name: 'Jane Example' })
    const scroller = title.closest('.overflow-y-auto') as HTMLElement
    expect(within(scroller).getByText('Active')).toBeInTheDocument()
    expect(within(scroller).getByText('New York · Representative · District 1')).toBeInTheDocument()
    expect(within(header).queryByText('Jane Example')).not.toBeInTheDocument()
    expect(within(header).queryByText('D')).not.toBeInTheDocument()

    vi.spyOn(scroller, 'getBoundingClientRect').mockReturnValue({ top: 50 } as DOMRect)
    vi.spyOn(title, 'getBoundingClientRect').mockReturnValue({ bottom: 20 } as DOMRect)
    fireEvent.scroll(scroller)
    expect(within(header).getByText('D')).toBeInTheDocument()
    expect(within(header).getByText('Jane Example')).toBeInTheDocument()
    expect(within(header).getByText('NY')).toBeInTheDocument()
    expect(within(header).queryByText('Active')).not.toBeInTheDocument()

    vi.spyOn(title, 'getBoundingClientRect').mockReturnValue({ bottom: 120 } as DOMRect)
    fireEvent.scroll(scroller)
    expect(within(header).queryByText('Jane Example')).not.toBeInTheDocument()
  })

  it('shows nothing new to signed-out users and still loads votes', async () => {
    clerk.signedIn = false
    render(
      <MemberDrawer
        official={official}
        onClose={() => {}}
        selectedBill={null}
        onSelectBill={() => {}}
        onCloseBill={() => {}}
      />,
    )
    expect(await screen.findByText('No recorded votes in the ingested bills.')).toBeInTheDocument()
    expect(screen.queryByText('Stated Positions (AI)')).not.toBeInTheDocument()
    expect(screen.queryByText('Medicaid')).not.toBeInTheDocument()
  })
})
