export interface Official {
  id: string
  name: string
  state: string
  party: string
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

export function positionBadgeClass(position: string | null) {
  if (position === 'Yes') return 'bg-emerald-900/60 text-emerald-300'
  if (position === 'No') return 'bg-red-900/60 text-red-300'
  if (position === 'Present') return 'bg-amber-900/60 text-amber-300'
  return 'bg-slate-700 text-slate-300'
}
