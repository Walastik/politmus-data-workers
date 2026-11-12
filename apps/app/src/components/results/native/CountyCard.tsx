import {
  PARTY_COLOR,
  countyLabel,
  countyMatchKey,
  countyNameForFeature,
  countyStanding,
  countyTurnout,
  formatPercent,
  formatVotes,
  partyKey,
  share,
  type RaceResult,
  type StateResults,
} from '@politmus/core/electionResults'
import { Pressable, Text, View } from 'react-native'

import { Dot } from './Overview'

// The tapped county's numbers, pinned under the map (web shows these in a
// hover tooltip). It's outside the map's layers, so no marker or column can
// ever cover it.
export function CountyCard({
  fips,
  featureName,
  results,
  race,
  onClose,
}: {
  fips: string
  featureName: string
  results: StateResults | undefined
  race: RaceResult | null
  onClose: () => void
}) {
  const key = countyMatchKey(countyNameForFeature(fips, featureName))
  const name = [...Object.keys(results?.counties ?? {}), ...Object.keys(race?.counties ?? {})].find(
    (county) => countyMatchKey(county) === key,
  )
  const standing = race && name ? countyStanding(race, name) : null
  const turnout = results && name ? countyTurnout(results, name) : null
  const row = name ? results?.counties[name] : undefined
  const label = results ? countyLabel(results, name ?? featureName) : featureName

  return (
    <View accessibilityLiveRegion="polite" className="gap-1.5 rounded-xl border border-slate-700 bg-[#090e1c]/95 px-3 py-2.5">
      <View className="flex-row items-center justify-between gap-3">
        <Text accessibilityRole="header" className="text-[13px] font-display text-slate-100">
          {label}
        </Text>
        <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close county details" hitSlop={12}>
          <Text className="font-sans text-base text-slate-400">✕</Text>
        </Pressable>
      </View>
      {race && standing ? (
        race.candidates
          .map((c, i) => ({ c, votes: standing.votes[i] ?? 0 }))
          .filter((entry) => entry.votes > 0)
          .sort((a, b) => b.votes - a.votes)
          .slice(0, 3)
          .map(({ c, votes }) => (
            <View key={c.name} className="flex-row items-center justify-between gap-3">
              <View className="min-w-0 shrink flex-row items-center gap-1.5">
                <Dot color={PARTY_COLOR[partyKey(c.party)]} />
                <Text numberOfLines={1} className="font-sans shrink text-xs text-slate-200">
                  {c.name}
                </Text>
              </View>
              <Text style={{ fontVariant: ['tabular-nums'] }} className="text-xs font-sans-bold text-slate-100">
                {formatPercent(share(votes, standing.totalVotes))} <Text className="font-sans-medium text-slate-500">{formatVotes(votes)}</Text>
              </Text>
            </View>
          ))
      ) : (
        <Text className="font-sans text-xs text-slate-400">{race ? 'Not part of this race.' : 'No counts for this county.'}</Text>
      )}
      {turnout !== null && row ? (
        <View className="flex-row items-center justify-between gap-3">
          <Text className="font-sans text-xs text-slate-200">Turnout</Text>
          <Text style={{ fontVariant: ['tabular-nums'] }} className="text-xs font-sans-bold text-slate-100">
            {formatPercent(turnout)} <Text className="font-sans-medium text-slate-500">of {formatVotes(row.registered)}</Text>
          </Text>
        </View>
      ) : null}
    </View>
  )
}
