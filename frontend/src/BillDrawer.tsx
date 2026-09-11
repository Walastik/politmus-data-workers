import { X } from 'lucide-react'
import { useEffect, useState } from 'react'

import { apiUrl } from './api'
import VoteTallyBar from './VoteTallyBar'
import {
  bipartisanTypeFromParties,
  bipartisanTypeLabel,
  formatBillDate,
  formatCosponsorBreakdown,
  involvedParties,
  partyBadgeClass,
  sanitizeCrsHtml,
  type Bill,
} from './types'

export default function BillDrawer({
  bill,
  onClose,
}: {
  bill: Bill
  onClose: () => void
}) {
  const [detail, setDetail] = useState<Bill | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    setDetail(null)

    fetch(apiUrl(`/api/bills/${encodeURIComponent(bill.id)}`), {
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`Failed to load bill (${res.status})`)
        }
        return res.json() as Promise<Bill>
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
        setError(err instanceof Error ? err.message : 'Failed to load bill')
        setLoading(false)
      })

    return () => controller.abort()
  }, [bill.id])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const view = detail ?? bill
  const summary = view.summary

  return (
    <div className="fixed inset-0 z-[60] flex justify-end">
      <button
        type="button"
        className="absolute inset-0 bg-slate-950/70"
        aria-label="Close bill details"
        onClick={onClose}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="bill-drawer-title"
        className="relative z-[70] flex h-full w-full max-w-lg flex-col border-l border-slate-700 bg-slate-900 shadow-2xl"
      >
        <header className="flex items-start justify-between gap-3 border-b border-slate-800 p-5">
          <div className="min-w-0">
            <p className="font-mono text-xs text-slate-400">{view.id}</p>
            <h2
              id="bill-drawer-title"
              className="mt-2 text-xl font-semibold leading-snug"
            >
              {view.title || 'Untitled bill'}
            </h2>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <PolicyAreaTag area={view.policy_area} />
              <BipartisanTag bill={view} />
              <SponsorTag bill={view} />
            </div>
            <CosponsorLine bill={view} className="mt-2" />
            <BillDates bill={view} className="mt-3" />
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
          <div className="mb-5">
            <VoteTallyBar
              summary={view.votes_summary}
              byParty={view.votes_by_party}
            />
          </div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            CRS summary
          </h3>
          {error ? (
            <p className="mt-3 text-sm text-red-400">{error}</p>
          ) : summary ? (
            <CrsSummary text={summary} />
          ) : loading ? (
            <p className="mt-3 text-sm text-slate-400">Loading bill details...</p>
          ) : (
            <p className="mt-3 text-sm text-slate-400">
              No CRS summary has been ingested for this bill.
            </p>
          )}
        </div>
      </aside>
    </div>
  )
}

export function PolicyAreaTag({ area }: { area: string | null }) {
  if (!area) {
    return null
  }
  return (
    <span className="rounded-full bg-blue-900/50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-blue-300">
      {area}
    </span>
  )
}

export function BipartisanTag({ bill }: { bill: Bill }) {
  const parties = involvedParties(
    bill.sponsor_party,
    bill.cosponsor_party_breakdown,
  )
  const type = bipartisanTypeFromParties(parties) ?? bill.bipartisan_type
  const label = bipartisanTypeLabel(type, parties)
  if (!label) {
    return null
  }
  const color =
    type === 'tripartisan'
      ? 'bg-emerald-900/50 text-emerald-300'
      : type === 'bipartisan'
        ? 'bg-violet-900/50 text-violet-300'
        : parties[0]
          ? partyBadgeClass(parties[0])
          : 'bg-slate-700/80 text-slate-300'
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${color}`}
    >
      {label}
    </span>
  )
}

function CosponsorLine({
  bill,
  className = '',
}: {
  bill: Bill
  className?: string
}) {
  const hasBreakdown = bill.cosponsor_party_breakdown != null
  const breakdown = formatCosponsorBreakdown(bill.cosponsor_party_breakdown)
  if (!bill.sponsor_party && !hasBreakdown) {
    return null
  }
  const cosponsorText = hasBreakdown
    ? breakdown === 'No cosponsors'
      ? 'No cosponsors'
      : `Cosponsors ${breakdown}`
    : null
  return (
    <p className={`text-xs text-slate-400 ${className}`.trim()}>
      {bill.sponsor_party ? `Sponsor ${bill.sponsor_party}` : null}
      {bill.sponsor_party && cosponsorText ? ' · ' : null}
      {cosponsorText}
    </p>
  )
}

export function BillDates({
  bill,
  className = '',
}: {
  bill: Bill
  className?: string
}) {
  const introduced = formatBillDate(bill.introduced_date)
  const voted = formatBillDate(bill.voted_date)
  if (!introduced && !voted) {
    return null
  }

  return (
    <dl className={`flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400 ${className}`.trim()}>
      {introduced ? (
        <div>
          <dt className="inline text-slate-500">Introduced </dt>
          <dd className="inline text-slate-300">{introduced}</dd>
        </div>
      ) : null}
      {voted ? (
        <div>
          <dt className="inline text-slate-500">Voted </dt>
          <dd className="inline text-slate-300">{voted}</dd>
        </div>
      ) : null}
    </dl>
  )
}

function SponsorTag({ bill }: { bill: Bill }) {
  if (!bill.sponsor_name && !bill.sponsor_bioguide_id) {
    return <span className="text-xs text-slate-500">No sponsor listed</span>
  }

  return (
    <span className="max-w-full truncate text-xs text-slate-400">
      {bill.sponsor_name || bill.sponsor_bioguide_id}
      {!bill.sponsor_id && bill.sponsor_bioguide_id ? (
        <span className="ml-1 text-slate-500">(not in roster)</span>
      ) : null}
    </span>
  )
}

function CrsSummary({ text }: { text: string }) {
  const hasHtml = /<[a-z][\s\S]*>/i.test(text)
  if (!hasHtml) {
    return (
      <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-slate-300">
        {text}
      </p>
    )
  }

  return (
    <div
      className="mt-3 text-sm leading-relaxed text-slate-300 [&_a]:text-blue-300 [&_li]:mb-1 [&_p]:mb-2 [&_p:last-child]:mb-0 [&_strong]:font-semibold [&_strong]:text-slate-100 [&_ul]:list-disc [&_ul]:pl-5"
      dangerouslySetInnerHTML={{ __html: sanitizeCrsHtml(text) }}
    />
  )
}
