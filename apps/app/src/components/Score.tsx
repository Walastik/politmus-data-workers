import {
  MIN_MATCHES_FOR_PCT,
  formatPct,
  formatPoints,
  hasReliablePct,
  pctToneClass,
  plural,
  pointsToneClass,
} from '@politmus/core/accountability'
import type { Official } from '@politmus/core/types'
import { Text, View } from 'react-native'

// Alignment % (the Politmus Score) beside raw points; nothing for an official
// who isn't scored. Native counterpart of the web ScoreHeadline.
export function ScoreHeadline({
  points,
  pct,
  matches,
}: {
  points: number | null | undefined
  pct: number | null | undefined
  matches: number | null | undefined
}) {
  if (matches == null || points == null) return null
  if (matches === 0) {
    return <Text className="mt-3 text-[11px] text-slate-500">Politmus Score: no passage votes on their stated positions yet</Text>
  }
  const reliable = hasReliablePct(matches, pct)
  return (
    <View
      className={`mt-3 flex-row ${reliable ? 'items-end' : 'items-center'} justify-between gap-3 rounded-lg border border-slate-700 bg-slate-900/70 px-3 py-2`}
    >
      <View>
        <Text className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Politmus Score</Text>
        {reliable ? <Text className={`text-2xl font-bold ${pctToneClass(pct)}`}>{formatPct(pct)}</Text> : null}
      </View>
      <View className="items-end">
        <Text className={`text-lg font-bold ${pointsToneClass(points)}`}>
          {formatPoints(points)} <Text className="text-xs font-semibold text-slate-400">pts</Text>
        </Text>
        <Text className="mt-1 text-[10px] text-slate-500">
          {plural(matches, 'scored vote')}
          {reliable ? '' : ` · % after ${MIN_MATCHES_FOR_PCT}`}
        </Text>
      </View>
    </View>
  )
}

// The Politmus Score in a few characters: the % once it's reliable, else points.
export function ScoreChip({ official }: { official: Pick<Official, 'score_points' | 'score_pct' | 'score_matches'> }) {
  const { score_points: points, score_pct: pct, score_matches: matches } = official
  if (points == null || !matches) {
    return <Text className="text-[11px] text-slate-600">—</Text>
  }
  const reliable = hasReliablePct(matches, pct)
  return (
    <Text
      className={`rounded bg-slate-900/70 px-1.5 py-0.5 text-xs font-bold ${reliable ? pctToneClass(pct) : pointsToneClass(points)}`}
    >
      {reliable ? formatPct(pct) : `${formatPoints(points)} pts`}
    </Text>
  )
}
