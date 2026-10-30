import { useAuth } from '@clerk/expo'
import { billDates, sponsorText } from '@politmus/core/billProfile'
import {
  BILL_FILTER_GROUPS,
  DEFAULT_BILL_FILTERS,
  billSortOptions,
  noBillsMessage,
  sortForQueryChange,
  type BillFilters,
} from '@politmus/core/billsList'
import type { Bill } from '@politmus/core/types'
import { useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, FlatList, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native'

import { Icons } from '@/components/icons'
import { BillTags } from '@/components/profile/BillSections'
import VoteTally from '@/components/profile/VoteTally'
import { Chip, SearchField } from '@/components/ui'
import { openBill } from '@/lib/links'
import { gridCellStyle, useGridColumns } from '@/lib/layout'
import { useBills } from '@/lib/queries'

// Legislation moving through Congress; native counterpart of the web Bills page.
export default function BillsScreen() {
  const [query, setQuery] = useState('')
  const [filters, setFilters] = useState<BillFilters>(DEFAULT_BILL_FILTERS)
  const [showFilters, setShowFilters] = useState(false)
  const bills = useBills(filters)
  const columns = useGridColumns(2)
  const grid = columns > 1

  // Debounce the search box into the filters.
  useEffect(() => {
    const timer = setTimeout(() => {
      const next = query.trim()
      setFilters((current) =>
        next === current.query ? current : { ...current, query: next, sort: sortForQueryChange(current.query, next, current.sort) },
      )
    }, 250)
    return () => clearTimeout(timer)
  }, [query])

  const items = useMemo(() => bills.data?.pages.flatMap((page) => (Array.isArray(page.items) ? page.items : [])) ?? [], [bills.data])
  const total = bills.data?.pages[0]?.total ?? 0
  const active = BILL_FILTER_GROUPS.filter((group) => filters[group.key] !== 'all').length

  const header = (
    <View className="gap-3 px-4 pt-4 pb-3">
      <SearchField
        value={query}
        onChangeText={setQuery}
        placeholder="Bill number (H.R. 1), title, sponsor, or topic"
        label="Search bills"
      />
      <Pressable
        onPress={() => setShowFilters(!showFilters)}
        accessibilityRole="button"
        accessibilityState={{ expanded: showFilters }}
        className="flex-row items-center gap-1.5 self-start"
      >
        {showFilters ? <Icons.ChevronDown size={16} colorClassName="accent-blue-400" /> : <Icons.ChevronRight size={16} colorClassName="accent-blue-400" />}
        <Icons.ListFilter size={14} colorClassName="accent-blue-400" />
        <Text className="text-sm font-semibold text-blue-400">Filters and sort{active ? ` (${active})` : ''}</Text>
      </Pressable>
      {showFilters ? (
        <View className="gap-3 rounded-lg border border-slate-700 bg-slate-800/60 p-3">
          {[...BILL_FILTER_GROUPS, { key: 'sort' as const, label: 'Sort By', options: billSortOptions(Boolean(filters.query)) }].map((group) => (
            <View key={group.key}>
              <Text className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{group.label}</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-1.5">
                {group.options.map((option) => (
                  <Chip
                    key={option.value}
                    label={option.label}
                    active={filters[group.key] === option.value}
                    onPress={() => setFilters((current) => ({ ...current, [group.key]: option.value }))}
                  />
                ))}
              </ScrollView>
            </View>
          ))}
        </View>
      ) : null}
      {items.length > 0 ? (
        <Text className="text-sm text-slate-400">
          Showing {items.length}/{total} bill{total === 1 ? '' : 's'}
        </Text>
      ) : null}
    </View>
  )

  return (
    <View className="flex-1 bg-slate-900">
      <FlatList
        // numColumns can't change on a mounted list.
        key={`bills-${columns}`}
        numColumns={columns}
        contentContainerClassName={grid ? 'px-2.5' : undefined}
        data={items}
        keyExtractor={(bill) => bill.id}
        renderItem={({ item }) => (
          <View style={gridCellStyle(columns)}>
            <BillCard bill={item} grid={grid} />
          </View>
        )}
        ListHeaderComponent={<View className={grid ? '-mx-2.5' : undefined}>{header}</View>}
        keyboardShouldPersistTaps="handled"
        className={bills.isPlaceholderData ? 'opacity-50' : ''}
        ListEmptyComponent={
          bills.isPending ? (
            <ActivityIndicator className="mt-10" colorClassName="accent-slate-400" />
          ) : (
            <Text className={`mt-6 px-8 text-center text-sm ${bills.isError ? 'text-red-400' : 'text-slate-400'}`}>
              {bills.isError ? bills.error.message : noBillsMessage(filters.query)}
            </Text>
          )
        }
        ListFooterComponent={bills.isFetchingNextPage ? <ActivityIndicator className="my-6" colorClassName="accent-slate-400" /> : undefined}
        onEndReached={() => {
          if (bills.hasNextPage && !bills.isFetchingNextPage) void bills.fetchNextPage()
        }}
        onEndReachedThreshold={0.5}
        refreshControl={<RefreshControl refreshing={bills.isRefetching && !bills.isFetchingNextPage} onRefresh={() => void bills.refetch()} />}
      />
    </View>
  )
}

function BillCard({ bill, grid }: { bill: Bill; grid: boolean }) {
  const { isSignedIn } = useAuth()
  const sponsor = sponsorText(bill)
  const dates = billDates(bill)
  const intents = bill.classification_metadata?.intents ?? []
  return (
    <Pressable
      onPress={() => openBill(bill)}
      accessibilityRole="button"
      accessibilityLabel={`Open details for ${bill.title || bill.id}`}
      className={`rounded-lg border border-slate-700 bg-slate-800 p-4 active:border-slate-500 ${grid ? 'h-full' : 'mx-4 mb-3'}`}
    >
      <View className="flex-row flex-wrap items-start justify-between gap-2">
        <Text className="font-mono text-xs text-slate-400">{bill.id}</Text>
        <Text className={`max-w-[70%] text-xs ${sponsor.name ? 'text-slate-300' : 'text-slate-500'}`} numberOfLines={1}>
          {sponsor.name ?? 'No sponsor listed'}
        </Text>
      </View>
      <Text className="mt-2 text-base font-semibold leading-snug text-slate-100" numberOfLines={3}>
        {bill.title || 'Untitled bill'}
      </Text>
      <BillTags bill={bill} />
      {isSignedIn && intents.length > 0 ? (
        <View className="mt-2 flex-row items-center gap-1 self-start rounded-full border border-purple-800/70 bg-purple-950/70 px-2 py-0.5">
          <Icons.Sparkles size={10} colorClassName="accent-purple-400" />
          <Text className="text-[10px] font-semibold uppercase tracking-wider text-purple-300">AI Classified ({intents.length})</Text>
        </View>
      ) : null}
      {dates.introduced || dates.voted || dates.velocity ? (
        <Text className="mt-2 text-xs text-slate-500">
          {[dates.introduced ? `Introduced ${dates.introduced}` : null, dates.voted ? `Voted ${dates.voted}` : null, dates.velocity?.text]
            .filter(Boolean)
            .join(' · ')}
        </Text>
      ) : null}
      <View className="mt-3">
        <VoteTally summary={bill.votes_summary} byParty={bill.votes_by_party} compact />
      </View>
    </Pressable>
  )
}
