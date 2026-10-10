import { useEffect, useState } from 'react'

import { apiUrl } from './api'
import BillDrawer, { BillDates, BipartisanTag, PolicyAreaTag, StatusTag } from './BillDrawer'
import VoteTallyBar from './VoteTallyBar'
import type { Bill } from './types'



export default function BillsFeed() {
  const [bills, setBills] = useState<Bill[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedBill, setSelectedBill] = useState<Bill | null>(null)

  const [voteStatus, setVoteStatus] = useState<string>('all')
  const [pace, setPace] = useState<string>('all')
  const [status, setStatus] = useState<string>('all')
  const [sponsorParty, setSponsorParty] = useState<string>('all')
  const [bipartisan, setBipartisan] = useState<string>('all')
  const [sort, setSort] = useState<string>('voted_desc')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [total, setTotal] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(null)

    const params = new URLSearchParams()
    if (voteStatus !== 'all') params.set('vote_status', voteStatus)
    if (pace !== 'all') params.set('pace', pace)
    if (status !== 'all') params.set('status', status)
    if (sponsorParty !== 'all') params.set('sponsor_party', sponsorParty)
    if (bipartisan !== 'all') params.set('bipartisan', bipartisan)
    params.set('sort', sort)
    params.set('limit', String(pageSize))
    params.set('offset', String((page - 1) * pageSize))

    fetch(apiUrl(`/api/bills?${params.toString()}`), { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`Failed to load bills (${res.status})`)
        }
        return res.json() as Promise<{items: Bill[], total: number}>
      })
      .then((data) => {
        setBills(Array.isArray(data.items) ? data.items : [])
        setTotal(data.total || 0)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return
        }
        console.error(err)
        setError(err instanceof Error ? err.message : 'Failed to load bills')
        setBills([])
        setTotal(0)
        setLoading(false)
      })

    return () => controller.abort()
  }, [voteStatus, pace, status, sponsorParty, bipartisan, sort, page, pageSize])

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-slate-700 bg-slate-800 p-4 shadow-sm flex flex-wrap gap-4">
        <label className="flex flex-col text-sm text-slate-300">
          Vote Status
          <select value={voteStatus} onChange={(e) => { setVoteStatus(e.target.value); setPage(1); }} className="mt-1 rounded bg-slate-700 border-slate-600 px-2 py-1">
            <option value="all">All</option>
            <option value="voted">Voted On</option>
            <option value="pending">Awaiting Vote</option>
          </select>
        </label>
        <label className="flex flex-col text-sm text-slate-300">
          Result
          <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="mt-1 rounded bg-slate-700 border-slate-600 px-2 py-1">
            <option value="all">All</option>
            <option value="passed">Passed</option>
            <option value="failed">Failed</option>
          </select>
        </label>
        <label className="flex flex-col text-sm text-slate-300">
          Pace
          <select value={pace} onChange={(e) => { setPace(e.target.value); setPage(1); }} className="mt-1 rounded bg-slate-700 border-slate-600 px-2 py-1">
            <option value="all">All</option>
            <option value="very_fast">Very Fast</option>
            <option value="fast">Fast</option>
            <option value="average">Average</option>
            <option value="slow">Slow</option>
            <option value="very_slow">Very Slow</option>
          </select>
        </label>
        <label className="flex flex-col text-sm text-slate-300">
          Sponsor Party
          <select value={sponsorParty} onChange={(e) => { setSponsorParty(e.target.value); setPage(1); }} className="mt-1 rounded bg-slate-700 border-slate-600 px-2 py-1">
            <option value="all">All</option>
            <option value="Democratic">Democratic</option>
            <option value="Republican">Republican</option>
            <option value="Independent">Independent</option>
          </select>
        </label>
        <label className="flex flex-col text-sm text-slate-300">
          Support
          <select value={bipartisan} onChange={(e) => { setBipartisan(e.target.value); setPage(1); }} className="mt-1 rounded bg-slate-700 border-slate-600 px-2 py-1">
            <option value="all">All</option>
            <option value="single_party">Single Party</option>
            <option value="bipartisan">Bipartisan</option>
            <option value="tripartisan">Tripartisan</option>
          </select>
        </label>
        <label className="flex flex-col text-sm text-slate-300">
          Sort By
          <select value={sort} onChange={(e) => { setSort(e.target.value); setPage(1); }} className="mt-1 rounded bg-slate-700 border-slate-600 px-2 py-1">
            <option value="voted_desc">Voted On (Newest)</option>
            <option value="voted_asc">Voted On (Oldest)</option>
            <option value="introduced_desc">Introduced (Newest)</option>
            <option value="introduced_asc">Introduced (Oldest)</option>
          </select>
        </label>
        <label className="flex flex-col text-sm text-slate-300">
          Page Size
          <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }} className="mt-1 rounded bg-slate-700 border-slate-600 px-2 py-1">
            <option value="25">25</option>
            <option value="50">50</option>
            <option value="75">75</option>
            <option value="100">100</option>
          </select>
        </label>
      </div>

      {error ? (
        <p className="text-red-400">
          {error}. Check that the API is reachable and refresh.
        </p>
      ) : loading ? (
        <p className="text-slate-400">Loading legislation feed...</p>
      ) : bills.length === 0 ? (
        <p className="text-slate-400">No bills match your filters.</p>
      ) : (
        <>
          <p className="text-sm text-slate-400">
            Showing {bills.length}/{total} bill{total === 1 ? '' : 's'}
          </p>
      <div className="space-y-3">
        {bills.map((bill) => (
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
              {bill.status || bill.policy_area || bill.bipartisan_type ? (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <StatusTag status={bill.status} />
                  {bill.policy_area ? (
                    <PolicyAreaTag area={bill.policy_area} />
                  ) : null}
                  <BipartisanTag bill={bill} />
                </div>
              ) : null}
              <BillDates bill={bill} className="mt-2" />
              <div className="mt-3">
                <VoteTallyBar
                  summary={bill.votes_summary}
                  byParty={bill.votes_by_party}
                />
              </div>
            </button>
          </article>
        ))}
      </div>

      <div className="flex justify-between items-center mt-4">
        <button
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          disabled={page === 1}
          className="px-4 py-2 rounded bg-slate-700 disabled:opacity-50 hover:bg-slate-600 transition"
        >
          Previous
        </button>
        <span className="text-slate-400 text-sm">Page {page} of {Math.ceil(total / pageSize) || 1}</span>
        <button
          onClick={() => setPage((p) => p + 1)}
          disabled={page * pageSize >= total}
          className="px-4 py-2 rounded bg-slate-700 disabled:opacity-50 hover:bg-slate-600 transition"
        >
          Next
        </button>
      </div>

      {selectedBill ? (
        <BillDrawer
          bill={selectedBill}
          onClose={() => setSelectedBill(null)}
        />
      ) : null}
        </>
      )}
    </div>
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
