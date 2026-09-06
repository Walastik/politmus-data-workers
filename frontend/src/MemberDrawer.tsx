import { X } from 'lucide-react'
import { useEffect, useState } from 'react'

import {
  partyBadgeClass,
  partyShort,
  positionBadgeClass,
  type Official,
  type OfficialDetail,
} from './types'

export default function MemberDrawer({
  official,
  onClose,
}: {
  official: Official
  onClose: () => void
}) {
  const [detail, setDetail] = useState<OfficialDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    setDetail(null)

    fetch(`/api/officials/${official.id}`, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`Failed to load votes (${res.status})`)
        }
        return res.json() as Promise<OfficialDetail>
      })
      .then((data) => {
        setDetail(data)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return
        }
        console.error(err)
        setError(err instanceof Error ? err.message : 'Failed to load votes')
        setLoading(false)
      })

    return () => controller.abort()
  }, [official.id])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const votes = detail?.votes ?? []

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <button
        type="button"
        className="absolute inset-0 bg-slate-950/70"
        aria-label="Close member details"
        onClick={onClose}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="member-drawer-title"
        className="relative z-50 flex h-full w-full max-w-md flex-col border-l border-slate-700 bg-slate-900 shadow-2xl"
      >
        <header className="flex items-start justify-between gap-3 border-b border-slate-800 p-5">
          <div>
            <div className="flex items-center gap-2">
              <span
                className={`text-xs px-2 py-0.5 rounded font-bold ${partyBadgeClass(official.party)}`}
              >
                {partyShort(official.party)}
              </span>
              <span className="text-xs text-slate-400">{official.state}</span>
            </div>
            <h2 id="member-drawer-title" className="mt-2 text-xl font-semibold">
              {official.name}
            </h2>
            <p className="mt-1 font-mono text-xs text-slate-500">{official.id}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-5">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Recorded votes
          </h3>
          {loading ? (
            <p className="mt-3 text-sm text-slate-400">Loading vote history...</p>
          ) : error ? (
            <p className="mt-3 text-sm text-red-400">{error}</p>
          ) : votes.length === 0 ? (
            <p className="mt-3 text-sm text-slate-400">
              No recorded votes in the ingested bills.
            </p>
          ) : (
            <ul className="mt-3 space-y-3">
              {votes.map((vote) => (
                <li
                  key={`${vote.bill_id}-${vote.position}`}
                  className="rounded-lg border border-slate-800 bg-slate-800/60 p-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="font-mono text-xs text-slate-400">{vote.bill_id}</p>
                    <span
                      className={`shrink-0 text-xs px-2 py-0.5 rounded font-bold ${positionBadgeClass(vote.position)}`}
                    >
                      {vote.position ?? 'Unknown'}
                    </span>
                  </div>
                  <p className="mt-1 text-sm font-medium leading-snug">
                    {vote.bill_title || 'Untitled bill'}
                  </p>
                  {vote.sponsor_name ? (
                    <p className="mt-1 text-xs text-slate-500">
                      Sponsor: {vote.sponsor_name}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </div>
  )
}
