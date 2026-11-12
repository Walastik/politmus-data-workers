import { AGGREGATOR, formatSourceTime, isAggregated, type Highlight, type ResultsSnapshot } from '@politmus/core/electionResults'
import { Pressable, ScrollView, Text, View } from 'react-native'

import { ExternalText } from '@/components/ui'

import { Face } from './Face'

const HIGHLIGHT_TONE: Record<Highlight['kind'], string> = {
  closest: '#fbbf24',
  'incumbent-behind': '#f472b6',
  'money-underdog': '#34d399',
  'priciest-votes': '#a78bfa',
  'turnout-high': '#5eead4',
  'turnout-low': '#64748b',
  landslide: '#60a5fa',
}

// What stands out so far: cards in a row that scrolls sideways. Tapping
// one opens its state and race.
export function Highlights({
  highlights,
  onOpen,
  bleed = true,
}: {
  highlights: Highlight[]
  onOpen: (h: Highlight) => void
  // Run to the screen edges (a phone); off beside the tablet panel.
  bleed?: boolean
}) {
  if (!highlights.length) return null
  return (
    <View className="gap-2.5">
      <View className="flex-row flex-wrap items-baseline justify-between gap-2">
        <Text accessibilityRole="header" className="text-xl font-display text-slate-100">
          What stands out so far
        </Text>
        <Text className="font-sans text-xs text-slate-500">Tap one to jump to it</Text>
      </View>
      {/* On a phone it bleeds to the screen edges, so cards scroll under the page margin. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={262}
        decelerationRate="fast"
        className={bleed ? '-mx-4' : 'overflow-hidden rounded-2xl'}
        contentContainerClassName={bleed ? 'gap-3 px-4 pb-1' : 'gap-3 pb-1'}
      >
        {highlights.map((h, i) => {
          const tone = HIGHLIGHT_TONE[h.kind]
          return (
            <Pressable
              key={`${h.kind}-${i}`}
              onPress={() => onOpen(h)}
              accessibilityRole="button"
              accessibilityLabel={`${h.title}: ${h.headline}. ${h.detail}`}
              className="w-[250px] gap-2 overflow-hidden rounded-2xl border border-[#26324d] bg-[#131d33] p-3.5 active:border-slate-600"
            >
              <View style={{ backgroundColor: tone }} className="absolute left-0 right-0 top-0 h-[3px]" />
              <Text style={{ color: tone }} className="text-[11px] font-sans-extrabold uppercase tracking-widest">
                {h.title}
              </Text>
              <View className="flex-row items-center gap-2.5">
                {h.candidate ? <Face name={h.candidate.name} profile={h.candidate.profile} party={h.candidate.party} size={40} /> : null}
                <Text className="min-w-0 flex-1 text-[15px] font-sans-extrabold leading-5 text-slate-100">{h.headline}</Text>
              </View>
              <Text className="font-sans text-xs leading-[17px] text-slate-400">{h.detail}</Text>
            </Pressable>
          )
        })}
      </ScrollView>
    </View>
  )
}

// Where the numbers come from, with the credit civicAPI's terms require.
export function Sources({ snapshot }: { snapshot: ResultsSnapshot }) {
  const states = Object.values(snapshot.states)
  const aggregated = states.filter(isAggregated)
  return (
    <View className="gap-2">
      <Text className="font-sans text-xs leading-[19px] text-slate-500">
        <Text className="font-sans-bold text-slate-400">Where these numbers come from.</Text> Each state’s election office publishes
        its own unofficial counts; where we can, we read them directly and change nothing. Totals keep moving as mail,
        provisional and overseas ballots are counted, and are final only once each state certifies. Race calls come from{' '}
        <ExternalText url={AGGREGATOR.url} label="civicAPI" className="text-blue-300" />, for every state: they’re its
        projections, not the state’s, and are shown apart from the counts. Money raised is from FEC filings.
      </Text>
      <View className="gap-1 pl-2">
        {states
          .filter((s) => !isAggregated(s))
          .map((s) => (
            <Text key={s.state} className="font-sans text-xs leading-[19px] text-slate-500">
              • {s.name}: <ExternalText url={s.source.url} label={s.source.name} className="text-blue-300" />
              {s.source.lastUpdated ? `, updated ${formatSourceTime(s.source.lastUpdated)}` : ''}
            </Text>
          ))}
      </View>
      {aggregated.length ? (
        <Text className="font-sans text-xs leading-[19px] text-slate-500">
          <Text className="font-sans-bold text-slate-400">Via civicAPI.</Text> Results for {aggregated.map((s) => s.name).join(', ')} are
          provided by <ExternalText url={AGGREGATOR.url} label="civicAPI" className="text-blue-300" />, an independent
          aggregator, because we can’t read those states’ feeds directly. civicAPI doesn’t say where its numbers come from, and
          they can trail the states by hours; check each state’s own site for its official count.
        </Text>
      ) : null}
    </View>
  )
}
