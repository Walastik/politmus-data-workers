// What Happening Now shows and says, shared by the web and native screens.

import { parseIsoDate } from './calendar'
import { daysUntil } from './feed'
import { formatShortDate, type EarlyVotingInfo, type EarlyVotingPhase } from './earlyVoting'
import { getVoterResources, type CivicLookup, type Race, type RaceCandidate, type VoterInfo, type VoterLocation } from './types'
import { closingTimeOn } from './pollingHours'
import { rankSites, type Point, type RankedSite } from './votingSites'

// Within this many days of Election Day the page is about the election; before
// that it leads with what Congress has been doing.
export const ELECTION_FOCUS_DAYS = 60
export const CLOSEST_SITES_SHOWN = 3
// Candidates per race before "Show all", while the ballot isn't confirmed and a
// race can still list a dozen primary candidates.
export const UNCONFIRMED_CANDIDATES_SHOWN = 6
export const FEED_PREVIEW_SIZE = 5

export function isElectionFocus(daysToElection: number | null): boolean {
  return daysToElection !== null && daysToElection >= 0 && daysToElection <= ELECTION_FOCUS_DAYS
}

// The House district from the lookup's divisions (".../cd:7"; 0 is at-large).
export function houseDistrict(lookup: CivicLookup | null): number | null {
  for (const division of lookup?.divisions ?? []) {
    const match = /\/cd:(\d+)$/.exec(division.ocd_id)
    if (match) return Number(match[1])
  }
  return null
}

// "TX-7", or "AK-AL" for an at-large seat.
export function districtLabel(stateCode: string | null, district: number | null): string | null {
  if (district === null || !stateCode) return null
  return `${stateCode}-${district === 0 ? 'AL' : district}`
}

export function errorMessage(err: unknown, fallback: string) {
  return err instanceof Error && err.message ? err.message : fallback
}

// The election hero's headline and line under it, from where early voting stands.
export function electionHeadline({
  window,
  phase,
  stateName,
  openStateCount,
  electionName,
  electionDay = false,
  pollsClose = null,
}: {
  window: EarlyVotingInfo | null
  phase: EarlyVotingPhase | null
  stateName: string | null
  // States with early voting open, when we don't know the visitor's state.
  openStateCount: number
  electionName: string | null
  // Today is Election Day.
  electionDay?: boolean
  // When the visitor's closest polling place closes, once their sites load.
  pollsClose?: PollsClose | null
}): { headline: string; detail: string | null; endLabel: string | null } {
  const endLabel = window ? (window.end === window.electionDate ? 'Election Day' : formatShortDate(window.end)) : null
  const daysLeft = window ? daysUntil(window.end) : null

  if (electionDay) {
    return {
      headline: 'Today is Election Day!',
      detail: pollsClose
        ? `Your closest polling place closes at ${formatClockTime(pollsClose.at)}. If you’re in line by then, you can still vote.`
        : stateName
          ? 'Get out and vote before your polling place closes tonight. If you’re in line when polls close, you can still vote.'
          : 'Get out and vote before polls close tonight. Add your address to find your polling place and when it closes.',
      endLabel,
    }
  }

  if (window && phase?.phase === 'open') {
    return {
      headline: `Early voting is open in ${stateName}`,
      detail: `Vote in person any day through ${endLabel}${
        daysLeft === 0 ? ' (today is the last day)' : daysLeft !== null ? ` · ${daysLeft + 1} days left` : ''
      }.`,
      endLabel,
    }
  }
  if (window && phase?.phase === 'upcoming') {
    return {
      headline: `Early voting in ${stateName} starts ${formatShortDate(window.start)}`,
      detail: phase.daysUntil === 1 ? 'That’s tomorrow.' : `That’s in ${phase.daysUntil} days.`,
      endLabel,
    }
  }
  if (window && phase?.phase === 'ended') {
    return {
      headline: `Early voting in ${stateName} has ended`,
      detail: 'You can still vote at your polling place on Election Day.',
      endLabel,
    }
  }
  if (openStateCount > 0) {
    return {
      headline: `Early voting is open in ${openStateCount} states`,
      detail: 'Add your address to see your dates, closest voting sites and who is on your ballot.',
      endLabel,
    }
  }
  return { headline: electionName ?? 'Election Day is coming up', detail: null, endLabel }
}

export interface PollsClose {
  at: Date
  siteName: string | null
}

// When the visitor's closest Election Day polling place closes today, from its
// posted hours. The hours are read on the viewer's clock, which matches the
// site's for anyone looking up their own address.
export function pollsCloseFor(
  data: VoterInfo | null,
  point: Point | null,
  electionDate: string | null,
): PollsClose | null {
  const day = parseIsoDate(electionDate)
  if (!data || !electionDate || !day) return null
  // Polling places first; vote centers listed as early sites only count when
  // their hours name Election Day.
  const candidates = [
    ...rankSites(data.pollingLocations, point).map((site) => ({ site, requireDate: false })),
    ...rankSites(data.earlyVoteSites, point).map((site) => ({ site, requireDate: true })),
  ]
  for (const { site, requireDate } of candidates) {
    const hours = site.location.pollingHours
    const close = hours ? closingTimeOn(hours, electionDate, { requireDate }) : null
    if (close) {
      return {
        at: new Date(day.year, day.month - 1, day.day, close.hour, close.minute),
        siteName: site.location.locationName,
      }
    }
  }
  return null
}

// "7 pm", "7:30 pm"
export function formatClockTime(at: Date): string {
  const hour = at.getHours()
  const minute = at.getMinutes()
  if (hour === 0 && minute === 0) return 'midnight'
  const suffix = hour < 12 ? 'am' : 'pm'
  const h12 = hour % 12 === 0 ? 12 : hour % 12
  return minute === 0 ? `${h12} ${suffix}` : `${h12}:${String(minute).padStart(2, '0')} ${suffix}`
}

