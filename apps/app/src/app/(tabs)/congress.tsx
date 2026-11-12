import {
  CONGRESS_VIEWS,
  VOTE_THRESHOLDS,
  VOTE_THRESHOLD_FOOTNOTE,
  byState,
  chamberLeaders,
  chamberMakeup,
  delegationSummary,
  houseSeatLabel,
  memberMatches,
  partyFillClass,
  sortRoster,
  splitChambers,
  type CongressView,
  type LeadershipPost,
  type RosterSort,
} from '@politmus/core/congress'
import {
  PARTY_FILTERS,
  ROSTER_STATUS_FILTERS,
  STATE_OPTIONS,
  officeLine,
  officialName,
  partyShort,
  rosterStatusLabel,
  type Official,
  type RosterStatusFilter,
} from '@politmus/core/types'
import { router } from 'expo-router'
import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { ActivityIndicator, FlatList, Pressable, Text, View } from 'react-native'

import { Icons } from '@/components/icons'
import MemberRow from '@/components/MemberRow'
import OptionSheet from '@/components/OptionSheet'
import { Chip, SearchField } from '@/components/ui'
import { gridCellStyle, useGridColumns } from '@/lib/layout'
import { openProfile } from '@/lib/links'
import { pageMetadata } from '@/lib/metadata'
import { useCurrentMembers, useRoster } from '@/lib/queries'

const STATE_CHOICES = [{ value: '', label: 'All states' }, ...STATE_OPTIONS.map((s) => ({ value: s.name, label: s.name }))]

export function generateMetadata() {
  return pageMetadata('/congress')
}

// Every current member of the Senate and House, with their Politmus Score;
// native counterpart of the web Congress page.
export default function CongressScreen() {
  const [view, setView] = useState<CongressView>('senate')
  const [party, setParty] = useState('')
  const [stateName, setStateName] = useState('')
  const [nameQuery, setNameQuery] = useState('')
  const [picking, setPicking] = useState(false)
  const query = useDebounced(nameQuery.trim(), 200)
  const members = useCurrentMembers()
  const chambers = splitChambers(members.data ?? [])
  const filters = { party, stateName, query }

  const header = (
    <View className="gap-4 px-4 pt-4 pb-3">
      <Text className="font-sans text-sm text-slate-400">
        Every current member of the Senate and House, with their Politmus Score. Running this cycle?{' '}
        <Text onPress={() => router.push('/candidates')} className="text-blue-400">
          See the candidates
        </Text>
        .
      </Text>
      {members.data ? (
        <View className="gap-3">
          <ChamberSummary title="Senate" members={chambers.senators} leaders={chamberLeaders(members.data, 'Senate')} />
          <ChamberSummary
            title="House"
            members={chambers.voting}
            leaders={chamberLeaders(members.data, 'House')}
            note={`plus ${chambers.delegates} non-voting delegates`}
          />
        </View>
      ) : null}
      <View className="flex-row rounded-lg border border-slate-700 bg-slate-800/60 p-1">
        {CONGRESS_VIEWS.map(({ key, label }) => (
          <Pressable
            key={key}
            onPress={() => setView(key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: view === key }}
            className={`flex-1 items-center rounded-md py-1.5 ${view === key ? 'bg-blue-600' : ''}`}
          >
            <Text className={`text-sm font-sans-medium ${view === key ? 'text-white' : 'text-slate-300'}`}>{label}</Text>
          </Pressable>
        ))}
      </View>
      <SearchField value={nameQuery} onChangeText={setNameQuery} placeholder="Search by name" label="Search members by name" />
      <View className="flex-row flex-wrap items-center gap-1.5">
        <Pressable
          onPress={() => setPicking(true)}
          accessibilityRole="button"
          accessibilityLabel={`Filter by state: ${stateName || 'All states'}`}
          className="flex-row items-center gap-1 rounded-full border border-slate-700 bg-slate-800 px-3 py-1"
        >
          <Text className="text-xs font-sans-medium text-slate-200">{stateName || 'All states'}</Text>
          <Icons.ChevronDown size={12} colorClassName="accent-slate-400" />
        </Pressable>
        {PARTY_FILTERS.map(({ value, label }) => (
          <Chip key={label} label={label} active={party === value} onPress={() => setParty(value)} />
        ))}
      </View>
      <OptionSheet
        visible={picking}
        title="State"
        options={STATE_CHOICES}
        value={stateName}
        onSelect={setStateName}
        onClose={() => setPicking(false)}
      />
    </View>
  )

  if (view === 'list') return <MemberList header={header} {...filters} />

  if (!members.data) {
    return (
      <FlatList
        className="flex-1 bg-slate-900"
        data={[]}
        renderItem={() => null}
        ListHeaderComponent={header}
        ListEmptyComponent={
          members.isError ? (
            <Text className="font-sans px-4 text-red-400">{members.error.message}. Check your connection and try again.</Text>
          ) : (
            <ActivityIndicator className="mt-6" colorClassName="accent-slate-400" />
          )
        }
      />
    )
  }

  return view === 'senate' ? (
    <SenateView header={header} members={chambers.senators.filter((m) => memberMatches(m, filters))} />
  ) : (
    <HouseView header={header} members={chambers.house.filter((m) => memberMatches(m, filters))} expandAll={Boolean(stateName || query)} />
  )
}

