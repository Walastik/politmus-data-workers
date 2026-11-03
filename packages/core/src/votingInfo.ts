// The full voting-information view (every site, the election office, and the
// fallback links), shared by the web VotingLocations and the native screen.

import { earlyVotingPhase, formatShortDate, getEarlyVotingWindow, localToday } from './earlyVoting'
import { getVoterResources, unfamiliarPortalHost, type AdminBody, type AdminBodies, type VoterInfo, type VoterLocation, type VoterUiState } from './types'

// Vote-center jurisdictions can return dozens of sites per address (75 polling
// places for a DC address in testing), so show a few and let the user expand.
export const INITIAL_LOCATIONS_SHOWN = 5

export const UNAVAILABLE_MESSAGE =
  'We could not reach the voting information service. You can still register to vote or check your status below.'

export interface LocationGroup {
  title: string
  typeLabel: string
  locations: VoterLocation[]
}

// The site lists to show: everything when live, drop-off boxes when mail-only.
export function locationGroups(voterInfo: VoterInfo): LocationGroup[] {
  const groups: LocationGroup[] =
    voterInfo.uiState === 'live'
      ? [
          { title: 'Election Day Polling Places', typeLabel: 'Election Day', locations: voterInfo.pollingLocations },
          { title: 'Early Voting Sites', typeLabel: 'Early Voting', locations: voterInfo.earlyVoteSites },
          { title: 'Ballot Drop-off Locations', typeLabel: 'Drop-off Box', locations: voterInfo.dropOffLocations },
        ]
      : voterInfo.uiState === 'mail_only'
        ? [{ title: 'Ballot Drop-off Locations', typeLabel: 'Drop-off Box', locations: voterInfo.dropOffLocations }]
        : []
  return groups.filter((group) => group.locations.length > 0)
}

export type NoticeTone = 'info' | 'warning' | 'error' | 'neutral' | 'done'
export type NoticeIcon = 'mail' | 'clock' | 'help' | 'alert' | 'check' | 'calendar'

export interface VotingNotice {
  tone: NoticeTone
  icon: NoticeIcon
  title: string
  body: string
  // An official lookup to send the voter to, with its label.
  action?: { label: string; url: string }
}

