// The Candidates page: everyone running for Congress this cycle, by race.
// Shared by the web page and the native screen.

import { formatCompactMoney } from './campaignFinance'
import { formatBillDate, incumbencyLabel, type Race, type RaceCandidate, type RacesPage } from './types'

export const CANDIDATES_PAGE_SIZE = 20

export const OFFICE_FILTERS = [
  { value: '', label: 'All' },
  { value: 'S', label: 'Senate' },
  { value: 'H', label: 'House' },
] as const

export interface RaceFilters {
  // Two-letter code.
  state: string
  office: string
  party: string
  query: string
  showAll: boolean
}

export const DEFAULT_RACE_FILTERS: RaceFilters = { state: '', office: '', party: '', query: '', showAll: false }

export function racesPath(filters: Partial<RaceFilters>, limit: number) {
  const params = new URLSearchParams({ limit: String(limit) })
  if (filters.state) params.set('state', filters.state)
  if (filters.office) params.set('office', filters.office)
  if (filters.party) params.set('party', filters.party)
  if (filters.query) params.set('q', filters.query)
  if (filters.showAll) params.set('all', 'true')
  return `/api/candidates/races?${params.toString()}`
}

// "34 races · General election Nov 3, 2026 · Most expensive first"
export function racesSummary(page: RacesPage, filteredByState: boolean) {
  const races = page.items ?? []
  const electionDate = races[0] ? formatBillDate(races[0].election_date) : null
  return `${page.total_count} race${page.total_count === 1 ? '' : 's'}${electionDate ? ` · General election ${electionDate}` : ''}${
    filteredByState ? '' : ' · Most expensive first'
  }`
}

// Where the lists come from, and whether they are the November ballot yet.
export function racesSourceNote(page: RacesPage) {
  const races = page.items ?? []
  const awaitingBallot = races.some((race) => !race.ballot_filtered)
  // States whose November ballot comes from services/ballot_nominees.py, not FEC.
  const curated = [...new Map(races.filter((race) => race.ballot_source).map((race) => [race.state_name, race.ballot_source]))]
  return `Source: ${page.source}. ${
    awaitingBallot
      ? 'FEC does not record primary results, so until pre-general reports are in, races list everyone who raised at least $5,000, including candidates who lost a primary.'
      : 'Races list the campaigns that filed a pre-general report, the ones on the November ballot.'
  }${curated.map(([state, source]) => ` ${state} races list the November nominees (${source}).`).join('')}`
}

export function raceRaisedLine(race: Race) {
  return `${formatCompactMoney(race.total_receipts)} raised by ${race.candidates.length} candidate${race.candidates.length === 1 ? '' : 's'}`
}

// Why some filers in a race aren't listed.
export function hiddenFilersNote(race: Race): string | null {
  if (race.hidden_count <= 0) return null
  return `${race.hidden_count} more filer${race.hidden_count === 1 ? '' : 's'} not shown${
    race.ballot_source
      ? ': not on the November ballot.'
      : race.ballot_filtered
        ? ': no pre-general report, so not on the November ballot.'
        : ': raised under $5,000.'
  }`
}

export type CandidateTagTone = 'amber' | 'emerald' | 'slate'

export const CANDIDATE_TAG_TONES: Record<CandidateTagTone, string> = {
  amber: 'border-amber-500/40 bg-amber-900/30 text-amber-200',
  emerald: 'border-emerald-500/40 bg-emerald-900/30 text-emerald-200',
  slate: 'border-slate-600 bg-slate-900/60 text-slate-300',
}

// Incumbent / In Congress / On Nov. ballot. The ballot tag only matters while
// a race still lists candidates who may have lost a primary.
export function candidateTags(candidate: RaceCandidate, showBallot: boolean): { label: string; tone: CandidateTagTone }[] {
  const incumbent = incumbencyLabel(candidate.incumbent_challenge) === 'Incumbent'
  return [
    incumbent ? { label: 'Incumbent', tone: 'amber' as const } : null,
    candidate.current_member && !incumbent ? { label: 'In Congress', tone: 'slate' as const } : null,
    showBallot && candidate.in_general_election ? { label: 'On Nov. ballot', tone: 'emerald' as const } : null,
  ].filter((tag): tag is { label: string; tone: CandidateTagTone } => tag !== null)
}

// Each candidate's money as a share of the race's top fundraiser.
export function raceReceiptShares(race: Race) {
  const top = Math.max(...race.candidates.map((candidate) => candidate.receipts ?? 0), 1)
  return (candidate: RaceCandidate) => (candidate.receipts ?? 0) / top
}
