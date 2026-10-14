import { ChevronDown, ChevronRight, Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'

import { apiUrl } from '../api'
import {
  formatRelativeTime,
  positionsStatusLabel,
  type Official,
  type PositionsProgress,
  type PositionsProgressItem,
} from '../types'

const PROGRESS_REFRESH_MS = 60_000

function officialFromItem(item: PositionsProgressItem): Official {
  return {
    id: item.official_id,
    name: item.name ?? item.official_id,
    state: item.state ?? '',
    party: item.party ?? '',
    office: item.office,
    district: item.district,
    // The worker only walks current members.
    current_member: true,
    phone: null,
    office_address: null,
    website_url: null,
    level: 'federal',
  }
}

function statusChipClass(status: string) {
  switch (status) {
    case 'ok':
      return 'border-purple-500/40 bg-purple-900/40 text-purple-200'
    case 'failed':
      return 'border-rose-800/70 bg-rose-950/60 text-rose-300'
    case 'blocked':
    case 'needs_js':
      return 'border-amber-800/70 bg-amber-950/60 text-amber-300'
    default:
      return 'border-slate-700 bg-slate-800 text-slate-300'
  }
}

export default function PositionsProgressPanel({
  onSelectOfficial,
}: {
  onSelectOfficial: (official: Official) => void
}) {
  const [progress, setProgress] = useState<PositionsProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [showRecent, setShowRecent] = useState(false)
  const [showProblems, setShowProblems] = useState(false)

  useEffect(() => {
    let controller: AbortController | null = null

    function load() {
      controller?.abort()
      const current = new AbortController()
      controller = current
      setRefreshing(true)
      fetch(apiUrl('/api/positions/progress'), { signal: current.signal })
        .then(async (res) => {
          if (!res.ok) {
            throw new Error(`Failed to load positions progress (${res.status})`)
          }
          return res.json() as Promise<PositionsProgress>
        })
        .then((data) => {
          setProgress(data)
          setError(null)
          setRefreshing(false)
        })
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === 'AbortError') {
            return
          }
          console.error(err)
          // Keep the last good numbers on screen.
          setError(err instanceof Error ? err.message : 'Failed to load positions progress')
          setRefreshing(false)
        })
    }

    function refreshIfVisible() {
      if (document.visibilityState === 'visible') {
        load()
      }
    }

    load()
    const interval = window.setInterval(refreshIfVisible, PROGRESS_REFRESH_MS)
    document.addEventListener('visibilitychange', refreshIfVisible)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', refreshIfVisible)
      controller?.abort()
    }
  }, [])

  if (!progress) {
    return (
      <section className="mb-6 rounded-xl border border-purple-500/30 bg-purple-950/10 p-4 text-sm">
        <p className={error ? 'text-red-400' : 'text-slate-400'}>
          {error ?? 'Loading stated positions progress...'}
        </p>
      </section>
    )
  }

  const byStatus = progress.by_status
  const ok = byStatus.ok ?? 0
  const percent = progress.population > 0 ? (ok / progress.population) * 100 : 0
  const otherAttempted = progress.population > 0 ? ((progress.attempted - ok) / progress.population) * 100 : 0
  const chips: [string, string, number][] = [
    ['ok', 'ok', ok],
    ['no_positions', 'no positions', (byStatus.no_positions ?? 0) + (byStatus.no_issue_pages ?? 0)],
    ['blocked', 'blocked', byStatus.blocked ?? 0],
    ['needs_js', 'needs JS', byStatus.needs_js ?? 0],
    ['failed', 'failed', byStatus.failed ?? 0],
    ['no_website', 'no website', byStatus.no_website ?? 0],
    ['not_attempted', 'not yet', progress.not_attempted],
  ]
  const lastUpdate = formatRelativeTime(progress.last_success_at)

  return (
    <section
      className="mb-6 rounded-xl border border-purple-500/30 bg-purple-950/10 p-4"
      aria-labelledby="positions-progress-title"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-purple-400" aria-hidden="true" />
          <h2 id="positions-progress-title" className="text-sm font-semibold text-purple-200">
            Stated positions: {ok.toLocaleString()} of {progress.population.toLocaleString()} processed
          </h2>
        </div>
        <p className="text-xs text-slate-400" aria-live="polite">
          {refreshing ? 'refreshing…' : lastUpdate ? `Last update ${lastUpdate}` : 'No successful runs yet'}
          {error ? <span className="ml-2 text-rose-300">(refresh failed)</span> : null}
        </p>
      </div>

      <div
        className="mt-3 flex h-2 overflow-hidden rounded-full bg-slate-800"
        role="progressbar"
        aria-label="Officials processed"
        aria-valuemin={0}
        aria-valuemax={progress.population}
        aria-valuenow={ok}
      >
        <div className="bg-purple-500" style={{ width: `${percent}%` }} />
        <div className="bg-slate-600" style={{ width: `${otherAttempted}%` }} />
      </div>

      <ul className="mt-3 flex flex-wrap gap-1.5 text-[11px]" aria-label="Status counts">
        {chips
          .filter(([key, , count]) => count > 0 || key === 'ok' || key === 'not_attempted')
          .map(([key, label, count]) => (
            <li key={key} className={`rounded border px-2 py-0.5 ${statusChipClass(key)}`}>
              {label} <span className="font-semibold">{count.toLocaleString()}</span>
            </li>
          ))}
        <li className="rounded border border-slate-700 bg-slate-900 px-2 py-0.5 text-slate-400">
          {progress.stances_total.toLocaleString()} positions saved
        </li>
      </ul>

      <ProgressList
        title={`Recent (${progress.recent.length})`}
        open={showRecent}
        onToggle={() => setShowRecent(!showRecent)}
        items={progress.recent}
        onSelect={(item) => onSelectOfficial(officialFromItem(item))}
      />
      <ProgressList
        title={`Problems (${progress.problems.length})`}
        open={showProblems}
        onToggle={() => setShowProblems(!showProblems)}
        items={progress.problems}
        onSelect={(item) => onSelectOfficial(officialFromItem(item))}
        showErrors
      />
    </section>
  )
}