function ChamberSummary({
  title,
  members,
  leaders,
  note,
}: {
  title: 'Senate' | 'House'
  members: Official[]
  leaders: LeadershipPost[] | null
  note?: string
}) {
  const { segments, scored } = chamberMakeup(members)
  const [showNumbers, setShowNumbers] = useState(false)
  return (
    <View accessibilityLabel={`${title} makeup`} className="rounded-xl border border-slate-700 bg-slate-800/40 p-4">
      <View className="flex-row items-baseline justify-between gap-2">
        <View className="flex-row items-center gap-1.5">
          <Text className="text-sm font-sans-semibold uppercase tracking-wider text-slate-300">{title}</Text>
          <Pressable
            onPress={() => setShowNumbers(!showNumbers)}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={`${title} key vote numbers`}
            accessibilityState={{ expanded: showNumbers }}
            className="active:opacity-70"
          >
            <Icons.Info size={14} colorClassName={showNumbers ? 'accent-blue-400' : 'accent-slate-500'} />
          </Pressable>
        </View>
        <Text className="font-sans text-xs text-slate-500">
          {members.length} members{note ? ` · ${note}` : ''}
        </Text>
      </View>
      <View className="mt-3 h-3 flex-row overflow-hidden rounded-full bg-slate-700">
        {segments.map((s) => (
          <View key={s.key} className={s.bar} style={{ width: `${s.share * 100}%` }} />
        ))}
      </View>
      <View className="mt-2 flex-row flex-wrap gap-x-4 gap-y-1">
        {segments.map((s) => (
          <Text key={s.key} className={`font-sans text-sm ${s.text}`}>
            <Text className="font-sans-semibold">{s.count}</Text> {s.label}
            {s.count === 1 ? '' : 's'}
          </Text>
        ))}
      </View>
      {showNumbers ? <VoteNumbers chamber={title} /> : null}
      {leaders ? (
        <View accessibilityLabel={`${title} leadership`} className="mt-3 gap-1.5 border-t border-slate-700/70 pt-3">
          {leaders.map((post) => (
            <LeaderLine key={post.title} post={post} />
          ))}
        </View>
      ) : null}
      <Text className="font-sans mt-2 text-xs text-slate-500">
        {scored} of {members.length} have a Politmus Score so far.
      </Text>
    </View>
  )
}

// The votes it takes to pass a bill, end a filibuster or override a veto,
// behind the chamber card's info button. No party named and no line on the bar.
function VoteNumbers({ chamber }: { chamber: 'Senate' | 'House' }) {
  const { thresholds, notes } = VOTE_THRESHOLDS[chamber]
  return (
    <View accessibilityLabel={`${chamber} key vote numbers`} className="mt-3 gap-2.5 rounded-lg bg-slate-900/60 p-3">
      {thresholds.map((t) => (
        <View key={t.label} accessible className="flex-row gap-3">
          <Text className="w-10 font-mono text-base text-slate-100">{t.votes}</Text>
          <View className="flex-1">
            <Text className="font-sans-semibold text-sm text-slate-200">{t.label}</Text>
            <Text className="font-sans text-xs leading-relaxed text-slate-400">{t.detail}</Text>
          </View>
        </View>
      ))}
      {notes.map((note) => (
        <Text key={note} className="font-sans text-xs leading-relaxed text-slate-400">
          {note}
        </Text>
      ))}
      <Text className="font-sans text-xs text-slate-500">{VOTE_THRESHOLD_FOOTNOTE}</Text>
    </View>
  )
}

