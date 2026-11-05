import {
  houseRaces,
  isAggregated,
  raceKey,
  resultHighlights,
  senateRace,
  type RaceResult,
  type StateResults,
} from '@politmus/core/electionResults'
import type { CountyView, MapOffice } from '@politmus/core/resultsMap'
import { useQuery } from '@tanstack/react-query'
import { router, useLocalSearchParams, usePreventRemove } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AccessibilityInfo, ActivityIndicator, Platform, Text, View, useWindowDimensions } from 'react-native'
import { useReducedMotion } from 'react-native-reanimated'

import { CountyCard } from './native/CountyCard'
import { Hero, Toolbar } from './native/Hero'
import { Highlights, Sources } from './native/Highlights'
import { Legend } from './native/Legend'
import { COUNTIES_URL } from './native/mapShapes'
import { Overview } from './native/Overview'
import { StatePanel } from './native/StatePanel'
import { USMap, type CountyTap } from './native/USMap'
import { getJson, useSnapshot } from './snapshot'

// A state's first race on the chamber being viewed, falling back to
// whatever the state has.
function firstRace(results: StateResults | undefined, office: MapOffice): RaceResult | null {
  return (office === 'H' ? (houseRaces(results)[0] ?? senateRace(results)) : (senateRace(results) ?? houseRaces(results)[0])) ?? null
}

