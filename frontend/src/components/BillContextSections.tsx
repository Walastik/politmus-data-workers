import { ChevronDown, ChevronRight, MessagesSquare } from 'lucide-react'
import { useState, type ReactNode } from 'react'

import {
  committeeReportUrl,
  formatBillDate,
  partyBadgeClass,
  partyShort,
  type Bill,
  type BillAmendment,
  type BillDebate,
  type BillDocuments,
  type BillSourceSummary,
  type DebatePoint,
} from '../types'

function Collapsible({
  id,
  title,
  defaultOpen = false,
  children,
}: {
  id: string
  title: ReactNode
  defaultOpen?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className="mb-5">
      <h3>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-controls={id}
          className="flex w-full items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400 transition hover:text-white"
        >
          {open ? (
            <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          {title}
        </button>
      </h3>
      {open ? <div id={id}>{children}</div> : null}
    </section>
  )
}

function PartyChip({ party, state }: { party?: string | null; state?: string | null }) {
  if (!party && !state) return null
  const label = [party ? partyShort(party) : null, state].filter(Boolean).join('-')
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
        party ? partyBadgeClass(party) : 'bg-slate-800 text-slate-300'
      }`}
    >
      {label}
    </span>
  )
}

function partyCounts(parties: (string | null)[]) {
  const counts = new Map<string, number>()
  for (const party of parties) {
    const key = party || 'Unknown'
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts.entries()].map(([party, n]) => `${n} ${partyShort(party)}`).join(', ')
}

// -- debate --------------------------------------------------------------------

function DebatePointItem({ point }: { point: DebatePoint }) {
  const who = point.kind === 'committee_views' ? point.title : point.speaker
  return (
    <li className="rounded-lg border border-slate-800 bg-slate-900/80 p-3">
      <p className="text-xs leading-relaxed text-slate-100">{point.point}</p>
      <blockquote className="mt-2 border-l-2 border-slate-600 pl-2.5 text-[11px] italic text-slate-300">
        &ldquo;{point.quote}&rdquo;
      </blockquote>
      <p className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400">
        <span className="font-medium text-slate-300">
          {point.chamber && point.kind !== 'committee_views' ? `${point.chamber === 'Senate' ? 'Sen.' : 'Rep.'} ` : ''}
          {who || 'Unknown speaker'}
        </span>
        <PartyChip party={point.party} state={point.state} />
        {point.date ? <span>{formatBillDate(point.date)}</span> : null}
        {point.url ? (
          <a
            href={point.url}
            target="_blank"
            rel="noreferrer"
            className="text-sky-300 underline-offset-2 hover:underline"
          >
            {point.kind === 'committee_views' ? 'Committee report' : 'Congressional Record'}
          </a>
        ) : null}
      </p>
    </li>
  )
}

function DebateColumn({ label, points, empty }: { label: string; points: DebatePoint[]; empty: string }) {
  return (
    <div>
      <h4 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{label}</h4>
      {points.length > 0 ? (
        <ul className="mt-2 space-y-2">
          {points.map((point) => (
            <DebatePointItem key={`${point.source_id}-${point.quote}`} point={point} />
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-xs text-slate-500">{empty}</p>
      )}
    </div>
  )
}

/**
 * Each side's main arguments, in members' own words (quotes verified
 * against the Congressional Record). Sides are by argument, not party.
 */
export function DebateSection({ debate }: { debate?: BillDebate | null }) {
  if (!debate || (debate.supporters.length === 0 && debate.opponents.length === 0)) return null
  return (
    <section
      className="mb-5 rounded-xl border border-slate-700 bg-slate-800/40 p-4"
      aria-labelledby="debate-title"
    >
      <div className="flex items-center gap-2">
        <MessagesSquare className="h-4 w-4 text-slate-300" aria-hidden="true" />
        <h3 id="debate-title" className="text-xs font-semibold uppercase tracking-wider text-slate-300">
          Where the sides disagree
        </h3>
      </div>
      {debate.key_dispute ? (
        <p className="mt-2 text-sm leading-relaxed text-slate-100">{debate.key_dispute}</p>
      ) : null}
      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        <DebateColumn
          label="Supporters say"
          points={debate.supporters}
          empty="No arguments for the bill were found in the stored floor statements."
        />
        <DebateColumn
          label="Opponents say"
          points={debate.opponents}
          empty="No arguments against the bill were found in the stored floor statements."
        />
      </div>
      <p className="mt-3 text-[10px] leading-relaxed text-slate-500">
        AI summary of {debate.sources_considered ?? 'the'} stored floor statement
        {debate.sources_considered === 1 ? '' : 's'} and committee views. Every quote is checked word
        for word against its source. Sides are assigned by what members argued, not by party, and
        each side shows the same number of points.
      </p>
    </section>
  )
}

// -- amendments ------------------------------------------------------------------

function AmendmentItem({ amendment }: { amendment: BillAmendment }) {
  const [expanded, setExpanded] = useState(false)
  const label = `${amendment.chamber === 'House' ? 'H.Amdt.' : 'S.Amdt.'} ${amendment.number}`
  const description = amendment.purpose || amendment.text_excerpt
  return (
    <li className="rounded-lg border border-slate-800 bg-slate-800/40 px-3 py-2">
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="font-medium text-slate-100">{label}</span>
        <span className="text-slate-400">{amendment.sponsor_name || 'Unknown sponsor'}</span>
        <PartyChip party={amendment.sponsor_party} />
        {amendment.submitted_date ? (
          <span className="text-[11px] text-slate-500">{formatBillDate(amendment.submitted_date)}</span>
        ) : null}
      </div>
      <p className="mt-1 text-[11px] text-slate-400">
        {amendment.latest_action_text || 'Filed; no vote or other action recorded.'}
      </p>
      {description ? (
        <p className={`mt-1 text-[11px] text-slate-300 ${expanded ? '' : 'line-clamp-2'}`}>{description}</p>
      ) : null}
      <div className="mt-1 flex gap-3 text-[11px]">
        {description && description.length > 160 ? (
          <button type="button" onClick={() => setExpanded(!expanded)} className="text-sky-300 hover:underline">
            {expanded ? 'Show less' : 'Show more'}
          </button>
        ) : null}
        {amendment.text_url ? (
          <a href={amendment.text_url} target="_blank" rel="noreferrer" className="text-sky-300 hover:underline">
            Full text
          </a>
        ) : null}
      </div>
    </li>
  )
}

export function AmendmentsSection({ amendments }: { amendments?: BillAmendment[] }) {
  if (!amendments || amendments.length === 0) return null
  return (
    <Collapsible
      id="bill-amendments"
      title={`Amendments filed (${amendments.length}: ${partyCounts(amendments.map((a) => a.sponsor_party))})`}
    >
      <ul className="mt-3 space-y-2">
        {amendments.map((amendment) => (
          <AmendmentItem key={amendment.id} amendment={amendment} />
        ))}
      </ul>
    </Collapsible>
  )
}

// -- floor statements ----------------------------------------------------------------

export function FloorStatementsSection({ sources }: { sources?: BillSourceSummary[] }) {
  if (!sources || sources.length === 0) return null
  return (
    <Collapsible
      id="bill-floor-statements"
      title={`Floor statements (${sources.length}: ${partyCounts(sources.map((s) => s.speaker_party))})`}
    >
      <ul className="mt-3 space-y-1.5">
        {sources.map((source) => (
          <li key={source.id} className="flex flex-wrap items-center gap-1.5 text-xs text-slate-300">
            <span className="w-24 shrink-0 text-[11px] text-slate-500">
              {source.date ? formatBillDate(source.date) : ''} {source.chamber ?? ''}
            </span>
            <span className="font-medium text-slate-100">
              {source.kind === 'committee_views' ? source.title : source.speaker_name}
            </span>
            <PartyChip party={source.speaker_party} state={source.speaker_state} />
            <span className="text-[11px] text-slate-500">{source.words.toLocaleString()} words</span>
            {source.url ? (
              <a href={source.url} target="_blank" rel="noreferrer" className="text-[11px] text-sky-300 hover:underline">
                Read
              </a>
            ) : null}
          </li>
        ))}
      </ul>
    </Collapsible>
  )
}

// -- documents -------------------------------------------------------------------------

export function DocumentsSection({ documents }: { documents?: BillDocuments | null }) {
  const reports = documents?.committee_reports ?? []
  const estimates = documents?.cbo_cost_estimates ?? []
  if (reports.length === 0 && estimates.length === 0) return null
  return (
    <section className="mb-5">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Documents</h3>
      <ul className="mt-2 space-y-1 text-xs">
        {reports.map((report) => {
          const url = committeeReportUrl(report.citation)
          return (
            <li key={report.citation}>
              {url ? (
                <a href={url} target="_blank" rel="noreferrer" className="text-sky-300 hover:underline">
                  Committee report {report.citation}
                </a>
              ) : (
                <span className="text-slate-300">Committee report {report.citation}</span>
              )}
            </li>
          )
        })}
        {estimates.map((estimate) => (
          <li key={estimate.url}>
            <a href={estimate.url} target="_blank" rel="noreferrer" className="text-sky-300 hover:underline">
              CBO cost estimate
            </a>
            <span className="text-slate-500">
              {estimate.description ? ` · ${estimate.description}` : ''}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

export function BillContextSections({ bill }: { bill: Bill }) {
  return (
    <>
      <AmendmentsSection amendments={bill.amendments} />
      <FloorStatementsSection sources={bill.sources} />
      <DocumentsSection documents={bill.documents} />
    </>
  )
}
