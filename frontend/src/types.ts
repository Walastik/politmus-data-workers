export interface Official {
  id: string
  name: string
  state: string
  party: string
  office: string | null
  district: number | null
  current_member: boolean
  phone: string | null
  office_address: string | null
  website_url: string | null
  level?: string | null
  openstates_id?: string | null
  positions_status?: PositionsStatus | null
  positions_count?: number | null
}

export type PositionsStatus =
  | 'ok'
  | 'no_positions'
  | 'no_issue_pages'
  | 'blocked'
  | 'needs_js'
  | 'thin_site'
  | 'no_website'
  | 'failed'

export interface OfficialStance {
  issue_label: string | null
  policy_area: string | null
  target_name: string | null
  mechanism: 'funding' | 'regulation' | 'oversight' | 'taxation' | string
  direction: 'increase' | 'decrease' | 'maintain' | 'mixed' | string
  stance: 'supports' | 'opposes' | string | null
  policy_direction: string | null
  emphasis: 'low' | 'medium' | 'high' | string | null
  summary: string | null
  evidence_quote: string | null
  source_url: string | null
  source_type: string
  extracted_at: string | null
  extractor_version?: string | null
  model?: string | null
}

export interface PositionsSync {
  status: PositionsStatus | string
  last_attempt_at: string | null
  last_success_at: string | null
  attempts: number
  pages_found: number | null
  stances_saved: number | null
  last_error: string | null
  extractor_version: string | null
}

export interface PositionsProgressItem {
  official_id: string
  name: string | null
  state: string | null
  party: string | null
  office: string | null
  district: number | null
  status: PositionsStatus | string
  stances_saved: number | null
  pages_found: number | null
  last_attempt_at: string | null
  last_error: string | null
}

export interface PositionsProgress {
  population: number
  attempted: number
  by_status: Partial<Record<PositionsStatus, number>> & Record<string, number>
  not_attempted: number
  stances_total: number
  last_success_at: string | null
  current_versions: { extractor_version: string | null; count: number }[]
  recent: PositionsProgressItem[]
  problems: PositionsProgressItem[]
}

export interface OfficialVote {
  bill_id: string
  bill_title: string | null
  bill_summary: string | null
  position: string | null
  sponsor_name: string | null
  roll_call_id?: number | null
  chamber?: string | null
  question?: string | null
  result?: string | null
  date?: string | null
}

export interface OfficialDetail extends Official {
  votes: OfficialVote[]
  stated_positions: OfficialStance[]
  positions_sync: PositionsSync | null
}

export interface ChamberVoteSummary {
  Yes?: number
  No?: number
  Present?: number
  'Not Voting'?: number
  [position: string]: number | undefined
}

export interface BillVoteSummary {
  house: ChamberVoteSummary
  senate: ChamberVoteSummary
}

export interface BillVotePartySummary {
  house: Record<string, ChamberVoteSummary>
  senate: Record<string, ChamberVoteSummary>
}

export type VoteChamber = 'house' | 'senate'

export type BillStatus =
  | 'Became Law'
  | 'Vetoed'
  | 'Failed'
  | 'To President / Governor'
  | 'Passed Both Chambers'
  | 'Passed Senate'
  | 'Passed House'
  | 'Introduced'

export type VelocityBucket =
  | 'very_fast'
  | 'fast'
  | 'average'
  | 'slow'
  | 'very_slow'

export interface BillVoter {
  official_id: string
  name: string
  position: string | null
}

export interface BillRollCall {
  id: number
  chamber: string
  date: string | null
  question: string | null
  result: string | null
  requires: string | null
  source_roll_call_id: string
}

export interface ClassificationIntent {
  target: string
  mechanism: 'funding' | 'regulation' | 'oversight' | 'taxation' | string
  direction: 'increase' | 'decrease' | 'maintain' | 'mixed' | string
  magnitude: 'low' | 'medium' | 'high' | string
  rationale?: string
  citation?: string
}

export interface ClassificationMetadata {
  tldr?: string | null
  eli5?: string | null
  intents?: ClassificationIntent[]
  [key: string]: unknown
}

export interface Bill {
  id: string
  title: string | null
  sponsor_id: string | null
  sponsor_bioguide_id: string | null
  sponsor_name: string | null
  sponsor_party: string | null
  cosponsor_party_breakdown: Record<string, number> | null
  bipartisan_type: 'single_party' | 'bipartisan' | 'tripartisan' | null
  policy_area: string | null
  summary: string | null
  introduced_date: string | null
  voted_date: string | null
  days_to_vote: number | null
  velocity_bucket: VelocityBucket | null
  latest_action_date?: string | null
  latest_action_text?: string | null
  status?: BillStatus | null
  level?: string | null
  classification_metadata?: ClassificationMetadata | null
  classification_model?: string | null
  votes_summary: BillVoteSummary
  votes_by_party?: BillVotePartySummary
  roll_calls?: BillRollCall[]
}

export interface CivicAddress {
  line1: string | null
  line2: string | null
  line3: string | null
  city: string | null
  state: string | null
  zip: string | null
}

export interface CivicDivision {
  ocd_id: string
  name: string
}

export interface CivicRepresentative {
  id: string | null
  name: string
  office: string
  division_id: string | null
  division_name: string | null
  party: string | null
  levels: string[]
  roles: string[]
  phones: string[]
  emails: string[]
  urls: string[]
  photo_url: string | null
  addresses: CivicAddress[]
  channels: { type: string | null; id: string | null }[]
}

export interface CivicLookup {
  normalized_input: CivicAddress | null
  divisions: CivicDivision[]
  representatives: CivicRepresentative[]
}

export const PARTY_FILTERS = [
  { value: '', label: 'All' },
  { value: 'D', label: 'D' },
  { value: 'R', label: 'R' },
  { value: 'I', label: 'I' },
] as const

export const ROSTER_STATUS_FILTERS = [
  { value: 'active', label: 'Active' },
  { value: 'former', label: 'Former' },
  { value: 'all', label: 'All' },
] as const

export type RosterStatusFilter = (typeof ROSTER_STATUS_FILTERS)[number]['value']

