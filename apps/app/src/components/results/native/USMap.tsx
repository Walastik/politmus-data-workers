import {
  PARTY_COLOR,
  PARTY_SHORT,
  countyMatchKey,
  countyNameForFeature,
  countyStanding,
  countyTurnout,
  formatMargin,
  isAggregated,
  partyKey,
  raceStanding,
  reportingShare,
  share,
  type RaceResult,
  type ResultsSnapshot,
  type StateResults,
} from '@politmus/core/electionResults'
import {
  HATCH_PATTERN_ID,
  MAP_HEIGHT,
  MAP_WIDTH,
  countyFill,
  layoutMarkers,
  shapeContains,
  stateFill,
  unzoomPoint,
  zoomToBounds,
  type CountyView,
  type MapMarker,
  type MapOffice,
} from '@politmus/core/resultsMap'
import { useEffect, useMemo, useState } from 'react'
import { PixelRatio, Platform, Pressable, Text, View, type LayoutChangeEvent } from 'react-native'
import Animated, {
  Easing,
  useAnimatedProps,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated'
import Svg, { Circle, Defs, Ellipse, G, Line, LinearGradient, Path, Pattern, RadialGradient, Rect, Stop, type GProps } from 'react-native-svg'

import { Face } from './Face'
import { countyShapes, stateShapes, type CountyShape } from './mapShapes'

const AnimatedPath = Animated.createAnimatedComponent(Path)
const AnimatedG = Animated.createAnimatedComponent(G)

// Inside a viewBox, react-native-svg on Android multiplies a group's
// translation by the screen density (the path coordinates it doesn't), so
// the zoom's translation is divided back down there.
const TRANSLATE_SCALE = Platform.OS === 'android' ? PixelRatio.get() : 1

// The face size in points for a map this wide. A phone map is about 360pt
// wide, where web's smallest (32px) crowds the 35 Senate races.
function faceSize(width: number) {
  return width < 520 ? 28 : width < 820 ? 40 : 50
}

export interface CountyTap {
  fips: string
  name: string
}

// The national map: states filled by leader and margin, with a Senate face
// on a 3D column, or a House seat-count pill, on each state with a race.
// Tapping a state zooms in to it and draws its counties.
export function USMap({
  snapshot,
  office,
  senateStates,
  selected,
  race,
  results,
  countiesTopo,
  countyView,
  flagged,
  tapped,
  onSelect,
  onCounty,
}: {
  snapshot: ResultsSnapshot
  office: MapOffice
  senateStates: Set<string>
  selected: string | null
  race: RaceResult | null
  results: StateResults | undefined
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  countiesTopo: any
  countyView: CountyView
  flagged: string | null
  tapped: string | null
  onSelect: (state: string | null) => void
  onCounty: (county: CountyTap) => void
}) {
  const [width, setWidth] = useState(0)
  const { states, byPostal, nation } = stateShapes()
  const height = (width * MAP_HEIGHT) / MAP_WIDTH
  const reduceMotion = useReducedMotion()
  const selectedShape = selected ? byPostal.get(selected) : undefined

  // Zoom with the same bounds math as web, animated on the UI thread by
  // setting the group's matrix, so the paths never re-render mid-zoom.
  const zoom = zoomToBounds(selectedShape?.bounds)
  const k = useSharedValue(zoom.k)
  const x = useSharedValue(zoom.x)
  const y = useSharedValue(zoom.y)
  useEffect(() => {
    const to = (value: number) => (reduceMotion ? value : withTiming(value, { duration: 800, easing: Easing.bezier(0.2, 0.7, 0.1, 1) }))
    k.set(to(zoom.k))
    x.set(to(zoom.x))
    y.set(to(zoom.y))
  }, [k, x, y, zoom.k, zoom.x, zoom.y, reduceMotion])
  // `matrix` is G's native prop (what its transform props become), though
  // GProps doesn't declare it.
  const zoomProps = useAnimatedProps(
    () => ({ matrix: [k.get(), 0, 0, k.get(), x.get() / TRANSLATE_SCALE, y.get() / TRANSLATE_SCALE] }) as Partial<GProps>,
  )

  // countyShapes caches each state's paths, so this is cheap to call.
  const counties = countiesTopo && selectedShape ? countyShapes(countiesTopo, selectedShape.fips) : []
  // County names in results, by match key.
  const countyKeys = useMemo(() => {
    const keys = new Map<string, string>()
    for (const name of Object.keys(results?.counties ?? {})) keys.set(countyMatchKey(name), name)
    for (const name of Object.keys(race?.counties ?? {})) keys.set(countyMatchKey(name), name)
    return keys
  }, [results, race])
  const resultName = (c: CountyShape) => countyKeys.get(countyMatchKey(countyNameForFeature(c.fips, c.name)))
  const onMapPress = (px: number, py: number) => {
    if (!width) return
    // Screen points to the 975 × 610 frame, then out of the zoom.
    const point = unzoomPoint([(px * MAP_WIDTH) / width, (py * MAP_WIDTH) / width], zoom)
    if (selected) {
      const county = counties.find((c) => shapeContains(c.feature.geometry, point))
      if (county) return onCounty({ fips: county.fips, name: county.name })
      if (selectedShape && shapeContains(selectedShape.feature.geometry, point)) return
    }
    const state = states.find((st) => shapeContains(st.feature.geometry, point))
    onSelect(state && state.postal !== selected ? state.postal : null)
  }
  const outlined = counties.filter((c) => c.fips === tapped || (flagged !== null && resultName(c) === flagged))

  return (
    <View
      onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
      style={{ aspectRatio: MAP_WIDTH / MAP_HEIGHT }}
      className="w-full overflow-hidden"
    >
      <Svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`}
        style={{ position: 'absolute' }}
        pointerEvents="none"
      >
        <Defs>
          <RadialGradient id="er-sky" cx="50%" cy="0%" rx="60%" ry="90%" fx="50%" fy="0%" gradientUnits="objectBoundingBox">
            <Stop offset="0" stopColor="#16223d" />
            <Stop offset="0.7" stopColor="#0f172a" />
            <Stop offset="1" stopColor="#0f172a" />
          </RadialGradient>
          <Pattern id={HATCH_PATTERN_ID} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <Rect width="6" height="6" fill="#1e293b" />
            <Line x1="0" y1="0" x2="0" y2="6" stroke="#475569" strokeWidth="2" />
          </Pattern>
        </Defs>
        <Rect width={MAP_WIDTH} height={MAP_HEIGHT} fill="url(#er-sky)" />
        <AnimatedG animatedProps={zoomProps}>
          {states.map((s) => {
            const isSelected = s.postal === selected
            return (
              <Path
                key={s.postal}
                d={s.d}
                fill={isSelected && counties.length ? '#0f172a' : stateFill(snapshot, s.postal, office, senateStates)}
                opacity={selected && !isSelected ? 0.18 : 1}
                stroke={isSelected ? '#e2e8f0' : '#0b1222'}
                strokeWidth={isSelected ? 1.6 : 0.8}
                vectorEffect="non-scaling-stroke"
              />
            )
          })}
          {counties.map((c) => {
            const name = resultName(c)
            const standing = race && name ? countyStanding(race, name) : null
            const turnout = results && name ? countyTurnout(results, name) : null
            return (
              <Path
                key={c.fips}
                d={c.d}
                fill={countyFill(countyView, standing, turnout)}
                stroke="rgba(11, 18, 34, 0.65)"
                strokeWidth={0.4}
                vectorEffect="non-scaling-stroke"
              />
            )
          })}
          {selectedShape && counties.length ? (
            <Path d={selectedShape.d} fill="none" stroke="#e2e8f0" strokeWidth={1.4} vectorEffect="non-scaling-stroke" pointerEvents="none" />
          ) : null}
          {/* The tapped county in white and the flagged one in yellow, drawn last so the outline is on top. */}
          {outlined.map((c) => (
            <Path
              key={`outline-${c.fips}`}
              d={c.d}
              fill="none"
              stroke={c.fips === tapped ? '#ffffff' : '#fde68a'}
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
              pointerEvents="none"
            />
          ))}
          <Path d={nation} fill="none" stroke="#334155" strokeWidth={0.6} vectorEffect="non-scaling-stroke" pointerEvents="none" />
        </AnimatedG>
      </Svg>
      {/* One touch target for the whole map: a tap is matched to a county or
          state by its position (shapeContains), undoing the zoom. */}
      <Pressable
        onPress={(e) => onMapPress(e.nativeEvent.locationX, e.nativeEvent.locationY)}
        accessibilityLabel={office === 'S' ? 'Senate results map' : 'House results map'}
        accessibilityHint={selected ? 'Tap a county for its numbers' : 'Tap a state to open it'}
        style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }}
      />
      {width ? (
        <Markers snapshot={snapshot} office={office} width={width} height={height} hidden={Boolean(selected)} onSelect={onSelect} />
      ) : null}
      {selected ? (
        <View className="absolute left-3 top-2.5 flex-row items-center gap-2">
          <Pressable
            onPress={() => onSelect(null)}
            accessibilityRole="button"
            hitSlop={8}
            className="min-h-[34px] justify-center rounded-full border border-[#26324d] bg-slate-900/85 px-3"
          >
            <Text className="text-[13px] font-semibold text-slate-200">← All states</Text>
          </Pressable>
          {!countiesTopo ? <Text className="text-xs text-slate-500">Loading counties…</Text> : null}
        </View>
      ) : null}
    </View>
  )
}

// ---- Markers ----

function Markers({
  snapshot,
  office,
  width,
  height,
  hidden,
  onSelect,
}: {
  snapshot: ResultsSnapshot
  office: MapOffice
  width: number
  height: number
  hidden: boolean
  onSelect: (state: string) => void
}) {
  const { byPostal } = stateShapes()
  const size = faceSize(width)
  const layout = useMemo(
    () => layoutMarkers({ snapshot, office, centroid: (postal) => byPostal.get(postal)?.centroid, size, width }),
    [snapshot, office, byPostal, size, width],
  )
  const scale = width / MAP_WIDTH
  // Faded out while a state is open. Hidden markers must stop taking touches
  // too, or they catch taps meant for the counties under them (#88 on web).
  const reduceMotion = useReducedMotion()
  const opacity = useSharedValue(hidden ? 0 : 1)
  useEffect(() => {
    opacity.set(reduceMotion ? (hidden ? 0 : 1) : withTiming(hidden ? 0 : 1, { duration: 350 }))
  }, [opacity, hidden, reduceMotion])
  const fade = useAnimatedStyle(() => ({ opacity: opacity.get() }))

  return (
    <Animated.View
      pointerEvents={hidden ? 'none' : 'box-none'}
      accessibilityElementsHidden={hidden}
      importantForAccessibility={hidden ? 'no-hide-descendants' : 'auto'}
      style={[{ position: 'absolute', left: 0, top: 0, width, height }, fade]}
    >
      {/* Callout lines from the small Northeastern states out to their markers. */}
      <Svg width={width} height={height} style={{ position: 'absolute' }} pointerEvents="none">
        {layout.markers
          .filter((m) => m.x !== m.cx)
          .map((m) => (
            <Line
              key={m.key}
              x1={m.cx * scale}
              y1={m.cy * scale}
              x2={m.x * scale}
              y2={m.y * scale}
              stroke="rgba(226, 232, 240, 0.4)"
              strokeWidth={1}
            />
          ))}
      </Svg>
      {layout.markers.map((m) =>
        m.tally ? (
          <HousePill key={m.key} marker={m} scale={scale} width={width} compact={size < 32} onSelect={onSelect} />
        ) : (
          <Tower
            key={m.key}
            marker={m}
            scale={scale}
            size={size}
            columnWidth={layout.columnWidth}
            depth={layout.depth}
            onSelect={onSelect}
          />
        ),
      )}
    </Animated.View>
  )
}

function HousePill({
  marker,
  scale,
  width,
  compact,
  onSelect,
}: {
  marker: MapMarker
  scale: number
  width: number
  compact: boolean
  onSelect: (state: string) => void
}) {
  const tally = marker.tally!
  const aggregated = isAggregated(marker.results)
  const label = tally.map((t) => `${PARTY_SHORT[t.party]}${compact ? '' : ' '}${t.leading}`).join(' · ')
  // Pills are wider than the faces the layout spaces for, so keep each one
  // inside the map by its own (estimated) width.
  const half = (label.length * (compact ? 5.6 : 7) + (compact ? 10 : 16)) / 2
  const left = Math.min(width - half - 2, Math.max(half + 2, marker.x * scale))
  return (
    <View
      pointerEvents="box-none"
      style={{ position: 'absolute', left: left - 60, width: 120, top: marker.y * scale, alignItems: 'center', transform: [{ translateY: '-50%' }], zIndex: 2 }}
    >
      <Pressable
        onPress={() => onSelect(marker.key)}
        accessibilityRole="button"
        accessibilityLabel={`${marker.results.name} House results${aggregated ? ', via civicAPI' : ''}`}
        hitSlop={{ top: 14, bottom: 14, left: 4, right: 4 }}
        style={{ backgroundColor: PARTY_COLOR[tally[0].party] }}
        className={`rounded-full ${compact ? 'px-1' : 'px-2 py-0.5'} ${aggregated ? 'border border-dashed border-slate-200/70' : ''}`}
      >
        <Text style={{ fontVariant: ['tabular-nums'], fontSize: compact ? 9 : 12 }} className="font-extrabold text-white">
          {label}
        </Text>
      </Pressable>
    </View>
  )
}

// A Senate race: the leader's face on a column whose height is the share of
// the count reported. The column and the face are siblings in the marker
// layer, so every column (zIndex 1) sits under every face (zIndex 2) and a
// tall column never covers a neighbor's face; the margin pills go on top.
function Tower({
  marker,
  scale,
  size,
  columnWidth,
  depth,
  onSelect,
}: {
  marker: MapMarker
  scale: number
  size: number
  columnWidth: number
  depth: number
  onSelect: (state: string) => void
}) {
  const reduceMotion = useReducedMotion()
  const lift = useSharedValue(reduceMotion ? marker.lift : 0)
  // Rises once on load, then only moves when the count changes.
  useEffect(() => {
    lift.set(reduceMotion ? marker.lift : withTiming(marker.lift, { duration: 1100, easing: Easing.bezier(0.2, 0.8, 0.2, 1) }))
  }, [lift, marker.lift, reduceMotion])

  const race = marker.race!
  const standing = raceStanding(race)
  const leader = standing.leader!
  const color = PARTY_COLOR[partyKey(leader.party)]
  const x = marker.x * scale
  const y = marker.y * scale
  const counted = Math.round((reportingShare(race) ?? 0) * 100)

  return (
    <>
      <Column x={x} y={y} lift={lift} color={color} columnWidth={columnWidth} depth={depth} maxLift={Math.ceil(size * 1.1)} />
      <FaceMarker
        x={x}
        y={y}
        lift={lift}
        size={size}
        depth={depth}
        color={color}
        name={leader.name}
        profile={leader.profile}
        party={leader.party}
        leaderShare={share(leader.votes, standing.totalVotes)}
        aggregated={isAggregated(marker.results)}
        label={`${marker.results.name}: ${leader.name} leads by ${standing.margin.toFixed(1)} points, ${counted}% counted`}
        onPress={() => onSelect(marker.key)}
      />
      <MarginPill x={x} y={y} lift={lift} size={size} depth={depth} color={color} margin={formatMargin(standing.margin)} />
    </>
  )
}

function Column({
  x,
  y,
  lift,
  color,
  columnWidth: w,
  depth: d,
  maxLift,
}: {
  x: number
  y: number
  lift: SharedValue<number>
  color: string
  columnWidth: number
  depth: number
  maxLift: number
}) {
  // The column's own canvas: its foot is at the bottom, centered on the
  // front face, with room for the side and top faces up and to the right.
  const boxW = w + d
  const boxH = maxLift + d + 6
  const left = 0
  const foot = boxH - 5
  const right = w
  const front = useAnimatedProps(() => {
    const top = foot - lift.get()
    return { d: `M${left},${foot}H${right}V${top}H${left}Z` }
  })
  const side = useAnimatedProps(() => {
    const top = foot - lift.get()
    return { d: `M${right},${foot}L${right + d},${foot - d}V${top - d}L${right},${top}Z` }
  })
  const cap = useAnimatedProps(() => {
    const top = foot - lift.get()
    return { d: `M${left},${top}H${right}L${right + d},${top - d}H${left + d}Z` }
  })
  const id = `col-${color.slice(1)}`
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: x - w / 2, top: y - foot, width: boxW, height: boxH, zIndex: 1 }}>
      <Svg width={boxW} height={boxH}>
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor={mix(color, '#ffffff', 0.78)} />
            <Stop offset="0.7" stopColor={color} />
          </LinearGradient>
          <RadialGradient id="col-shadow" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor="#000" stopOpacity={0.6} />
            <Stop offset="1" stopColor="#000" stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Ellipse cx={w / 2} cy={foot} rx={Math.min(boxW / 2, w * 1.2)} ry={4} fill="url(#col-shadow)" />
        <AnimatedPath animatedProps={front} fill={`url(#${id})`} />
        <AnimatedPath animatedProps={side} fill={mix(color, '#000000', 0.62)} />
        <AnimatedPath animatedProps={cap} fill={mix(color, '#ffffff', 0.55)} />
      </Svg>
    </View>
  )
}

function FaceMarker({
  x,
  y,
  lift,
  size,
  depth,
  color,
  name,
  profile,
  party,
  leaderShare,
  aggregated,
  label,
  onPress,
}: {
  x: number
  y: number
  lift: SharedValue<number>
  size: number
  depth: number
  color: string
  name: string
  profile: Parameters<typeof Face>[0]['profile']
  party: string
  leaderShare: number
  aggregated: boolean
  label: string
  onPress: () => void
}) {
  // The face sits atop its column, overlapping the cap by half its depth.
  const ride = useAnimatedStyle(() => ({ transform: [{ translateY: -lift.get() }] }))
  const radius = 47
  const circumference = 2 * Math.PI * radius
  const inset = Math.max(3, Math.round(size * 0.1))
  // At least a 44pt target around the face.
  const slop = Math.max(0, Math.ceil((44 - size) / 2))
  return (
    <Animated.View
      pointerEvents="box-none"
      style={[{ position: 'absolute', left: x - size / 2, top: y + depth / 2 - size, width: size, height: size, zIndex: 2 }, ride]}
    >
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={label}
        hitSlop={slop}
        style={{ position: 'absolute', left: 0, top: 0, width: size, height: size }}
      >
      <Svg width={size} height={size} viewBox="0 0 100 100" style={{ position: 'absolute' }}>
        <Circle cx="50" cy="50" r={radius} fill="#0f172a" stroke="#334155" strokeWidth="6" />
        <Circle
          cx="50"
          cy="50"
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={`${(leaderShare / 100) * circumference} ${circumference}`}
          transform="rotate(-90 50 50)"
        />
      </Svg>
      <View style={{ position: 'absolute', left: inset, top: inset }}>
        <Face name={name} profile={profile} party={party} size={size - inset * 2} ring={0} />
      </View>
      {aggregated ? (
        <View
          style={{ position: 'absolute', left: -4, top: -4, width: size + 8, height: size + 8, borderRadius: (size + 8) / 2 }}
          className="border border-dashed border-slate-200/70"
        />
      ) : null}
      </Pressable>
    </Animated.View>
  )
}

// The margin under a face. Its own layer (zIndex 3), above every face, so a
// neighbor's face never hides it.
function MarginPill({
  x,
  y,
  lift,
  size,
  depth,
  color,
  margin,
}: {
  x: number
  y: number
  lift: SharedValue<number>
  size: number
  depth: number
  color: string
  margin: string
}) {
  const ride = useAnimatedStyle(() => ({ transform: [{ translateY: -lift.get() }] }))
  return (
    <Animated.View
      pointerEvents="none"
      style={[{ position: 'absolute', left: x - size * 1.5, width: size * 3, top: y + depth / 2 - 6, alignItems: 'center', zIndex: 3 }, ride]}
    >
      <View style={{ backgroundColor: color }} className="rounded-full px-1">
        <Text style={{ fontVariant: ['tabular-nums'], fontSize: size < 32 ? 9 : 11 }} className="font-extrabold text-white">
          {margin}
        </Text>
      </View>
    </Animated.View>
  )
}

// Blends a hex color toward another; amount is how much of `color` stays,
// like CSS color-mix(in srgb, color amount, other).
function mix(color: string, other: string, amount: number) {
  const a = rgb(color)
  const b = rgb(other)
  const c = a.map((v, i) => Math.round(v * amount + b[i] * (1 - amount)))
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`
}

function rgb(hex: string) {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
