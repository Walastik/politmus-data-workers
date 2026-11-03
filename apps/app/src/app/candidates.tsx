import { partyBarClass, formatCompactMoney } from '@politmus/core/campaignFinance'
import {
  CANDIDATES_PAGE_SIZE,
  CANDIDATE_TAG_TONES,
  DEFAULT_RACE_FILTERS,
  OFFICE_FILTERS,
  candidateTags,
  hiddenFilersNote,
  raceRaisedLine,
  raceReceiptShares,
  racesSourceNote,
  racesSummary,
  type RaceFilters,
} from '@politmus/core/candidates'
import {
  PARTY_FILTERS,
  STATE_OPTIONS,
  officialFromRaceCandidate,
  partyBadgeClass,
  partyShort,
  raceTitle,
  type Race,
  type RaceCandidate,
} from '@politmus/core/types'
import { Stack } from 'expo-router'
import { useEffect, useState } from 'react'
import { ActivityIndicator, FlatList, Pressable, Text, View } from 'react-native'

import { UnlistedNomineeCard } from '@/components/HappeningNow'
import { Icons } from '@/components/icons'
import OfficialPhoto from '@/components/OfficialPhoto'
import OptionSheet from '@/components/OptionSheet'
import { Chip, SearchField } from '@/components/ui'
import { openProfile } from '@/lib/links'
import { gridCellStyle, useGridColumns } from '@/lib/layout'
import { pageMetadata } from '@/lib/metadata'
import { useRaceList } from '@/lib/queries'

const STATE_CHOICES = [{ value: '', label: 'All states' }, ...STATE_OPTIONS.map((s) => ({ value: s.abbr, label: s.name }))]

export function generateMetadata() {
  return pageMetadata('/candidates')
}

// Everyone running for Congress this cycle, by race; native counterpart of
// the web Candidates page.
export default function CandidatesScreen() {
  const [filters, setFilters] = useState<RaceFilters>(DEFAULT_RACE_FILTERS)
  const [nameQuery, setNameQuery] = useState('')
  const [pages, setPages] = useState(1)
  const [picking, setPicking] = useState(false)
  const races = useRaceList(filters, CANDIDATES_PAGE_SIZE * pages)
  const page = races.data
  const items = page?.items ?? []

  // Any filter change starts the list over at one page.
  const update = (patch: Partial<RaceFilters>) => {
    setFilters((current) => ({ ...current, ...patch }))
    setPages(1)
  }

  useEffect(() => {
    const timer = setTimeout(() => {
      const next = nameQuery.trim()
      setFilters((current) => (current.query === next ? current : { ...current, query: next }))
      setPages(1)
    }, 200)
    return () => clearTimeout(timer)
  }, [nameQuery])

  const stateLabel = STATE_CHOICES.find((s) => s.value === filters.state)?.label ?? 'All states'

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: 'Candidates', headerBackTitle: 'Back' }} />
      <FlatList
        className="flex-1 bg-slate-900"
        contentContainerClassName="w-full md:max-w-[960px] md:self-center"
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        data={items}
        keyExtractor={(race) => race.key}
        renderItem={({ item }) => <RaceCard race={item} showAll={filters.showAll} />}
        ListHeaderComponent={
          <View className="gap-3 px-4 pt-4 pb-3">
            <Text className="text-sm text-slate-400">
              Everyone running for Congress this cycle, by race, with where they stand and who funds them.
            </Text>
            <SearchField value={nameQuery} onChangeText={setNameQuery} placeholder="Search candidates by name" label="Search candidates by name" />
            <View className="flex-row flex-wrap items-center gap-1.5">
              <Pressable
                onPress={() => setPicking(true)}
                accessibilityRole="button"
                accessibilityLabel={`Filter by state: ${stateLabel}`}
                className="flex-row items-center gap-1 rounded-full border border-slate-700 bg-slate-800 px-3 py-1"
              >
                <Text className="text-xs font-medium text-slate-200">{stateLabel}</Text>
                <Icons.ChevronDown size={12} colorClassName="accent-slate-400" />
              </Pressable>
              {OFFICE_FILTERS.map((option) => (
                <Chip key={option.label} label={option.label} active={filters.office === option.value} onPress={() => update({ office: option.value })} />
              ))}
            </View>
            <View className="flex-row flex-wrap items-center gap-1.5">
              {PARTY_FILTERS.map((option) => (
                <Chip
                  key={option.label}
                  label={option.label === 'All' ? 'All parties' : option.label}
                  active={filters.party === option.value}
                  onPress={() => update({ party: option.value })}
                />
              ))}
              <Chip label="Show all filers" active={filters.showAll} onPress={() => update({ showAll: !filters.showAll })} />
            </View>
            {page && items.length > 0 ? (
              <View className="gap-1">
                <Text className="text-sm text-slate-400">{racesSummary(page, Boolean(filters.state))}</Text>
                <SourceNote text={racesSourceNote(page)} />
              </View>
            ) : null}
            <OptionSheet
              visible={picking}
              title="State"
              options={STATE_CHOICES}
              value={filters.state}
              onSelect={(value) => update({ state: value })}
              onClose={() => setPicking(false)}
            />
          </View>
        }
        ListEmptyComponent={
          races.isPending ? (
            <ActivityIndicator className="mt-6" colorClassName="accent-slate-400" />
          ) : (
            <Text className={`px-4 ${races.isError ? 'text-red-400' : 'text-slate-400'}`}>
              {races.isError ? `${races.error.message}. Check your connection and try again.` : 'No races match this filter.'}
            </Text>
          )
        }
        ListFooterComponent={
          page && items.length < page.total_count ? (
            <Pressable
              disabled={races.isFetching}
              onPress={() => setPages(pages + 1)}
              accessibilityRole="button"
              className={`mx-4 mb-8 items-center rounded border border-slate-700 bg-slate-800 py-2.5 ${races.isFetching ? 'opacity-60' : ''}`}
            >
              <Text className="text-sm text-slate-300">
                {races.isFetching ? 'Loading…' : `Show more races (${page.total_count - items.length} left)`}
              </Text>
            </Pressable>
          ) : undefined
        }
      />
    </>
  )
}

