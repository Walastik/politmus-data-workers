import { useEffect, useId } from 'react'
import { Text, useColorScheme, View } from 'react-native'
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedProps,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated'
import Svg, { ClipPath, Defs, G, LinearGradient, Path, Pattern, Rect, Stop } from 'react-native-svg'

// The Politmus "P" as a strip of litmus paper soaking up water from the foot
// of the stem: dry paper below the waterline, the brand's red, violet and
// blue above it.
//
// Same geometry and gradient as brand/politmus-monogram.svg. react-native-svg
// can't draw feTurbulence, so a tiled fiber pattern stands in for the paper
// texture. Rather than animate a clipPath (which Android redraws unreliably),
// the P is the static clip and the waterline is an animated shape filled with
// the litmus gradient; the result looks the same.
//
// Without `progress`, it loops every 2.2s: the water rises from below the stem
// to just above the bowl, holds, then the paper dries and it starts again.
// With `progress` (0 to 100), the waterline sits at that height and eases to
// each new value.

const P = 'M0 14Q0 0 14 0H320A268 268 0 0 1 320 536H180V786Q180 800 166 800H14Q0 800 0 786ZM180 164H310A99 99 0 0 1 310 362H180Z'
const ASPECT = 660 / 860
const HEIGHT = 800

// The waterline: a sine-like row of cubic curves, extended down past the foot.
const WAVE_LENGTH = 220
const AMPLITUDE = 14
const LEFT = -60
const RIGHT = 680
// Lowest crest sits below the foot even at the wave's peak; highest is 10%
// of the P above its top, so the bowl fills completely.
const DRY_CREST = HEIGHT + AMPLITUDE + 20
const WET_CREST = -HEIGHT * 0.1

export const LOOP_MS = 2200
const RISE_END = 0.75 // of the loop: water reaches the top
const DRY_START = 0.88 // holds, then dries out by the loop's end
/** When each loop's water reaches the top (the launch screen leaves then). */
export const RISE_MS = LOOP_MS * RISE_END
const SWAY_MS = 1700

function wave(crest: number, shift: number) {
  'worklet'
  const half = WAVE_LENGTH / 2
  // Cubic control points at 4/3 of the amplitude put the peak at the amplitude.
  const lift = (AMPLITUDE * 4) / 3
  const start = LEFT - WAVE_LENGTH + (((shift % WAVE_LENGTH) + WAVE_LENGTH) % WAVE_LENGTH)
  let x = start
  let up = true
  let d = `M${x} ${crest}`
  while (x < RIGHT) {
    const y = up ? crest - lift : crest + lift
    d += `C${x + half * 0.36} ${y} ${x + half * 0.64} ${y} ${x + half} ${crest}`
    x += half
    up = !up
  }
  return `${d}V${HEIGHT + 100}H${start}Z`
}

function easeInOut(p: number) {
  'worklet'
  return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2
}

const AnimatedPath = Animated.createAnimatedComponent(Path)
const AnimatedG = Animated.createAnimatedComponent(G)

export interface PolitmusLoaderProps {
  /** Height of the P in points; the width follows the monogram's aspect. */
  size?: number
  /** 0 to 100 for known progress; leave out for the endless loop. */
  progress?: number
  /** Short caption under the P, shown in uppercase. */
  label?: string
  className?: string
}