// "Speaker   Mike Johnson (R)", opening their profile; "Vacant" when no one holds the post.
function LeaderLine({ post }: { post: LeadershipPost }) {
  const { holder } = post
  const label = <Text className="font-sans w-32 text-xs text-slate-500">{post.label}</Text>
  if (!holder) {
    return (
      <View accessible accessibilityLabel={`${post.title}: vacant`} className="flex-row items-baseline gap-2">
        {label}
        <Text className="font-sans flex-1 text-sm text-slate-400">Vacant</Text>
      </View>
    )
  }
  const name = officialName(holder)
  return (
    <Pressable
      onPress={() => openProfile(holder)}
      accessibilityRole="button"
      accessibilityLabel={`${post.title}: ${name}, ${partyShort(holder.party)}`}
      className="flex-row items-baseline gap-2 active:opacity-70"
    >
      {label}
      <Text className="font-sans flex-1 text-sm text-blue-400" numberOfLines={1}>
        {name} <Text className="text-slate-400">({partyShort(holder.party)})</Text>
      </Text>
    </Pressable>
  )
}

function SenateView({ header, members }: { header: ReactElement; members: Official[] }) {
  const columns = useGridColumns()
  const grid = columns > 1
  return (
    <FlatList
      // numColumns can't change on a mounted list.
      key={`senate-${columns}`}
      numColumns={columns}
      className="flex-1 bg-slate-900"
      contentContainerClassName={grid ? 'px-2.5' : undefined}
      keyboardShouldPersistTaps="handled"
      data={byState(members)}
      keyExtractor={([state]) => state}
      ListHeaderComponent={<View className={grid ? '-mx-2.5' : undefined}>{header}</View>}
      ListEmptyComponent={<Text className="font-sans px-4 text-slate-400">No senators match these filters.</Text>}
      renderItem={({ item: [state, senators] }) => (
        <View style={gridCellStyle(columns)}>
          <View className={`rounded-lg border border-slate-700 bg-slate-800/40 p-3 ${grid ? 'h-full' : 'mx-4 mb-3'}`}>
            <Text className="mb-2 text-xs font-sans-semibold uppercase tracking-wider text-slate-400">{state}</Text>
            <View className="gap-1.5">
              {senators.map((senator) => (
                <MemberRow key={senator.id} official={senator} />
              ))}
            </View>
          </View>
        </View>
      )}
    />
  )
}

function HouseView({ header, members, expandAll }: { header: ReactElement; members: Official[]; expandAll: boolean }) {
  const columns = useGridColumns()
  const [open, setOpen] = useState<Set<string>>(new Set())
  const groups = byState(members)
  const allOpen = expandAll || groups.every(([state]) => open.has(state))
  const toggle = (state: string) =>
    setOpen((current) => {
      const next = new Set(current)
      if (next.has(state)) next.delete(state)
      else next.add(state)
      return next
    })

  return (
    <FlatList
      className="flex-1 bg-slate-900"
      keyboardShouldPersistTaps="handled"
      data={groups}
      keyExtractor={([state]) => state}
      extraData={open}
      ListHeaderComponent={
        <View>
          {header}
          {expandAll || groups.length === 0 ? null : (
            <Pressable
              onPress={() => setOpen(allOpen ? new Set() : new Set(groups.map(([state]) => state)))}
              accessibilityRole="button"
              className="self-end px-4 pb-2"
            >
              <Text className="text-sm font-sans-semibold text-blue-400">{allOpen ? 'Collapse all' : 'Expand all'}</Text>
            </Pressable>
          )}
        </View>
      }
      ListEmptyComponent={<Text className="font-sans px-4 text-slate-400">No House members match these filters.</Text>}
      renderItem={({ item: [state, delegation] }) => {
        const isOpen = expandAll || open.has(state)
        const summary = delegationSummary(delegation)
        const Chevron = isOpen ? Icons.ChevronDown : Icons.ChevronRight
        return (
          <View className="mx-4 border-b border-slate-800">
            <Pressable
              onPress={() => toggle(state)}
              accessibilityRole="button"
              accessibilityState={{ expanded: isOpen }}
              className="flex-row items-center gap-3 py-3 active:bg-slate-800/60"
            >
              <Chevron size={16} colorClassName="accent-slate-500" />
              <Text className="flex-1 font-sans-medium text-slate-100">{state}</Text>
              <View className="flex-row gap-0.5">
                {summary.byParty.slice(0, 20).map((m) => (
                  <View key={m.id} className={`h-3 w-1.5 rounded-sm ${partyFillClass(m.party)}`} />
                ))}
              </View>
              <Text className="font-sans text-xs text-slate-400">{summary.label}</Text>
            </Pressable>
            {isOpen ? (
              columns > 1 ? (
                <View className="-mx-1.5 flex-row flex-wrap pb-3">
                  {summary.byDistrict.map((member) => (
                    <View key={member.id} style={gridCellStyle(columns)}>
                      <MemberRow official={member} subtitle={houseSeatLabel(member)} />
                    </View>
                  ))}
                </View>
              ) : (
                <View className="gap-1.5 pb-4">
                  {summary.byDistrict.map((member) => (
                    <MemberRow key={member.id} official={member} subtitle={houseSeatLabel(member)} />
                  ))}
                </View>
              )
            ) : null}
          </View>
        )
      }}
    />
  )
}

