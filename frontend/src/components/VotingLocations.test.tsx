import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import VotingLocations from './VotingLocations'
import type { AdminBody, VoterInfo, VoterLocation } from '../types'

function createMockLocation(overrides: Partial<VoterLocation>): VoterLocation {
  return {
    locationName: null,
    line1: null,
    city: null,
    state: null,
    zip: null,
    pollingHours: null,
    startDate: null,
    endDate: null,
    notes: null,
    sources: [],
    ...overrides,
  }
}

function createMockAdminBody(overrides: Partial<AdminBody>): AdminBody {
  return {
    name: null,
    electionInfoUrl: null,
    electionRegistrationUrl: null,
    electionRegistrationConfirmationUrl: null,
    absenteeVotingInfoUrl: null,
    votingLocationFinderUrl: null,
    ballotInfoUrl: null,
    hoursOfOperation: null,
    physicalAddress: null,
    phone: null,
    email: null,
    ...overrides,
  }
}

function createMockVoterInfo(overrides: Partial<VoterInfo>): VoterInfo {
  return {
    uiState: 'live',
    upstreamStatus: 'success',
    mailOnly: false,
    election: null,
    pollingLocations: [],
    earlyVoteSites: [],
    dropOffLocations: [],
    adminBodies: { state: null, local: null },
    otherElections: [],
    fetchedAt: '2024-11-01T00:00:00Z',
    ...overrides,
  }
}

