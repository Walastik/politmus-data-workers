export interface Official {
  id: string
  name: string
  state: string
  party: string
  office: string | null
  district: number | null
  current_member: boolean
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

export interface Bill {
  id: string
  title: string | null
  sponsor_id: string | null
  sponsor_bioguide_id: string | null
  sponsor_name: string | null
  votes_summary: Record<string, number>
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
  return party
}

export function rosterStatusLabel(official: Official) {
  return official.current_member ? 'Active' : 'Former'
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
  if (official.office === 'Senator') {
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
