import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import BillsFeed from './BillsFeed'
import { billStub } from './types'

vi.mock('@clerk/clerk-react', () => ({
  SignedIn: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

function requestedParams(): URLSearchParams[] {
  return vi
    .mocked(globalThis.fetch)
    .mock.calls.map(([input]) => new URL(String(input), 'http://localhost').searchParams)
}

describe('BillsFeed search', () => {
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response(JSON.stringify({ items: [{ ...billStub('119-hr-1'), title: 'One Big Bill' }], total: 1 })),
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('sends the search and sorts by best match until it is cleared', async () => {
    render(<BillsFeed onSelectBill={() => {}} />)
    expect(await screen.findByText('One Big Bill')).toBeInTheDocument()
    expect(requestedParams()[0].get('q')).toBeNull()

    const input = screen.getByRole('searchbox', { name: 'Search bills' })
    fireEvent.change(input, { target: { value: '  H.R. 1 ' } })
    await waitFor(() => expect(requestedParams().at(-1)?.get('q')).toBe('H.R. 1'))
    expect(requestedParams().at(-1)?.get('sort')).toBe('relevance')
    expect(screen.getByRole('option', { name: 'Best Match' })).toBeInTheDocument()

    fireEvent.change(input, { target: { value: '' } })
    await waitFor(() => expect(requestedParams().at(-1)?.get('q')).toBeNull())
    expect(requestedParams().at(-1)?.get('sort')).toBe('voted_desc')
    expect(screen.queryByRole('option', { name: 'Best Match' })).toBeNull()
  })

  it('keeps a sort the user picked when a search starts', async () => {
    render(<BillsFeed onSelectBill={() => {}} />)
    await screen.findByText('One Big Bill')

    fireEvent.change(screen.getByRole('combobox', { name: 'Sort By' }), {
      target: { value: 'introduced_desc' },
    })
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search bills' }), {
      target: { value: 'veterans' },
    })
    await waitFor(() => expect(requestedParams().at(-1)?.get('q')).toBe('veterans'))
    expect(requestedParams().at(-1)?.get('sort')).toBe('introduced_desc')
  })
})
