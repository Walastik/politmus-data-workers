import { PAC_CATEGORY_COLORS, formatMoney } from '@politmus/core/campaignFinance'
import { PAC_SORTS, fecCommitteeUrl, pacMeta, type PacSort } from '@politmus/core/pacExplorer'
import type { FinanceElection, Pac } from '@politmus/core/types'
import { Stack, useLocalSearchParams } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, FlatList, Pressable, ScrollView, Text, View } from 'react-native'

import { Icons } from '@/components/icons'
import { LegendSwatch } from '@/components/profile/parts'
import { Chip, SearchField } from '@/components/ui'
import { openUrl } from '@/lib/links'
import { useFinance, usePacGifts, usePacList, usePacSummary } from '@/lib/queries'

const color = (key: string) => PAC_CATEGORY_COLORS[key] ?? PAC_CATEGORY_COLORS.other

// Every PAC that gave in one election, searchable and filterable; native
// counterpart of the web PacExplorer.
export default function PacExplorerScreen() {
  const { id, candidate, year } = useLocalSearchParams<{ id: string; candidate: string; year: string }>()
  const finance = useFinance(id, true)
  const election = finance.data?.elections.find(
    (e) => e.fec_candidate_id === candidate && String(e.election_year) === year,
  )

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: `PACs · ${year} election`, headerBackTitle: 'Back' }} />
      {election ? (
        <Explorer officialId={id} election={election} />
      ) : (
        <View className="flex-1 bg-slate-900 px-5 py-5">
          <Text className={`text-sm ${finance.isError ? 'text-rose-300' : 'text-slate-400'}`}>
            {finance.isError ? finance.error.message : finance.data ? 'That election has no finance data.' : 'Loading…'}
          </Text>
        </View>
      )}
    </>
  )
}

function Explorer({ officialId, election }: { officialId: string; election: FinanceElection }) {
  const summary = usePacSummary(officialId, election).data
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [category, setCategory] = useState<string | null>(null)
  const [sort, setSort] = useState<PacSort>('amount')
  const [expanded, setExpanded] = useState<string | null>(null)
  const list = usePacList(officialId, election, { sort, query: debouncedQuery, category })
  const items = useMemo(() => list.data?.pages.flatMap((page) => page.items) ?? [], [list.data])
  const total = list.data?.pages[0]?.total_count

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 250)
    return () => clearTimeout(timer)
  }, [query])

  // Any filter change collapses the open PAC.
  useEffect(() => setExpanded(null), [debouncedQuery, category, sort])

  return (
    <FlatList
      className={`flex-1 bg-slate-900 ${list.isPlaceholderData ? 'opacity-60' : ''}`}
      contentContainerClassName="w-full md:max-w-[960px] md:self-center"
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      data={items}
      keyExtractor={(pac) => pac.pac_key}
      extraData={expanded}
      ListHeaderComponent={
        <View className="gap-3 px-5 pt-4 pb-2">
          <SearchField value={query} onChangeText={setQuery} placeholder="Search PACs by name" label="Search PACs by name" />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-1.5">
            <Chip
              label={`All${summary ? ` · ${summary.pac_count}` : ''}`}
              active={category === null}
              onPress={() => setCategory(null)}
              activeClassName="border-emerald-400 bg-emerald-500/20"
            />
            {(summary?.categories ?? []).map((c) => (
              <Chip
                key={c.key}
                label={`${c.label} · ${c.pac_count}`}
                active={category === c.key}
                onPress={() => setCategory(category === c.key ? null : c.key)}
                activeClassName="border-emerald-400 bg-emerald-500/20"
                icon={<LegendSwatch color={color(c.key)} />}
              />
            ))}
          </ScrollView>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="items-center gap-1.5">
            <Text className="mr-1 text-xs text-slate-400">Sort</Text>
            {PAC_SORTS.map((option) => (
              <Chip key={option.value} label={option.label} active={sort === option.value} onPress={() => setSort(option.value)} />
            ))}
          </ScrollView>
          {total !== undefined ? (
            <Text className="text-xs text-slate-400">
              {total} {total === 1 ? 'PAC' : 'PACs'}
            </Text>
          ) : null}
        </View>
      }
      renderItem={({ item }) => (
        <PacRow
          pac={item}
          open={expanded === item.pac_key}
          onToggle={() => setExpanded(expanded === item.pac_key ? null : item.pac_key)}
          officialId={officialId}
          election={election}
        />
      )}
      ListEmptyComponent={
        list.isPending ? (
          <ActivityIndicator className="mt-6" colorClassName="accent-slate-400" />
        ) : (
          <Text className={`px-5 text-sm ${list.isError ? 'text-rose-300' : 'text-slate-400'}`}>
            {list.isError ? list.error.message : 'No PACs match.'}
          </Text>
        )
      }
      ListFooterComponent={list.isFetchingNextPage ? <ActivityIndicator className="my-6" colorClassName="accent-slate-400" /> : <View className="h-8" />}
      onEndReached={() => {
        if (list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage()
      }}
      onEndReachedThreshold={0.5}
    />
  )
}

