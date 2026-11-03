// The PAC explorer: every PAC that gave in one election, searchable and
// filterable. Shared by the web panel and the native screen.

import { formatDateRange, pacParams } from './campaignFinance'
import type { FinanceElection, Pac } from './types'

export const PAC_PAGE_SIZE = 50

export const PAC_SORTS = [
  { value: 'amount', label: 'Largest total' },
  { value: 'gifts', label: 'Most gifts' },
  { value: 'recent', label: 'Most recent' },
  { value: 'name', label: 'Name A–Z' },
] as const

export type PacSort = (typeof PAC_SORTS)[number]['value']

export function pacListPath(
  officialId: string,
  election: FinanceElection,
  { sort, offset, query, category }: { sort: PacSort; offset: number; query: string; category: string | null },
) {
  const params = pacParams(election)
  params.set('sort', sort)
  params.set('limit', String(PAC_PAGE_SIZE))
  params.set('offset', String(offset))
  if (query) params.set('q', query)
  if (category) params.set('category', category)
  return `/api/officials/${encodeURIComponent(officialId)}/finance/pacs/list?${params}`
}

export function pacGiftsPath(officialId: string, election: FinanceElection, pacKey: string) {
  const params = pacParams(election)
  params.set('pac_key', pacKey)
  return `/api/officials/${encodeURIComponent(officialId)}/finance/pacs/gifts?${params}`
}

// "Corporate · 4 gifts · 2025-03-01 → 2026-06-30"
export function pacMeta(pac: Pac) {
  return `${pac.category_label} · ${pac.gift_count} ${pac.gift_count === 1 ? 'gift' : 'gifts'} · ${formatDateRange(pac.first_date, pac.last_date)}`
}

export function fecCommitteeUrl(committeeId: string) {
  return `https://www.fec.gov/data/committee/${committeeId}/`
}
