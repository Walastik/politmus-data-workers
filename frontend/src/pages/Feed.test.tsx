import { fireEvent, render, screen, within } from '@testing-library/react'
import { useEffect } from 'react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { FeedItem } from '../types'
import Feed from './Feed'

function isoDaysAgo(days: number) {
  const d = new Date()
  d.setDate(d.getDate() - days)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function item(id: number, extra: Partial<FeedItem>): FeedItem {
  return {
    id,
    kind: 'bill_introduced',
    occurred_at: isoDaysAgo(0),
    detected_at: '2026-10-20T12:00:00Z',
    headline: `Headline ${id}`,
    subline: null,
    level: 'federal',
    state: null,
    bill: null,
    official: null,
    roll_call: null,
    tally_by_party: null,
    payload: null,
    ...extra,
  }
}

const lawItem = item(3, {
  kind: 'bill_status_changed',
  headline: 'Clean Water Act',
  subline: 'Became Public Law No: 119-12.',
  payload: { status: 'Became Law', action: 'Became Public Law No: 119-12.' },
  bill: {
    id: '119-hr-12',
    title: 'Clean Water Act',
    sponsor_id: null,
    sponsor_bioguide_id: null,
    sponsor_name: null,
    sponsor_party: null,
    cosponsor_party_breakdown: null,
    bipartisan_type: null,
    policy_area: 'Environmental Protection',
    summary: null,
    introduced_date: null,
    voted_date: null,
    days_to_vote: null,
    velocity_bucket: null,
    latest_action_date: null,
    latest_action_text: null,
    status: 'Became Law',
    level: 'federal',
  },
})

const voteItem: FeedItem = item(2, {
  kind: 'vote_held',
  occurred_at: isoDaysAgo(1),
  headline: 'Border Act',
  subline: 'On Passage',
  bill: { ...lawItem.bill!, id: '119-s-88', title: 'Border Act', policy_area: null, status: null },
  roll_call: {
    id: 9,
    chamber: 'Senate',
    date: isoDaysAgo(1),
    question: 'On Passage',
    result: 'Passed',
    requires: '1/2',
    source_roll_call_id: 'senate-119-1-00009',
  },
  tally_by_party: { Republican: { Yes: 50 }, Democratic: { No: 48 } },
})

const olderItem = item(1, {
  kind: 'official_seated',
  occurred_at: isoDaysAgo(30),
  headline: 'Jane Roe',
  subline: 'Took office · Senator, Texas',
})

let currentSearch = ''

function SearchSpy() {
  const { search } = useLocation()
  useEffect(() => {
    currentSearch = search
  }, [search])
  return null
}

function renderFeed(search = '') {
  return render(
    <MemoryRouter initialEntries={[`/feed${search}`]}>
      <Feed />
      <SearchSpy />
    </MemoryRouter>,
  )
}

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
}

describe('Feed page', () => {
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/feed/upcoming')) {
        return jsonResponse({
          elections: [{ id: '9000', name: 'General Election', date: isoDaysAgo(-14) }],
        })
      }
      if (url.includes('/api/feed?')) {
        if (url.includes('cursor=')) {
          return jsonResponse({ items: [olderItem], next_cursor: null })
        }
        return jsonResponse({ items: [lawItem, voteItem], next_cursor: 'c1' })
      }
      return jsonResponse({}, 404)
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows upcoming elections and groups items by day', async () => {
    renderFeed()

    expect(await screen.findByText('General Election')).toBeInTheDocument()
    expect(screen.getByText(/in 14 days/)).toBeInTheDocument()

    const today = await screen.findByRole('region', { name: 'Today' })
    expect(within(today).getByText('Became law')).toBeInTheDocument()
    expect(within(today).getByText('Clean Water Act')).toBeInTheDocument()

    const yesterday = screen.getByRole('region', { name: 'Yesterday' })
    expect(within(yesterday).getByText('Senate vote · Passed')).toBeInTheDocument()
    expect(within(yesterday).getByText('On Passage')).toBeInTheDocument()
  })

  it('merges same-day votes on a bill into one card', async () => {
    const amendment = {
      ...voteItem,
      id: 1,
      subline: 'On the Amendment',
      roll_call: { ...voteItem.roll_call!, id: 8, question: 'On the Amendment', result: 'Rejected' },
    }
    vi.mocked(globalThis.fetch).mockImplementation((input: RequestInfo | URL) =>
      String(input).includes('/api/feed?')
        ? jsonResponse({ items: [voteItem, amendment], next_cursor: null })
        : jsonResponse({ elections: [] }),
    )
    renderFeed()

    expect(await screen.findByText('Senate · 2 votes · Passed')).toBeInTheDocument()
    expect(screen.queryByText('On the Amendment')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Show 1 earlier vote that day' }))
    expect(screen.getByText('On the Amendment')).toBeInTheDocument()
    expect(screen.getByText('Rejected')).toBeInTheDocument()
  })

  it('loads older items with the cursor', async () => {
    renderFeed()
    fireEvent.click(await screen.findByRole('button', { name: 'Load more' }))

    const earlier = await screen.findByRole('region', { name: 'Earlier' })
    expect(within(earlier).getByText('Jane Roe')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument()
    const urls = vi.mocked(globalThis.fetch).mock.calls.map(([input]) => String(input))
    expect(urls.some((url) => url.includes('cursor=c1'))).toBe(true)
  })

  it('filters by kind and keeps the filter in the URL', async () => {
    renderFeed()
    await screen.findByText('Clean Water Act')

    fireEvent.click(screen.getByRole('button', { name: 'Votes' }))

    await vi.waitFor(() => {
      const urls = vi.mocked(globalThis.fetch).mock.calls.map(([input]) => String(input))
      expect(urls.some((url) => url.includes('kinds=vote_held'))).toBe(true)
    })
    expect(currentSearch).toBe('?show=votes')
  })

  it('opens the bill drawer from a card', async () => {
    renderFeed()
    fireEvent.click(await screen.findByRole('button', { name: 'Became law: Clean Water Act' }))

    await vi.waitFor(() => expect(currentSearch).toBe('?bill=119-hr-12'))
  })

})
