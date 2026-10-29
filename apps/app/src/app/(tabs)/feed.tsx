import { FEED_FILTERS, FEED_LEVELS, groupFeed } from '@politmus/core/feed'
import { useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, SectionList, Text, View } from 'react-native'

import FeedItemRow from '@/components/FeedItemRow'
import { useFeed } from '@/lib/queries'

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      className={`rounded-full border px-3 py-1 ${active ? 'border-blue-500 bg-blue-600' : 'border-slate-700 bg-slate-800'}`}
    >
      <Text className={`text-xs font-medium ${active ? 'text-white' : 'text-slate-300'}`}>{label}</Text>
    </Pressable>
  )
}

export default function FeedScreen() {
  const [filterKey, setFilterKey] = useState('all')
  const [level, setLevel] = useState<string>('all')
  const feed = useFeed(filterKey, level)

  const sections = useMemo(() => {
    const items = feed.data?.pages.flatMap((page) => (Array.isArray(page.items) ? page.items : [])) ?? []
    return groupFeed(items).map(({ label, entries }) => ({ title: label, data: entries }))
  }, [feed.data])

  const filters = (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2 px-4 py-3">
      {FEED_FILTERS.map((f) => (
        <Chip key={f.key} label={f.label} active={filterKey === f.key} onPress={() => setFilterKey(f.key)} />
      ))}
      <View className="mx-1 w-px bg-slate-700" />
      {FEED_LEVELS.map((l) => (
        <Chip key={l.key} label={l.label} active={level === l.key} onPress={() => setLevel(l.key)} />
      ))}
    </ScrollView>
  )

  return (
    <View className="flex-1 bg-slate-900">
      <SectionList
        sections={sections}
        keyExtractor={(entry) => String(entry.item.id)}
        renderItem={({ item }) => <FeedItemRow entry={item} />}
        renderSectionHeader={({ section }) => (
          <Text className="bg-slate-900 px-4 pt-3 pb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
            {section.title}
          </Text>
        )}
        ListHeaderComponent={filters}
        ListEmptyComponent={
          feed.isPending ? (
            <ActivityIndicator className="mt-10" colorClassName="accent-slate-400" />
          ) : feed.isError ? (
            <Text className="mt-10 px-8 text-center text-sm text-red-400">{feed.error.message}</Text>
          ) : (
            <Text className="mt-10 px-8 text-center text-sm text-slate-400">Nothing new yet.</Text>
          )
        }
        ListFooterComponent={
          feed.isFetchingNextPage ? <ActivityIndicator className="my-6" colorClassName="accent-slate-400" /> : undefined
        }
        onEndReached={() => {
          if (feed.hasNextPage && !feed.isFetchingNextPage) void feed.fetchNextPage()
        }}
        onEndReachedThreshold={0.5}
        refreshControl={
          <RefreshControl refreshing={feed.isRefetching && !feed.isFetchingNextPage} onRefresh={() => void feed.refetch()} />
        }
        stickySectionHeadersEnabled
      />
    </View>
  )
}
