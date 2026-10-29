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
  type FeedItem,
  type Official,
} from '@politmus/core/types'
import { feedKindStyle, tallyAsBillSummary, type FeedIcon } from '@politmus/core/feedItem'

const FEED_ICONS: Record<FeedIcon, ComponentType<{ className?: string }>> = {
  bill: FilePlus2,
  law: Gavel,
  failed: XCircle,
  progress: TrendingUp,
  vote: Vote,
  seated: UserPlus,
  departed: UserMinus,
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
  const { label, icon, tone } = feedKindStyle(item, related.length + 1)
  const Icon = FEED_ICONS[icon]
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
