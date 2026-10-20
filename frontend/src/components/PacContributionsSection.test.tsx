import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { FinanceElection, Pac, PacSummary } from '../types'
import PacContributionsSection from './PacContributionsSection'

const election: FinanceElection = {
  fec_candidate_id: 'S6MN00267',
  election_year: 2024,
  fec_url: 'https://www.fec.gov/data/candidate/S6MN00267/',
}

function pac(name: string, overrides: Partial<Pac> = {}): Pac {
  return {
    pac_key: name,
    committee_id: `C-${name}`,
    name,
    category: 'labor',
    category_label: 'Labor unions',
    total: 10000,
    gift_count: 2,
    first_date: '2023-01-01',
    last_date: '2024-06-01',
    ...overrides,
  }
}

const summary: PacSummary = {
  official_id: 'K000367',
  fec_candidate_id: 'S6MN00267',
  election_year: 2024,
  total: 1368278,
  reported_total: 1368278,
  gift_count: 393,
  pac_count: 217,
  categories: [
    { key: 'labor', label: 'Labor unions', total: 237225, share: 0.1734, pac_count: 35, gift_count: 62 },
    { key: 'cooperative', label: 'Cooperatives', total: 73800, share: 0.0539, pac_count: 13, gift_count: 26 },
  ],
  top_pacs: [pac('FIREFIGHTERS PAC', { total: 15000 }), pac('DAIRY FARMERS PAC', { category: 'cooperative', category_label: 'Cooperatives' })],
  synced: true,
  last_fetched_at: '2026-10-19T12:00:00',
}

const listCalls: URLSearchParams[] = []

function respond(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  listCalls.length = 0
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = new URL(String(input), 'http://localhost')
    if (url.pathname.endsWith('/finance/pacs/list')) {
      listCalls.push(url.searchParams)
      const q = url.searchParams.get('q')
      const offset = Number(url.searchParams.get('offset'))
      const all = q
        ? [pac('DAIRY FARMERS PAC', { category: 'cooperative', category_label: 'Cooperatives' })]
        : [pac('FIREFIGHTERS PAC'), pac('PAINTERS PAC')]
      return respond({ total_count: q ? 1 : 3, items: offset ? [pac('THIRD PAC')] : all })
    }
    if (url.pathname.endsWith('/finance/pacs/gifts')) {
      return respond([
        { sub_id: '1', receipt_date: '2024-02-26', amount: 5000, two_year_period: 2024, pdf_url: 'https://docquery.fec.gov/1' },
      ])
    }
    return respond(summary)
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

async function renderSection() {
  render(<PacContributionsSection officialId="K000367" election={election} />)
  await screen.findByText('FIREFIGHTERS PAC')
}

async function openExplorer() {
  await renderSection()
  fireEvent.click(screen.getByRole('button', { name: 'View all 217 PACs' }))
  return screen.findByRole('dialog', { name: 'PAC contributions · 2024 election' })
}

describe('PacContributionsSection', () => {
  it('shows the total, categories and top PACs', async () => {
    await renderSection()
    expect(screen.getByText(/from 217 PACs and committees \(393 gifts\)/)).toBeInTheDocument()
    expect(screen.getByText('Labor unions')).toBeInTheDocument()
    expect(screen.getByText('DAIRY FARMERS PAC')).toBeInTheDocument()
    expect(screen.queryByText(/differ by/)).not.toBeInTheDocument()
  })

  it('flags a gap with the reported total', async () => {
    vi.mocked(fetch).mockImplementation(async () =>
      respond({
        ...summary,
        reported_total: 1500000,
        reported_through: '2026-09-30',
        itemized_through: '2026-06-30',
      }),
    )
    render(<PacContributionsSection officialId="K000367" election={election} />)
    expect(
      await screen.findByText(/through 2026-09-30, 9% different .* run through 2026-06-30/),
    ).toBeInTheDocument()
  })

  it('says when PAC details are not loaded', async () => {
    vi.mocked(fetch).mockImplementation(async () => respond({ ...summary, synced: false }))
    render(<PacContributionsSection officialId="K000367" election={election} />)
    expect(await screen.findByText(/haven't been loaded/)).toBeInTheDocument()
  })
})

describe('PacExplorer', () => {
  it('lists PACs and loads more', async () => {
    const dialog = await openExplorer()
    await within(dialog).findByText('PAINTERS PAC')
    expect(within(dialog).getByText('3 PACs')).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Show more (1 left)' }))
    expect(await within(dialog).findByText('THIRD PAC')).toBeInTheDocument()
    expect(listCalls.at(-1)?.get('offset')).toBe('2')
  })

  it('searches by name after a pause', async () => {
    const dialog = await openExplorer()
    await within(dialog).findByText('PAINTERS PAC')
    fireEvent.change(within(dialog).getByRole('searchbox', { name: 'Search PACs by name' }), {
      target: { value: 'dairy' },
    })
    await waitFor(() => expect(listCalls.at(-1)?.get('q')).toBe('dairy'))
    expect(await within(dialog).findByText('1 PAC')).toBeInTheDocument()
    expect(listCalls.at(-1)?.get('offset')).toBe('0')
  })

  it('filters by category and sorts', async () => {
    const dialog = await openExplorer()
    await within(dialog).findByText('PAINTERS PAC')
    fireEvent.click(within(dialog).getByRole('button', { name: /Cooperatives · 13/ }))
    await waitFor(() => expect(listCalls.at(-1)?.get('category')).toBe('cooperative'))
    fireEvent.change(within(dialog).getByRole('combobox'), { target: { value: 'recent' } })
    await waitFor(() => expect(listCalls.at(-1)?.get('sort')).toBe('recent'))
  })

  it('expands a PAC to its gifts and filing links', async () => {
    const dialog = await openExplorer()
    fireEvent.click(await within(dialog).findByRole('button', { name: /PAINTERS PAC/ }))
    expect(await within(dialog).findByText('2024-02-26')).toBeInTheDocument()
    expect(within(dialog).getByRole('link', { name: 'Filing' })).toHaveAttribute(
      'href',
      'https://docquery.fec.gov/1',
    )
  })

  it('closes on Escape without reaching other listeners', async () => {
    const outer = vi.fn()
    window.addEventListener('keydown', outer)
    try {
      await openExplorer()
      act(() => {
        fireEvent.keyDown(window, { key: 'Escape' })
      })
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(outer).not.toHaveBeenCalled()
    } finally {
      window.removeEventListener('keydown', outer)
    }
  })
})
