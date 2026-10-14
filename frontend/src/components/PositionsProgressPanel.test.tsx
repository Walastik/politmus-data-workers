import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { PositionsProgress } from '../types'
import PositionsProgressPanel from './PositionsProgressPanel'

const progress: PositionsProgress = {
  population: 535,
  attempted: 120,
  by_status: { ok: 98, no_positions: 4, no_issue_pages: 3, blocked: 6, needs_js: 2, failed: 7 },
  not_attempted: 415,
  stances_total: 3820,
  last_success_at: new Date(Date.now() - 5 * 60_000).toISOString(),
  current_versions: [{ extractor_version: 'v1', count: 98 }],
  recent: [
    {
      official_id: 'A000001',
      name: 'Jane Example',
      state: 'New York',
      party: 'Democratic',
      office: 'Representative',
      district: 1,
      status: 'ok',
      stances_saved: 12,
      pages_found: 4,
      last_attempt_at: null,
      last_error: null,
    },
  ],
  problems: [
    {
      official_id: 'B000002',
      name: 'John Blocked',
      state: 'Ohio',
      party: 'Republican',
      office: 'Senator',
      district: null,
      status: 'failed',
      stances_saved: null,
      pages_found: null,
      last_attempt_at: null,
      last_error: 'ollama timed out after 600s',
    },
  ],
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('PositionsProgressPanel', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('renders counts and opens an official from a problem row', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(progress))
    const onSelect = vi.fn()
    render(<PositionsProgressPanel onSelectOfficial={onSelect} />)

    expect(await screen.findByText('Stated positions: 98 of 535 processed')).toBeInTheDocument()
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/positions/progress')
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '98')
    expect(screen.getByText('Last update 5 minutes ago')).toBeInTheDocument()

    const chips = within(screen.getByRole('list', { name: 'Status counts' }))
    expect(chips.getByText('no positions').textContent).toBe('no positions 7')
    expect(chips.getByText('failed').textContent).toBe('failed 7')
    expect(chips.getByText('not yet').textContent).toBe('not yet 415')
    expect(chips.getByText('3,820 positions saved')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Problems (1)' }))
    expect(screen.getByText('ollama timed out after 600s')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /John Blocked/ }))
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'B000002', name: 'John Blocked', office: 'Senator', current_member: true }),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Recent (1)' }))
    expect(screen.getByText('12 positions')).toBeInTheDocument()
  })

  it('refreshes every minute and keeps the last good data on errors', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse(progress))
      .mockResolvedValueOnce(jsonResponse({ detail: 'boom' }, 500))
    render(<PositionsProgressPanel onSelectOfficial={() => {}} />)
    expect(await screen.findByText('Stated positions: 98 of 535 processed')).toBeInTheDocument()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(screen.getByText('Stated positions: 98 of 535 processed')).toBeInTheDocument()
    expect(screen.getByText('(refresh failed)')).toBeInTheDocument()
  })

  it('skips refreshes while the tab is hidden', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(progress))
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    render(<PositionsProgressPanel onSelectOfficial={() => {}} />)
    await screen.findByText('Stated positions: 98 of 535 processed')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000)
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    visibility.mockReturnValue('visible')
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
