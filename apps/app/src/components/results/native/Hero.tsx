import {
  PARTY_COLOR,
  PARTY_SHORT,
  formatSourceTime,
  houseFlips,
  houseRaces,
  isAggregated,
  senateRace,
  senateTally,
  type ResultsSnapshot,
} from '@politmus/core/electionResults'
import type { MapOffice } from '@politmus/core/resultsMap'
import type { ReactNode } from 'react'
import { Pressable, Text, View } from 'react-native'

const TABULAR = { fontVariant: ['tabular-nums' as const] }

export function Hero({ snapshot }: { snapshot: ResultsSnapshot }) {
  const states = Object.values(snapshot.states)
  const tally = senateTally(snapshot)
  const counted = states.filter((s) => senateRace(s)).length
  const viaAggregator = states.filter((s) => senateRace(s) && isAggregated(s)).length
  const totalSenate = snapshot.senate?.length ?? counted
  const houseSeats = states.reduce((sum, s) => sum + houseRaces(s).length, 0)
  const flips = houseFlips(snapshot)
  return (
    <View className="gap-3">
      <View className="flex-row items-center gap-2">
        <View className="h-2 w-2 rounded-full bg-emerald-400" />
        <Text className="text-xs font-bold uppercase tracking-wider text-emerald-400">2026 midterms · Unofficial results</Text>
      </View>
      <Text accessibilityRole="header" className="text-3xl font-extrabold tracking-tight text-slate-100">
        How the midterms are counting
      </Text>
      <Text className="text-sm leading-5 text-slate-400">
        Most numbers here come straight from a state election office and update as they post new counts. States we can’t
        read directly come from civicAPI, an independent aggregator, and are marked with a dashed ring. A race marked Called
        has a winner projected by civicAPI while counting goes on, and a call can be wrong. Certified means the state has
        made its count final.
      </Text>
      <View className="flex-row gap-2.5">
        <ScoreCard
          label="Senate leads"
          note={`in ${counted} of ${totalSenate} races${viaAggregator ? `, ${viaAggregator} via civicAPI` : ''}`}
        >
          {tally.map((t) => (
            <Text key={t.party} style={[TABULAR, { color: PARTY_COLOR[t.party] }]} className="text-2xl font-extrabold">
              {PARTY_SHORT[t.party]} {t.leading}
            </Text>
          ))}
        </ScoreCard>
        <ScoreCard label="House seats changing hands" note={`of ${houseSeats} counted`}>
          {flips.length ? (
            flips.map((f) => (
              <Text key={f.party} style={[TABULAR, { color: PARTY_COLOR[f.party] }]} className="text-2xl font-extrabold">
                {PARTY_SHORT[f.party]} +{f.seats}
              </Text>
            ))
          ) : (
            <Text style={TABULAR} className="text-2xl font-extrabold text-slate-100">
              0
            </Text>
          )}
        </ScoreCard>
      </View>
    </View>
  )
}

function ScoreCard({ label, note, children }: { label: string; note: string; children: ReactNode }) {
  return (
    <View className="flex-1 rounded-2xl border border-[#26324d] bg-[#131d33] px-3.5 py-2.5">
      <Text className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{label}</Text>
      <View className="mt-1 flex-row flex-wrap items-baseline gap-x-2.5">{children}</View>
      <Text className="mt-0.5 text-xs font-semibold text-slate-400">{note}</Text>
    </View>
  )
}

// Senate or House, plus when the snapshot was taken.
export function Toolbar({
  office,
  onOffice,
  generatedAt,
}: {
  office: MapOffice
  onOffice: (office: MapOffice) => void
  generatedAt: string
}) {
  return (
    <View className="gap-2">
      <Segmented
        label="Chamber"
        value={office}
        options={[
          { value: 'S', label: 'Senate' },
          { value: 'H', label: 'House' },
        ]}
        onChange={onOffice}
      />
      <Text className="text-xs text-slate-500">Refreshes every minute · snapshot {formatSourceTime(generatedAt)}</Text>
    </View>
  )
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
}) {
  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel={label}
      className="flex-row self-start rounded-full border border-[#26324d] bg-[#131d33] p-[3px]"
    >
      {options.map((option) => {
        const active = option.value === value
        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(option.value)}
            hitSlop={{ top: 6, bottom: 6 }}
            className={`min-h-[38px] justify-center rounded-full px-4 ${active ? 'bg-slate-200' : ''}`}
          >
            <Text className={`text-sm font-semibold ${active ? 'text-slate-900' : 'text-slate-400'}`}>{option.label}</Text>
          </Pressable>
        )
      })}
    </View>
  )
}
