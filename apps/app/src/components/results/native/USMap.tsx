import {
  PARTY_COLOR,
  PARTY_SHORT,
  formatMargin,
  isAggregated,
  partyKey,
  raceStanding,
  reportingShare,
  share,
  type ResultsSnapshot,
} from '@politmus/core/electionResults'
import {
  HATCH_PATTERN_ID,
  MAP_HEIGHT,
  MAP_WIDTH,
  layoutMarkers,
  stateFill,
  type MapMarker,
  type MapOffice,
} from '@politmus/core/resultsMap'
import { useEffect, useMemo, useState } from 'react'
import { Text, View, type LayoutChangeEvent } from 'react-native'
import Animated, {
  Easing,
  useAnimatedProps,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated'
import Svg, { Circle, Defs, Ellipse, Line, LinearGradient, Path, Pattern, RadialGradient, Rect, Stop } from 'react-native-svg'

import { Face } from './Face'
import { stateShapes } from './mapShapes'

const AnimatedPath = Animated.createAnimatedComponent(Path)

// The face size in points for a map this wide. A phone map is about 360pt
// wide, where web's smallest (32px) crowds the 35 Senate races.
function faceSize(width: number) {
  return width < 520 ? 28 : width < 820 ? 40 : 50
}

// The national map: states filled by leader and margin, with a Senate face
// on a 3D column, or a House seat-count pill, on each state with a race.
export function USMap({
  snapshot,
  office,
  senateStates,
}: {
  snapshot: ResultsSnapshot
  office: MapOffice
  senateStates: Set<string>
}) {
  const [width, setWidth] = useState(0)
  const { states, nation } = stateShapes()
  const height = (width * MAP_HEIGHT) / MAP_WIDTH

  return (
    <View
      onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
      style={{ aspectRatio: MAP_WIDTH / MAP_HEIGHT }}
      className="w-full overflow-hidden"
      accessibilityRole="image"
      accessibilityLabel={office === 'S' ? 'Senate results map' : 'House results map'}
    >
      <Svg width="100%" height="100%" viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`} style={{ position: 'absolute' }}>
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
        {states.map((s) => (
          <Path
            key={s.postal}
            d={s.d}
            fill={stateFill(snapshot, s.postal, office, senateStates)}
            stroke="#0b1222"
            strokeWidth={0.8}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        <Path d={nation} fill="none" stroke="#334155" strokeWidth={0.6} vectorEffect="non-scaling-stroke" />
      </Svg>
      {width ? <Markers snapshot={snapshot} office={office} width={width} height={height} /> : null}
    </View>
  )
}

// ---- Markers ----

function Markers({ snapshot, office, width, height }: { snapshot: ResultsSnapshot; office: MapOffice; width: number; height: number }) {
  const { byPostal } = stateShapes()
  const size = faceSize(width)
  const layout = useMemo(
    () => layoutMarkers({ snapshot, office, centroid: (postal) => byPostal.get(postal)?.centroid, size, width }),
    [snapshot, office, byPostal, size, width],
  )
  const scale = width / MAP_WIDTH

  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, top: 0, width, height }}>
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
          <HousePill key={m.key} marker={m} scale={scale} width={width} compact={size < 32} />
        ) : (
          <Tower key={m.key} marker={m} scale={scale} size={size} columnWidth={layout.columnWidth} depth={layout.depth} />
        ),
      )}
    </View>
  )
}

function HousePill({ marker, scale, width, compact }: { marker: MapMarker; scale: number; width: number; compact: boolean }) {
  const tally = marker.tally!
  const aggregated = isAggregated(marker.results)
  const label = tally.map((t) => `${PARTY_SHORT[t.party]}${compact ? '' : ' '}${t.leading}`).join(' · ')
  // Pills are wider than the faces the layout spaces for, so keep each one
  // inside the map by its own (estimated) width.
  const half = (label.length * (compact ? 5.6 : 7) + (compact ? 10 : 16)) / 2
  const left = Math.min(width - half - 2, Math.max(half + 2, marker.x * scale))
  return (
    <View
      pointerEvents="none"
      style={{ position: 'absolute', left: left - 60, width: 120, top: marker.y * scale, alignItems: 'center', transform: [{ translateY: '-50%' }], zIndex: 2 }}
      accessibilityLabel={`${marker.results.name} House results${aggregated ? ', via civicAPI' : ''}`}
    >
      <View
        style={{ backgroundColor: PARTY_COLOR[tally[0].party] }}
        className={`rounded-full ${compact ? 'px-1' : 'px-2 py-0.5'} ${aggregated ? 'border border-dashed border-slate-200/70' : ''}`}
      >
        <Text style={{ fontVariant: ['tabular-nums'], fontSize: compact ? 9 : 12 }} className="font-extrabold text-white">
          {label}
        </Text>
      </View>
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
}: {
  marker: MapMarker
  scale: number
  size: number
  columnWidth: number
  depth: number
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
}) {
  // The face sits atop its column, overlapping the cap by half its depth.
  const ride = useAnimatedStyle(() => ({ transform: [{ translateY: -lift.get() }] }))
  const radius = 47
  const circumference = 2 * Math.PI * radius
  const inset = Math.max(3, Math.round(size * 0.1))
  return (
    <Animated.View
      pointerEvents="none"
      accessibilityLabel={label}
      style={[{ position: 'absolute', left: x - size / 2, top: y + depth / 2 - size, width: size, height: size, zIndex: 2 }, ride]}
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
