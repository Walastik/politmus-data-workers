import {
  MIN_MATCHES_FOR_PCT,
  formatPct,
  formatPoints,
  hasReliablePct,
  pctToneClass,
  plural,
  pointsToneClass,
} from '../accountability'

// Alignment % (the litmus number) beside raw points. Renders nothing for an
// official who is not scored (no stated positions yet).
export default function ScoreHeadline({
  points,
  pct,
  matches,
  size = 'card',
}: {
  points: number | null | undefined
  pct: number | null | undefined
  matches: number | null | undefined
  size?: 'card' | 'drawer'
}) {
  if (matches == null || points == null) {
    return null
  }
  if (matches === 0) {
    return (
      <p className="mt-3 text-[11px] text-slate-500" data-testid="score-headline">
        Litmus score: no passage votes on their stated positions yet
      </p>
    )
  }
  const reliable = hasReliablePct(matches, pct)
  const big = size === 'drawer' ? 'text-3xl' : 'text-2xl'
  return (
    <div
      className="mt-3 flex items-end justify-between gap-3 rounded-lg border border-slate-700 bg-slate-900/70 px-3 py-2"
      data-testid="score-headline"
    >
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Litmus</p>
        <p
          className={`${big} font-bold leading-none ${reliable ? pctToneClass(pct) : 'text-slate-500'}`}
          title={
            reliable
              ? 'Share of scored votes that match what they say they want'
              : `Shown after ${MIN_MATCHES_FOR_PCT} scored votes`
          }
        >
          {reliable ? formatPct(pct) : '—'}
        </p>
      </div>
      <div className="text-right">
        <p className={`text-lg font-bold leading-none ${pointsToneClass(points)}`}>
          {formatPoints(points)} <span className="text-xs font-semibold text-slate-400">pts</span>
        </p>
        <p className="mt-1 text-[10px] text-slate-500">
          {plural(matches, 'scored vote')}
          {reliable ? '' : ` · % after ${MIN_MATCHES_FOR_PCT}`}
        </p>
      </div>
    </div>
  )
}
