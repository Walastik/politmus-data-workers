import { isAggregated, senateRace } from '@politmus/core/electionResults'
import type { MapOffice } from '@politmus/core/resultsMap'
import { router, useLocalSearchParams } from 'expo-router'
import { useMemo, useState } from 'react'
import { ActivityIndicator, Text, View } from 'react-native'

import { Hero, Toolbar } from './native/Hero'
import { Legend } from './native/Legend'
import { Overview } from './native/Overview'
import { USMap } from './native/USMap'
import { useSnapshot } from './snapshot'

// The results explorer on iOS and Android (the web page is
// ElectionResults.web.tsx). On a phone everything stacks in one column:
// hero, chamber switch, then the races. See docs/results-mobile-plan.md.
export default function ElectionResults() {
  const snapshotQuery = useSnapshot()
  // The chamber is in the route (politmus://results?office=H), like the
  // query string on web, so a link opens the same view.
  const params = useLocalSearchParams<{ office?: string }>()
  const [office, setOfficeState] = useState<MapOffice>(params.office === 'H' ? 'H' : 'S')
  const setOffice = (next: MapOffice) => {
    setOfficeState(next)
    router.setParams({ office: next === 'H' ? 'H' : undefined })
  }
  const snapshot = snapshotQuery.data ?? null
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

  return (
    <View className="gap-4 bg-slate-900 px-4 pb-12 pt-5">
      <Hero snapshot={snapshot} />
      <Toolbar office={office} onOffice={setOffice} generatedAt={snapshot.generatedAt} />
      <View className="overflow-hidden rounded-[20px] border border-[#26324d] bg-slate-900">
        <USMap snapshot={snapshot} office={office} senateStates={senateStates} />
        <View className="border-t border-[#26324d] bg-slate-900/60 px-3.5 py-2.5">
          <Legend
            office={office}
            countyView={null}
            pending={(snapshot.senate ?? []).some((info) => !senateRace(snapshot.states[info.state]))}
            aggregated={Object.values(snapshot.states).some(isAggregated)}
          />
        </View>
      </View>
      <Overview snapshot={snapshot} office={office} />
    </View>
  )
}
