import { ChevronDown, ChevronRight, ExternalLink, Search, X } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { apiUrl } from '../api'
import {
  PAC_CATEGORY_COLORS,
  formatDateRange,
  formatMoney,
  pacParams,
} from '../campaignFinance'
import type { FinanceElection, Pac, PacGift, PacList, PacSummary } from '../types'
import { LegendSwatch } from './financeParts'

const PAGE_SIZE = 50
const SEARCH_DEBOUNCE_MS = 250

const SORTS = [
  { value: 'amount', label: 'Largest total' },
  { value: 'gifts', label: 'Most gifts' },
  { value: 'recent', label: 'Most recent' },
  { value: 'name', label: 'Name A–Z' },
] as const
type Sort = (typeof SORTS)[number]['value']

// Every PAC that gave in one election, searchable and filterable. Opens over
// the member drawer; Escape closes only this panel.
export default function PacExplorer({
  officialId,
  election,
  summary,
  onClose,
}: {
  officialId: string
  election: FinanceElection
  summary: PacSummary
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [category, setCategory] = useState<string | null>(null)
  const [sort, setSort] = useState<Sort>('amount')
  const [list, setList] = useState<PacList | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [offset, setOffset] = useState(0)
  const [expanded, setExpanded] = useState<string | null>(null)

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopImmediatePropagation()
        onClose()
      }
    }
    // Capture phase, so the member drawer's own Escape handler never sees it.
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [onClose])

  // Any filter change starts the list over from the first page.
  function restart() {
    setOffset(0)
    setExpanded(null)
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const next = query.trim()
      if (next !== debouncedQuery) {
        setDebouncedQuery(next)
        restart()
      }
    }, SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [query, debouncedQuery])

  useEffect(() => {
    const controller = new AbortController()
    const params = pacParams(election)
    params.set('sort', sort)
    params.set('limit', String(PAGE_SIZE))
    params.set('offset', String(offset))
    if (debouncedQuery) {
      params.set('q', debouncedQuery)
    }
    if (category) {
      params.set('category', category)
    }
    setLoading(true)
    setError(null)
    fetch(
      apiUrl(`/api/officials/${encodeURIComponent(officialId)}/finance/pacs/list?${params}`),
      { signal: controller.signal },
    )
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`Failed to load PACs (${res.status})`)
        }
        return res.json() as Promise<PacList>
      })
      .then((page) => {
        setList((previous) =>
          offset > 0 && previous
            ? { total_count: page.total_count, items: [...previous.items, ...page.items] }
            : page,
        )
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return
        }
        setError(err instanceof Error ? err.message : 'Failed to load PACs')
        setLoading(false)
      })
    return () => controller.abort()
  }, [officialId, election, debouncedQuery, category, sort, offset])

  const items = list?.items ?? []
  const color = (key: string) => PAC_CATEGORY_COLORS[key] ?? PAC_CATEGORY_COLORS.other

  return createPortal(
    <div className="fixed inset-0 z-[60] flex justify-end">
      <button
        type="button"
        className="absolute inset-0 bg-slate-950/70"
        aria-label="Close PAC list"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="pac-explorer-title"
        className="relative flex h-dvh w-full max-w-lg flex-col border-l border-slate-700 bg-slate-900 shadow-2xl"
      >
        <header className="shrink-0 border-b border-slate-800 px-5 py-3">
          <div className="flex items-center justify-between gap-3">
            <h2 id="pac-explorer-title" className="text-sm font-semibold text-slate-100">
              PAC contributions · {election.election_year} election
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <label className="relative mt-3 block">
            <span className="sr-only">Search PACs by name</span>
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500"
              aria-hidden="true"
            />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search PACs by name"
              className="w-full rounded-md border border-slate-700 bg-slate-950 py-1.5 pl-9 pr-3 text-sm text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
            />
          </label>

          <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Category">
            <CategoryChip
              active={category === null}
              onClick={() => {
                setCategory(null)
                restart()
              }}
            >
              All · {summary.pac_count}
            </CategoryChip>
            {summary.categories.map((c) => (
              <CategoryChip
                key={c.key}
                active={category === c.key}
                onClick={() => {
                  setCategory(category === c.key ? null : c.key)
                  restart()
                }}
                color={color(c.key)}
              >
                {c.label} · {c.pac_count}
              </CategoryChip>
            ))}
          </div>

          <div className="mt-2 flex items-center justify-between gap-2 text-xs text-slate-400">
            <span aria-live="polite">
              {list ? `${list.total_count} ${list.total_count === 1 ? 'PAC' : 'PACs'}` : ''}
            </span>
            <label className="flex items-center gap-1.5">
              Sort
              <select
                value={sort}
                onChange={(event) => {
                  setSort(event.target.value as Sort)
                  restart()
                }}
                className="rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 text-xs text-slate-200"
              >
                {SORTS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
          {error ? <p className="text-sm text-rose-300">{error}</p> : null}
          {!error && list && items.length === 0 ? (
            <p className="text-sm text-slate-400">No PACs match.</p>
          ) : null}
          <ul className="divide-y divide-slate-800">
            {items.map((pac) => (
              <PacRow
                key={pac.pac_key}
                pac={pac}
                color={color(pac.category)}
                open={expanded === pac.pac_key}
                onToggle={() => setExpanded(expanded === pac.pac_key ? null : pac.pac_key)}
                officialId={officialId}
                election={election}
              />
            ))}
          </ul>
          {loading ? <p className="mt-3 text-sm text-slate-400">Loading…</p> : null}
          {!loading && list && items.length < list.total_count ? (
            <button
              type="button"
              onClick={() => setOffset(items.length)}
              className="mt-3 w-full rounded-md border border-slate-700 py-1.5 text-xs text-slate-300 hover:border-slate-500"
            >
              Show more ({list.total_count - items.length} left)
            </button>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  )
}

function CategoryChip({
  active,
  onClick,
  color,
  children,
}: {
  active: boolean
  onClick: () => void
  color?: string
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] transition ${
        active
          ? 'border-emerald-400 bg-emerald-500/20 text-emerald-100'
          : 'border-slate-700 text-slate-300 hover:border-slate-500'
      }`}
    >
      {color ? <LegendSwatch color={color} /> : null}
      {children}
    </button>
  )
}

function PacRow({
  pac,
  color,
  open,
  onToggle,
  officialId,
  election,
}: {
  pac: Pac
  color: string
  open: boolean
  onToggle: () => void
  officialId: string
  election: FinanceElection
}) {
  return (
    <li className="py-2">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-start gap-2 text-left"
      >
        {open ? (
          <ChevronDown className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden="true" />
        ) : (
          <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden="true" />
        )}
        <span className="mt-0.5">
          <LegendSwatch color={color} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-xs text-slate-100">{pac.name}</span>
          <span className="text-[10px] text-slate-500">
            {pac.category_label} · {pac.gift_count} {pac.gift_count === 1 ? 'gift' : 'gifts'} ·{' '}
            {formatDateRange(pac.first_date, pac.last_date)}
          </span>
        </span>
        <span className="shrink-0 text-xs tabular-nums text-slate-200">{formatMoney(pac.total)}</span>
      </button>
      {open ? <PacGifts officialId={officialId} election={election} pac={pac} /> : null}
    </li>
  )
}

function PacGifts({
  officialId,
  election,
  pac,
}: {
  officialId: string
  election: FinanceElection
  pac: Pac
}) {
  const [gifts, setGifts] = useState<PacGift[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    const params = pacParams(election)
    params.set('pac_key', pac.pac_key)
    fetch(
      apiUrl(`/api/officials/${encodeURIComponent(officialId)}/finance/pacs/gifts?${params}`),
      { signal: controller.signal },
    )
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`Failed to load gifts (${res.status})`)
        }
        return res.json() as Promise<PacGift[]>
      })
      .then(setGifts)
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return
        }
        setError(err instanceof Error ? err.message : 'Failed to load gifts')
      })
    return () => controller.abort()
  }, [officialId, election, pac.pac_key])

  if (error) {
    return <p className="ml-6 mt-1 text-[11px] text-rose-300">{error}</p>
  }
  if (!gifts) {
    return <p className="ml-6 mt-1 text-[11px] text-slate-500">Loading gifts…</p>
  }
  return (
    <ul className="ml-6 mt-1.5 space-y-0.5 text-[11px]">
      {gifts.map((gift) => (
        <li key={gift.sub_id} className="flex items-center gap-3 text-slate-300">
          <span className="w-20 tabular-nums text-slate-400">{gift.receipt_date ?? 'N/A'}</span>
          <span className="w-16 text-right tabular-nums">{formatMoney(gift.amount)}</span>
          {gift.pdf_url ? (
            <a
              href={gift.pdf_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-0.5 text-emerald-400 hover:text-emerald-300"
            >
              Filing
              <ExternalLink className="h-3 w-3" aria-hidden="true" />
            </a>
          ) : null}
        </li>
      ))}
      {pac.committee_id ? (
        <li>
          <a
            href={`https://www.fec.gov/data/committee/${pac.committee_id}/`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-0.5 text-emerald-400 hover:text-emerald-300"
          >
            {pac.committee_id} on FEC.gov
            <ExternalLink className="h-3 w-3" aria-hidden="true" />
          </a>
        </li>
      ) : null}
    </ul>
  )
}
