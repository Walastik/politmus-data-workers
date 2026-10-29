import { describe, expect, it } from 'vitest'

import { dayGroup, daysUntil, groupFeed } from './feed'
import type { FeedItem } from './types'

describe('dayGroup', () => {
  const now = new Date(2026, 9, 20, 15, 30)

  it('buckets by local calendar day', () => {
    expect(dayGroup('2026-10-20', now)).toBe('Today')
    expect(dayGroup('2026-10-19', now)).toBe('Yesterday')
    expect(dayGroup('2026-10-14', now)).toBe('This week')
    expect(dayGroup('2026-10-13', now)).toBe('Earlier')
  })

  it('treats bad or future dates sensibly', () => {
    expect(dayGroup('not a date', now)).toBe('Earlier')
    expect(dayGroup('2026-10-21', now)).toBe('Today')
  })
})

describe('daysUntil', () => {
  it('counts calendar days from today', () => {
    const now = new Date(2026, 9, 20, 23, 59)
    expect(daysUntil('2026-10-20', now)).toBe(0)
    expect(daysUntil('2026-11-03', now)).toBe(14)
    expect(daysUntil('nope', now)).toBeNull()
  })
})

describe('groupFeed', () => {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`

  function vote(id: number, billId: string, chamber = 'Senate'): FeedItem {
    return {
      id,
      kind: 'vote_held',
      occurred_at: today,
      detected_at: `${today}T12:00:00Z`,
      headline: billId,
      subline: null,
      level: 'federal',
      state: null,
      bill: { id: billId } as FeedItem['bill'],
      official: null,
      roll_call: {
        id,
        chamber,
        date: today,
        question: `Q${id}`,
        result: 'Agreed to',
        requires: null,
        source_roll_call_id: `r${id}`,
      },
      tally_by_party: null,
      payload: null,
    }
  }

  it('folds same-day votes on one bill and chamber into the latest vote', () => {
    const groups = groupFeed([
      vote(5, 'B1'),
      vote(4, 'B2'),
      vote(3, 'B1'),
      vote(2, 'B1', 'House'),
      vote(1, 'B1'),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].entries.map((e) => [e.item.id, e.related.map((r) => r.id)])).toEqual([
      [5, [3, 1]],
      [4, []],
      [2, []],
    ])
  })
})