export const STATE_OPTIONS = [
  { abbr: 'AL', name: 'Alabama' },
  { abbr: 'AK', name: 'Alaska' },
  { abbr: 'AZ', name: 'Arizona' },
  { abbr: 'AR', name: 'Arkansas' },
  { abbr: 'CA', name: 'California' },
  { abbr: 'CO', name: 'Colorado' },
  { abbr: 'CT', name: 'Connecticut' },
  { abbr: 'DE', name: 'Delaware' },
  { abbr: 'DC', name: 'District of Columbia' },
  { abbr: 'FL', name: 'Florida' },
  { abbr: 'GA', name: 'Georgia' },
  { abbr: 'HI', name: 'Hawaii' },
  { abbr: 'ID', name: 'Idaho' },
  { abbr: 'IL', name: 'Illinois' },
  { abbr: 'IN', name: 'Indiana' },
  { abbr: 'IA', name: 'Iowa' },
  { abbr: 'KS', name: 'Kansas' },
  { abbr: 'KY', name: 'Kentucky' },
  { abbr: 'LA', name: 'Louisiana' },
  { abbr: 'ME', name: 'Maine' },
  { abbr: 'MD', name: 'Maryland' },
  { abbr: 'MA', name: 'Massachusetts' },
  { abbr: 'MI', name: 'Michigan' },
  { abbr: 'MN', name: 'Minnesota' },
  { abbr: 'MS', name: 'Mississippi' },
  { abbr: 'MO', name: 'Missouri' },
  { abbr: 'MT', name: 'Montana' },
  { abbr: 'NE', name: 'Nebraska' },
  { abbr: 'NV', name: 'Nevada' },
  { abbr: 'NH', name: 'New Hampshire' },
  { abbr: 'NJ', name: 'New Jersey' },
  { abbr: 'NM', name: 'New Mexico' },
  { abbr: 'NY', name: 'New York' },
  { abbr: 'NC', name: 'North Carolina' },
  { abbr: 'ND', name: 'North Dakota' },
  { abbr: 'OH', name: 'Ohio' },
  { abbr: 'OK', name: 'Oklahoma' },
  { abbr: 'OR', name: 'Oregon' },
  { abbr: 'PA', name: 'Pennsylvania' },
  { abbr: 'RI', name: 'Rhode Island' },
  { abbr: 'SC', name: 'South Carolina' },
  { abbr: 'SD', name: 'South Dakota' },
  { abbr: 'TN', name: 'Tennessee' },
  { abbr: 'TX', name: 'Texas' },
  { abbr: 'UT', name: 'Utah' },
  { abbr: 'VT', name: 'Vermont' },
  { abbr: 'VA', name: 'Virginia' },
  { abbr: 'WA', name: 'Washington' },
  { abbr: 'WV', name: 'West Virginia' },
  { abbr: 'WI', name: 'Wisconsin' },
  { abbr: 'WY', name: 'Wyoming' },
  { abbr: 'AS', name: 'American Samoa' },
  { abbr: 'GU', name: 'Guam' },
  { abbr: 'MP', name: 'Northern Mariana Islands' },
  { abbr: 'PR', name: 'Puerto Rico' },
  { abbr: 'VI', name: 'Virgin Islands' },
] as const

export function partyBadgeClass(party: string) {
  if (party === 'Democratic' || party === 'D') {
    return 'bg-blue-900/60 text-blue-300'
  }
  if (party === 'Republican' || party === 'R') {
    return 'bg-red-900/60 text-red-300'
  }
  return 'bg-emerald-900/60 text-emerald-300'
}

export function partyShort(party: string) {
  if (party === 'Democratic') return 'D'
  if (party === 'Republican') return 'R'
  if (party === 'Independent') return 'I'
  if (party === 'Libertarian') return 'L'
  if (party === 'Unknown') return '?'
  return party
}

const PARTY_DISPLAY_ORDER = [
  'Democratic',
  'Republican',
  'Independent',
  'Libertarian',
]

export function sortParties(parties: Iterable<string>) {
  return [...parties].sort((a, b) => {
    const aIndex = PARTY_DISPLAY_ORDER.indexOf(a)
    const bIndex = PARTY_DISPLAY_ORDER.indexOf(b)
    if (aIndex === -1 && bIndex === -1) {
      return a.localeCompare(b)
    }
    if (aIndex === -1) {
      return 1
    }
    if (bIndex === -1) {
      return -1
    }
    return aIndex - bIndex
  })
}

export function involvedParties(
  sponsorParty: string | null | undefined,
  breakdown: Record<string, number> | null | undefined,
) {
  const parties = new Set<string>()
  if (sponsorParty) {
    parties.add(sponsorParty)
  }
  for (const [party, count] of Object.entries(breakdown || {})) {
    if (count > 0) {
      parties.add(party)
    }
  }
  return sortParties(parties)
}

export function bipartisanTypeFromParties(
  parties: string[],
): Bill['bipartisan_type'] {
  if (parties.length >= 3) return 'tripartisan'
  if (parties.length === 2) return 'bipartisan'
  if (parties.length === 1) return 'single_party'
  return null
}

export function bipartisanTypeLabel(
  type: Bill['bipartisan_type'],
  parties: string[] = [],
) {
  if (type === 'single_party') {
    const party = parties[0]
    return party ? `Single party ${partyShort(party)}` : 'Single party'
  }
  if (type === 'bipartisan') {
    const shorts = parties.map(partyShort)
    return shorts.length ? `Bipartisan ${shorts.join('/')}` : 'Bipartisan'
  }
  if (type === 'tripartisan') return 'Tripartisan'
  return null
}

export function voteShort(position: string | null | undefined) {
  if (position === 'Yes') return 'Y'
  if (position === 'No') return 'N'
  if (position === 'Present') return 'P'
  if (position === 'Not Voting') return 'NV'
  return position || '—'
}

export function voteTextClass(position: string | null | undefined) {
  if (position === 'Yes') return 'text-emerald-400'
  if (position === 'No') return 'text-red-400'
  if (position === 'Present') return 'text-amber-400'
  return 'text-slate-400'
}

export function formatCosponsorBreakdown(
  breakdown: Record<string, number> | null | undefined,
) {
  if (!breakdown) {
    return null
  }
  const parts = Object.entries(breakdown)
    .filter(([, count]) => count > 0)
    .map(([party, count]) => `${partyShort(party)} ${count}`)
  return parts.length ? parts.join(' · ') : 'No cosponsors'
}

// Placeholder records for drawers opened from a URL id alone; the drawer's own
// detail fetch fills in the rest.
export function officialStub(id: string): Official {
  return {
    id,
    name: '',
    state: '',
    party: '',
    office: null,
    district: null,
    current_member: true,
    phone: null,
    office_address: null,
    website_url: null,
  }
}

