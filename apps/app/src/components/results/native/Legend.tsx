import { partyTint } from '@politmus/core/electionResults'
import { NO_RACE_FILL, turnoutColor, type CountyView, type MapOffice } from '@politmus/core/resultsMap'
import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import Svg, { Defs, Line, LinearGradient, Pattern, Rect, Stop } from 'react-native-svg'

// Under the map: what the colors mean.
export function Legend({
  office,
  countyView,
  pending,
  aggregated,
}: {
  office: MapOffice
  countyView: CountyView | null
  pending: boolean
  aggregated: boolean
}) {
  if (countyView === 'turnout') {
    return (
      <View className="flex-row flex-wrap items-center gap-x-4 gap-y-1.5">
        <Item>Turnout of registered voters</Item>
        <View className="flex-row items-center gap-1.5">
          <Label>30%</Label>
          <Ramp
            id="turnout"
            stops={[
              [0, turnoutColor(30)],
              [1, turnoutColor(80)],
            ]}
          />
          <Label>80%</Label>
        </View>
      </View>
    )
  }
  return (
    <View className="flex-row flex-wrap items-center gap-x-4 gap-y-1.5">
      <View className="flex-row items-center gap-1.5">
        <Label>D</Label>
        <Ramp
          id="party"
          stops={[
            [0, partyTint('DEM', 30)],
            [0.48, partyTint('DEM', 2)],
            [0.52, partyTint('REP', 2)],
            [1, partyTint('REP', 30)],
          ]}
        />
        <Label>R</Label>
      </View>
      <Item>Brighter means a bigger lead</Item>
      {countyView === null ? (
        <>
          {aggregated ? (
            <Item swatch={<View className="h-3 w-3 rounded-full border border-dashed border-slate-200/70" />}>
              Dashed ring: counts via civicAPI, not the state
            </Item>
          ) : null}
          {office === 'S' && pending ? <Item swatch={<Hatch />}>Counts on the state’s own site</Item> : null}
          <Item swatch={<View style={{ backgroundColor: NO_RACE_FILL }} className="h-3 w-3 rounded-[3px] border border-slate-700" />}>
            {office === 'S' ? 'No Senate race' : 'Not loaded yet'}
          </Item>
        </>
      ) : null}
    </View>
  )
}

function Label({ children }: { children: ReactNode }) {
  return <Text className="text-[11px] text-slate-400">{children}</Text>
}

function Item({ swatch, children }: { swatch?: ReactNode; children: ReactNode }) {
  return (
    <View className="flex-row items-center gap-1.5">
      {swatch}
      <Label>{children}</Label>
    </View>
  )
}

function Ramp({ id, stops }: { id: string; stops: [number, string][] }) {
  return (
    <Svg width={120} height={8}>
      <Defs>
        <LinearGradient id={`ramp-${id}`} x1="0" y1="0" x2="1" y2="0">
          {stops.map(([offset, color]) => (
            <Stop key={offset} offset={offset} stopColor={color} />
          ))}
        </LinearGradient>
      </Defs>
      <Rect width={120} height={8} rx={4} fill={`url(#ramp-${id})`} />
    </Svg>
  )
}

function Hatch() {
  return (
    <Svg width={12} height={12}>
      <Defs>
        <Pattern id="legend-hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <Rect width="5" height="5" fill="#1e293b" />
          <Line x1="0" y1="0" x2="0" y2="5" stroke="#475569" strokeWidth="2" />
        </Pattern>
      </Defs>
      <Rect x={0.5} y={0.5} width={11} height={11} rx={3} fill="url(#legend-hatch)" stroke="#334155" strokeWidth={1} />
    </Svg>
  )
}
