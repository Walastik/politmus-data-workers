import { useState, type ReactNode } from 'react'
import { Pressable, Share, Text, View } from 'react-native'

import { Icons } from '../icons'

// Building blocks shared by the member and bill profiles.

export function SectionHeading({ children }: { children: ReactNode }) {
  return <Text className="text-xs font-sans-semibold uppercase tracking-wider text-slate-400">{children}</Text>
}

export function SubHeading({ children }: { children: ReactNode }) {
  return <Text className="text-[11px] font-sans-semibold uppercase tracking-wider text-slate-400">{children}</Text>
}

// A section that opens on tap, like the web drawer's collapsible sections.
export function Collapsible({
  title,
  icon,
  tone = 'text-slate-300',
  chevronAccent = 'accent-slate-400',
  boxClassName = 'rounded-xl border border-slate-700 bg-slate-800/40 p-4',
  right,
  children,
}: {
  title: string
  icon?: ReactNode
  tone?: string
  chevronAccent?: string
  boxClassName?: string
  right?: ReactNode
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const Chevron = open ? Icons.ChevronDown : Icons.ChevronRight
  return (
    <View className={boxClassName}>
      <View className="flex-row items-center justify-between gap-2">
        <Pressable
          onPress={() => setOpen(!open)}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          className="flex-1 flex-row items-center gap-2 py-0.5"
        >
          <Chevron size={16} colorClassName={chevronAccent} />
          {icon}
          <Text className={`text-xs font-sans-semibold uppercase tracking-wider ${tone}`}>{title}</Text>
        </Pressable>
        {right}
      </View>
      {open ? children : null}
    </View>
  )
}

// Small rounded label (status, policy area, mechanism…).
export function Pill({ className, children, rounded = 'rounded-full' }: { className: string; children: ReactNode; rounded?: string }) {
  return (
    <View className={`self-start px-2 py-0.5 ${rounded} ${className}`}>
      <Text className={`text-[10px] font-sans-semibold uppercase tracking-wider ${className}`}>{children}</Text>
    </View>
  )
}

export function Quote({ text, border = 'border-purple-500/60 bg-purple-950/30', tone = 'text-purple-200' }: { text: string; border?: string; tone?: string }) {
  return (
    <View className={`mt-2 rounded-r border-l-2 py-1 pr-2 pl-2.5 ${border}`}>
      <Text className={`font-sans text-[11px] italic ${tone}`}>“{text}”</Text>
    </View>
  )
}

export function Explainer({ label = 'What does this mean?', children }: { label?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <View className="mt-2">
      <Pressable onPress={() => setOpen(!open)} accessibilityRole="button" accessibilityState={{ expanded: open }} className="flex-row items-center gap-1">
        <Icons.Info size={12} colorClassName="accent-emerald-400" />
        <Text className="text-[11px] font-sans-medium text-emerald-400">{label}</Text>
      </Pressable>
      {open ? <Text className="font-sans mt-1 text-xs leading-relaxed text-slate-300">{children}</Text> : null}
    </View>
  )
}

export interface BarSegment {
  key: string
  share: number
  color: string
}

// One stacked bar with a 2px gap between segments; a legend carries identity.
export function StackedBar({ segments, label }: { segments: BarSegment[]; label: string }) {
  return (
    <View accessibilityRole="image" accessibilityLabel={label} className="mt-2 h-3 flex-row gap-0.5 overflow-hidden rounded">
      {segments.map((segment) => (
        <View key={segment.key} className="h-full" style={{ width: `${segment.share * 100}%`, backgroundColor: segment.color }} />
      ))}
    </View>
  )
}

export function LegendSwatch({ color }: { color: string }) {
  return <View className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: color }} />
}

// The system share sheet with the profile's politmus.com link.
export function ShareButton({ url, title }: { url: string; title: string }) {
  return (
    <Pressable
      onPress={() => void Share.share({ url, message: `${title}\n${url}` })}
      accessibilityRole="button"
      accessibilityLabel="Share"
      hitSlop={8}
      className="mr-2 p-1"
    >
      <Icons.Share2 size={20} colorClassName="accent-slate-200" />
    </Pressable>
  )
}