export function billStub(id: string): Bill {
  return {
    id,
    title: null,
    sponsor_id: null,
    sponsor_bioguide_id: null,
    sponsor_name: null,
    sponsor_party: null,
    cosponsor_party_breakdown: null,
    bipartisan_type: null,
    policy_area: null,
    summary: null,
    introduced_date: null,
    voted_date: null,
    days_to_vote: null,
    velocity_bucket: null,
    latest_action_date: null,
    latest_action_text: null,
    status: null,
    level: 'federal',
    votes_summary: { house: {}, senate: {} },
    votes_by_party: { house: {}, senate: {} },
    roll_calls: [],
  }
}

export function rosterStatusLabel(official: Official) {
  return official.current_member ? 'Active' : 'Former'
}

export function formatBillDate(value: string | null | undefined) {
  if (!value) {
    return null
  }
  const parsed = new Date(`${value.slice(0, 10)}T00:00:00`)
  if (Number.isNaN(parsed.getTime())) {
    return null
  }
  return parsed.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function billStatusClass(status: BillStatus | string | null | undefined) {
  if (status === 'Became Law' || status === 'Passed Both Chambers') {
    return 'bg-emerald-900/50 text-emerald-300'
  }
  if (status === 'Vetoed' || status === 'Failed') {
    return 'bg-red-900/50 text-red-300'
  }
  if (status === 'To President / Governor') {
    return 'bg-amber-900/50 text-amber-300'
  }
  if (status === 'Passed House' || status === 'Passed Senate') {
    return 'bg-blue-900/50 text-blue-300'
  }
  return 'bg-slate-700/80 text-slate-300'
}

const VELOCITY_DISPLAY: Record<
  VelocityBucket,
  { emoji: string; label: string }
> = {
  very_fast: { emoji: '🚀', label: 'Very fast' },
  fast: { emoji: '🏃', label: 'Fast' },
  average: { emoji: '🚶', label: 'Average' },
  slow: { emoji: '🐢', label: 'Slow' },
  very_slow: { emoji: '🐌', label: 'Very slow' },
}

export function velocityDisplay(bucket: VelocityBucket | null | undefined) {
  if (!bucket) {
    return null
  }
  return VELOCITY_DISPLAY[bucket] ?? null
}

export function formatVoteVelocity(
  days: number | null | undefined,
  bucket: VelocityBucket | null | undefined,
) {
  const display = velocityDisplay(bucket)
  if (days == null || !display) {
    return null
  }
  const unit = days === 1 || days === -1 ? 'day' : 'days'
  return {
    emoji: display.emoji,
    label: display.label,
    days,
    text: `${display.emoji} ${days} ${unit}`,
  }
}

export function sanitizeCrsHtml(html: string) {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
}

export function positionBadgeClass(position: string | null) {
  if (position === 'Yes') return 'bg-emerald-900/60 text-emerald-300'
  if (position === 'No') return 'bg-red-900/60 text-red-300'
  if (position === 'Present') return 'bg-amber-900/60 text-amber-300'
  return 'bg-slate-700 text-slate-300'
}

// Congress.gov stores names inverted ("Adams, Alma S.", "Bishop, Sanford D., Jr.").
// Shows them first name first ("Alma S. Adams", "Sanford D. Bishop Jr."); names
// without a comma are already in display order and pass through.
export function displayName(name: string) {
  const [last, first, ...suffixes] = name.split(',').map((part) => part.trim())
  if (!first) {
    return name.trim()
  }
  return [first, last, ...suffixes].filter(Boolean).join(' ')
}

export function officeLine(official: Official) {
  const office = official.office || 'Member of Congress'
  const seat = seatLabel(official)
  return seat ? `${office} · ${seat}` : office
}

export function seatLabel(official: Official) {
  if (official.office === 'Senator' || official.office === 'Governor') {
    return 'Statewide'
  }
  if (
    official.office === 'Representative' ||
    official.office === 'Delegate' ||
    official.office === 'Resident Commissioner'
  ) {
    if (official.district == null || official.district === 0) {
      return 'At-large'
    }
    return `District ${official.district}`
  }
  if (official.district == null) {
    return null
  }
  if (official.district === 0) {
    return 'At-large'
  }
  return `District ${official.district}`
}

export function stateNameFromAbbr(abbr: string | null | undefined) {
  if (!abbr) {
    return ''
  }
  const found = STATE_OPTIONS.find((state) => state.abbr === abbr.toUpperCase())
  return found?.name ?? abbr
}

// Two-letter code for a state given by name or code, or null if unrecognized.
export function stateAbbr(state: string | null | undefined) {
  const value = state?.trim().toUpperCase()
  if (!value) {
    return null
  }
  const found = STATE_OPTIONS.find(
    (option) => option.abbr === value || option.name.toUpperCase() === value,
  )
  return found?.abbr ?? null
}

export function formatCivicAddress(address: CivicAddress | null | undefined) {
  if (!address) {
    return null
  }
  const line1 = [address.line1, address.line2, address.line3]
    .filter(Boolean)
    .join(', ')
  const cityLine = [address.city, address.state, address.zip]
    .filter(Boolean)
    .join(' ')
  const parts = [line1, cityLine].filter(Boolean)
  return parts.length ? parts.join(', ') : null
}

function officeKey(rep: CivicRepresentative) {
  return (rep.office || '').trim().toLowerCase()
}

export function isCivicStateLevel(rep: CivicRepresentative) {
  return rep.levels.includes('administrativeArea1')
}

export function isCivicPresident(rep: CivicRepresentative) {
  const office = officeKey(rep)
  return (
    office.includes('president of the united states') ||
    office === 'president' ||
    office.includes('vice president')
  )
}

export function isCivicSenator(rep: CivicRepresentative) {
  if (isCivicStateLevel(rep)) {
    return false
  }
  return officeKey(rep) === 'senator' || rep.roles.includes('legislatorUpperBody')
}

export function isCivicHouseMember(rep: CivicRepresentative) {
  if (isCivicStateLevel(rep)) {
    return false
  }
  const office = officeKey(rep)
  return (
    office === 'representative' ||
    office === 'delegate' ||
    office === 'resident commissioner' ||
    rep.roles.includes('legislatorLowerBody')
  )
}

export function isCivicGovernor(rep: CivicRepresentative) {
  if (!isCivicStateLevel(rep)) {
    return false
  }
  return officeKey(rep) === 'governor'
}

export function isCivicStateSenator(rep: CivicRepresentative) {
  if (!isCivicStateLevel(rep) || isCivicGovernor(rep)) {
    return false
  }
  const office = officeKey(rep)
  return (
    office === 'state senator' ||
    office === 'senator' ||
    rep.roles.includes('legislatorUpperBody')
  )
}

export function isCivicStateHouseMember(rep: CivicRepresentative) {
  if (!isCivicStateLevel(rep) || isCivicGovernor(rep)) {
    return false
  }
  const office = officeKey(rep)
  return (
    office === 'state representative' ||
    office === 'representative' ||
    office.includes('assembly') ||
    rep.roles.includes('legislatorLowerBody')
  )
}

export function groupCivicRepresentatives(reps: CivicRepresentative[]) {
  const president: CivicRepresentative[] = []
  const senators: CivicRepresentative[] = []
  const house: CivicRepresentative[] = []
  const governors: CivicRepresentative[] = []
  const stateSenators: CivicRepresentative[] = []
  const stateHouse: CivicRepresentative[] = []
  const other: CivicRepresentative[] = []

  for (const rep of reps) {
    if (isCivicPresident(rep)) {
      president.push(rep)
    } else if (isCivicSenator(rep)) {
      senators.push(rep)
    } else if (isCivicHouseMember(rep)) {
      house.push(rep)
    } else if (isCivicGovernor(rep)) {
      governors.push(rep)
    } else if (isCivicStateSenator(rep)) {
      stateSenators.push(rep)
    } else if (isCivicStateHouseMember(rep)) {
      stateHouse.push(rep)
    } else {
      other.push(rep)
    }
  }

  return { president, senators, house, governors, stateSenators, stateHouse, other }
}

export function civicRepresentativeToOfficial(
  rep: CivicRepresentative,
  state: string,
): Official | null {
  if (!rep.id) {
    return null
  }
  const districtMatch = rep.division_id?.match(/\/(?:cd|sldu|sldl):(\d+)$/)
  const district = districtMatch ? Number(districtMatch[1]) : null
  return {
    id: rep.id,
    name: rep.name,
    state,
    party: rep.party || '',
    office: rep.office,
    district,
    current_member: true,
    phone: rep.phones[0] ?? null,
    office_address: formatCivicAddress(rep.addresses[0]) ?? null,
    website_url: rep.urls[0] ?? null,
    level: isCivicStateLevel(rep) ? 'state' : 'federal',
    openstates_id: isCivicStateLevel(rep) ? rep.id : null,
  }
}

export type VoterUiState =
  | 'live'
  | 'mail_only'
  | 'no_locations_yet'
  | 'no_data_yet'
  | 'nearby_only'
  | 'election_over'
  | 'no_election'
  | 'address_problem'
  | 'unavailable'

export interface VoterSource {
  name: string | null
  official: boolean | null
}

export interface VoterLocation {
  locationName: string | null
  line1: string | null
  city: string | null
  state: string | null
  zip: string | null
  pollingHours: string | null
  startDate: string | null
  endDate: string | null
  notes: string | null
  sources: VoterSource[]
}

export interface AdminBody {
  name: string | null
  electionInfoUrl: string | null
  electionRegistrationUrl: string | null
  electionRegistrationConfirmationUrl: string | null
  absenteeVotingInfoUrl: string | null
  votingLocationFinderUrl: string | null
  ballotInfoUrl: string | null
  hoursOfOperation: string | null
  physicalAddress: CivicAddress | null
  phone: string | null
  email: string | null
}

export interface AdminBodies {
  state: AdminBody | null
  local: AdminBody | null
}

export interface VoterElection {
  id: string
  name: string
  date: string | null
}

export interface VoterInfo {
  uiState: VoterUiState
  upstreamStatus: string
  election: VoterElection | null
  mailOnly: boolean
  pollingLocations: VoterLocation[]
  earlyVoteSites: VoterLocation[]
  dropOffLocations: VoterLocation[]
  adminBodies: AdminBodies
  otherElections: VoterElection[]
  fetchedAt: string
  detail?: string
}

export interface StateVoterResource {
  name: string
  voteGovUrl: string
  checkRegistrationUrl: string
  registerUrl: string
  // Official state election-office pages, from the National Association of
  // Secretaries of State "Can I Vote" directory (nass.org/can-I-vote), checked
  // 2026-10-12. Absent for the nationwide fallback.
  pollingPlaceUrl?: string
  registrationStatusUrl?: string
}

export const STATE_VOTER_RESOURCES: Record<string, StateVoterResource> = {
  AL: {
    name: 'Alabama',
    pollingPlaceUrl: 'https://myinfo.alabamavotes.gov/voterview',
    registrationStatusUrl: 'https://myinfo.alabamavotes.gov/voterview',
    voteGovUrl: 'https://vote.gov',
    checkRegistrationUrl: 'https://www.vote.org/am-i-registered-to-vote/',
    registerUrl: 'https://www.vote.org/register-to-vote/alabama/',
  },
  AK: {
    name: 'Alaska',
    pollingPlaceUrl: 'https://akelections.maps.arcgis.com/apps/webappviewer/index.html?id=579890d66c7e40ae9f7cc227d76669b1',
    registrationStatusUrl: 'https://myvoterportal.alaska.gov/',
    voteGovUrl: 'https://vote.gov',
    checkRegistrationUrl: 'https://www.vote.org/am-i-registered-to-vote/',
    registerUrl: 'https://www.vote.org/register-to-vote/alaska/',
  },
  AZ: {
    name: 'Arizona',
    pollingPlaceUrl: 'https://my.arizona.vote/WhereToVote.aspx?s=address',
    registrationStatusUrl: 'https://my.arizona.vote/WhereToVote.aspx?s=individual',
    voteGovUrl: 'https://vote.gov',
    checkRegistrationUrl: 'https://www.vote.org/am-i-registered-to-vote/',
    registerUrl: 'https://www.vote.org/register-to-vote/arizona/',
  },
  AR: {
    name: 'Arkansas',
    pollingPlaceUrl: 'https://www.voterview.ar-nova.org/',
    registrationStatusUrl: 'https://www.voterview.ar-nova.org/voterview',
    voteGovUrl: 'https://vote.gov',
    checkRegistrationUrl: 'https://www.vote.org/am-i-registered-to-vote/',
    registerUrl: 'https://www.vote.org/register-to-vote/arkansas/',
  },
  CA: {
    name: 'California',
    pollingPlaceUrl: 'https://www.sos.ca.gov/elections/polling-place/',
    registrationStatusUrl: 'https://voterstatus.sos.ca.gov/',
    voteGovUrl: 'https://vote.gov',
    checkRegistrationUrl: 'https://www.vote.org/am-i-registered-to-vote/',
    registerUrl: 'https://www.vote.org/register-to-vote/california/',
  },
  CO: {
    name: 'Colorado',
    pollingPlaceUrl: 'https://www.sos.state.co.us/voter/pages/pub/olvr/findVoterReg.xhtml',
    registrationStatusUrl: 'https://www.sos.state.co.us/voter/pages/pub/olvr/findVoterReg.xhtml',
    voteGovUrl: 'https://vote.gov',
    checkRegistrationUrl: 'https://www.vote.org/am-i-registered-to-vote/',
    registerUrl: 'https://www.vote.org/register-to-vote/colorado/',
  },
  CT: {
    name: 'Connecticut',
    pollingPlaceUrl: 'https://www.dir.ct.gov/sots/LookUp.aspx',
    registrationStatusUrl: 'https://portaldir.ct.gov/sots/LookUp.aspx',
    voteGovUrl: 'https://vote.gov',
    checkRegistrationUrl: 'https://www.vote.org/am-i-registered-to-vote/',
    registerUrl: 'https://www.vote.org/register-to-vote/connecticut/',
  },
  DE: {
    name: 'Delaware',
    pollingPlaceUrl: 'https://ivote.de.gov/voterview',
    registrationStatusUrl: 'https://ivote.de.gov/voterview',
    voteGovUrl: 'https://vote.gov',
    checkRegistrationUrl: 'https://www.vote.org/am-i-registered-to-vote/',
    registerUrl: 'https://www.vote.org/register-to-vote/delaware/',
  },
  DC: {
    name: 'District of Columbia',
    pollingPlaceUrl: 'https://dcboe.org/voters/find-out-where-to-vote/vote-center-locator-tool',
    registrationStatusUrl: 'https://apps.dcboe.org/VRS',
    voteGovUrl: 'https://vote.gov',
    checkRegistrationUrl: 'https://www.vote.org/am-i-registered-to-vote/',
    registerUrl: 'https://www.vote.org/register-to-vote/district-of-columbia/',
  },
  FL: {
    name: 'Florida',
    pollingPlaceUrl: 'https://registration.dos.fl.gov/en/CheckVoterStatus/Index',
    registrationStatusUrl: 'https://registration.elections.myflorida.com/CheckVoterStatus',
    voteGovUrl: 'https://vote.gov',
    checkRegistrationUrl: 'https://www.vote.org/am-i-registered-to-vote/',
    registerUrl: 'https://www.vote.org/register-to-vote/florida/',
  },
  GA: {
    name: 'Georgia',
    pollingPlaceUrl: 'https://mvp.sos.ga.gov/s/',
    registrationStatusUrl: 'https://www.mvp.sos.ga.gov/MVP/mvp.do',
    voteGovUrl: 'https://vote.gov',
    checkRegistrationUrl: 'https://www.vote.org/am-i-registered-to-vote/',
    registerUrl: 'https://www.vote.org/register-to-vote/georgia/',
  },
  HI: {
    name: 'Hawaii',
    pollingPlaceUrl: 'https://elections.hawaii.gov/voting/voting-in-hawaii/',
    registrationStatusUrl: 'https://olvr.hawaii.gov/',
    voteGovUrl: 'https://vote.gov',
    checkRegistrationUrl: 'https://www.vote.org/am-i-registered-to-vote/',
    registerUrl: 'https://www.vote.org/register-to-vote/hawaii/',
  },
  ID: {
    name: 'Idaho',
    pollingPlaceUrl: 'https://elections.sos.idaho.gov/ElectionLink/ElectionLink/ViewPollingLocation.aspx',
    registrationStatusUrl: 'https://elections.sos.idaho.gov/ElectionLink/ElectionLink/VoterSearch.aspx',
    voteGovUrl: 'https://vote.gov',
    checkRegistrationUrl: 'https://www.vote.org/am-i-registered-to-vote/',
    registerUrl: 'https://www.vote.org/register-to-vote/idaho/',
  },
  IL: {
    name: 'Illinois',
    pollingPlaceUrl: 'https://ova.elections.il.gov/PollingPlaceLookup.aspx',
    registrationStatusUrl: 'https://ova.elections.il.gov/RegistrationLookup.aspx',
    voteGovUrl: 'https://vote.gov',
    checkRegistrationUrl: 'https://www.vote.org/am-i-registered-to-vote/',
    registerUrl: 'https://www.vote.org/register-to-vote/illinois/',
  },
  IN: {
    name: 'Indiana',
    pollingPlaceUrl: 'https://indianavoters.in.gov/PublicSite/PublicMain.aspx',
    registrationStatusUrl: 'https://indianavoters.in.gov/',
    voteGovUrl: 'https://vote.gov',
    checkRegistrationUrl: 'https://www.vote.org/am-i-registered-to-vote/',
    registerUrl: 'https://www.vote.org/register-to-vote/indiana/',
  },
  IA: {
    name: 'Iowa',
    pollingPlaceUrl: 'https://sos.iowa.gov/elections/voterreg/pollingplace/search.aspx',
    registrationStatusUrl: 'https://sos.iowa.gov/elections/voterreg/regtovote/search.aspx',
    voteGovUrl: 'https://vote.gov',
    checkRegistrationUrl: 'https://www.vote.org/am-i-registered-to-vote/',
    registerUrl: 'https://www.vote.org/register-to-vote/iowa/',
  },
  KS: {
    name: 'Kansas',
    pollingPlaceUrl: 'https://myvoteinfo.voteks.org/VoterView',
    registrationStatusUrl: 'https://myvoteinfo.voteks.org/VoterView/',
    voteGovUrl: 'https://vote.gov',
    checkRegistrationUrl: 'https://www.vote.org/am-i-registered-to-vote/',
    registerUrl: 'https://www.vote.org/register-to-vote/kansas/',
  },
  KY: {
    name: 'Kentucky',
    pollingPlaceUrl: 'https://vrsws.sos.ky.gov/ovrweb/govoteky',
    registrationStatusUrl: 'https://vrsws.sos.ky.gov/VIC/',
    voteGovUrl: 'https://vote.gov',
    checkRegistrationUrl: 'https://www.vote.org/am-i-registered-to-vote/',
    registerUrl: 'https://www.vote.org/register-to-vote/kentucky/',
  },
  LA: {
    name: 'Louisiana',
    pollingPlaceUrl: 'https://voterportal.sos.la.gov/',
    registrationStatusUrl: 'https://voterportal.sos.la.gov/Home/VoterLogin',
    voteGovUrl: 'https://vote.gov',
    checkRegistrationUrl: 'https://www.vote.org/am-i-registered-to-vote/',
    registerUrl: 'https://www.vote.org/register-to-vote/louisiana/',
  },
  ME: {
    name: 'Maine',
    pollingPlaceUrl: 'https://www.maine.gov/portal/government/edemocracy/voter_lookup.php',
    registrationStatusUrl: 'https://www1.maine.gov/portal/government/edemocracy/voter_lookup.php',
    voteGovUrl: 'https://vote.gov',
    checkRegistrationUrl: 'https://www.vote.org/am-i-registered-to-vote/',
    registerUrl: 'https://www.vote.org/register-to-vote/maine/',
  },
  MD: {
    name: 'Maryland',
    pollingPlaceUrl: 'https://elections.maryland.gov/voting/where.html',
    registrationStatusUrl: 'https://voterservices.elections.maryland.gov/VoterSearch',
    voteGovUrl: 'https://vote.gov',
    checkRegistrationUrl: 'https://www.vote.org/am-i-registered-to-vote/',
    registerUrl: 'https://www.vote.org/register-to-vote/maryland/',
  },
  MA: {
    name: 'Massachusetts',
    pollingPlaceUrl: 'https://www.sec.state.ma.us/WhereDoIVoteMA/WhereDoIVote',
    registrationStatusUrl: 'https://www.sec.state.ma.us/voterregistrationsearch/myvoterregstatus.aspx',
    voteGovUrl: 'https://vote.gov',
    checkRegistrationUrl: 'https://www.vote.org/am-i-registered-to-vote/',
    registerUrl: 'https://www.vote.org/register-to-vote/massachusetts/',
  },
  MI: {
    name: 'Michigan',
    pollingPlaceUrl: 'https://mvic.sos.state.mi.us/Voter/index',
    registrationStatusUrl: 'https://mvic.sos.state.mi.us/Voter/Index',
    voteGovUrl: 'https://vote.gov',
    checkRegistrationUrl: 'https://www.vote.org/am-i-registered-to-vote/',
    registerUrl: 'https://www.vote.org/register-to-vote/michigan/',
  },
  MN: {
    name: 'Minnesota',
    pollingPlaceUrl: 'https://pollfinder.sos.mn.gov/',
    registrationStatusUrl: 'https://mnvotes.sos.mn.gov/voterstatuscheck/index',
    voteGovUrl: 'https://vote.gov',
    checkRegistrationUrl: 'https://www.vote.org/am-i-registered-to-vote/',
    registerUrl: 'https://www.vote.org/register-to-vote/minnesota/',
  },
  MS: {
    name: 'Mississippi',
    pollingPlaceUrl: 'https://myelectionday.sos.state.ms.us/VoterOutreach/Pages/VOSearch.aspx',
    registrationStatusUrl: 'https://www.msegov.com/sos/voter_registration/AmIRegistered',
    voteGovUrl: 'https://vote.gov',
    checkRegistrationUrl: 'https://www.vote.org/am-i-registered-to-vote/',
    registerUrl: 'https://www.vote.org/register-to-vote/mississippi/',
  },
  MO: {
    name: 'Missouri',
    pollingPlaceUrl: 'https://voteroutreach.sos.mo.gov/PRD/VoterOutreach/VOSearch.aspx',
    registrationStatusUrl: 'https://s1.sos.mo.gov/elections/voterlookup/',
    voteGovUrl: 'https://vote.gov',
    checkRegistrationUrl: 'https://www.vote.org/am-i-registered-to-vote/',
    registerUrl: 'https://www.vote.org/register-to-vote/missouri/',
  },
  MT: {
    name: 'Montana',
    pollingPlaceUrl: 'https://app.mt.gov/voterinfo/',
    registrationStatusUrl: 'https://app.mt.gov/voterinfo/',
    voteGovUrl: 'https://vote.gov',
    checkRegistrationUrl: 'https://www.vote.org/am-i-registered-to-vote/',
    registerUrl: 'https://www.vote.org/register-to-vote/montana/',
  },
  NE: {
    name: 'Nebraska',
    pollingPlaceUrl: 'https://www.votercheck.necvr.ne.gov/',
    registrationStatusUrl: 'https://www.votercheck.necvr.ne.gov/VoterView/',
    voteGovUrl: 'https://vote.gov',
    checkRegistrationUrl: 'https://www.vote.org/am-i-registered-to-vote/',
    registerUrl: 'https://www.vote.org/register-to-vote/nebraska/',
  },
  NV: {
    name: 'Nevada',
    pollingPlaceUrl: 'https://nvsos.gov/votersearch/',
    registrationStatusUrl: 'https://www.nvsos.gov/votersearch/',
    voteGovUrl: 'https://vote.gov',
    checkRegistrationUrl: 'https://www.vote.org/am-i-registered-to-vote/',
    registerUrl: 'https://www.vote.org/register-to-vote/nevada/',
  },
  NH: {
    name: 'New Hampshire',
    pollingPlaceUrl: 'https://app.sos.nh.gov/viphome',
    registrationStatusUrl: 'https://app.sos.nh.gov/voterinformation',
    voteGovUrl: 'https://vote.gov',
    checkRegistrationUrl: 'https://www.vote.org/am-i-registered-to-vote/',
    registerUrl: 'https://www.vote.org/register-to-vote/new-hampshire/',
  },
  NJ: {
    name: 'New Jersey',
    pollingPlaceUrl: 'https://www.state.nj.us/state/elections/vote-polling-location.shtml',
    registrationStatusUrl: 'https://voter.svrs.nj.gov/registration-check',
    voteGovUrl: 'https://vote.gov',
    checkRegistrationUrl: 'https://www.vote.org/am-i-registered-to-vote/',
    registerUrl: 'https://www.vote.org/register-to-vote/new-jersey/',
  },
  NM: {
    name: 'New Mexico',
    pollingPlaceUrl: 'https://voterportal.servis.sos.state.nm.us/WhereToVote.aspx',
    registrationStatusUrl: 'https://voterportal.servis.sos.state.nm.us/WhereToVote.aspx',
    voteGovUrl: 'https://vote.gov',
    checkRegistrationUrl: 'https://www.vote.org/am-i-registered-to-vote/',
    registerUrl: 'https://www.vote.org/register-to-vote/new-mexico/',
  },
  NY: {
    name: 'New York',
    pollingPlaceUrl: 'https://voterlookup.elections.ny.gov/',
    registrationStatusUrl: 'https://voterlookup.elections.ny.gov/',
    voteGovUrl: 'https://vote.gov',
    checkRegistrationUrl: 'https://www.vote.org/am-i-registered-to-vote/',
    registerUrl: 'https://www.vote.org/register-to-vote/new-york/',
  },
  NC: {
    name: 'North Carolina',
    pollingPlaceUrl: 'https://vt.ncsbe.gov/PPLkup/',
    registrationStatusUrl: 'https://vt.ncsbe.gov/RegLkup/',
    voteGovUrl: 'https://vote.gov',
    checkRegistrationUrl: 'https://www.vote.org/am-i-registered-to-vote/',
    registerUrl: 'https://www.vote.org/register-to-vote/north-carolina/',
  },
  ND: {
    name: 'North Dakota',
    pollingPlaceUrl: 'https://vip.sos.nd.gov/WhereToVote.aspx?tab=AddressandVotingTimes',
    registrationStatusUrl: 'https://www.sos.nd.gov/elections',
    voteGovUrl: 'https://vote.gov',
    checkRegistrationUrl: 'https://www.vote.org/am-i-registered-to-vote/',
    registerUrl: 'https://www.vote.org/register-to-vote/north-dakota/',
  },
  OH: {
    name: 'Ohio',
    pollingPlaceUrl: 'https://www.ohiosos.gov/directories/find-my-polling-location',
    registrationStatusUrl: 'https://voterlookup.ohiosos.gov/voterlookup.aspx',
    voteGovUrl: 'https://vote.gov',
    checkRegistrationUrl: 'https://www.vote.org/am-i-registered-to-vote/',
    registerUrl: 'https://www.vote.org/register-to-vote/ohio/',
  },
  OK: {
    name: 'Oklahoma',
    pollingPlaceUrl: 'https://okvoterportal.okelections.us/',
    registrationStatusUrl: 'https://okvoterportal.okelections.us/',
    voteGovUrl: 'https://vote.gov',
    checkRegistrationUrl: 'https://www.vote.org/am-i-registered-to-vote/',
    registerUrl: 'https://www.vote.org/register-to-vote/oklahoma/',
  },
  OR: {
    name: 'Oregon',
    pollingPlaceUrl: 'https://sos.oregon.gov/voting/pages/drop-box-locator.aspx',
    registrationStatusUrl: 'https://secure.sos.state.or.us/orestar/vr/showVoterSearch.do?lang=eng',
    voteGovUrl: 'https://vote.gov',
    checkRegistrationUrl: 'https://www.vote.org/am-i-registered-to-vote/',
    registerUrl: 'https://www.vote.org/register-to-vote/oregon/',
  },
  PA: {
    name: 'Pennsylvania',
    pollingPlaceUrl: 'https://www.pavoterservices.pa.gov/Pages/PollingPlaceInfo.aspx',
    registrationStatusUrl: 'https://www.vote.pa.gov/Register-to-Vote/Pages/Check-Your-Voter-Registration-Status.aspx',
    voteGovUrl: 'https://vote.gov',
    checkRegistrationUrl: 'https://www.vote.org/am-i-registered-to-vote/',
    registerUrl: 'https://www.vote.org/register-to-vote/pennsylvania/',
  },
  RI: {
    name: 'Rhode Island',
    pollingPlaceUrl: 'https://vote.sos.ri.gov/Home/PollingPlaces?ActiveFlag=2',
    registrationStatusUrl: 'https://vote.sos.ri.gov/Home/UpdateVoterRecord?ActiveFlag=0',
    voteGovUrl: 'https://vote.gov',
    checkRegistrationUrl: 'https://www.vote.org/am-i-registered-to-vote/',
    registerUrl: 'https://www.vote.org/register-to-vote/rhode-island/',
  },
  SC: {
    name: 'South Carolina',
    pollingPlaceUrl: 'https://vrems.scvotes.sc.gov/Voter/Login?PageMode=PollingPlace',
    registrationStatusUrl: 'https://vrems.scvotes.sc.gov/Voter/Login?PageMode=VoterInformation',
    voteGovUrl: 'https://vote.gov',
    checkRegistrationUrl: 'https://www.vote.org/am-i-registered-to-vote/',
    registerUrl: 'https://www.vote.org/register-to-vote/south-carolina/',
  },
  SD: {
    name: 'South Dakota',
    pollingPlaceUrl: 'https://vip.sdsos.gov/VIPLogin.aspx',
    registrationStatusUrl: 'https://vip.sdsos.gov/viplogin.aspx',
    voteGovUrl: 'https://vote.gov',
    checkRegistrationUrl: 'https://www.vote.org/am-i-registered-to-vote/',
    registerUrl: 'https://www.vote.org/register-to-vote/south-dakota/',
  },
  TN: {
    name: 'Tennessee',
    pollingPlaceUrl: 'https://tnmap.tn.gov/voterlookup/',
    registrationStatusUrl: 'https://tnmap.tn.gov/voterlookup/',
    voteGovUrl: 'https://vote.gov',
    checkRegistrationUrl: 'https://www.vote.org/am-i-registered-to-vote/',
    registerUrl: 'https://www.vote.org/register-to-vote/tennessee/',
  },
  TX: {
    name: 'Texas',
    pollingPlaceUrl: 'https://teamrv-mvp.sos.texas.gov/MVP/mvp.do',
    registrationStatusUrl: 'https://teamrv-mvp.sos.texas.gov/MVP/mvp.do',
    voteGovUrl: 'https://vote.gov',
    checkRegistrationUrl: 'https://www.vote.org/am-i-registered-to-vote/',
    registerUrl: 'https://www.vote.org/register-to-vote/texas/',
  },
  UT: {
    name: 'Utah',
    pollingPlaceUrl: 'https://votesearch.utah.gov/voter-search/search/search-by-address/how-and-where-can-i-vote',
    registrationStatusUrl: 'https://votesearch.utah.gov/voter-search/search/search-by-voter/voter-info',
    voteGovUrl: 'https://vote.gov',
    checkRegistrationUrl: 'https://www.vote.org/am-i-registered-to-vote/',
    registerUrl: 'https://www.vote.org/register-to-vote/utah/',
  },
  VT: {
    name: 'Vermont',
    pollingPlaceUrl: 'https://mvp.vermont.gov',
    registrationStatusUrl: 'https://mvp.vermont.gov',
    voteGovUrl: 'https://vote.gov',
    checkRegistrationUrl: 'https://www.vote.org/am-i-registered-to-vote/',
    registerUrl: 'https://www.vote.org/register-to-vote/vermont/',
  },
  VA: {
    name: 'Virginia',
    pollingPlaceUrl: 'https://vote.elections.virginia.gov/VoterInformation/Lookup/polling',
    registrationStatusUrl: 'https://vote.elections.virginia.gov/VoterInformation/Lookup/status',
    voteGovUrl: 'https://vote.gov',
    checkRegistrationUrl: 'https://www.vote.org/am-i-registered-to-vote/',
    registerUrl: 'https://www.vote.org/register-to-vote/virginia/',
  },
  WA: {
    name: 'Washington',
    pollingPlaceUrl: 'https://voter.votewa.gov/WhereToVote.aspx',
    registrationStatusUrl: 'https://voter.votewa.gov/WhereToVote.aspx',
    voteGovUrl: 'https://vote.gov',
    checkRegistrationUrl: 'https://www.vote.org/am-i-registered-to-vote/',
    registerUrl: 'https://www.vote.org/register-to-vote/washington/',
  },
  WV: {
    name: 'West Virginia',
    pollingPlaceUrl: 'https://apps.sos.wv.gov/elections/voter/index.aspx',
    registrationStatusUrl: 'https://apps.sos.wv.gov/Elections/Voter/AmIRegisteredToVote',
    voteGovUrl: 'https://vote.gov',
    checkRegistrationUrl: 'https://www.vote.org/am-i-registered-to-vote/',
    registerUrl: 'https://www.vote.org/register-to-vote/west-virginia/',
  },
  WI: {
    name: 'Wisconsin',
    pollingPlaceUrl: 'https://myvote.wi.gov/en-us/FindMyPollingPlace',
    registrationStatusUrl: 'https://myvote.wi.gov/en-us/MyVoterInfo',
    voteGovUrl: 'https://vote.gov',
    checkRegistrationUrl: 'https://www.vote.org/am-i-registered-to-vote/',
    registerUrl: 'https://www.vote.org/register-to-vote/wisconsin/',
  },
  WY: {
    name: 'Wyoming',
    pollingPlaceUrl: 'https://myelectionday.sos.wyo.gov/WYVOTES/Pages/VOSearch.aspx',
    registrationStatusUrl: 'https://sos.wyo.gov/Elections/State/RegisteringToVote.aspx',
    voteGovUrl: 'https://vote.gov',
    checkRegistrationUrl: 'https://www.vote.org/am-i-registered-to-vote/',
    registerUrl: 'https://www.vote.org/register-to-vote/wyoming/',
  },
}

// Official links whose .gov address redirects elsewhere. votetexas.gov itself
// links straight to the Civix-hosted portal (checked 2026-10-12).
const PORTAL_REDIRECTS: Record<string, string> = {
  'teamrv-mvp.sos.texas.gov': 'goelect.txelections.civixapps.com',
}

// Host a voter actually lands on, when it is not a .gov/.us domain. Several
// states run official portals on other domains (Texas on its vendor's
// civixapps.com, Arizona on arizona.vote, ...), which can look like phishing
// without a word of explanation.
export function unfamiliarPortalHost(url?: string): string | null {
  if (!url) return null
  let host: string
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }
  host = PORTAL_REDIRECTS[host] ?? host
  if (/\.(gov|us)$/.test(host)) return null
  return host.replace(/^www\./, '')
}

