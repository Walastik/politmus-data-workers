import type { FeedEntry } from '@politmus/core/feed'
import { feedKindStyle, type FeedIcon } from '@politmus/core/feedItem'
import { formatBillDate, partyBadgeClass, partyShort } from '@politmus/core/types'
import { useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { useResolveClassNames } from 'uniwind'

import { openBill, openProfile } from '@/lib/links'

import { Icons } from './icons'

const FEED_ICONS: Record<FeedIcon, (typeof Icons)[keyof typeof Icons]> = {
  bill: Icons.FilePlus2,
  law: Icons.Gavel,
  failed: Icons.XCircle,
  progress: Icons.TrendingUp,
  vote: Icons.Vote,
  seated: Icons.UserPlus,
  departed: Icons.UserMinus,
}

// Native counterpart of the web FeedItemCard; labels and colours come from
// @politmus/core/feedItem so the two read the same.
export default function FeedItemRow({ entry }: { entry: FeedEntry }) {
  const { item, related } = entry
  const [showRelated, setShowRelated] = useState(false)
  const { label, icon, tone } = feedKindStyle(item, related.length + 1)
  const Icon = FEED_ICONS[icon]
  // tone is a runtime class (text-*), so read its colour rather than build accent-*.
  const toneColor = useResolveClassNames(tone).color
  const official = item.official
  const bill = item.bill
  const open = bill ? () => openBill(bill) : official ? () => openProfile(official) : undefined

  return (
    <View className="mx-4 mb-3 rounded-lg border border-slate-700 bg-slate-800 p-4">
      <Pressable
        onPress={open}
        disabled={!open}
        accessibilityRole={open ? 'button' : undefined}
        accessibilityLabel={`${label}: ${item.headline}`}
      >
        <View className="flex-row items-center justify-between gap-2">
          <View className="flex-1 flex-row items-center gap-1.5">
            <Icon size={14} color={typeof toneColor === 'string' ? toneColor : undefined} />
            <Text className={`text-xs font-semibold uppercase tracking-wider ${tone}`} numberOfLines={1}>
              {label}
            </Text>
          </View>
          <Text className="text-xs text-slate-500">{formatBillDate(item.occurred_at)}</Text>
        </View>

        <Text className="mt-2 text-base font-semibold leading-snug text-slate-100">{item.headline}</Text>
        {item.subline ? (
          <Text className="mt-1 text-sm text-slate-400" numberOfLines={2}>
            {item.subline}
          </Text>
        ) : null}

        {bill || official ? (
          <View className="mt-2 flex-row flex-wrap items-center gap-2">
            {bill ? <Text className="font-mono text-xs text-slate-400">{bill.id}</Text> : null}
            {bill?.policy_area ? (
              <Text className="rounded bg-slate-700/80 px-2 py-0.5 text-xs text-slate-300">{bill.policy_area}</Text>
            ) : null}
            {item.level === 'state' ? (
              <Text className="rounded bg-slate-700/80 px-2 py-0.5 text-xs text-slate-300">State</Text>
            ) : null}
            {official?.party ? (
              <Text className={`rounded px-2 py-0.5 text-xs font-semibold ${partyBadgeClass(official.party)}`}>
                {partyShort(official.party)}
              </Text>
            ) : null}
          </View>
        ) : null}
      </Pressable>

      {related.length > 0 ? (
        <View className="mt-3 border-t border-slate-700 pt-2">
          <Pressable
            onPress={() => setShowRelated((open) => !open)}
            accessibilityRole="button"
            accessibilityState={{ expanded: showRelated }}
            className="flex-row items-center gap-1"
          >
            {showRelated ? (
              <Icons.ChevronDown size={14} colorClassName="accent-slate-400" />
            ) : (
              <Icons.ChevronRight size={14} colorClassName="accent-slate-400" />
            )}
            <Text className="text-xs text-slate-400">
              {showRelated ? 'Hide' : 'Show'} {related.length} earlier vote{related.length === 1 ? '' : 's'} that day
            </Text>
          </Pressable>
          {showRelated
            ? related.map((vote) => (
                <View key={vote.id} className="mt-1 flex-row justify-between gap-3">
                  <Text className="flex-1 text-xs text-slate-300">
                    {vote.roll_call?.question ?? vote.subline ?? 'Roll call'}
                  </Text>
                  <Text className="text-xs text-slate-500">{vote.roll_call?.result}</Text>
                </View>
              ))
            : null}
        </View>
      ) : null}
    </View>
  )
}
