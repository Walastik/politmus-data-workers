// Feed page filters and date grouping, shared by the page and its tests.

import { parseIsoDate } from './calendar'
import type { FeedItem, FeedKind } from './types'

export const FEED_FILTERS: readonly { key: string; label: string; kinds: FeedKind[] | null }[] = [
  { key: 'all', label: 'All', kinds: null },
  { key: 'bills', label: 'New bills', kinds: ['bill_introduced'] },
  { key: 'progress', label: 'Bill progress', kinds: ['bill_status_changed'] },
  { key: 'votes', label: 'Votes', kinds: ['vote_held'] },
  { key: 'officials', label: 'Officials', kinds: ['official_seated', 'official_departed'] },
]

export const FEED_LEVELS = [
  { key: 'all', label: 'All levels' },
  { key: 'federal', label: 'Federal' },
  { key: 'state', label: 'State' },
] as const

export type DayGroup = 'Today' | 'Yesterday' | 'This week' | 'Earlier'

export function dayGroup(occurredAt: string, now: Date = new Date()): DayGroup {
  const day = parseIsoDate(occurredAt.slice(0, 10))
  if (!day) return 'Earlier'
  const date = new Date(day.year, day.month - 1, day.day)
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const daysAgo = Math.round((today.getTime() - date.getTime()) / 86_400_000)
  if (daysAgo <= 0) return 'Today'
  if (daysAgo === 1) return 'Yesterday'
  if (daysAgo < 7) return 'This week'
  return 'Earlier'
}

export function daysUntil(value: string, now: Date = new Date()): number | null {
  const day = parseIsoDate(value)
  if (!day) return null
  const target = new Date(day.year, day.month - 1, day.day)
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((target.getTime() - today.getTime()) / 86_400_000)
}

// One card on the timeline. `related` holds the other roll calls folded into
// it: a busy floor day can hold a dozen amendment votes on one bill, which
// read as one story, so they share the card of the day's latest vote.
export interface FeedEntry {
  item: FeedItem
  related: FeedItem[]
}

function voteGroupKey(item: FeedItem): string | null {
  if (item.kind !== 'vote_held' || !item.bill) return null
  return `${item.occurred_at}|${item.bill.id}|${item.roll_call?.chamber ?? ''}`
}

// Day sections in feed order (items arrive newest first). Merging works on the
// whole list, so votes split across "load more" pages still land on one card.
export function groupFeed(items: FeedItem[]): { label: DayGroup; entries: FeedEntry[] }[] {
  const groups: { label: DayGroup; entries: FeedEntry[] }[] = []
  const voteEntries = new Map<string, FeedEntry>()
  for (const item of items) {
    const key = voteGroupKey(item)
    const existing = key ? voteEntries.get(key) : undefined
    if (existing) {
      existing.related.push(item)
      continue
    }
    const entry: FeedEntry = { item, related: [] }
    if (key) voteEntries.set(key, entry)

    const label = dayGroup(item.occurred_at)
    const last = groups[groups.length - 1]
    if (last && last.label === label) {
      last.entries.push(entry)
    } else {
      groups.push({ label, entries: [entry] })
    }
  }
  return groups
}