function ProgressList({
  title,
  open,
  onToggle,
  items,
  onSelect,
  showErrors = false,
}: {
  title: string
  open: boolean
  onToggle: () => void
  items: PositionsProgressItem[]
  onSelect: (item: PositionsProgressItem) => void
  showErrors?: boolean
}) {
  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="inline-flex items-center gap-1 text-xs font-medium text-purple-300 hover:text-purple-200"
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        {title}
      </button>
      {open ? (
        items.length === 0 ? (
          <p className="mt-2 text-xs text-slate-500">None.</p>
        ) : (
          <ul className="mt-2 divide-y divide-slate-800 rounded-lg border border-slate-800 bg-slate-900/80">
            {items.map((item) => (
              <li key={item.official_id}>
                <button
                  type="button"
                  onClick={() => onSelect(item)}
                  className="w-full px-3 py-2 text-left text-xs transition hover:bg-slate-800"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium text-slate-100">
                      {item.name ?? item.official_id}
                      {item.state ? <span className="ml-1.5 text-slate-500">{item.state}</span> : null}
                    </span>
                    <span className="flex shrink-0 items-center gap-2 text-slate-400">
                      <span className={`rounded border px-1.5 py-0.5 text-[10px] ${statusChipClass(item.status)}`}>
                        {positionsStatusLabel(item.status)}
                      </span>
                      {item.status === 'ok' ? <span>{item.stances_saved ?? 0} positions</span> : null}
                      <span className="text-slate-500">{formatRelativeTime(item.last_attempt_at)}</span>
                    </span>
                  </div>
                  {showErrors && item.last_error ? (
                    <p className="mt-1 truncate text-rose-300/90" title={item.last_error}>
                      {item.last_error}
                    </p>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  )
}
