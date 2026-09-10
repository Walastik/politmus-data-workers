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
}

export interface OfficialVote {
  bill_id: string
  bill_title: string | null
  position: string | null
  sponsor_name: string | null
}

export interface OfficialDetail extends Official {
  votes: OfficialVote[]
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
  votes_summary: BillVoteSummary
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
  return party
}

export function bipartisanTypeLabel(type: Bill['bipartisan_type']) {
  if (type === 'single_party') return 'Single party'
  if (type === 'bipartisan') return 'Bipartisan'
  if (type === 'tripartisan') return 'Tripartisan'
  return null
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
