import { ChevronDown, ChevronRight, DollarSign } from 'lucide-react'
import { useEffect, useState } from 'react'

import { apiUrl } from '../api'
import type { FinanceElection, OfficialFinance } from '../types'

// Preview of OpenFEC data (fec_client.py). Shown only to signed-in users in
// the dev explorer until there is a real design for it.

const SIZE_LABELS: Record<number, string> = {
  0: '$200 and under',
  200: '$200–499',
  500: '$500–999',
  1000: '$1,000–1,999',
  2000: '$2,000+',
}

const money = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
})

function formatMoney(value: number | null | undefined) {
  return value == null ? '—' : money.format(value)
}

function formatShare(value: number | null | undefined) {
  return value == null ? '—' : `${Math.round(value * 100)}%`
}

export default function CampaignFinanceSection({ officialId }: { officialId: string }) {
  const [finance, setFinance] = useState<OfficialFinance | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showRaw, setShowRaw] = useState(false)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    setFinance(null)
    setError(null)
    fetch(apiUrl(`/api/officials/${encodeURIComponent(officialId)}/finance`), {
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`Failed to load campaign finance (${res.status})`)
        }
        return res.json() as Promise<OfficialFinance>
      })
      .then(setFinance)
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return
        }
        setError(err instanceof Error ? err.message : 'Failed to load campaign finance')
      })
    return () => controller.abort()
  }, [officialId])

  return (
    <section
      className="mb-6 rounded-xl border border-emerald-500/30 bg-emerald-950/10 p-4"
      aria-labelledby="campaign-finance-title"
    >
      <h3 id="campaign-finance-title">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-controls="campaign-finance-body"
          className="flex w-full items-center gap-2 text-xs font-semibold uppercase tracking-wider text-emerald-300 transition hover:text-emerald-200"
        >
          {open ? (
            <ChevronDown className="h-4 w-4 text-emerald-400" aria-hidden="true" />
          ) : (
            <ChevronRight className="h-4 w-4 text-emerald-400" aria-hidden="true" />
          )}
          <DollarSign className="h-4 w-4 text-emerald-400" aria-hidden="true" />
          Campaign Finance (preview)
        </button>
      </h3>

      {open ? (
        <div id="campaign-finance-body">
          {error ? (
            <p className="mt-2 text-xs text-rose-300">{error}</p>
          ) : !finance ? (
            <p className="mt-2 text-xs text-slate-400">Loading…</p>
          ) : finance.elections.length === 0 ? (
            <p className="mt-2 text-xs text-slate-400">
              {finance.fec_candidate_ids.length === 0
                ? 'No FEC candidate ID. Run fec_client.py crosswalk.'
                : `No totals loaded yet. Run fec_client.py totals --official-id ${officialId}.`}
            </p>
          ) : (
            <div className="mt-3 space-y-4">
              {finance.elections.map((election) => (
                <ElectionCard key={`${election.fec_candidate_id}-${election.election_year}`} election={election} />
              ))}
            </div>
          )}

          {finance ? (
            <div className="mt-3 border-t border-slate-800 pt-3">
              <p className="text-[11px] text-slate-500">
                Source: {finance.source}
                {finance.opensecrets_url ? (
                  <>
                    {' · '}
                    <a
                      href={finance.opensecrets_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-emerald-400 hover:text-emerald-300"
                    >
                      OpenSecrets
                    </a>
                  </>
                ) : null}
              </p>
              <button
                type="button"
                onClick={() => setShowRaw(!showRaw)}
                className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-emerald-400 transition hover:text-emerald-300"
              >
                {showRaw ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                {showRaw ? 'Hide raw JSON' : 'View raw JSON'}
              </button>
              {showRaw ? (
                <pre className="mt-2 max-h-72 overflow-auto rounded border border-slate-800 bg-slate-950 p-2 font-mono text-[11px] text-emerald-200">
                  {JSON.stringify(finance, null, 2)}
                </pre>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}

function ElectionCard({ election }: { election: FinanceElection }) {
  const sizes = election.size_breakdown ?? []
  const sizeTotal = sizes.reduce((sum, bucket) => sum + bucket.total, 0)
  const rows: [string, number | null | undefined][] = [
    ['Raised', election.receipts],
    ['Individuals (small, unitemized)', election.individual_unitemized],
    ['Individuals (itemized)', election.individual_itemized],
    ['PACs', election.pac_contributions],
    ['Party committees', election.party_contributions],
    ['Candidate (self + loans)', (election.candidate_contributions ?? 0) + (election.candidate_loans ?? 0)],
    ['Spent', election.disbursements],
    ['Cash on hand', election.cash_on_hand],
    ['Debts', election.debts],
  ]

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <h4 className="text-sm font-semibold text-slate-100">{election.election_year} election</h4>
        <a
          href={election.fec_url}
          target="_blank"
          rel="noreferrer"
          className="font-mono text-[11px] text-emerald-400 hover:text-emerald-300"
        >
          {election.fec_candidate_id}
        </a>
      </div>
      <p className="mt-0.5 text-[11px] text-slate-500">
        {election.coverage_start_date ?? '?'} → {election.coverage_end_date ?? '?'}
      </p>

      <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 text-xs">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-slate-400">{label}</dt>
            <dd className="text-right tabular-nums text-slate-200">{formatMoney(value)}</dd>
          </div>
        ))}
      </dl>

      {sizes.length > 0 ? (
        <div className="mt-3">
          <h5 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Individual gifts by size · {formatShare(election.small_dollar_share)} small-dollar
          </h5>
          <ul className="mt-1 space-y-1">
            {sizes.map((bucket) => (
              <li key={bucket.size} className="text-xs">
                <div className="flex justify-between text-slate-300">
                  <span>{SIZE_LABELS[bucket.size] ?? `$${bucket.size}+`}</span>
                  <span className="tabular-nums">{formatMoney(bucket.total)}</span>
                </div>
                <div className="mt-0.5 h-1.5 rounded bg-slate-800">
                  <div
                    className="h-1.5 rounded bg-emerald-500"
                    style={{ width: `${sizeTotal ? (bucket.total / sizeTotal) * 100 : 0}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {election.top_states?.length ? (
        <div className="mt-3">
          <h5 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Itemized gifts from home state · {formatShare(election.in_state_share)}
          </h5>
          <p className="mt-1 text-xs text-slate-300">
            Top states:{' '}
            {election.top_states
              .map((state) => `${state.state} ${formatMoney(state.total)}`)
              .join(' · ')}
          </p>
        </div>
      ) : null}
    </div>
  )
}
