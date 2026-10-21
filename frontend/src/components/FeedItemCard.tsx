import {
  ChevronDown,
  ChevronRight,
  FilePlus2,
  Gavel,
  TrendingUp,
  UserMinus,
  UserPlus,
  Vote,
  XCircle,
} from 'lucide-react'
import { useState, type ComponentType } from 'react'

import { PolicyAreaTag } from '../BillDrawer'
import VoteTallyBar from '../VoteTallyBar'
import {
  billStub,
  formatBillDate,
  partyBadgeClass,
  partyShort,
  type Bill,
  type ChamberVoteSummary,
  type FeedItem,
  type Official,
} from '../types'

interface KindStyle {
  label: string
  icon: ComponentType<{ className?: string }>
  // Icon and label colour; one hue per kind of news.
  tone: string
}

function kindStyle(item: FeedItem, voteCount: number): KindStyle {
  switch (item.kind) {
    case 'bill_introduced':
      return { label: 'New bill', icon: FilePlus2, tone: 'text-blue-400' }
    case 'bill_status_changed': {
      const status = item.payload?.status ?? 'Bill moved'
      if (status === 'Became Law') {
        return { label: 'Became law', icon: Gavel, tone: 'text-emerald-400' }
      }
      if (status === 'Vetoed' || status === 'Failed') {
        return { label: status, icon: XCircle, tone: 'text-red-400' }
      }
      return { label: status, icon: TrendingUp, tone: 'text-sky-400' }
    }
    case 'vote_held': {
      const chamber = item.roll_call?.chamber ?? item.payload?.chamber ?? 'Floor'
      const result = item.roll_call?.result ?? item.payload?.result
      const votes = voteCount > 1 ? `${chamber} · ${voteCount} votes` : `${chamber} vote`
      return {
        label: result ? `${votes} · ${result}` : votes,
        icon: Vote,
        tone: 'text-slate-300',
      }
    }
    case 'official_seated':
      return { label: 'New in office', icon: UserPlus, tone: 'text-amber-400' }
    case 'official_departed':
      return { label: 'Left office', icon: UserMinus, tone: 'text-slate-400' }
  }
}

// VoteTallyBar reads bill-shaped summaries; put this one roll call's party
// tally under its chamber so the feed draws the same bar as the bills list.
function tallyAsBillSummary(item: FeedItem) {
  const byParty = item.tally_by_party
  const chamber = item.roll_call?.chamber === 'House' ? 'house' : 'senate'
  if (!byParty) return null
  const totals: ChamberVoteSummary = {}
  for (const positions of Object.values(byParty)) {
    for (const [position, count] of Object.entries(positions)) {
      totals[position] = (totals[position] ?? 0) + (count ?? 0)
    }
  }
  return {
    summary: { house: {}, senate: {}, [chamber]: totals },
    byParty: { house: {}, senate: {}, [chamber]: byParty },
  }
}

export default function FeedItemCard({
  item,
  related = [],
  onSelectBill,
  onSelectOfficial,
}: {
  item: FeedItem
  // Earlier same-day votes on this bill folded into this card.
  related?: FeedItem[]
  onSelectBill: (bill: Bill) => void
  onSelectOfficial: (official: Official) => void
}) {
  const [showRelated, setShowRelated] = useState(false)
  const { label, icon: Icon, tone } = kindStyle(item, related.length + 1)
  const official = item.official
  const bill = item.bill
  const tally = item.kind === 'vote_held' ? tallyAsBillSummary(item) : null

  const open = () => {
    if (bill) {
      onSelectBill({ ...billStub(bill.id), ...bill })
    } else if (official) {
      onSelectOfficial(official)
    }
  }
  const clickable = Boolean(bill || official)

  return (
    <article className="rounded-lg border border-slate-700 bg-slate-800 p-4 shadow-sm transition hover:border-slate-500 hover:bg-slate-800/80">
      <button
        type="button"
        onClick={open}
        disabled={!clickable}
        className="w-full text-left disabled:cursor-default"
        aria-label={`${label}: ${item.headline}`}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className={`inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider ${tone}`}>
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            {label}
          </p>
          <p className="text-xs text-slate-500">{formatBillDate(item.occurred_at)}</p>
        </div>

        <h3 className="mt-2 text-base font-semibold leading-snug">{item.headline}</h3>
        {item.subline ? (
          <p className="mt-1 line-clamp-2 text-sm text-slate-400">{item.subline}</p>
        ) : null}

        {bill || official ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {bill ? <p className="font-mono text-xs text-slate-400">{bill.id}</p> : null}
            {bill?.policy_area ? <PolicyAreaTag area={bill.policy_area} /> : null}
            {item.level === 'state' ? (
              <span className="rounded bg-slate-700/80 px-2 py-0.5 text-xs text-slate-300">
                State
              </span>
            ) : null}
            {official?.party ? (
              <span className={`rounded px-2 py-0.5 text-xs font-semibold ${partyBadgeClass(official.party)}`}>
                {partyShort(official.party)}
              </span>
            ) : null}
          </div>
        ) : null}

        {tally ? (
          <div className="mt-3">
            <VoteTallyBar summary={tally.summary} byParty={tally.byParty} />
          </div>
        ) : null}
      </button>

      {related.length > 0 ? (
        <div className="mt-3 border-t border-slate-700 pt-2">
          <button
            type="button"
            onClick={() => setShowRelated((open) => !open)}
            aria-expanded={showRelated}
            className="inline-flex items-center gap-1 text-xs text-slate-400 transition hover:text-slate-200"
          >
            {showRelated ? (
              <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            {showRelated ? 'Hide' : 'Show'} {related.length} earlier vote
            {related.length === 1 ? '' : 's'} that day
          </button>
          {showRelated ? (
            <ul className="mt-2 space-y-1">
              {related.map((vote) => (
                <li key={vote.id} className="flex justify-between gap-3 text-xs">
                  <span className="text-slate-300">
                    {vote.roll_call?.question ?? vote.subline ?? 'Roll call'}
                  </span>
                  <span className="shrink-0 text-slate-500">{vote.roll_call?.result}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </article>
  )
}