// The note grows a sentence per state with a curated ballot; keep it to a few
// lines until tapped so the races stay in view.
function SourceNote({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  return (
    <Pressable onPress={() => setOpen(!open)} accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityHint="Shows the full source note">
      <Text className="text-xs text-slate-500" numberOfLines={open ? undefined : 3}>
        {text}
      </Text>
      {open ? null : <Text className="mt-0.5 text-xs font-medium text-blue-400">More about the sources</Text>}
    </Pressable>
  )
}

function RaceCard({ race, showAll }: { race: Race; showAll: boolean }) {
  const share = raceReceiptShares(race)
  const hidden = hiddenFilersNote(race)
  const columns = useGridColumns()
  return (
    <View accessibilityLabel={raceTitle(race)} className="mx-4 mb-4 rounded-xl border border-slate-700 bg-slate-800/40 p-4">
      <Text className="text-base font-semibold text-slate-100">{raceTitle(race)}</Text>
      <Text className="mt-0.5 text-xs text-slate-400">{raceRaisedLine(race)}</Text>
      <View className={columns > 1 ? '-mx-1.5 mt-1.5 flex-row flex-wrap' : 'mt-3 gap-3'}>
        {race.candidates.map((candidate) => (
          <View key={candidate.fec_candidate_id} style={gridCellStyle(columns)}>
            <CandidateCard candidate={candidate} race={race} share={share(candidate)} />
          </View>
        ))}
        {(race.unlisted_nominees ?? []).map((nominee) => (
          <View key={nominee.name} style={gridCellStyle(columns)}>
            <UnlistedNomineeCard nominee={nominee} />
          </View>
        ))}
      </View>
      {hidden && !showAll ? <Text className="mt-3 text-xs text-slate-500">{hidden}</Text> : null}
    </View>
  )
}

function CandidateCard({ candidate, race, share }: { candidate: RaceCandidate; race: Race; share: number }) {
  const name = candidate.name ?? candidate.fec_candidate_id
  const party = candidate.party ?? ''
  const tags = candidateTags(candidate, !race.ballot_filtered)
  return (
    <Pressable
      onPress={() => openProfile(officialFromRaceCandidate(candidate, race))}
      accessibilityRole="button"
      accessibilityLabel={`${name}${party ? `, ${partyShort(party)}` : ''}`}
      className="rounded-lg border border-slate-700 bg-slate-800 p-3 active:border-slate-500"
    >
      <View className="flex-row items-center gap-3">
        <OfficialPhoto url={candidate.photo_url} name={name} party={party} />
        <View className="min-w-0 flex-1">
          <View className="flex-row items-center gap-2">
            {party ? (
              <View className={`rounded px-1.5 py-0.5 ${partyBadgeClass(party)}`}>
                <Text className={`text-[10px] font-bold ${partyBadgeClass(party)}`}>{partyShort(party)}</Text>
              </View>
            ) : null}
            <Text className="flex-1 text-sm font-semibold text-slate-100" numberOfLines={1}>
              {name}
            </Text>
          </View>
          {tags.length > 0 ? (
            <View className="mt-1 flex-row flex-wrap gap-1">
              {tags.map((tag) => (
                <View key={tag.label} className={`rounded border px-1.5 py-0.5 ${CANDIDATE_TAG_TONES[tag.tone]}`}>
                  <Text className={`text-[10px] font-semibold ${CANDIDATE_TAG_TONES[tag.tone]}`}>{tag.label}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>
      </View>
      <View className="mt-3 flex-row gap-2">
        <View className="flex-1">
          <Text className="text-xs text-slate-500">Raised</Text>
          <Text className="text-xs font-semibold text-slate-100">{formatCompactMoney(candidate.receipts)}</Text>
        </View>
        <View className="flex-1">
          <Text className="text-xs text-slate-500">Cash on hand</Text>
          <Text className="text-xs font-semibold text-slate-100">{formatCompactMoney(candidate.cash_on_hand)}</Text>
        </View>
      </View>
      <View className="mt-2 h-1.5 overflow-hidden rounded bg-slate-900">
        <View className={`h-full ${partyBarClass(party)}`} style={{ width: `${share * 100}%` }} />
      </View>
    </Pressable>
  )
}
