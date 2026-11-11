// The Congress roster: views, filters, grouping and the chamber makeup bars,
// shared by the web page and the native screen.

import { officialName, partyShort, type Official, type RosterStatusFilter } from './types'

export type CongressView = 'senate' | 'house' | 'list'

export const CONGRESS_VIEWS: { key: CongressView; label: string }[] = [
  { key: 'senate', label: 'Senate' },
  { key: 'house', label: 'House' },
  { key: 'list', label: 'All members' },
]

export const NON_VOTING_OFFICES = new Set(['Delegate', 'Resident Commissioner'])
const PARTY_ORDER = ['D', 'I', 'R']

export type RosterSort = 'name' | 'score'

export function officialsPath(params: URLSearchParams) {
  return `/api/officials?${params.toString()}`
}

// Every current member of Congress (the Senate and House views filter locally).
export const CURRENT_MEMBERS_PATH = officialsPath(new URLSearchParams({ level: 'federal', current_member: 'true' }))

// The All members roster, filtered on the server.
export function rosterPath({
  status,
  party,
  stateName,
  query,
}: {
  status: RosterStatusFilter
  party: string
  stateName: string
  query: string
}) {
  const params = new URLSearchParams()
  if (status === 'active') params.set('current_member', 'true')
  else if (status === 'former') params.set('current_member', 'false')
  params.set('level', 'federal')
  if (party) params.set('party', party)
  if (stateName) params.set('state', stateName)
  if (query) params.set('q', query)
  return officialsPath(params)
}

export function memberMatches(member: Official, { party, stateName, query }: { party: string; stateName: string; query: string }) {
  const q = query.toLowerCase()
  return (
    (!party || partyShort(member.party) === party) &&
    (!stateName || member.state === stateName) &&
    (!q || officialName(member).toLowerCase().includes(q) || member.name.toLowerCase().includes(q))
  )
}

export function splitChambers(members: Official[]) {
  const senators = members.filter((m) => m.office === 'Senator')
  const house = members.filter((m) => m.office !== 'Senator')
  return {
    senators,
    house,
    voting: house.filter((m) => !NON_VOTING_OFFICES.has(m.office ?? '')),
    delegates: house.filter((m) => NON_VOTING_OFFICES.has(m.office ?? '')).length,
  }
}

// Party segments for a chamber's makeup bar, D then I then R.
export function chamberMakeup(members: Official[]) {
  const counts = { D: 0, R: 0, I: 0 }
  for (const member of members) {
    const key = partyShort(member.party) as keyof typeof counts
    counts[key in counts ? key : 'I'] += 1
  }
  const total = members.length || 1
  return {
    segments: [
      { key: 'D', label: 'Democrat', count: counts.D, bar: 'bg-blue-500', text: 'text-blue-300' },
      { key: 'I', label: 'Independent', count: counts.I, bar: 'bg-emerald-500', text: 'text-emerald-300' },
      { key: 'R', label: 'Republican', count: counts.R, bar: 'bg-red-500', text: 'text-red-300' },
    ]
      .filter((segment) => segment.count > 0)
      .map((segment) => ({ ...segment, share: segment.count / total })),
    scored: members.filter((m) => m.score_matches).length,
  }
}

// Each chamber's top posts, in order, with the title the chamber card shows.
const LEADERSHIP_POSTS = {
  Senate: [
    { title: 'Senate Majority Leader', label: 'Majority Leader' },
    { title: 'Senate Minority Leader', label: 'Minority Leader' },
  ],
  House: [
    { title: 'Speaker of the House', label: 'Speaker' },
    { title: 'House Majority Leader', label: 'Majority Leader' },
    { title: 'House Minority Leader', label: 'Minority Leader' },
  ],
}

export type LeadershipPost = { title: string; label: string; holder: Official | null }

// A chamber's top posts and who holds each (null: vacant). Null when the
// roster has no leadership at all, so a roster loaded before the API sent
// leadership_role never shows every post as vacant.
export function chamberLeaders(members: Official[], chamber: keyof typeof LEADERSHIP_POSTS): LeadershipPost[] | null {
  if (!members.some((m) => m.leadership_role)) return null
  return LEADERSHIP_POSTS[chamber].map((post) => ({
    ...post,
    holder: members.find((m) => m.leadership_role === post.title) ?? null,
  }))
}

export function byState(members: Official[]): [string, Official[]][] {
  const groups = new Map<string, Official[]>()
  for (const member of members) {
    const list = groups.get(member.state) ?? []
    list.push(member)
    groups.set(member.state, list)
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))
}

export function houseSeatLabel(member: Official) {
  if (NON_VOTING_OFFICES.has(member.office ?? '')) return member.office ?? 'Delegate'
  return !member.district || member.district === 98 ? 'At-large' : `District ${member.district}`
}

// A state's House delegation: by district, its party strip order, and "9 seats · 6D 3R".
export function delegationSummary(delegation: Official[]) {
  const counts = ['D', 'R', 'I']
    .map((p) => [p, delegation.filter((m) => partyShort(m.party) === p).length] as const)
    .filter(([, n]) => n > 0)
  return {
    byDistrict: [...delegation].sort((a, b) => (a.district ?? 0) - (b.district ?? 0)),
    byParty: [...delegation].sort((a, b) => PARTY_ORDER.indexOf(partyShort(a.party)) - PARTY_ORDER.indexOf(partyShort(b.party))),
    label: `${delegation.length} seat${delegation.length === 1 ? '' : 's'} · ${counts.map(([p, n]) => `${n}${p}`).join(' ')}`,
  }
}

export function sortRoster(rows: Official[], { sort, hasPositionsOnly }: { sort: RosterSort; hasPositionsOnly: boolean }) {
  const filtered = hasPositionsOnly ? rows.filter((m) => m.positions_status === 'ok') : rows
  if (sort === 'name') return filtered
  return [...filtered].sort(
    (a, b) =>
      (b.score_matches ? 1 : 0) - (a.score_matches ? 1 : 0) ||
      (b.score_pct ?? -1) - (a.score_pct ?? -1) ||
      (b.score_points ?? 0) - (a.score_points ?? 0),
  )
}

export function partyEdgeClass(party: string | null | undefined) {
  if (party === 'Democratic' || party === 'D') return 'border-blue-500'
  if (party === 'Republican' || party === 'R') return 'border-red-500'
  return 'border-emerald-500'
}

export function partyFillClass(party: string | null | undefined) {
  if (party === 'Democratic' || party === 'D') return 'bg-blue-500'
  if (party === 'Republican' || party === 'R') return 'bg-red-500'
  return 'bg-emerald-500'
}
