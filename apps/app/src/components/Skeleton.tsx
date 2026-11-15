import { useEffect, type ReactNode } from 'react'
import { View } from 'react-native'
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated'

import { gridCellStyle } from '@/lib/layout'

// Placeholders shaped like the content they stand in for, so a screen keeps
// its layout while it loads and the real content drops into place instead of
// pushing everything around. The PolitmusLoader P is for the launch screen.
//
// <Skeleton> pulses once for everything inside it; <Bone> and <TextBone> are
// the still grey shapes. Each skeleton below mirrors one real component's
// padding, borders and line heights, so keep them in step when those change.

const PULSE_MS = 900

export function Skeleton({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  const reduceMotion = useReducedMotion()
  const opacity = useSharedValue(1)

  useEffect(() => {
    if (reduceMotion) {
      cancelAnimation(opacity)
      opacity.set(1)
      return
    }
    opacity.set(withRepeat(withTiming(0.45, { duration: PULSE_MS, easing: Easing.inOut(Easing.ease) }), -1, true))
    return () => cancelAnimation(opacity)
  }, [opacity, reduceMotion])

  const style = useAnimatedStyle(() => ({ opacity: opacity.get() }))

  return (
    <Animated.View
      style={style}
      className={className}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityState={{ busy: true }}
    >
      {children}
    </Animated.View>
  )
}

/** A grey block; size and shape come from className. */
export function Bone({ className = '' }: { className?: string }) {
  return <View className={`rounded bg-slate-700/70 ${className}`} />
}

// Line boxes of the text sizes used in the app (Tailwind's line heights), so a
// line of placeholder takes the same height as the line of text it stands for.
const LINE_CLASS = {
  '10': 'h-[14px]',
  '11': 'h-4',
  xs: 'h-4',
  sm: 'h-5',
  base: 'h-6',
  lg: 'h-7',
  xl: 'h-7',
  '2xl': 'h-8',
} as const
const BAR_CLASS = {
  '10': 'h-2',
  '11': 'h-2',
  xs: 'h-2.5',
  sm: 'h-3',
  base: 'h-3.5',
  lg: 'h-4',
  xl: 'h-5',
  '2xl': 'h-6',
} as const

/** One line of text: `width` is a Tailwind width class such as w-1/2. */
export function TextBone({ size = 'sm', width = 'w-full', className = '' }: { size?: keyof typeof LINE_CLASS; width?: string; className?: string }) {
  return (
    <View className={`justify-center ${LINE_CLASS[size]} ${width} ${className}`}>
      <Bone className={`${BAR_CLASS[size]} w-full`} />
    </View>
  )
}

/** `count` copies of a placeholder, in a grid of `columns` like the real list. */
export function Repeat({ count, columns = 1, children }: { count: number; columns?: number; children: (index: number) => ReactNode }) {
  const items = Array.from({ length: count }, (_, i) => i)
  if (columns === 1) return <>{items.map((i) => <View key={i}>{children(i)}</View>)}</>
  return (
    <View className="flex-row flex-wrap px-2.5">
      {items.map((i) => (
        <View key={i} style={gridCellStyle(columns)}>
          {children(i)}
        </View>
      ))}
    </View>
  )
}

// Vary line widths a little so a list doesn't look stamped out.
const WIDE = ['w-3/4', 'w-2/3', 'w-4/5', 'w-3/5'] as const
const NARROW = ['w-1/3', 'w-2/5', 'w-1/4', 'w-1/2'] as const
const wide = (i: number) => WIDE[i % WIDE.length]
const narrow = (i: number) => NARROW[i % NARROW.length]

// ---------------------------------------------------------------------------
// Rows and cards

/** MemberRow: photo, name, party line and score chip. */
export function MemberRowSkeleton({ index = 0 }: { index?: number }) {
  return (
    <View className="flex-row items-center gap-2.5 rounded-md border-l-2 border-slate-700 bg-slate-800/70 px-2.5 py-2">
      <Bone className="h-8 w-8 rounded-full" />
      <View className="min-w-0 flex-1">
        <TextBone size="sm" width={narrow(index + 1)} />
        <TextBone size="11" width={narrow(index)} />
      </View>
      <Bone className="h-5 w-10" />
    </View>
  )
}

/** FeedItemRow: kind label and date, a two-line headline, subline and tags. */
export function FeedCardSkeleton({ index = 0, grid = false }: { index?: number; grid?: boolean }) {
  return (
    <View className={`rounded-lg border border-slate-700 bg-slate-800 p-4 ${grid ? 'h-full' : 'mx-4 mb-3'}`}>
      <View className="flex-row items-center justify-between gap-2">
        <TextBone size="xs" width="w-28" />
        <TextBone size="xs" width="w-16" />
      </View>
      <View className="mt-2">
        <TextBone size="base" />
        <TextBone size="base" width={wide(index)} />
      </View>
      <TextBone size="sm" width={wide(index + 1)} className="mt-1" />
      <View className="mt-2 flex-row gap-2">
        <Bone className="h-5 w-16" />
        <Bone className="h-5 w-24" />
      </View>
    </View>
  )
}

/** The bills list's BillCard: number and sponsor, title, tags, dates, tally. */
export function BillCardSkeleton({ index = 0, grid = false }: { index?: number; grid?: boolean }) {
  return (
    <View className={`rounded-lg border border-slate-700 bg-slate-800 p-4 ${grid ? 'h-full' : 'mx-4 mb-3'}`}>
      <View className="flex-row items-center justify-between gap-2">
        <TextBone size="xs" width="w-20" />
        <TextBone size="xs" width="w-32" />
      </View>
      <View className="mt-2">
        <TextBone size="base" />
        <TextBone size="base" width={wide(index)} />
      </View>
      <View className="mt-2 flex-row gap-1.5">
        <Bone className="h-5 w-20 rounded-full" />
        <Bone className="h-5 w-14 rounded-full" />
      </View>
      <TextBone size="xs" width="w-1/2" className="mt-2" />
      <Bone className="mt-3 h-2 w-full rounded-full" />
    </View>
  )
}

/** A Section card from ui.tsx with its title, around placeholder content. */
export function SectionSkeleton({ children }: { children: ReactNode }) {
  return (
    <View className="rounded-xl border border-slate-700 bg-slate-800/40 p-4">
      <View className="mb-3 flex-row items-center justify-between gap-2">
        <TextBone size="sm" width="w-40" />
        <TextBone size="sm" width="w-24" />
      </View>
      {children}
    </View>
  )
}

/** A few lines of body text, for a section whose own content is loading. */
export function LinesSkeleton({ lines = 3, size = 'sm' }: { lines?: number; size?: keyof typeof LINE_CLASS }) {
  return (
    <View>
      {Array.from({ length: lines }, (_, i) => (
        <TextBone key={i} size={size} width={i === lines - 1 ? 'w-2/3' : 'w-full'} />
      ))}
    </View>
  )
}

/** Congress's ChamberSummary: title, party bar, counts, leaders. */
export function ChamberSummarySkeleton() {
  return (
    <View className="rounded-xl border border-slate-700 bg-slate-800/40 p-4">
      <View className="flex-row items-center justify-between gap-2">
        <TextBone size="sm" width="w-20" />
        <TextBone size="xs" width="w-24" />
      </View>
      <Bone className="mt-3 h-3 w-full rounded-full" />
      <View className="mt-2 flex-row gap-4">
        <TextBone size="sm" width="w-24" />
        <TextBone size="sm" width="w-24" />
      </View>
      <View className="mt-3 gap-1.5 border-t border-slate-700/70 pt-3">
        <TextBone size="sm" width="w-3/4" />
        <TextBone size="sm" width="w-2/3" />
      </View>
      <TextBone size="xs" width="w-1/2" className="mt-2" />
    </View>
  )
}

/** One state's card in the Senate view: the state name and two senators. */
export function SenateStateSkeleton({ index = 0, grid = false }: { index?: number; grid?: boolean }) {
  return (
    <View className={`rounded-lg border border-slate-700 bg-slate-800/40 p-3 ${grid ? 'h-full' : 'mx-4 mb-3'}`}>
      <TextBone size="xs" width="w-24" className="mb-2" />
      <View className="gap-1.5">
        <MemberRowSkeleton index={index} />
        <MemberRowSkeleton index={index + 1} />
      </View>
    </View>
  )
}

/** One candidate in a race: photo, party and name, tags, money and bar. */
export function CandidateCardSkeleton({ index = 0 }: { index?: number }) {
  return (
    <View className="rounded-lg border border-slate-700 bg-slate-800 p-3">
      <View className="flex-row items-center gap-3">
        <Bone className="h-12 w-12 rounded-full" />
        <View className="min-w-0 flex-1">
          <TextBone size="sm" width={wide(index)} />
          <Bone className="mt-1 h-4 w-20" />
        </View>
      </View>
      <View className="mt-3 flex-row gap-2">
        <View className="flex-1">
          <TextBone size="xs" width="w-12" />
          <TextBone size="xs" width="w-16" />
        </View>
        <View className="flex-1">
          <TextBone size="xs" width="w-20" />
          <TextBone size="xs" width="w-14" />
        </View>
      </View>
      <Bone className="mt-2 h-1.5 w-full" />
    </View>
  )
}

/** Candidates' RaceCard: title, money line and two candidates. */
export function RaceCardSkeleton({ index = 0, columns = 1 }: { index?: number; columns?: number }) {
  return (
    <View className="mx-4 mb-4 rounded-xl border border-slate-700 bg-slate-800/40 p-4">
      <TextBone size="base" width={narrow(index + 3)} />
      <TextBone size="xs" width="w-2/3" className="mt-0.5" />
      <View className={columns > 1 ? '-mx-1.5 mt-1.5 flex-row flex-wrap' : 'mt-3 gap-3'}>
        {[0, 1].map((i) => (
          <View key={i} style={gridCellStyle(columns)}>
            <CandidateCardSkeleton index={index + i} />
          </View>
        ))}
      </View>
    </View>
  )
}

/** A representative's card on My Reps: photo, name, office, score, contact. */
export function RepCardSkeleton({ index = 0 }: { index?: number }) {
  return (
    <View className="rounded-lg border border-slate-700 bg-slate-800 p-4">
      <View className="flex-row items-center gap-3">
        <Bone className="h-12 w-12 rounded-full" />
        <View className="min-w-0 flex-1">
          <TextBone size="base" width={narrow(index + 3)} />
          <TextBone size="xs" width={wide(index)} className="mt-1" />
        </View>
      </View>
      <View className="mt-3 flex-row gap-4">
        <TextBone size="xs" width="w-24" />
        <TextBone size="xs" width="w-28" />
      </View>
    </View>
  )
}

/** The compact representative rows on Happening Now. */
export function RepStripSkeleton({ count = 3 }: { count?: number }) {
  return (
    <View className="gap-2">
      {Array.from({ length: count }, (_, i) => (
        <View key={i} className="flex-row items-center gap-2.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2">
          <Bone className="h-8 w-8 rounded-full" />
          <View className="min-w-0 flex-1">
            <TextBone size="sm" width={narrow(i + 1)} />
            <TextBone size="11" width={narrow(i)} />
          </View>
        </View>
      ))}
    </View>
  )
}

/** The address box on Happening Now and My Reps. */
export function LocationBarSkeleton() {
  return (
    <View className="gap-2">
      <LinesSkeleton lines={2} />
      <Bone className="h-[42px] w-full rounded-md" />
      <View className="flex-row gap-2">
        <Bone className="h-10 w-44 rounded-md" />
        <Bone className="h-10 w-36 rounded-md" />
      </View>
      <LinesSkeleton lines={2} size="xs" />
    </View>
  )
}

// ---------------------------------------------------------------------------
// Whole screens, for when nothing above the content is drawn yet

/** Happening Now before sign-in and location are known. */
export function NowSkeleton() {
  return (
    <Skeleton label="Loading Happening Now" className="gap-6">
      <View className="rounded-xl border border-slate-700 bg-slate-800/60 p-5">
        <TextBone size="xs" width="w-32" />
        <TextBone size="2xl" width="w-3/4" className="mt-1" />
        <TextBone size="sm" width="w-full" className="mt-1" />
        <TextBone size="sm" width="w-2/3" />
      </View>
      <LocationBarSkeleton />
      <SectionSkeleton>
        <FeedCardSkeleton />
        <FeedCardSkeleton index={1} />
      </SectionSkeleton>
    </Skeleton>
  )
}

/** My Reps' results: Congress, then state officials. */
export function RepsSkeleton() {
  return (
    <Skeleton label="Finding your representatives" className="gap-8">
      {[0, 1].map((section) => (
        <View key={section}>
          <TextBone size="sm" width="w-44" />
          <TextBone size="sm" width="w-3/4" className="mt-1" />
          <View className="mt-4 gap-4">
            <RepCardSkeleton index={section * 2} />
            <RepCardSkeleton index={section * 2 + 1} />
          </View>
        </View>
      ))}
    </Skeleton>
  )
}

/** The member profile: header, contact and a few sections. */
export function ProfileSkeleton() {
  return (
    <Skeleton label="Loading profile" className="gap-6">
      <View className="flex-row items-center gap-4 border-b border-slate-800 pb-5">
        <Bone className="h-20 w-20 rounded-full" />
        <View className="min-w-0 flex-1 gap-1">
          <View className="flex-row items-center gap-2">
            <Bone className="h-5 w-7" />
            <TextBone size="xl" width="w-1/2" />
          </View>
          <TextBone size="sm" width="w-2/3" />
          <Bone className="mt-2 h-14 w-full rounded-lg" />
        </View>
      </View>
      {[3, 4, 2].map((lines, i) => (
        <View key={i}>
          <TextBone size="sm" width="w-36" />
          <View className="mt-3">
            <LinesSkeleton lines={lines} />
          </View>
        </View>
      ))}
    </Skeleton>
  )
}

/** The bill profile: title, tags, sponsor, dates, tally and summary. */
export function BillDetailSkeleton() {
  return (
    <Skeleton label="Loading bill" className="gap-6">
      <View className="border-b border-slate-800 pb-5">
        <TextBone size="xl" />
        <TextBone size="xl" width="w-2/3" />
        <View className="mt-2 flex-row gap-1.5">
          <Bone className="h-5 w-24 rounded-full" />
          <Bone className="h-5 w-16 rounded-full" />
        </View>
        <TextBone size="xs" width="w-1/2" className="mt-2" />
        <TextBone size="xs" width="w-2/5" className="mt-1" />
        <View className="mt-3 flex-row gap-4">
          <TextBone size="xs" width="w-28" />
          <TextBone size="xs" width="w-24" />
        </View>
      </View>
      <View className="gap-3">
        <TextBone size="sm" width="w-28" />
        <Bone className="h-3 w-full rounded-full" />
        <View className="flex-row gap-3">
          <Bone className="h-16 flex-1 rounded-lg" />
          <Bone className="h-16 flex-1 rounded-lg" />
        </View>
      </View>
      <View>
        <TextBone size="sm" width="w-32" />
        <View className="mt-3">
          <LinesSkeleton lines={5} />
        </View>
      </View>
    </Skeleton>
  )
}

/** Voting locations: election card, links and a couple of sites. */
export function VotingSkeleton() {
  return (
    <Skeleton label="Finding voting locations" className="gap-6">
      <View className="rounded-lg border border-slate-700 bg-slate-800/80 p-4">
        <TextBone size="xs" width="w-20" />
        <TextBone size="lg" width="w-2/3" />
        <Bone className="mt-2 h-8 w-48 rounded" />
      </View>
      <View className="flex-row flex-wrap gap-2">
        <Bone className="h-9 w-36 rounded" />
        <Bone className="h-9 w-32 rounded" />
      </View>
      <View>
        <TextBone size="sm" width="w-40" className="mb-3" />
        <View className="gap-4">
          <SiteSkeleton />
          <SiteSkeleton index={1} />
        </View>
      </View>
    </Skeleton>
  )
}

/** A voting site card: name, address, hours. */
export function SiteSkeleton({ index = 0 }: { index?: number }) {
  return (
    <View className="rounded-lg border border-slate-700 bg-slate-800 p-4">
      <TextBone size="base" width={wide(index)} />
      <TextBone size="sm" width="w-1/2" className="mt-1" />
      <TextBone size="xs" width="w-2/5" className="mt-2" />
    </View>
  )
}

/** A screen of voter names and their votes. */
export function VoterRowsSkeleton({ count = 14 }: { count?: number }) {
  return (
    <Skeleton label="Loading votes">
      {Array.from({ length: count }, (_, i) => (
        <View key={i} className="flex-row items-center justify-between gap-3 py-1">
          <TextBone size="sm" width={narrow(i)} />
          <Bone className="h-3 w-8" />
        </View>
      ))}
    </Skeleton>
  )
}

/** PAC rows: swatch, name and details, amount. */
export function PacRowsSkeleton({ count = 10 }: { count?: number }) {
  return (
    <Skeleton label="Loading PACs" className="px-5">
      {Array.from({ length: count }, (_, i) => (
        <View key={i} className="flex-row items-center gap-3 border-b border-slate-800 py-2.5">
          <Bone className="h-2.5 w-2.5 rounded-sm" />
          <View className="min-w-0 flex-1">
            <TextBone size="xs" width={wide(i)} />
            <TextBone size="10" width={narrow(i)} />
          </View>
          <TextBone size="xs" width="w-16" />
        </View>
      ))}
    </Skeleton>
  )
}

/** Election results: scoreboard, map and a row of highlights. */
export function ResultsSkeleton() {
  return (
    <Skeleton label="Loading the latest counts" className="w-full gap-4 p-4">
      <TextBone size="2xl" width="w-1/2" />
      <View className="flex-row gap-3">
        <Bone className="h-20 flex-1 rounded-xl" />
        <Bone className="h-20 flex-1 rounded-xl" />
      </View>
      <Bone className="h-64 w-full rounded-xl" />
      <View className="flex-row gap-3">
        <Bone className="h-24 flex-1 rounded-xl" />
        <Bone className="h-24 flex-1 rounded-xl" />
        <Bone className="h-24 flex-1 rounded-xl" />
      </View>
    </Skeleton>
  )
}
