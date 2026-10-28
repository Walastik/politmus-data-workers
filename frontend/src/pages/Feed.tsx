import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { apiUrl } from '../api'
import FeedItemCard from '../components/FeedItemCard'
import PageHeader, { PageContainer } from '../components/PageHeader'
import UpcomingElections from '../components/UpcomingElections'
import { useDrawerLinks } from '../useDrawerLinks'
import { FEED_FILTERS, FEED_LEVELS, groupFeed } from '../feed'
import type { FeedItem, FeedPage } from '../types'

const PAGE_SIZE = 30

export default function Feed() {
  const { openOfficial, openBill } = useDrawerLinks()
  const [searchParams, setSearchParams] = useSearchParams()
  const filterKey = FEED_FILTERS.some((f) => f.key === searchParams.get('show'))
    ? (searchParams.get('show') as string)
    : 'all'
  const level = FEED_LEVELS.some((l) => l.key === searchParams.get('level'))
    ? (searchParams.get('level') as string)
    : 'all'

  const [items, setItems] = useState<FeedItem[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Ignore "load more" responses that land after the filters changed.
  const requestKey = useRef('')

  const feedUrl = useCallback(
    (cursor: string | null) => {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE) })
      const kinds = FEED_FILTERS.find((f) => f.key === filterKey)?.kinds
      if (kinds) params.set('kinds', kinds.join(','))
      if (level !== 'all') params.set('level', level)
      if (cursor) params.set('cursor', cursor)
      return apiUrl(`/api/feed?${params.toString()}`)
    },
    [filterKey, level],
  )

  useEffect(() => {
    const controller = new AbortController()
    requestKey.current = `${filterKey}:${level}`
    setLoading(true)
    setError(null)
    fetch(feedUrl(null), { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`Failed to load feed (${res.status})`)
        }
        return res.json() as Promise<FeedPage>
      })
      .then((data) => {
        setItems(Array.isArray(data.items) ? data.items : [])
        setNextCursor(data.next_cursor ?? null)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return
        }
        setError(err instanceof Error ? err.message : 'Failed to load feed')
        setLoading(false)
      })
    return () => controller.abort()
  }, [feedUrl, filterKey, level])

  const loadMore = () => {
    if (!nextCursor) return
    const key = requestKey.current
    setLoadingMore(true)
    fetch(feedUrl(nextCursor))
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`Failed to load more (${res.status})`)
        }
        return res.json() as Promise<FeedPage>
      })
      .then((data) => {
        if (requestKey.current !== key) return
        setItems((current) => [...current, ...(data.items ?? [])])
        setNextCursor(data.next_cursor ?? null)
      })
      .catch((err: unknown) => {
        if (requestKey.current !== key) return
        setError(err instanceof Error ? err.message : 'Failed to load more')
      })
      .finally(() => setLoadingMore(false))
  }

  const setParam = (name: string, value: string) => {
    const params = new URLSearchParams(searchParams)
    if (value === 'all') {
      params.delete(name)
    } else {
      params.set(name, value)
    }
    setSearchParams(params, { replace: true })
  }

  return (
    <PageContainer narrow>
      <PageHeader
        title="Feed"
        description="The latest from Congress: bills introduced and passed, how members voted, and elections coming up."
      />
      <div className="space-y-6">
        <UpcomingElections />

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Show">
            {FEED_FILTERS.map((filter) => (
              <Chip
                key={filter.key}
                active={filterKey === filter.key}
                onClick={() => setParam('show', filter.key)}
              >
                {filter.label}
              </Chip>
            ))}
          </div>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Level">
            {FEED_LEVELS.map((option) => (
              <Chip
                key={option.key}
                active={level === option.key}
                onClick={() => setParam('level', option.key)}
              >
                {option.label}
              </Chip>
            ))}
          </div>
        </div>

        {loading ? (
          <p className="text-slate-400">Loading…</p>
        ) : error && items.length === 0 ? (
          <p className="text-red-400">{error}</p>
        ) : items.length === 0 ? (
          <p className="text-slate-400">Nothing new here yet.</p>
        ) : (
          <div className="space-y-6">
            {groupFeed(items).map((group, index) => (
              <section key={`${group.label}-${index}`} aria-label={group.label}>
                <h2 className="sticky top-14 z-10 -mx-4 mb-2 bg-slate-900/95 px-4 py-1 text-xs font-semibold uppercase tracking-wider text-slate-500 backdrop-blur">
                  {group.label}
                </h2>
                <div className="space-y-3">
                  {group.entries.map(({ item, related }) => (
                    <FeedItemCard
                      key={item.id}
                      item={item}
                      related={related}
                      onSelectBill={openBill}
                      onSelectOfficial={openOfficial}
                    />
                  ))}
                </div>
              </section>
            ))}
            {error ? <p className="text-red-400">{error}</p> : null}
            {nextCursor ? (
              <div className="flex justify-center">
                <button
                  type="button"
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="rounded bg-slate-700 px-4 py-2 transition hover:bg-slate-600 disabled:opacity-50"
                >
                  {loadingMore ? 'Loading…' : 'Load more'}
                </button>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </PageContainer>
  )
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: string
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`rounded px-3 py-1.5 text-xs font-semibold uppercase tracking-wider transition ${
        active ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
      }`}
    >
      {children}
    </button>
  )
}
