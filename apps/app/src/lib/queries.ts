import { feedPath } from '@politmus/core/feed'
import type { FeedPage, RacesPage, VoterInfo } from '@politmus/core/types'
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