describe('VotingLocations Component', () => {
  it('collapses passed early-voting dates into a "Passed dates" section', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 12, 12, 0))
    try {
      render(
        <VotingLocations
          voterInfo={createMockVoterInfo({
            election: { id: '12000', name: '2026 General Midterm Election', date: '2026-11-03' },
            earlyVoteSites: [
              createMockLocation({
                locationName: 'Burnsville City Hall',
                pollingHours: 'Fri, Oct 9: 8:00 am - 4:30 pm\nTue, Oct 13: 8:00 am - 4:30 pm\nMon, Nov 2: 8 am - 5 pm',
              }),
            ],
          })}
          loading={false}
          stateCode="MN"
        />,
      )
      expect(screen.getByText('Tue, Oct 13: 8:00 am - 4:30 pm')).toBeVisible()
      const summary = screen.getByText('Passed dates (1)')
      const details = summary.closest('details')!
      expect(details.open).toBe(false)
      fireEvent.click(summary)
      expect(details.open).toBe(true)
      expect(screen.getByText('Fri, Oct 9: 8:00 am - 4:30 pm')).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('election date is an add-to-calendar button that downloads an .ics file', () => {
    const createObjectURL = vi.fn(() => 'blob:election')
    const revokeObjectURL = vi.fn()
    Object.assign(URL, { createObjectURL, revokeObjectURL })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    render(
      <VotingLocations
        voterInfo={createMockVoterInfo({
          uiState: 'no_locations_yet',
          election: { id: '12000', name: '2026 General Midterm Election', date: '2026-11-03' },
        })}
        loading={false}
        stateCode="TX"
      />,
    )

    const button = screen.getByRole('button', {
      name: 'Tuesday, November 3, 2026: add to calendar with reminders',
    })
    fireEvent.click(button)

    expect(createObjectURL).toHaveBeenCalledTimes(1)
    expect(click).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('link', { name: 'Google Calendar' })).toHaveAttribute(
      'href',
      expect.stringContaining('dates=20261103%2F20261104'),
    )
    click.mockRestore()
  })

  it('explains official portals on unfamiliar domains', () => {
    const { unmount } = render(<VotingLocations voterInfo={null} loading={false} stateCode="TX" />)
    expect(screen.getByText('goelect.txelections.civixapps.com')).toBeInTheDocument()
    unmount()

    render(<VotingLocations voterInfo={null} loading={false} stateCode="CA" />)
    expect(screen.queryByText(/voter portal at/)).not.toBeInTheDocument()
  })

  it('live data without election-office links still shows official state links', () => {
    render(
      <VotingLocations
        voterInfo={createMockVoterInfo({
          pollingLocations: [createMockLocation({ locationName: 'Central Library' })],
        })}
        loading={false}
        stateCode="TX"
      />,
    )
    expect(screen.getByText('Central Library')).toBeInTheDocument()
    const official = screen.getByRole('link', { name: /Find Polling Place & Check Registration \(Official\)/ })
    expect(official).toHaveAttribute('href', 'https://teamrv-mvp.sos.texas.gov/MVP/mvp.do')
  })

  it('live data with election-office links does not duplicate the state links', () => {
    render(
      <VotingLocations
        voterInfo={createMockVoterInfo({
          pollingLocations: [createMockLocation({ locationName: 'Central Library' })],
          adminBodies: {
            state: createMockAdminBody({ electionRegistrationUrl: 'https://sos.example.gov/register' }),
            local: null,
          },
        })}
        loading={false}
        stateCode="TX"
      />,
    )
    expect(screen.queryByText(/Voter Resources for Texas/)).not.toBeInTheDocument()
  })

  it('shows the first 5 locations of a long list and expands on request', () => {
    const pollingLocations = Array.from({ length: 75 }, (_, i) =>
      createMockLocation({ locationName: `Vote Center ${i + 1}`, line1: `${i + 1} Main St` }),
    )
    render(
      <VotingLocations
        voterInfo={createMockVoterInfo({ pollingLocations })}
        loading={false}
        stateCode="DC"
      />,
    )

    expect(screen.getByText('Vote Center 5')).toBeInTheDocument()
    expect(screen.queryByText('Vote Center 6')).not.toBeInTheDocument()

    const toggle = screen.getByRole('button', { name: /Show all 75 \(70 more\)/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(toggle)

    expect(screen.getByText('Vote Center 75')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Show fewer/ })).toHaveAttribute('aria-expanded', 'true')
  })

  it('renders loading state with aria-live polite and role status', () => {
    render(<VotingLocations voterInfo={null} loading={true} stateCode="KS" />)

    const loadingRegion = screen.getByRole('status')
    expect(loadingRegion).toHaveAttribute('aria-live', 'polite')
    expect(screen.getByText(/Loading voting and polling location information/i)).toBeInTheDocument()
  })

  it('renders "live" state with locations, hours, directions, and registration block', () => {
    const voterInfo = createMockVoterInfo({
      uiState: 'live',
      election: {
        id: '2000',
        name: 'VIP Test Election',
        date: '2024-11-05',
      },
      pollingLocations: [
        createMockLocation({
          locationName: 'Kansas City Community Center',
          line1: '1263 Pacific Ave',
          city: 'Kansas City',
          state: 'KS',
          zip: '66102',
          pollingHours: '7:00 AM - 7:00 PM\nValid photo ID required',
          notes: 'Main gymnasium, enter through south doors.',
          sources: [{ name: 'Voting Information Project', official: true }],
        }),
      ],
      adminBodies: {
        state: createMockAdminBody({
          name: 'Kansas Secretary of State',
          electionRegistrationUrl: 'https://www.ksvotes.org/',
          electionRegistrationConfirmationUrl: 'https://myvoteinfo.voteks.org/voterview',
          phone: '(785) 296-4561',
          email: 'election@ks.gov',
        }),
        local: null,
      },
    })

    render(<VotingLocations voterInfo={voterInfo} loading={false} stateCode="KS" />)

    // Check election header
    expect(screen.getByText('VIP Test Election')).toBeInTheDocument()

    // Check registration block is present above cards
    expect(screen.getByText(/Register to Vote/i)).toBeInTheDocument()
    expect(screen.getByText(/Check Registration Status/i)).toBeInTheDocument()

    // Check location card
    expect(screen.getByText('Kansas City Community Center')).toBeInTheDocument()
    expect(screen.getByText(/1263 Pacific Ave/i)).toBeInTheDocument()
    expect(screen.getByText(/7:00 AM - 7:00 PM/i)).toBeInTheDocument()
    expect(screen.getByText(/Main gymnasium, enter through south doors./i)).toBeInTheDocument()

    // Check directions link
    const directionsLink = screen.getByRole('link', { name: /Directions/i })
    expect(directionsLink).toHaveAttribute('href')
    expect(directionsLink.getAttribute('href')).toContain('google.com/maps/dir')

    // Check contact card
    expect(screen.getByText('Kansas Secretary of State')).toBeInTheDocument()
    expect(screen.getByText('(785) 296-4561')).toBeInTheDocument()
  })

  it('renders "mail_only" state distinctly', () => {
    const voterInfo = createMockVoterInfo({
      uiState: 'mail_only',
      mailOnly: true,
      election: { id: '1', name: 'Oregon General Election', date: '2024-11-05' },
    })

    render(<VotingLocations voterInfo={voterInfo} loading={false} stateCode="OR" />)

    expect(screen.getByText(/Voting by Mail in Your Jurisdiction/i)).toBeInTheDocument()
    expect(screen.getByText(/Voters in this area vote primarily by mail/i)).toBeInTheDocument()
  })

  it('renders "no_locations_yet" state distinctly', () => {
    const voterInfo = createMockVoterInfo({
      uiState: 'no_locations_yet',
      election: { id: '2', name: 'Upcoming Primary', date: '2024-08-01' },
    })

    render(<VotingLocations voterInfo={voterInfo} loading={false} stateCode="TX" />)

    expect(screen.getByText(/Polling locations have not yet been assigned/i)).toBeInTheDocument()
    expect(screen.getByText(/official polling place assignments have not yet been published/i)).toBeInTheDocument()
  })

  it('renders "no_data_yet" state distinctly', () => {
    const voterInfo = createMockVoterInfo({
      uiState: 'no_data_yet',
      upstreamStatus: 'noStreetSegmentFound',
    })

    render(<VotingLocations voterInfo={voterInfo} loading={false} stateCode="WY" />)

    expect(screen.getByText(/No voting location data available for this street segment/i)).toBeInTheDocument()
  })

  it('renders "nearby_only" state distinctly and omits location cards', () => {
    const voterInfo = createMockVoterInfo({
      uiState: 'nearby_only',
      upstreamStatus: 'multipleStreetSegmentsFound',
    })

    render(<VotingLocations voterInfo={voterInfo} loading={false} stateCode="IL" />)

    expect(screen.getByText(/Multiple election precincts match this street segment/i)).toBeInTheDocument()
    // Verify no location card headings rendered
    expect(screen.queryByText(/Election Day Polling Places/i)).not.toBeInTheDocument()
  })

  it('renders "election_over" state distinctly', () => {
    const voterInfo = createMockVoterInfo({
      uiState: 'election_over',
      upstreamStatus: 'electionOver',
    })

    render(<VotingLocations voterInfo={voterInfo} loading={false} stateCode="CA" />)

    expect(screen.getByText(/The election has concluded/i)).toBeInTheDocument()
    expect(screen.getByText(/The scheduled election for this area is over/i)).toBeInTheDocument()
  })

  it('renders "no_election" state distinctly', () => {
    const voterInfo = createMockVoterInfo({
      uiState: 'no_election',
      upstreamStatus: 'electionUnknown',
    })

    render(<VotingLocations voterInfo={voterInfo} loading={false} stateCode="FL" />)

    expect(screen.getByText(/No upcoming elections found/i)).toBeInTheDocument()
    expect(screen.getByText(/There are no upcoming elections currently scheduled/i)).toBeInTheDocument()
  })

  it('renders "address_problem" state distinctly', () => {
    const voterInfo = createMockVoterInfo({
      uiState: 'address_problem',
      upstreamStatus: 'addressUnparseable',
    })

    render(<VotingLocations voterInfo={voterInfo} loading={false} stateCode="NY" />)

    expect(screen.getByText(/Address not recognized/i)).toBeInTheDocument()
    expect(screen.getByText(/The election database could not parse or locate this address/i)).toBeInTheDocument()
  })

  it('renders "unavailable" state with fallback state resources', () => {
    const voterInfo = createMockVoterInfo({
      uiState: 'unavailable',
      upstreamStatus: 'upstream_forbidden',
    })

    render(<VotingLocations voterInfo={voterInfo} loading={false} stateCode="NC" />)

    expect(screen.getByText(/Live voting location lookup is currently unavailable/i)).toBeInTheDocument()
    // Verify fallback links for North Carolina
    expect(screen.getByText(/Voter Resources for North Carolina/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Register to Vote in North Carolina/i })).toBeInTheDocument()
  })
})
