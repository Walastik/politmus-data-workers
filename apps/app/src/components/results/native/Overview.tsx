import {
  PARTY_COLOR,
  PARTY_SHORT,
  formatMargin,
  houseRaces,
  houseTally,
  isAggregated,
  partyKey,
  partyTint,
  raceKey,
  raceStanding,
  senateRace,
  type RaceResult,
  type ResultsSnapshot,
  type StateResults,
} from '@politmus/core/electionResults'
import type { MapOffice } from '@politmus/core/resultsMap'
import type { ReactNode } from 'react'
import { Pressable, Text, View } from 'react-native'

import { Face } from './Face'

type OnSelect = (state: string, race?: string) => void

// The panel with no state open: Senate races closest first, or every
// House seat by state.
export function Overview({ snapshot, office, onSelect }: { snapshot: ResultsSnapshot; office: MapOffice; onSelect?: OnSelect }) {
  if (office === 'H') {
    const states = Object.values(snapshot.states).filter((s) => houseRaces(s).length)
    return (
      <Panel>
        <Text accessibilityRole="header" className="text-xl font-extrabold text-slate-100">
          House races we’re counting
        </Text>
        <Source>
          Every House seat, by state. A yellow dot marks a seat where the sitting member is behind. States tagged civicAPI
          come from an independent aggregator, not the state.
        </Source>
        {states.map((s) => (
          <View key={s.state}>
            <Row onPress={onSelect && (() => onSelect(s.state))} label={`${s.name} House results`}>
              <View className="min-w-0 flex-1 flex-row items-center">
                <Text className="text-sm font-bold text-slate-100">{s.name}</Text>
                {isAggregated(s) ? <AggTag /> : null}
              </View>
              <View className="flex-row gap-2">
                {houseTally(s).map((t) => (
                  <Text key={t.party} style={{ color: PARTY_COLOR[t.party] }} className="text-sm font-bold">
                    {PARTY_SHORT[t.party]} {t.leading}
                  </Text>
                ))}
              </View>
            </Row>
            <SeatGrid state={s} selected={null} onSelect={onSelect && ((key) => onSelect(s.state, key))} />
          </View>
        ))}
      </Panel>
    )
  }

  const counted = Object.values(snapshot.states)
    .map((s) => ({ s, race: senateRace(s) }))
    .filter((x): x is { s: StateResults; race: RaceResult } => Boolean(x.race))
    .map((x) => ({ ...x, standing: raceStanding(x.race) }))
    .sort((a, b) => a.standing.margin - b.standing.margin)
  const pending = (snapshot.senate ?? []).filter((info) => !senateRace(snapshot.states[info.state]))

  return (
    <Panel>
      <Heading>Senate, closest first</Heading>
      <View className="gap-1">
        {counted.map(({ s, standing }) => {
          const color = PARTY_COLOR[partyKey(standing.leader?.party)]
          return (
            <Row
              key={s.state}
              onPress={onSelect && (() => onSelect(s.state))}
              label={`${s.name}: ${standing.leader?.name ?? 'no votes yet'} leads by ${formatMargin(standing.margin)}`}
            >
              <View className="min-w-0 flex-1 flex-row items-center gap-2">
                <Dot color={color} />
                <Text numberOfLines={1} className="min-w-0 shrink text-sm text-slate-500">
                  <Text className="font-bold text-slate-100">{s.name}</Text> {standing.leader?.name}
                </Text>
                {isAggregated(s) ? <AggTag /> : null}
              </View>
              <Text style={{ color, fontVariant: ['tabular-nums'] }} className="text-sm font-bold">
                {formatMargin(standing.margin)}
              </Text>
            </Row>
          )
        })}
      </View>
      {pending.length ? (
        <>
          <View className="gap-1.5">
            <Heading>Counts on state sites</Heading>
            <Source>
              We haven’t connected these states’ official results yet. Tap one for the candidates and a link to its count.
            </Source>
          </View>
          <View className="flex-row flex-wrap gap-2">
            {pending.map((info) => (
              <Pressable
                key={info.state}
                disabled={!onSelect}
                onPress={() => onSelect?.(info.state)}
                accessibilityRole={onSelect ? 'button' : undefined}
                className="min-h-[44px] grow basis-[45%] flex-row items-center justify-between gap-2 rounded-[10px] bg-[#1a2540] px-2.5 py-2"
              >
                <Text className="text-sm text-slate-200">{info.stateName}</Text>
                <View className="flex-row">
                  {info.candidates.slice(0, 3).map((c, i) => (
                    <View key={c.name} style={{ marginLeft: i ? -6 : 0 }}>
                      <Face name={c.name} profile={c.profile} party={c.party} size={26} />
                    </View>
                  ))}
                </View>
              </Pressable>
            ))}
          </View>
        </>
      ) : null}
    </Panel>
  )
}