export function getVoterResources(stateCode?: string | null): StateVoterResource {
  if (!stateCode) {
    return {
      name: 'United States',
      voteGovUrl: 'https://vote.gov',
      checkRegistrationUrl: 'https://www.vote.org/am-i-registered-to-vote/',
      registerUrl: 'https://www.vote.org/register-to-vote/',
    }
  }
  const upper = stateCode.toUpperCase().trim()
  return (
    STATE_VOTER_RESOURCES[upper] ?? {
      name: upper,
      voteGovUrl: 'https://vote.gov',
      checkRegistrationUrl: 'https://www.vote.org/am-i-registered-to-vote/',
      registerUrl: 'https://www.vote.org/register-to-vote/',
    }
  )
}


export function directionBadgeClass(direction?: string | null) {
  switch (direction?.toLowerCase()) {
    case 'increase':
      return 'bg-emerald-950/80 text-emerald-300 border-emerald-800/70'
    case 'decrease':
      return 'bg-rose-950/80 text-rose-300 border-rose-800/70'
    case 'maintain':
      return 'bg-sky-950/80 text-sky-300 border-sky-800/70'
    case 'mixed':
      return 'bg-amber-950/80 text-amber-300 border-amber-800/70'
    default:
      return 'bg-slate-800 text-slate-300 border-slate-700'
  }
}