// The searchable roster: current or former members, filtered on the server.
function MemberList({ header, party, stateName, query }: { header: ReactElement; party: string; stateName: string; query: string }) {
  const [status, setStatus] = useState<RosterStatusFilter>('active')
  const [hasPositionsOnly, setHasPositionsOnly] = useState(false)
  const [sort, setSort] = useState<RosterSort>('name')
  const roster = useRoster({ status, party, stateName, query })
  const columns = useGridColumns()
  const grid = columns > 1
  const visible = useMemo(() => sortRoster(roster.data ?? [], { sort, hasPositionsOnly }), [roster.data, sort, hasPositionsOnly])

  return (
    <FlatList
      key={`roster-${columns}`}
      numColumns={columns}
      contentContainerClassName={grid ? 'px-2.5' : undefined}
      className={`flex-1 bg-slate-900 ${roster.isPlaceholderData ? 'opacity-60' : ''}`}
      keyboardShouldPersistTaps="handled"
      data={visible}
      keyExtractor={(official) => official.id}
      ListHeaderComponent={
        <View className={grid ? '-mx-2.5' : undefined}>
          {header}
          <View className="flex-row flex-wrap items-center gap-1.5 px-4 pb-3">
            {ROSTER_STATUS_FILTERS.map(({ value, label }) => (
              <Chip key={value} label={label} active={status === value} onPress={() => setStatus(value)} />
            ))}
            <Chip
              label="Has AI positions"
              active={hasPositionsOnly}
              onPress={() => setHasPositionsOnly(!hasPositionsOnly)}
              activeClassName="border-purple-500 bg-purple-600"
              icon={<Icons.Sparkles size={12} colorClassName={hasPositionsOnly ? 'accent-white' : 'accent-purple-300'} />}
            />
            <Chip
              label={sort === 'score' ? 'Sort: Score' : 'Sort: Name'}
              active={sort === 'score'}
              onPress={() => setSort(sort === 'score' ? 'name' : 'score')}
            />
          </View>
          {roster.data && visible.length > 0 ? (
            <Text className="font-sans px-4 pb-3 text-sm text-slate-400">
              Showing {visible.length} member{visible.length === 1 ? '' : 's'}
            </Text>
          ) : null}
        </View>
      }
      ListEmptyComponent={
        roster.isPending ? (
          <ActivityIndicator className="mt-6" colorClassName="accent-slate-400" />
        ) : (
          <Text className={`font-sans px-4 ${roster.isError ? 'text-red-400' : 'text-slate-400'}`}>
            {roster.isError ? roster.error.message : 'No officials match this filter.'}
          </Text>
        )
      }
      renderItem={({ item }) => (
        <View className={grid ? undefined : 'mx-4 mb-1.5'} style={gridCellStyle(columns)}>
          <MemberRow official={item} subtitle={officeLine(item)} status={status === 'active' ? undefined : rosterStatusLabel(item)} />
        </View>
      )}
    />
  )
}

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return debounced
}