export default function PolitmusLoader({ size = 72, progress, label, className }: PolitmusLoaderProps) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const dark = useColorScheme() !== 'light'
  const reduceMotion = useReducedMotion()
  const determinate = progress !== undefined
  const target = determinate ? Math.min(100, Math.max(0, progress)) / 100 : 1

  // The loop's clock (0 to 1), the determinate level, and the sideways sway.
  const clock = useSharedValue(0)
  const level = useSharedValue(determinate ? target : 0)
  const sway = useSharedValue(0)

  useEffect(() => {
    if (determinate || reduceMotion) {
      cancelAnimation(clock)
      clock.set(0)
      return
    }
    clock.set(0)
    clock.set(withRepeat(withTiming(1, { duration: LOOP_MS, easing: Easing.linear }), -1, false))
    return () => cancelAnimation(clock)
  }, [clock, determinate, reduceMotion])

  useEffect(() => {
    level.set(reduceMotion ? target : withTiming(target, { duration: 450, easing: Easing.out(Easing.cubic) }))
  }, [level, target, reduceMotion])

  useEffect(() => {
    if (reduceMotion) {
      cancelAnimation(sway)
      sway.set(0)
      return
    }
    sway.set(withRepeat(withTiming(1, { duration: SWAY_MS, easing: Easing.linear }), -1, false))
    return () => cancelAnimation(sway)
  }, [sway, reduceMotion])

  const crest = () => {
    'worklet'
    const filled = determinate || reduceMotion ? level.get() : easeInOut(Math.min(1, clock.get() / RISE_END))
    return DRY_CREST + (WET_CREST - DRY_CREST) * filled
  }

  const waterProps = useAnimatedProps(() => ({ d: wave(crest(), sway.get() * WAVE_LENGTH) }))
  // A paler band just ahead of the waterline, drifting against it: the dye
  // wicking up the fibers before the paper is fully wet.
  const bleedProps = useAnimatedProps(() => ({ d: wave(crest() - 16, WAVE_LENGTH * 0.4 - sway.get() * WAVE_LENGTH) }))
  const wetProps = useAnimatedProps(() => {
    if (determinate || reduceMotion) return { opacity: 1 }
    const t = clock.get()
    return { opacity: t < DRY_START ? 1 : 1 - (t - DRY_START) / (1 - DRY_START) }
  })

  const clip = `clip-${id}`
  const litmus = `litmus-${id}`
  const fiber = `fiber-${id}`
  const dry = dark ? '#293548' : '#E2E0D8'
  const fiberLight = dark ? '#94A3B8' : '#FFFFFF'

  return (
    <View
      className={`items-center gap-3 ${className ?? ''}`}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label ?? 'Loading'}
      accessibilityValue={determinate ? { min: 0, max: 100, now: Math.round(target * 100) } : undefined}
    >
      <Svg width={size * ASPECT} height={size} viewBox="-30 -30 660 860">
        <Defs>
          <ClipPath id={clip}>
            <Path d={P} clipRule="evenodd" />
          </ClipPath>
          <LinearGradient id={litmus} gradientUnits="userSpaceOnUse" x1="60" y1="0" x2="250" y2="800">
            <Stop offset="0" stopColor="#DC2626" />
            <Stop offset="0.28" stopColor="#DC2626" />
            <Stop offset="0.5" stopColor="#7C3AED" />
            <Stop offset="0.72" stopColor="#2563EB" />
            <Stop offset="1" stopColor="#2563EB" />
          </LinearGradient>
          {/* Paper grain: a few short fibers and flecks, tiled. */}
          <Pattern id={fiber} patternUnits="userSpaceOnUse" width="48" height="48">
            <Path d="M4 9l11 3M27 4l9 -2M31 30l12 4M8 37l7 -5M20 22l3 9" stroke={fiberLight} strokeOpacity={0.14} strokeWidth="2" />
            <Path d="M14 2l-6 7M40 17l5 9M22 43l11 -2" stroke="#000000" strokeOpacity={0.16} strokeWidth="2" />
            <Rect x="36" y="40" width="3" height="3" fill="#000000" fillOpacity={0.14} />
            <Rect x="2" y="24" width="3" height="3" fill={fiberLight} fillOpacity={0.12} />
          </Pattern>
        </Defs>

        <G clipPath={`url(#${clip})`}>
          {/* Dry paper. */}
          <Rect x="-30" y="-30" width="660" height="860" fill={dry} />
          {/* Wet, reacted paper below the waterline. */}
          <AnimatedG animatedProps={wetProps}>
            <AnimatedPath animatedProps={bleedProps} fill={`url(#${litmus})`} fillOpacity={0.35} />
            <AnimatedPath animatedProps={waterProps} fill={`url(#${litmus})`} />
          </AnimatedG>
          <Rect x="-30" y="-30" width="660" height="860" fill={`url(#${fiber})`} />
          {/* The paper's folds, as on the brand mark. */}
          <Path d="M0 164H180V362H92C32 362 0 398 0 468Z" fill="#000000" fillOpacity={0.18} />
          <Path d="M0 594C0 558 26 536 78 536H180V660H0Z" fill="#000000" fillOpacity={0.14} />
        </G>

        <G stroke="#111111" strokeWidth="18" strokeLinecap="round" strokeLinejoin="round" fill="none">
          <Path d={P} fillRule="evenodd" />
          <Path d="M0 164H180" />
          <Path d="M180 362H92C32 362 0 398 0 468" />
          <Path d="M180 536H78C26 536 0 558 0 594" />
        </G>
      </Svg>
      {label ? (
        <Text className="font-mono text-xs tracking-wider text-slate-600 uppercase dark:text-slate-400">{label}</Text>
      ) : null}
    </View>
  )
}