function PacRow({
  pac,
  open,
  onToggle,
  officialId,
  election,
}: {
  pac: Pac
  open: boolean
  onToggle: () => void
  officialId: string
  election: FinanceElection
}) {
  const Chevron = open ? Icons.ChevronDown : Icons.ChevronRight
  return (
    <View className="mx-5 border-b border-slate-800 py-2.5">
      <Pressable onPress={onToggle} accessibilityRole="button" accessibilityState={{ expanded: open }} className="flex-row items-start gap-2">
        <Chevron size={14} colorClassName="accent-slate-500" />
        <View className="mt-0.5">
          <LegendSwatch color={color(pac.category)} />
        </View>
        <View className="min-w-0 flex-1">
          <Text className="text-xs text-slate-100">{pac.name}</Text>
          <Text className="text-[10px] text-slate-500">{pacMeta(pac)}</Text>
        </View>
        <Text className="text-xs text-slate-200">{formatMoney(pac.total)}</Text>
      </Pressable>
      {open ? <PacGifts officialId={officialId} election={election} pac={pac} /> : null}
    </View>
  )
}

function PacGifts({ officialId, election, pac }: { officialId: string; election: FinanceElection; pac: Pac }) {
  const gifts = usePacGifts(officialId, election, pac.pac_key)
  if (gifts.isError) return <Text className="mt-1 ml-6 text-[11px] text-rose-300">{gifts.error.message}</Text>
  if (!gifts.data) return <Text className="mt-1 ml-6 text-[11px] text-slate-500">Loading gifts…</Text>
  return (
    <View className="mt-1.5 ml-6 gap-1">
      {gifts.data.map((gift) => (
        <View key={gift.sub_id} className="flex-row items-center gap-3">
          <Text className="w-20 text-[11px] text-slate-400">{gift.receipt_date ?? '—'}</Text>
          <Text className="w-16 text-right text-[11px] text-slate-300">{formatMoney(gift.amount)}</Text>
          {gift.pdf_url ? (
            <Pressable onPress={() => openUrl(gift.pdf_url!)} accessibilityRole="link" className="flex-row items-center gap-0.5">
              <Text className="text-[11px] text-emerald-400">Filing</Text>
              <Icons.ExternalLink size={12} colorClassName="accent-emerald-400" />
            </Pressable>
          ) : null}
        </View>
      ))}
      {pac.committee_id ? (
        <Pressable onPress={() => openUrl(fecCommitteeUrl(pac.committee_id!))} accessibilityRole="link" className="flex-row items-center gap-0.5">
          <Text className="text-[11px] text-emerald-400">{pac.committee_id} on FEC.gov</Text>
          <Icons.ExternalLink size={12} colorClassName="accent-emerald-400" />
        </Pressable>
      ) : null}
    </View>
  )
}