// Every House seat in a state as a tile, tinted by the leader; a yellow dot
// marks a seat where the sitting member is behind.
export function SeatGrid({
  state,
  selected,
  onSelect,
}: {
  state: StateResults
  selected: string | null
  onSelect?: (key: string) => void
}) {
  return (
    <View className="flex-row flex-wrap gap-1.5 px-2.5 pb-2.5 pt-1">
      {houseRaces(state).map((race) => {
        const standing = raceStanding(race)
        const key = raceKey(state.state, race)
        const incumbent = race.candidates.find((c) => c.incumbent)
        const flip = Boolean(incumbent && standing.leader && incumbent !== standing.leader)
        return (
          <Pressable
            key={key}
            disabled={!onSelect}
            onPress={() => onSelect?.(key)}
            accessibilityRole={onSelect ? 'button' : undefined}
            accessibilityState={{ selected: selected === key }}
            accessibilityLabel={`${state.state}-${race.district}: ${standing.leader?.name ?? 'No votes yet'}${flip ? ', sitting member behind' : ''}`}
            style={{ backgroundColor: standing.leader ? partyTint(standing.leader.party, standing.margin) : '#1e293b' }}
            className={`h-11 w-11 items-center justify-center rounded-[9px] border ${selected === key ? 'border-slate-200' : 'border-transparent'}`}
          >
            <Text className="text-xs font-extrabold text-slate-100">{race.district}</Text>
            {flip ? (
              <View className="absolute -right-[3px] -top-[3px] h-2.5 w-2.5 rounded-full border-2 border-[#131d33] bg-amber-200" />
            ) : null}
          </Pressable>
        )
      })}
    </View>
  )
}

// ---- Building blocks shared by the panels ----

export function Panel({ children }: { children: ReactNode }) {
  return <View className="gap-3.5 rounded-[20px] border border-[#26324d] bg-[#131d33] p-4">{children}</View>
}

export function Heading({ children }: { children: ReactNode }) {
  return (
    <Text accessibilityRole="header" className="text-xs font-bold uppercase tracking-widest text-slate-500">
      {children}
    </Text>
  )
}

export function Source({ children }: { children: ReactNode }) {
  return <Text className="text-xs leading-[18px] text-slate-500">{children}</Text>
}

export function Dot({ color }: { color: string }) {
  return <View style={{ backgroundColor: color }} className="h-2 w-2 rounded-full" />
}

export function AggTag() {
  return (
    <View className="ml-1.5 rounded-full border border-dashed border-amber-300/60 px-1.5">
      <Text className="text-[10px] font-bold text-amber-300">civicAPI</Text>
    </View>
  )
}

// A list row; tappable once there's somewhere to go.
export function Row({ onPress, label, children }: { onPress?: () => void; label?: string; children: ReactNode }) {
  return (
    <Pressable
      disabled={!onPress}
      onPress={onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={label}
      className="min-h-[44px] flex-row items-center justify-between gap-2.5 rounded-[10px] px-2.5 py-2 active:bg-[#1a2540]"
    >
      {children}
    </Pressable>
  )
}