export function mechanismBadgeClass(mechanism?: string | null) {
  switch (mechanism?.toLowerCase()) {
    case 'funding':
      return 'bg-indigo-950/80 text-indigo-300 border-indigo-800/70'
    case 'regulation':
      return 'bg-purple-950/80 text-purple-300 border-purple-800/70'
    case 'oversight':
      return 'bg-cyan-950/80 text-cyan-300 border-cyan-800/70'
    case 'taxation':
      return 'bg-orange-950/80 text-orange-300 border-orange-800/70'
    default:
      return 'bg-slate-800 text-slate-300 border-slate-700'
  }
}

// The API sends naive UTC timestamps (no offset); read them as UTC.
export function parseApiTimestamp(value: string | null | undefined): Date | null {
  if (!value) {
    return null
  }
  const hasZone = /(Z|[+-]\d{2}:?\d{2})$/.test(value)
  const parsed = new Date(hasZone ? value : `${value}Z`)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

export function formatRelativeTime(
  value: string | null | undefined,
  now: Date = new Date(),
): string | null {
  const parsed = parseApiTimestamp(value)
  if (!parsed) {
    return null
  }
  const seconds = Math.round((parsed.getTime() - now.getTime()) / 1000)
  const abs = Math.abs(seconds)
  const rtf = new Intl.RelativeTimeFormat('en-US', { numeric: 'auto' })
  if (abs < 45) {
    return 'just now'
  }
  if (abs < 45 * 60) {
    return rtf.format(Math.round(seconds / 60), 'minute')
  }
  if (abs < 22 * 3600) {
    return rtf.format(Math.round(seconds / 3600), 'hour')
  }
  if (abs < 26 * 86400) {
    return rtf.format(Math.round(seconds / 86400), 'day')
  }
  return parsed.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export const POSITIONS_STATUS_LABELS: Record<PositionsStatus, string> = {
  ok: 'Processed',
  no_positions: 'No positions',
  no_issue_pages: 'No issue pages',
  blocked: 'Blocked',
  needs_js: 'Needs JS',
  thin_site: 'Thin site',
  no_website: 'No website',
  failed: 'Failed',
}

export function positionsStatusLabel(status: string | null | undefined) {
  if (!status) {
    return null
  }
  return POSITIONS_STATUS_LABELS[status as PositionsStatus] ?? status
}
