import type { ReactNode } from 'react'
import { Pressable, Text, View } from 'react-native'

import { openUrl } from '@/lib/links'

import { Icons } from './icons'

// A titled card, like the web app's Happening Now sections.
export function Section({
  icon,
  title,
  action,
  children,
}: {
  icon?: ReactNode
  title: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <View className="rounded-xl border border-slate-700 bg-slate-800/40 p-4">
      <View className="mb-3 flex-row flex-wrap items-center justify-between gap-2">
        <View className="flex-row items-center gap-2">
          {icon}
          <Text className="text-sm font-semibold uppercase tracking-wider text-slate-300">{title}</Text>
        </View>
        {action}
      </View>
      {children}
    </View>
  )
}

// Blue text action with a chevron ("See the full Feed ›").
export function LinkAction({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="link" className="flex-row items-center gap-0.5">
      <Text className="text-sm font-semibold text-blue-400">{label}</Text>
      <Icons.ChevronRight size={16} colorClassName="accent-blue-400" />
    </Pressable>
  )
}

// Inline link to an outside page.
export function ExternalText({ url, label, className = 'text-blue-400' }: { url: string; label: string; className?: string }) {
  return (
    <Text onPress={() => openUrl(url)} accessibilityRole="link" className={`underline ${className}`}>
      {label}
    </Text>
  )
}

export function Muted({ children }: { children: ReactNode }) {
  return <Text className="text-sm text-slate-400">{children}</Text>
}

export function Badge({ className, children }: { className: string; children: ReactNode }) {
  return (
    <View className={`self-start rounded px-1.5 py-0.5 ${className}`}>
      <Text className={`text-[10px] font-bold ${className}`}>{children}</Text>
    </View>
  )
}