// The results explorer on iOS and Android (the web page is
// ElectionResults.web.tsx). On a phone everything stacks in one column:
// hero, chamber switch, map, then the races. See docs/results-mobile-plan.md.
export default function ElectionResults({ scrollTo }: { scrollTo?: (y: number, animated: boolean) => void } = {}) {
  const snapshotQuery = useSnapshot()
  const snapshot = snapshotQuery.data ?? null

  // The view is in the route (politmus://results?state=TX&race=TX-S&office=H),
  // like the query string on web, so a link opens the same state and race.
  const params = useLocalSearchParams<{ state?: string; race?: string; office?: string }>()
  const [office, setOffice] = useState<MapOffice>(params.office === 'H' ? 'H' : 'S')
  const [selected, setSelected] = useState<string | null>(params.state?.toUpperCase() ?? null)
  const [raceId, setRaceId] = useState<string | null>(params.race ?? null)
  const [countyView, setCountyView] = useState<CountyView>('lead')
  const [flagged, setFlagged] = useState<string | null>(null)
  const [tapped, setTapped] = useState<CountyTap | null>(null)

  // Only when the view changes: on a cold start from a link the params
  // already match, and navigation isn't ready to take setParams yet.
  const viewParams = { state: selected ?? undefined, race: raceId ?? undefined, office: office === 'H' ? 'H' : undefined }
  const paramsChanged =
    viewParams.state !== params.state || viewParams.race !== params.race || viewParams.office !== (params.office === 'H' ? 'H' : undefined)
  useEffect(() => {
    if (paramsChanged) router.setParams(viewParams)
  })

  const countiesTopo = useQuery({
    queryKey: ['topology', COUNTIES_URL],
    queryFn: () => getJson<unknown>(COUNTIES_URL),
    enabled: Boolean(selected),
    staleTime: Infinity,
  })

  const selectState = useCallback(
    (state: string | null, nextRace?: string | null) => {
      setSelected(state)
      setFlagged(null)
      setTapped(null)
      // Android reads the panel's live region; VoiceOver needs telling.
      if (Platform.OS === 'ios' && snapshot) {
        const name = state ? (snapshot.states[state]?.name ?? snapshot.senate?.find((s) => s.state === state)?.stateName ?? state) : null
        AccessibilityInfo.announceForAccessibility(name ? `${name} open` : 'All states')
      }
      if (!state || !snapshot) return setRaceId(null)
      if (nextRace) return setRaceId(nextRace)
      const first = firstRace(snapshot.states[state], office)
      setRaceId(first ? raceKey(state, first) : null)
    },
    [office, snapshot],
  )

  // With a state open, Back (Android's button, the iOS swipe or the header
  // arrow) closes the state first, like Escape on web.
  usePreventRemove(selected !== null, () => selectState(null))

  const highlights = useMemo(() => (snapshot ? resultHighlights(snapshot) : []), [snapshot])
  // Where the map sits in the page, so a highlight or a county in a list
  // can bring it back into view (web scrolls to the top instead).
  const stageY = useRef(0)
  const mapY = useRef(0)
  const reduceMotion = useReducedMotion()
  const showMap = () => scrollTo?.(Math.max(0, stageY.current + mapY.current - 12), !reduceMotion)
  // Tablets get the side-by-side layout (Tailwind's md breakpoint).
  const wide = useWindowDimensions().width >= 768

  const senateStates = useMemo(() => new Set((snapshot?.senate ?? []).map((info) => info.state)), [snapshot])

  if (!snapshot) {
    return (
      <View className="min-h-[60vh] flex-1 items-center justify-center gap-3 bg-slate-900 p-6">
        {snapshotQuery.isError ? (
          <Text className="text-center text-sm text-slate-400">Results are unavailable right now. Try again in a minute.</Text>
        ) : (
          <>
            <ActivityIndicator color="#94a3b8" />
            <Text className="text-center text-sm text-slate-400">Loading the latest counts…</Text>
          </>
        )}
      </View>
    )
  }

  const results = selected ? snapshot.states[selected] : undefined
  // A link with a state and no race opens on the chamber being viewed.
  const race = results?.races.find((r) => raceKey(results.state, r) === raceId) ?? (results && !raceId ? firstRace(results, office) : null)

  const highlightsBlock = (
    <Highlights
      highlights={highlights}
      bleed={!wide}
      onOpen={(h) => {
        if (h.raceKey?.includes('-H')) setOffice('H')
        selectState(h.state, h.raceKey)
        if (h.county) {
          setFlagged(h.county)
          setCountyView(h.kind.startsWith('turnout') ? 'turnout' : 'lead')
        }
        showMap()
      }}
    />
  )

  return (
    <View className="gap-4 bg-slate-900 px-4 pb-12 pt-5">
      <Hero snapshot={snapshot} />
      <Toolbar office={office} onOffice={setOffice} generatedAt={snapshot.generatedAt} />
      {/* On a phone everything stacks; from the md breakpoint (tablets) the
          panel sits beside the map, as on the web page. */}
      <View
        onLayout={(e) => {
          stageY.current = e.nativeEvent.layout.y
        }}
        className="gap-4 md:flex-row md:items-start"
      >
        <View className="min-w-0 gap-4 md:flex-1">
          <View
            onLayout={(e) => {
              mapY.current = e.nativeEvent.layout.y
            }}
            className="overflow-hidden rounded-[20px] border border-[#26324d] bg-slate-900"
          >
            <USMap
              snapshot={snapshot}
              office={office}
              senateStates={senateStates}
              selected={selected}
              race={race}
              results={results}
              countiesTopo={countiesTopo.data ?? null}
              countyView={countyView}
              flagged={flagged}
              tapped={tapped?.fips ?? null}
              onSelect={selectState}
              onCounty={(county) => setTapped((current) => (current?.fips === county.fips ? null : county))}
            />
            <View className="gap-2 border-t border-[#26324d] bg-slate-900/60 px-3.5 py-2.5">
              <Legend
                office={office}
                countyView={selected ? countyView : null}
                pending={(snapshot.senate ?? []).some((info) => !senateRace(snapshot.states[info.state]))}
                aggregated={Object.values(snapshot.states).some(isAggregated)}
              />
              {selected ? null : <Text className="text-xs text-slate-500">Tap a state to dig into its counties</Text>}
            </View>
          </View>
          {selected && tapped ? (
            <CountyCard fips={tapped.fips} featureName={tapped.name} results={results} race={race} onClose={() => setTapped(null)} />
          ) : null}
          {wide ? highlightsBlock : null}
        </View>
        <View className="md:w-[380px]">
          {selected ? (
            <StatePanel
              key={selected}
              state={selected}
              results={results}
              info={snapshot.senate?.find((info) => info.state === selected)}
              race={race}
              office={office}
              countyView={countyView}
              onCountyView={setCountyView}
              onRace={(key) => {
                setRaceId(key)
                setTapped(null)
              }}
              onFlag={(county) => {
                setFlagged(county)
                if (county) showMap()
              }}
              flagged={flagged}
              onBack={() => selectState(null)}
            />
          ) : (
            <Overview snapshot={snapshot} office={office} onSelect={selectState} />
          )}
        </View>
      </View>
      {wide ? null : highlightsBlock}
      <Sources snapshot={snapshot} />
    </View>
  )
}
