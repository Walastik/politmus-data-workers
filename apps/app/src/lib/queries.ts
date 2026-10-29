import { feedPath } from '@politmus/core/feed'
import type { FeedPage } from '@politmus/core/types'
import { useInfiniteQuery } from '@tanstack/react-query'

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
