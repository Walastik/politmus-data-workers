import { FEED_FILTERS, FEED_LEVELS, groupFeed } from '@politmus/core/feed'
import { useMemo, useState } from 'react'
import { ActivityIndicator, RefreshControl, ScrollView, SectionList, Text, View } from 'react-native'

import FeedItemRow from '@/components/FeedItemRow'
import { Chip } from '@/components/ui'
import { gridCellStyle, useGridColumns } from '@/lib/layout'
import { pageMetadata } from '@/lib/metadata'
import { useFeed } from '@/lib/queries'

export function generateMetadata() {
  return pageMetadata('/feed')
}

export default function FeedScreen() {
  const [filterKey, setFilterKey] = useState('all')
  const [level, setLevel] = useState<string>('all')
  const feed = useFeed(filterKey, level)
  const columns = useGridColumns(2)

  // SectionList has no numColumns, so each section's entries go in rows of
  // `columns` (one per row on phones and the native app).
  const sections = useMemo(() => {
    const items = feed.data?.pages.flatMap((page) => (Array.isArray(page.items) ? page.items : [])) ?? []
    return groupFeed(items).map(({ label, entries }) => {
      const rows = []
      for (let i = 0; i < entries.length; i += columns) rows.push(entries.slice(i, i + columns))
      return { title: label, data: rows }
    })
  }, [feed.data, columns])

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
        keyExtractor={(row) => String(row[0].item.id)}
        renderItem={({ item: row }) =>
          columns > 1 ? (
            <View className="flex-row px-2.5">
              {row.map((entry) => (
                <View key={entry.item.id} style={gridCellStyle(columns)}>
                  <FeedItemRow entry={entry} grid />
                </View>
              ))}
            </View>
          ) : (
            <FeedItemRow entry={row[0]} />
          )
        }
        renderSectionHeader={({ section }) => (
          <Text className="bg-slate-900 px-4 pt-3 pb-2 text-xs font-sans-semibold uppercase tracking-wider text-slate-400">
            {section.title}
          </Text>
        )}
        ListHeaderComponent={filters}
        ListEmptyComponent={
          feed.isPending ? (
            <ActivityIndicator className="mt-10" colorClassName="accent-slate-400" />
          ) : feed.isError ? (
            <Text className="font-sans mt-10 px-8 text-center text-sm text-red-400">{feed.error.message}</Text>
          ) : (
            <Text className="font-sans mt-10 px-8 text-center text-sm text-slate-400">Nothing new yet.</Text>
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