// What to say when there are no live sites to list, by the API's uiState.
export function votingNotice(voterInfo: VoterInfo, stateCode: string | null | undefined): VotingNotice | null {
  const state = voterInfo.uiState as VoterUiState
  switch (state) {
    case 'mail_only':
      return {
        tone: 'info',
        icon: 'mail',
        title: 'Voting by Mail in Your Jurisdiction',
        body: 'Voters in this area vote primarily by mail. Ballots are mailed directly to registered voters. Completed ballots can be returned by mail or delivered to official drop-off locations.',
      }
    case 'no_locations_yet': {
      const resources = getVoterResources(stateCode)
      const finderUrl =
        voterInfo.adminBodies?.local?.votingLocationFinderUrl ||
        voterInfo.adminBodies?.state?.votingLocationFinderUrl ||
        resources.pollingPlaceUrl
      const stateName = stateCode ? resources.name : null
      return {
        tone: 'neutral',
        icon: 'clock',
        title: "Voting locations for this address aren't in our data yet",
        body: `${voterInfo.election?.name || 'An election'} is coming up, but election officials haven't yet sent polling place or early voting site data for this address to the Voting Information Project, the nationwide source Politmus uses. Sites usually appear shortly before voting starts. Until then, the official lookup has the current list.`,
        action: finderUrl
          ? { label: `Find your voting location on ${stateName ? `${stateName}'s` : 'the'} official site`, url: finderUrl }
          : undefined,
      }
    }
    case 'no_data_yet':
      return {
        tone: 'neutral',
        icon: 'help',
        title: 'No voting location data available for this street segment',
        body: 'Official election authorities have not published polling location records for this specific street segment. You can confirm your voter registration and polling details directly through your state resources below.',
      }
    case 'nearby_only':
      return {
        tone: 'warning',
        icon: 'alert',
        title: 'Multiple election precincts match this street segment',
        body: 'Your address sits near precinct boundaries where multiple voting locations apply. To avoid casting an incorrect ballot, please confirm your designated polling place directly with your local election office.',
      }
    case 'election_over':
      return {
        tone: 'done',
        icon: 'check',
        title: 'The election has concluded',
        body: 'The scheduled election for this area is over. Keep your voter registration current to ensure you are ready for upcoming elections.',
      }
    case 'no_election':
      return {
        tone: 'neutral',
        icon: 'calendar',
        title: 'No upcoming elections found',
        body: 'There are no upcoming elections currently scheduled in the official voting database for this address. Use the links below to verify your voter registration status with your state.',
      }
    case 'address_problem':
      return {
        tone: 'error',
        icon: 'alert',
        title: 'Address not recognized',
        body: 'The election database could not parse or locate this address. Please ensure your street address includes the house number, street name, and ZIP code.',
      }
    default:
      return null
  }
}

// The state fallback links appear for every state but live; live data without
// any election-office links (e.g. DC) gets them too.
export function showStaticFallback(voterInfo: VoterInfo) {
  return voterInfo.uiState !== 'live' || !hasRegistrationLinks(voterInfo.adminBodies)
}

export function hasRegistrationLinks(adminBodies?: AdminBodies | null) {
  return registrationLinks(adminBodies).length > 0
}

// Official links from the election office, best source first.
export function registrationLinks(adminBodies?: AdminBodies | null): { label: string; url: string; style: 'primary' | 'accent' | 'plain' }[] {
  if (!adminBodies) return []
  const local = adminBodies.local
  const state = adminBodies.state
  const pick = (key: keyof AdminBody) => (local?.[key] || state?.[key] || null) as string | null
  return [
    { label: 'Register to Vote', url: pick('electionRegistrationUrl'), style: 'primary' as const },
    { label: 'Check Registration Status', url: pick('electionRegistrationConfirmationUrl'), style: 'accent' as const },
    { label: 'Absentee / Mail-in Voting', url: pick('absenteeVotingInfoUrl'), style: 'plain' as const },
    { label: 'Official Location Finder', url: pick('votingLocationFinderUrl'), style: 'plain' as const },
    { label: 'Sample Ballot', url: pick('ballotInfoUrl'), style: 'plain' as const },
  ].filter((link): link is { label: string; url: string; style: 'primary' | 'accent' | 'plain' } => Boolean(link.url))
}

// Statewide early voting dates for the Election card. Hidden when the Civic
// API already lists early-voting sites, which carry their own dates.
export function earlyVotingDates(voterInfo: VoterInfo, stateCode: string | null | undefined) {
  const dates = getEarlyVotingWindow(stateCode, voterInfo.election?.date)
  if (!dates || voterInfo.earlyVoteSites.length > 0) return null
  const phase = earlyVotingPhase(dates, localToday())
  if (!phase || phase.phase === 'ended') return null
  const endLabel = dates.end === dates.electionDate ? 'Election Day' : formatShortDate(dates.end)
  return {
    stateName: getVoterResources(stateCode).name,
    range: `${formatShortDate(dates.start)} – ${endLabel}`,
    open: phase.phase === 'open',
    status:
      phase.phase === 'open' ? `Open now through ${endLabel}` : phase.daysUntil === 1 ? 'Starts tomorrow' : `Starts in ${phase.daysUntil} days`,
    note: dates.note ?? null,
    sourceName: dates.sourceName,
    sourceUrl: dates.sourceUrl,
  }
}

// The always-available links: the state's official lookup, Vote.org and Vote.gov.
export function staticFallback(stateCode: string | null | undefined) {
  const resources = getVoterResources(stateCode)
  const { pollingPlaceUrl, registrationStatusUrl } = resources
  const samePage = Boolean(pollingPlaceUrl && pollingPlaceUrl === registrationStatusUrl)
  const portalHosts = [
    ...new Set(
      [pollingPlaceUrl, samePage ? undefined : registrationStatusUrl]
        .map(unfamiliarPortalHost)
        .filter((host): host is string => Boolean(host)),
    ),
  ]
  const links = [
    pollingPlaceUrl
      ? {
          label: `${samePage ? 'Find Polling Place & Check Registration' : 'Find Your Polling Place'} (Official)`,
          url: pollingPlaceUrl,
          primary: true,
        }
      : null,
    registrationStatusUrl && !samePage ? { label: 'Check Registration (Official)', url: registrationStatusUrl, primary: false } : null,
    { label: `Register to Vote in ${resources.name} (Vote.org)`, url: resources.registerUrl, primary: !pollingPlaceUrl },
    !registrationStatusUrl ? { label: 'Check Registration (Vote.org)', url: resources.checkRegistrationUrl, primary: false } : null,
    { label: 'Federal Guide (Vote.gov)', url: resources.voteGovUrl, primary: false },
  ].filter((link): link is { label: string; url: string; primary: boolean } => link !== null)

  return {
    title: `Voter Resources for ${resources.name}`,
    intro: pollingPlaceUrl
      ? `Find your polling place or check your registration on ${resources.name}'s official election site, or register through Vote.org:`
      : 'Register, check your registration status, or find your state election office:',
    links,
    // Split so the host can be emphasized.
    portalNote:
      portalHosts.length > 0
        ? {
            lead: `The official ${portalHosts.length > 1 ? 'links open' : 'link opens'} ${resources.name}'s voter portal at `,
            hosts: portalHosts.join(' and '),
            tail: `, the address ${resources.name}'s election office uses for it, so it won't look like a .gov site.`,
          }
        : null,
  }
}

// The election offices to contact, local first.
export function electionOffices(adminBodies?: AdminBodies | null): { body: AdminBody; role: string }[] {
  return [
    adminBodies?.local ? { body: adminBodies.local, role: 'Your local election office' } : null,
    adminBodies?.state ? { body: adminBodies.state, role: 'State election office' } : null,
  ].filter((office): office is { body: AdminBody; role: string } => office !== null)
}
