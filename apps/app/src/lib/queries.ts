import { feedPath } from '@politmus/core/feed'
import { pacParams } from '@politmus/core/campaignFinance'
import type {
  Bill,
  BillVoter,
  FeedPage,
  FinanceElection,
  OfficialDetail,
  OfficialFinance,
  PacSummary,
  RacesPage,
  VoteChamber,
  VoterInfo,
} from '@politmus/core/types'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'

import { useApi } from './api'

const FEED_PAGE_SIZE = 30

export function useFeed(filterKey: string, level: string) {
  const api = useApi()
  return useInfiniteQuery({
    queryKey: ['feed', filterKey, level],
    queryFn: ({ pageParam, signal }) =>
      api.json<FeedPage>(feedPath({ filterKey, level, cursor: pageParam, limit: FEED_PAGE_SIZE }), { signal }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor,
  })
}

export function useFeedPreview(limit: number) {
  const api = useApi()
  return useQuery({
    queryKey: ['feed-preview', limit],
    queryFn: ({ signal }) => api.json<FeedPage>(feedPath({ filterKey: 'all', level: 'all', limit }), { signal }),
  })
}

// Voting sites and election offices for a street address (Google Civic).
export function useVoterInfo(address: string | null, stateCode: string | null, enabled: boolean) {
  const api = useApi()
  return useQuery({
    queryKey: ['voter-info', address, stateCode],
    enabled: enabled && Boolean(address),
    queryFn: ({ signal }) =>
      api.json<VoterInfo>('/api/voter-info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, state: stateCode || undefined }),
        signal,
      }),
    // The API rate-limits voter-info per client; one try per address is enough.
    retry: false,
    staleTime: 10 * 60 * 1000,
  })
}

export function useRaces(stateCode: string | null) {
  const api = useApi()
  return useQuery({
    queryKey: ['races', stateCode],
    enabled: Boolean(stateCode),
    queryFn: async ({ signal }) => {
      const page = await api.json<RacesPage>(
        `/api/candidates/races?state=${encodeURIComponent(stateCode ?? '')}&limit=100`,
        { signal },
      )
      return page.items ?? []
    },
    staleTime: 10 * 60 * 1000,
  })
}

export function useOfficial(id: string) {
  const api = useApi()
  return useQuery({
    queryKey: ['official', id],
    queryFn: ({ signal }) => api.json<OfficialDetail>(`/api/officials/${encodeURIComponent(id)}`, { signal }),
  })
}

export function useBill(id: string) {
  const api = useApi()
  return useQuery({
    queryKey: ['bill', id],
    queryFn: ({ signal }) => api.json<Bill>(`/api/bills/${encodeURIComponent(id)}`, { signal }),
  })
}

export function useBillVoters(id: string, chamber: VoteChamber, party: string) {
  const api = useApi()
  return useQuery({
    queryKey: ['bill-voters', id, chamber, party],
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({ chamber, party })
      const data = await api.json<{ voters: BillVoter[] }>(`/api/bills/${encodeURIComponent(id)}/votes?${params}`, { signal })
      return Array.isArray(data.voters) ? data.voters : []
    },
  })
}

export function useFinance(officialId: string, enabled: boolean) {
  const api = useApi()
  return useQuery({
    queryKey: ['finance', officialId],
    enabled,
    queryFn: ({ signal }) => api.json<OfficialFinance>(`/api/officials/${encodeURIComponent(officialId)}/finance`, { signal }),
  })
}

export function usePacSummary(officialId: string, election: FinanceElection) {
  const api = useApi()
  return useQuery({
    queryKey: ['pacs', officialId, pacParams(election)],
    queryFn: ({ signal }) =>
      api.json<PacSummary>(`/api/officials/${encodeURIComponent(officialId)}/finance/pacs?${pacParams(election)}`, { signal }),
  })
}

