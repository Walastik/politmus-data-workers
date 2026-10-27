import { Sparkles } from 'lucide-react'

import { formatPct, formatPoints, hasReliablePct, pctToneClass, pointsToneClass } from '../accountability'
import {
  officeLine,
  officialName,
  partyBadgeClass,
  partyShort,
  positionsStatusLabel,
  rosterStatusLabel,
  type Official,
} from '../types'
import OfficialPhoto from './OfficialPhoto'
import ScoreHeadline from './ScoreHeadline'

// A member as a clickable card. `full` is the roster card (score block and
// positions badge); `compact` is one line for the chamber views.
export default function MemberCard({
  official,
  onSelect,
  variant = 'full',
  subtitle,
  showStatus = false,
}: {
  official: Official
  onSelect: (official: Official) => void
  variant?: 'full' | 'compact'
  subtitle?: string
  showStatus?: boolean
}) {
  const name = officialName(official)
  if (variant === 'compact') {
    return (
      <button
        type="button"
        onClick={() => onSelect(official)}
        className={`flex w-full items-center gap-2.5 rounded-md border-l-2 bg-slate-800/70 px-2.5 py-2 text-left transition hover:bg-slate-700/70 ${partyEdgeClass(official.party)}`}
      >
        <OfficialPhoto url={official.photo_url} name={name} party={official.party} size="sm" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-slate-100">{name}</span>
          <span className="block truncate text-[11px] text-slate-400">
            {partyShort(official.party)}
            {subtitle ? ` · ${subtitle}` : ''}
          </span>
        </span>
        <ScoreChip official={official} />
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={() => onSelect(official)}
      className="flex h-full flex-col rounded-lg border border-slate-700 bg-slate-800 p-4 text-left shadow-sm transition hover:border-slate-500 hover:bg-slate-800/80"
    >
      <div className="flex items-start justify-between">
        <span className={`rounded px-2 py-0.5 text-xs font-bold ${partyBadgeClass(official.party)}`}>
          {partyShort(official.party)}
        </span>
        <span className="text-xs text-slate-400">{official.state}</span>
      </div>
      <h3 className="mt-2 text-base font-semibold">{name}</h3>
      <p className="mt-1 text-xs text-slate-400">{subtitle ?? officeLine(official)}</p>
      {showStatus ? (
        <p className="mt-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          {rosterStatusLabel(official)}
        </p>
      ) : null}
      <ScoreHeadline points={official.score_points} pct={official.score_pct} matches={official.score_matches} />
      <PositionsCardBadge official={official} />
    </button>
  )
}

// The Politmus Score in a few characters: the % once it's reliable, else points.
export function ScoreChip({ official }: { official: Pick<Official, 'score_points' | 'score_pct' | 'score_matches'> }) {
  const { score_points: points, score_pct: pct, score_matches: matches } = official
  if (points == null || !matches) {
    return (
      <span className="shrink-0 text-[11px] text-slate-600" title="Not scored yet">
        N/A
      </span>
    )
  }
  const reliable = hasReliablePct(matches, pct)
  return (
    <span
      className={`shrink-0 rounded bg-slate-900/70 px-1.5 py-0.5 text-xs font-bold tabular-nums ${
        reliable ? pctToneClass(pct) : pointsToneClass(points)
      }`}
      title={`Politmus Score · ${matches} scored vote${matches === 1 ? '' : 's'}`}
    >
      {reliable ? formatPct(pct) : `${formatPoints(points)} pts`}
    </span>
  )
}

export function PositionsCardBadge({ official }: { official: Official }) {
  if (official.positions_status === 'ok') {
    return (
      <span className="mt-2 inline-flex items-center gap-1 self-start rounded border border-purple-500/40 bg-purple-900/40 px-1.5 py-0.5 text-[10px] font-semibold text-purple-200">
        <Sparkles className="h-3 w-3" aria-hidden="true" />
        AI positions ({official.positions_count ?? 0})
      </span>
    )
  }
  const label = positionsStatusLabel(official.positions_status)
  return label ? <p className="mt-2 text-[10px] uppercase tracking-wider text-slate-500">{label}</p> : null
}

export function partyEdgeClass(party: string | null | undefined) {
  if (party === 'Democratic' || party === 'D') return 'border-blue-500'
  if (party === 'Republican' || party === 'R') return 'border-red-500'
  return 'border-emerald-500'
}

export function partyFillClass(party: string | null | undefined) {
  if (party === 'Democratic' || party === 'D') return 'bg-blue-500'
  if (party === 'Republican' || party === 'R') return 'bg-red-500'
  return 'bg-emerald-500'
}
