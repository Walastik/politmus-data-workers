// The Bills list: its filters and the request they make, shared by the web
// page and the native screen.

export interface BillFilters {
  query: string
  voteStatus: string
  status: string
  pace: string
  sponsorParty: string
  bipartisan: string
  sort: string
}

export const DEFAULT_BILL_FILTERS: BillFilters = {
  query: '',
  voteStatus: 'all',
  status: 'all',
  pace: 'all',
  sponsorParty: 'all',
  bipartisan: 'all',
  sort: 'voted_desc',
}

type FilterKey = Exclude<keyof BillFilters, 'query'>

// Each dropdown on the web page, a chip group on native.
export const BILL_FILTER_GROUPS: { key: FilterKey; label: string; options: { value: string; label: string }[] }[] = [
  {
    key: 'voteStatus',
    label: 'Vote Status',
    options: [
      { value: 'all', label: 'All' },
      { value: 'voted', label: 'Voted On' },
      { value: 'pending', label: 'Awaiting Vote' },
    ],
  },
  {
    key: 'status',
    label: 'Result',
    options: [
      { value: 'all', label: 'All' },
      { value: 'passed', label: 'Passed' },
      { value: 'failed', label: 'Failed' },
    ],
  },
  {
    key: 'pace',
    label: 'Pace',
    options: [
      { value: 'all', label: 'All' },
      { value: 'very_fast', label: 'Very Fast' },
      { value: 'fast', label: 'Fast' },
      { value: 'average', label: 'Average' },
      { value: 'slow', label: 'Slow' },
      { value: 'very_slow', label: 'Very Slow' },
    ],
  },
  {
    key: 'sponsorParty',
    label: 'Sponsor Party',
    options: [
      { value: 'all', label: 'All' },
      { value: 'Democratic', label: 'Democratic' },
      { value: 'Republican', label: 'Republican' },
      { value: 'Independent', label: 'Independent' },
    ],
  },
  {
    key: 'bipartisan',
    label: 'Support',
    options: [
      { value: 'all', label: 'All' },
      { value: 'single_party', label: 'Single Party' },
      { value: 'bipartisan', label: 'Bipartisan' },
      { value: 'tripartisan', label: 'Tripartisan' },
    ],
  },
]

// "Best Match" only exists while searching.
export function billSortOptions(searching: boolean) {
  return [
    ...(searching ? [{ value: 'relevance', label: 'Best Match' }] : []),
    { value: 'voted_desc', label: 'Voted On (Newest)' },
    { value: 'voted_asc', label: 'Voted On (Oldest)' },
    { value: 'introduced_desc', label: 'Introduced (Newest)' },
    { value: 'introduced_asc', label: 'Introduced (Oldest)' },
  ]
}

// Starting a search switches the default sort to best match, and clearing it
// switches back; a sort the user picked is left alone.
export function sortForQueryChange(previousQuery: string, nextQuery: string, sort: string) {
  if (nextQuery && !previousQuery) return sort === 'voted_desc' ? 'relevance' : sort
  if (!nextQuery) return sort === 'relevance' ? 'voted_desc' : sort
  return sort
}

export function billsPath(filters: BillFilters, { limit, offset }: { limit: number; offset: number }) {
  const params = new URLSearchParams()
  if (filters.query) params.set('q', filters.query)
  if (filters.voteStatus !== 'all') params.set('vote_status', filters.voteStatus)
  if (filters.pace !== 'all') params.set('pace', filters.pace)
  if (filters.status !== 'all') params.set('status', filters.status)
  if (filters.sponsorParty !== 'all') params.set('sponsor_party', filters.sponsorParty)
  if (filters.bipartisan !== 'all') params.set('bipartisan', filters.bipartisan)
  params.set('sort', filters.sort)
  params.set('limit', String(limit))
  params.set('offset', String(offset))
  return `/api/bills?${params.toString()}`
}

export function noBillsMessage(query: string) {
  return query ? `No bills match "${query}" with these filters.` : 'No bills match your filters.'
}