// "2h 05m 09s", "5m 09s", or null once the time has passed.
export function formatCountdown(ms: number): string | null {
  if (ms <= 0) return null
  const total = Math.floor(ms / 1000)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return hours > 0 ? `${hours}h ${pad(minutes)}m ${pad(seconds)}s` : `${minutes}m ${pad(seconds)}s`
}

export function daysAwayLabel(days: number | null): string | null {
  if (days === null || days < 0) return null
  return days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : `${days} days away`
}

export interface VotingSitesView {
  kind: 'early' | 'polling'
  title: string
  ranked: RankedSite[]
  shown: RankedSite[]
  // True when the sites are ordered by distance from the visitor.
  sorted: boolean
  totalSites: number
}

// Early voting sites while early voting is on (or ahead); Election Day
// polling places once it's over, on Election Day, or when no early sites are listed.
export function votingSitesView(
  data: VoterInfo | null,
  phase: EarlyVotingPhase | null,
  point: { lat: number; lon: number } | null,
  electionDay = false,
): VotingSitesView {
  const preferEarly = phase?.phase !== 'ended' && !electionDay
  const early = data?.earlyVoteSites ?? []
  const polling = data?.pollingLocations ?? []
  const [kind, locations]: ['early' | 'polling', VoterLocation[]] =
    preferEarly && early.length > 0 ? ['early', early] : polling.length > 0 ? ['polling', polling] : ['early', early]
  const ranked = rankSites(locations, point)
  const shown = ranked.slice(0, CLOSEST_SITES_SHOWN)
  const sorted = shown.some((site) => site.miles !== null)
  const base = kind === 'early' ? 'Early voting sites' : 'Election Day polling places'
  return {
    kind,
    title: sorted ? `Closest ${base.toLowerCase()}` : base,
    ranked,
    shown,
    sorted,
    totalSites: early.length + polling.length + (data?.dropOffLocations.length ?? 0),
  }
}

// The line under the site list: how it's ordered and how many more there are.
export function moreSitesNote(view: VotingSitesView): string | null {
  const { ranked, shown, sorted, kind } = view
  if (ranked.length <= shown.length) return null
  return sorted
    ? `By straight-line distance from your address. ${ranked.length - shown.length} more ${
        kind === 'early' ? 'early voting sites' : 'polling places'
      } nearby.`
    : `Showing ${shown.length} of ${ranked.length}.`
}

// Why there are no sites to show, for a loaded VoterInfo with none.
export function noSitesMessage(data: VoterInfo | null, stateCode: string | null): string {
  const resources = getVoterResources(stateCode)
  return data?.mailOnly
    ? `${resources.name} votes by mail. Return your ballot by mail or at a drop-off site.`
    : `${resources.name} hasn’t published voting sites for your address to Google yet.`
}

// The visitor's federal races: both Senate seats and their House district.
export function ballotRacesFor(races: Race[], district: number | null): Race[] {
  return races.filter((race) => race.office === 'S' || (race.office === 'H' && race.district === district))
}

export function ballotUrlFrom(voterInfo: VoterInfo | null): string | null {
  return voterInfo?.adminBodies.local?.ballotInfoUrl ?? voterInfo?.adminBodies.state?.ballotInfoUrl ?? null
}

// FEC sometimes lists one campaign under two candidate IDs; show it once.
export function uniqueCandidates(race: Race): RaceCandidate[] {
  const seen = new Set<string>()
  return race.candidates.filter((candidate) => {
    const key = `${(candidate.name ?? candidate.fec_candidate_id).toLowerCase()}|${candidate.party ?? ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

// Shown on any race whose list we can't vouch for as the whole ballot.
export function incompleteRaceReason(race: Race): string {
  return race.ballot_source
    ? 'We’ve confirmed the major-party nominees, but independent and third-party candidates come from news coverage and FEC filings, so some may be missing.'
    : 'We haven’t confirmed this race’s nominees yet. This list comes from FEC filings, so it can include candidates who lost a primary and leave out candidates who haven’t filed with the FEC.'
}

// Occupations too generic to tell a voter anything.
const GENERIC_BACKGROUND = new Set(['politician'])

export function candidateBackground(candidate: RaceCandidate): string[] {
  return (candidate.background ?? [])
    .filter((item) => !GENERIC_BACKGROUND.has(item.toLowerCase()))
    .slice(0, 2)
    .map((item) => item.charAt(0).toUpperCase() + item.slice(1))
}

// Official links for the visitor's election office, best source first.
export function beforeYouVoteLinks(voterInfo: VoterInfo | null, stateCode: string | null) {
  const resources = getVoterResources(stateCode)
  const local = voterInfo?.adminBodies.local
  const state = voterInfo?.adminBodies.state
  const links = [
    {
      label: 'Check that you’re registered',
      url:
        local?.electionRegistrationConfirmationUrl ??
        state?.electionRegistrationConfirmationUrl ??
        resources.registrationStatusUrl ??
        resources.checkRegistrationUrl,
    },
    { label: 'See your sample ballot', url: local?.ballotInfoUrl ?? state?.ballotInfoUrl ?? null },
    {
      label: 'Official polling place lookup',
      url: local?.votingLocationFinderUrl ?? state?.votingLocationFinderUrl ?? resources.pollingPlaceUrl ?? null,
    },
    { label: 'Voting by mail', url: local?.absenteeVotingInfoUrl ?? state?.absenteeVotingInfoUrl ?? null },
  ].filter((link): link is { label: string; url: string } => Boolean(link.url))
  return { links, office: local ?? state ?? null }
}
