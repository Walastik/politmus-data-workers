import { useEffect, useState } from 'react'

import { apiUrl } from './api'
import BillDrawer, { BillDates, PolicyAreaTag } from './BillDrawer'
import VoteTallyBar, { voteTotal } from './VoteTallyBar'
import type { Bill } from './types'

export default function BillsFeed() {
  const [bills, setBills] = useState<Bill[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedBill, setSelectedBill] = useState<Bill | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(null)

    fetch(apiUrl('/api/bills'), { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`Failed to load bills (${res.status})`)
        }
        return res.json() as Promise<Bill[]>
      })
      .then((data) => {
        setBills(Array.isArray(data) ? data : [])
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return
        }
        console.error(err)
        setError(err instanceof Error ? err.message : 'Failed to load bills')
        setBills([])
        setLoading(false)
      })

    return () => controller.abort()
  }, [])

  if (loading) {
    return <p className="text-slate-400">Loading legislation feed...</p>
  }
  if (error) {
    return (
      <p className="text-red-400">
        {error}. Check that the API is reachable and refresh.
      </p>
    )
  }
  if (bills.length === 0) {
    return <p className="text-slate-400">No bills have been ingested yet.</p>
  }

  const ordered = [...bills].sort((a, b) => {
    const aVotes = voteTotal(a.votes_summary)
    const bVotes = voteTotal(b.votes_summary)
    if (aVotes !== bVotes) {
      return bVotes - aVotes
    }
    return b.id.localeCompare(a.id)
  })

  return (
    <>
      <p className="mb-4 text-sm text-slate-400">
        Showing {ordered.length} bill{ordered.length === 1 ? '' : 's'}
      </p>
      <div className="space-y-3">
        {ordered.map((bill) => (
          <article
            key={bill.id}
            className="rounded-lg border border-slate-700 bg-slate-800 p-4 shadow-sm transition hover:border-slate-500 hover:bg-slate-800/80"
          >
            <button
              type="button"
              onClick={() => setSelectedBill(bill)}
              className="w-full text-left"
              aria-label={`Open details for ${bill.title || bill.id}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="font-mono text-xs text-slate-400">{bill.id}</p>
                <SponsorTag bill={bill} />
              </div>
              <h3 className="mt-2 text-base font-semibold leading-snug">
                {bill.title || 'Untitled bill'}
              </h3>
              {bill.policy_area ? (
                <div className="mt-2">
                  <PolicyAreaTag area={bill.policy_area} />
                </div>
              ) : null}
              <BillDates bill={bill} className="mt-2" />
              <div className="mt-3">
                <VoteTallyBar summary={bill.votes_summary} />
              </div>
            </button>
          </article>
        ))}
      </div>
      {selectedBill ? (
        <BillDrawer
          bill={selectedBill}
          onClose={() => setSelectedBill(null)}
        />
      ) : null}
    </>
  )
}

function SponsorTag({ bill }: { bill: Bill }) {
  if (!bill.sponsor_name && !bill.sponsor_bioguide_id) {
    return <span className="text-xs text-slate-500">No sponsor listed</span>
  }

  return (
    <span className="max-w-full truncate rounded bg-slate-700/80 px-2 py-0.5 text-xs text-slate-200">
      {bill.sponsor_name || bill.sponsor_bioguide_id}
      {!bill.sponsor_id && bill.sponsor_bioguide_id ? (
        <span className="ml-1 text-slate-400">(not in roster)</span>
      ) : null}
    </span>
  )
}
