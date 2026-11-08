import {
  AGGREGATOR,
  PARTY_COLOR,
  PARTY_LABEL,
  countingComplete,
  countyLabel,
  countyStanding,
  countyTurnout,
  dollarsPerVote,
  formatMargin,
  formatMoney,
  formatPercent,
  formatSourceTime,
  formatVotes,
  houseRaces,
  isAggregated,
  partyKey,
  partyTint,
  raceKey,
  raceStanding,
  raceStatus,
  raceWinner,
  reportingLabel,
  senateRace,
  share,
  stateTurnout,
  type CandidateProfile,
  type RaceResult,
  type ResultCandidate,
  type SenateRaceInfo,
  type StateResults,
} from '@politmus/core/electionResults'
import { turnoutColor, type CountyView, type MapOffice } from '@politmus/core/resultsMap'
import { getVoterResources } from '@politmus/core/types'
import { useEffect, type ReactNode } from 'react'
import { Pressable, Text, View } from 'react-native'
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated'

import { ExternalText } from '@/components/ui'
import { openProfile } from '@/lib/links'

import { StatusBadge } from './Congress'
import { Face } from './Face'
import { Segmented } from './Hero'
import { Dot, Heading, Panel, Row, SeatGrid, Source } from './Overview'

const TABULAR = { fontVariant: ['tabular-nums' as const] }

function showProfile(profile: CandidateProfile | null | undefined) {
  if (profile?.officialId) openProfile({ id: profile.officialId })
}

// The panel with a state open (the web StatePanel): the source, stats, the
// race chips and House seats, the race itself, and the county lists.
export function StatePanel({
  state,
  results,
  info,
  race,
  office,
  countyView,
  onCountyView,
  onRace,
  onFlag,
  flagged,
  onBack,
}: {
  state: string
  results: StateResults | undefined
  info: SenateRaceInfo | undefined
  race: RaceResult | null
  office: MapOffice
  countyView: CountyView
  onCountyView: (view: CountyView) => void
  onRace: (key: string) => void
  onFlag: (county: string | null) => void
  flagged: string | null
  onBack: () => void
}) {
  const name = results?.name ?? info?.stateName ?? getVoterResources(state).name

  if (!results) {
    const url = info?.resultsUrl ?? getVoterResources(state).pollingPlaceUrl ?? 'https://vote.gov'
    return (
      <Panel>
        <BackButton onPress={onBack} />
        <Title>{name}</Title>
        <Source>
          We don’t read {name}’s official counts yet, so they’re on the state’s own site.{' '}
          <ExternalText url={url} label={`See ${name}’s results`} className="text-blue-300" />
        </Source>
        {info ? (
          <>
            <Heading>{info.label} candidates</Heading>
            <View className="gap-2">
              {info.candidates.map((c) => (
                <View key={c.name} className="flex-row items-center gap-2.5 rounded-[14px] bg-[#1a2540] p-2.5">
                  <Face name={c.name} profile={c.profile} party={c.party} size={48} />
                  <View className="min-w-0 flex-1 gap-0.5">
                    <Text numberOfLines={1} className="text-sm font-bold text-slate-100">
                      {c.name}
                    </Text>
                    <View className="flex-row flex-wrap items-center gap-1.5">
                      <Text style={{ color: PARTY_COLOR[partyKey(c.party)] }} className="text-[11px]">
                        {PARTY_LABEL[partyKey(c.party)]}
                      </Text>
                      {c.incumbent ? <Tag tone="incumbent">INCUMBENT</Tag> : null}
                      {c.profile?.receipts ? <Text className="text-[11px] text-slate-400">Raised {formatMoney(c.profile.receipts)}</Text> : null}
                    </View>
                    {c.profile ? <ProfileLink profile={c.profile} name={c.name} /> : null}
                  </View>
                </View>
              ))}
            </View>
          </>
        ) : (
          <Source>No Senate race in {name} this year.</Source>
        )}
      </Panel>
    )
  }

  const senate = senateRace(results)
  const house = houseRaces(results)
  const turnout = stateTurnout(results)

  return (
    <Panel>
      <BackButton onPress={onBack} />
      <View className="gap-1">
        <Title>{name}</Title>
        {isAggregated(results) ? (
          <View accessibilityRole="summary" className="mt-1.5 rounded-xl border border-dashed border-amber-300/55 bg-amber-900/20 px-3 py-2.5">
            <Text className="text-[12.5px] leading-5 text-slate-200">
              <Text className="font-bold text-amber-300">Counts via civicAPI, not from {name} directly.</Text> We can’t read{' '}
              {name}’s own results feed, so these come from{' '}
              <ExternalText url={AGGREGATOR.url} label="civicAPI" className="text-blue-300" />, an independent aggregator that
              doesn’t publish its sources. They can trail the state’s count by hours.
              {results.source.lastUpdated ? ` civicAPI last updated this ${formatSourceTime(results.source.lastUpdated)}.` : ''}
              {results.source.stateUrl ? (
                <>
                  {' '}
                  <ExternalText url={results.source.stateUrl} label={`Check ${name}’s official results`} className="text-blue-300" />.
                </>
              ) : null}
            </Text>
          </View>
        ) : (
          <Source>
            Unofficial results from the <ExternalText url={results.source.url} label={results.source.name} className="text-blue-300" />
            {results.source.lastUpdated ? `, updated ${formatSourceTime(results.source.lastUpdated)}` : ''}.
          </Source>
        )}
      </View>

      {results.ballots ? (
        <View className="flex-row gap-2">
          <Stat label="Ballots" value={formatCompact(results.ballots)} />
          <Stat label="Registered" value={results.registered ? formatCompact(results.registered) : '-'} />
          <Stat label="Turnout" value={turnout ? formatPercent(turnout) : '-'} />
        </View>
      ) : null}

      {senate || (office === 'S' && house.length) ? (
        <View accessibilityLabel="Race" className="flex-row flex-wrap items-center gap-1.5">
          {senate ? (
            <Pressable
              onPress={() => onRace(raceKey(state, senate))}
              accessibilityRole="button"
              accessibilityState={{ selected: race === senate }}
              className={`min-h-[34px] justify-center rounded-full border px-3 ${race === senate ? 'border-slate-200 bg-slate-200' : 'border-[#26324d] bg-[#1a2540]'}`}
            >
              <Text className={`text-xs font-semibold ${race === senate ? 'text-slate-900' : 'text-slate-200'}`}>Senate</Text>
            </Pressable>
          ) : null}
          {office === 'S' && house.length ? <Source>+ {house.length} House seats below</Source> : null}
        </View>
      ) : null}
      {house.length ? (
        <View className="gap-1.5">
          <Heading>House seats</Heading>
          <SeatGrid state={results} selected={race ? raceKey(state, race) : null} onSelect={onRace} />
        </View>
      ) : null}

      {race ? <RaceCard key={raceKey(state, race)} state={results} race={race} /> : null}

      {race && Object.keys(race.counties).length ? (
        <>
          <Segmented
            label="County map"
            value={countyView}
            options={[
              { value: 'lead', label: 'Who’s ahead' },
              { value: 'turnout', label: 'Turnout' },
            ]}
            onChange={onCountyView}
          />
          <CountyLists state={results} race={race} view={countyView} flagged={flagged} onFlag={onFlag} />
        </>
      ) : null}
    </Panel>
  )
}

function Title({ children }: { children: ReactNode }) {
  return (
    <Text accessibilityRole="header" className="text-xl font-extrabold tracking-tight text-slate-100">
      {children}
    </Text>
  )
}

function BackButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="All states"
      hitSlop={6}
      className="min-h-[34px] justify-center self-start rounded-full border border-[#26324d] bg-slate-900/85 px-3"
    >
      <Text className="text-[13px] font-semibold text-slate-200">← All states</Text>
    </Pressable>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-1 rounded-xl bg-[#1a2540] px-2.5 py-2">
      <Text className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</Text>
      <Text style={TABULAR} className="mt-0.5 text-base font-extrabold text-slate-100">
        {value}
      </Text>
    </View>
  )
}

function Tag({ tone, children }: { tone: 'incumbent' | 'leads'; children: ReactNode }) {
  const look = tone === 'incumbent' ? 'border-amber-500/35 bg-amber-500/15' : 'border-emerald-400/35 bg-emerald-400/15'
  const text = tone === 'incumbent' ? 'text-amber-300' : 'text-emerald-300'
  return (
    <View className={`rounded-[5px] border px-1.5 ${look}`}>
      <Text className={`text-[10px] font-extrabold tracking-wide ${text}`}>{children}</Text>
    </View>
  )
}

function ProfileLink({ profile, name }: { profile: CandidateProfile; name: string }) {
  if (!profile.officialId) return null
  return (
    <Pressable
      onPress={() => showProfile(profile)}
      accessibilityRole="link"
      accessibilityLabel={`${name}’s full profile`}
      hitSlop={{ top: 10, bottom: 10, left: 4, right: 12 }}
      className="mt-1 self-start"
    >
      <Text className="text-[11px] font-bold text-blue-300">Full profile →</Text>
    </Pressable>
  )
}

function formatCompact(n: number) {
  return n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n)
}

// ---- The race ----

// Bars grow in once when a race opens (skipped under reduced motion).
function useGrow() {
  const reduceMotion = useReducedMotion()
  const grow = useSharedValue(reduceMotion ? 1 : 0)
  useEffect(() => {
    grow.set(reduceMotion ? 1 : withTiming(1, { duration: 1100, easing: Easing.bezier(0.2, 0.8, 0.2, 1) }))
  }, [grow, reduceMotion])
  return grow
}

function RaceCard({ state, race }: { state: StateResults; race: RaceResult }) {
  const standing = raceStanding(race)
  const status = raceStatus(race)
  const winner = raceWinner(race)
  const grow = useGrow()
  const { leader, runnerUp, totalVotes } = standing
  const top = Math.max(...standing.ranked.map((c) => c.votes), 1)

  return (
    <View className="gap-3">
      <View className="gap-1">
        <Heading>
          {race.office === 'S' ? 'U.S. Senate' : `${state.state}-${race.district} · U.S. House`}
          {race.special ? ' · Special' : ''}
        </Heading>
        <Source>
          {reportingLabel(race)} · {formatVotes(totalVotes)} votes counted
        </Source>
        {winner && status !== 'counting' ? (
          <View
            className={`mt-1 flex-row items-start gap-2 rounded-[10px] border px-2.5 py-2 ${
              status === 'certified' ? 'border-slate-200/40 bg-slate-200/5' : 'border-dashed border-[#26324d]'
            }`}
          >
            <View className="pt-px">
              <StatusBadge status={status} />
            </View>
            <Text className="flex-1 text-xs leading-[18px] text-slate-400">
              {status === 'certified' ? (
                <>
                  {state.name} certified <Text className="font-bold text-slate-200">{winner.name}</Text> the winner. This count
                  is final.
                </>
              ) : (
                <>
                  {race.call?.source} called this for <Text className="font-bold text-slate-200">{winner.name}</Text>
                  {race.call?.at ? ` on ${formatSourceTime(race.call.at)}` : ''}. Votes are still being counted, and only{' '}
                  {state.name}’s certification makes it final.
                </>
              )}
            </Text>
          </View>
        ) : null}
      </View>

      {leader && runnerUp ? <TugOfWar leader={leader} runnerUp={runnerUp} totalVotes={totalVotes} marginVotes={standing.marginVotes} margin={standing.margin} grow={grow} /> : null}

      <View className="gap-2">
        {standing.ranked.map((c) => (
          <CandidateCard
            key={c.name}
            candidate={c}
            isLeader={c === leader}
            won={c === winner && status !== 'counting' ? status : null}
            totalVotes={totalVotes}
            top={top}
            grow={grow}
          />
        ))}
      </View>
    </View>
  )
}

// The top two side by side, split by their share of the two-way vote, with
// a line at the halfway mark.
function TugOfWar({
  leader,
  runnerUp,
  totalVotes,
  marginVotes,
  margin,
  grow,
}: {
  leader: ResultCandidate
  runnerUp: ResultCandidate
  totalVotes: number
  marginVotes: number
  margin: number
  grow: SharedValue<number>
}) {
  const twoWay = leader.votes + runnerUp.votes || 1
  const leaderPart = leader.votes / twoWay
  const left = useAnimatedStyle(() => ({ flexGrow: 0.5 + (leaderPart - 0.5) * grow.get() }))
  const right = useAnimatedStyle(() => ({ flexGrow: 0.5 + (0.5 - leaderPart) * grow.get() }))
  const leaderColor = PARTY_COLOR[partyKey(leader.party)]
  return (
    <View>
      <View
        accessibilityLabel={`${leader.name} ${formatPercent(share(leader.votes, totalVotes))}, ${runnerUp.name} ${formatPercent(share(runnerUp.votes, totalVotes))}`}
        className="h-[34px] flex-row overflow-hidden rounded-[10px] bg-slate-900"
      >
        <Animated.View style={[{ flexBasis: 0, backgroundColor: leaderColor }, left]} className="justify-center px-2.5">
          <Text numberOfLines={1} className="text-xs font-extrabold text-white">
            {formatPercent(share(leader.votes, totalVotes))}
          </Text>
        </Animated.View>
        <Animated.View
          style={[{ flexBasis: 0, backgroundColor: PARTY_COLOR[partyKey(runnerUp.party)] }, right]}
          className="items-end justify-center px-2.5"
        >
          <Text numberOfLines={1} className="text-xs font-extrabold text-white">
            {formatPercent(share(runnerUp.votes, totalVotes))}
          </Text>
        </Animated.View>
        <View pointerEvents="none" className="absolute bottom-0 left-1/2 top-0 w-0.5 bg-white/70" />
      </View>
      <View className="mt-1.5 flex-row items-baseline justify-between gap-2">
        <Text className="shrink text-xs text-slate-400">
          <Text className="font-bold text-slate-200">{leader.name}</Text> leads by{' '}
          <Text className="font-bold text-slate-200">{formatVotes(marginVotes)}</Text> votes
        </Text>
        <Text style={{ color: leaderColor }} className="text-xs font-bold">
          {formatMargin(margin)}
        </Text>
      </View>
    </View>
  )
}

function CandidateCard({
  candidate: c,
  isLeader,
  won,
  totalVotes,
  top,
  grow,
}: {
  candidate: ResultCandidate
  isLeader: boolean
  won: 'called' | 'certified' | null
  totalVotes: number
  top: number
  grow: SharedValue<number>
}) {
  const color = PARTY_COLOR[partyKey(c.party)]
  const perVote = dollarsPerVote(c)
  const part = c.votes / top
  const bar = useAnimatedStyle(() => ({ width: `${part * grow.get() * 100}%` }))
  return (
    <View
      style={isLeader ? { borderColor: color, backgroundColor: `${color}22` } : undefined}
      className="flex-row items-center gap-2.5 rounded-[14px] border border-transparent bg-[#1a2540] p-2.5"
    >
      <Face name={c.name} profile={c.profile} party={c.party} size={48} />
      <View className="min-w-0 flex-1">
        <View className="flex-row items-baseline justify-between gap-2">
          <Text numberOfLines={1} className="shrink text-sm font-bold text-slate-100">
            {c.name}
          </Text>
          <Text style={TABULAR} className="text-lg font-extrabold text-slate-100">
            {formatPercent(share(c.votes, totalVotes))}
          </Text>
        </View>
        <View className="mt-0.5 flex-row flex-wrap items-center gap-1.5">
          <Text style={{ color }} className="text-[11px]">
            {PARTY_LABEL[partyKey(c.party)]}
          </Text>
          <Text className="text-[11px] text-slate-400">{formatVotes(c.votes)} votes</Text>
          {c.incumbent ? <Tag tone="incumbent">INCUMBENT</Tag> : null}
          {won ? <StatusBadge status={won} /> : isLeader ? <Tag tone="leads">LEADS</Tag> : null}
        </View>
        <View className="mt-1.5 h-[7px] overflow-hidden rounded bg-slate-900">
          <Animated.View style={[{ height: '100%', backgroundColor: color, borderRadius: 4 }, bar]} />
        </View>
        {c.profile?.receipts ? (
          <View className="mt-1.5 flex-row flex-wrap gap-x-3">
            <Text style={TABULAR} className="text-[11px] text-slate-400">
              Raised <Text className="font-bold text-slate-200">{formatMoney(c.profile.receipts)}</Text>
            </Text>
            {perVote ? (
              <Text style={TABULAR} className="text-[11px] text-slate-400">
                <Text className="font-bold text-slate-200">${perVote.toFixed(2)}</Text> per vote
              </Text>
            ) : null}
            {c.profile.outsideSupport ? (
              <Text style={TABULAR} className="text-[11px] text-slate-400">
                Outside help <Text className="font-bold text-slate-200">{formatMoney(c.profile.outsideSupport)}</Text>
              </Text>
            ) : null}
          </View>
        ) : null}
        {c.profile ? <ProfileLink profile={c.profile} name={c.name} /> : null}
      </View>
    </View>
  )
}

// ---- Counties ----

// Tapping a county flags it on the map in yellow; tapping it again clears it.
function CountyLists({
  state,
  race,
  view,
  flagged,
  onFlag,
}: {
  state: StateResults
  race: RaceResult
  view: CountyView
  flagged: string | null
  onFlag: (county: string | null) => void
}) {
  const standing = raceStanding(race)
  const rows = Object.keys(race.counties)
    .map((county) => ({ county, standing: countyStanding(race, county)!, turnout: countyTurnout(state, county) }))
    .filter((row) => row.standing.totalVotes > 0)
  const toggle = (county: string) => onFlag(flagged === county ? null : county)

  const list = (title: ReactNode, items: { county: string; dot: string; side: string; sideColor?: string }[]) => (
    <View className="gap-1">
      <Heading>{title}</Heading>
      <View className="gap-0.5">
        {items.map((r) => (
          <CountyRow key={r.county} {...r} label={countyLabel(state, r.county)} flagged={flagged === r.county} onPress={() => toggle(r.county)} />
        ))}
      </View>
    </View>
  )

  if (view === 'turnout') {
    const byTurnout = rows.filter((r) => r.turnout !== null && r.turnout <= 100).sort((a, b) => b.turnout! - a.turnout!)
    if (!byTurnout.length) return <Source>{state.name} doesn’t publish county turnout in its results feed.</Source>
    const items = (picked: typeof byTurnout) =>
      picked.map((r) => ({ county: r.county, dot: turnoutColor(r.turnout), side: formatPercent(r.turnout!) }))
    return (
      <>
        {countingComplete(state) ? null : (
          <Source>{state.name} is still counting, so turnout will rise in counties that haven’t finished reporting.</Source>
        )}
        {list('Highest turnout', items(byTurnout.slice(0, 5)))}
        {list('Lowest turnout', items(byTurnout.slice(-5).reverse()))}
      </>
    )
  }

  return (
    <>
      {standing.ranked.slice(0, 2).map((c) => {
        const ahead = rows.filter((r) => r.standing.leader === c)
        const strongest = [...ahead].sort((a, b) => b.standing.margin - a.standing.margin).slice(0, 5)
        const color = PARTY_COLOR[partyKey(c.party)]
        return (
          <View key={c.name}>
            {list(
              <>
                {c.name.split(' ').at(-1)}’s strongest counties{' '}
                <Text className="font-medium normal-case tracking-normal">(ahead in {ahead.length})</Text>
              </>,
              strongest.map((r) => ({
                county: r.county,
                dot: partyTint(c.party, r.standing.margin),
                side: formatMargin(r.standing.margin),
                sideColor: color,
              })),
            )}
          </View>
        )
      })}
    </>
  )
}

function CountyRow({
  label,
  dot,
  side,
  sideColor,
  flagged,
  onPress,
}: {
  county: string
  label: string
  dot: string
  side: string
  sideColor?: string
  flagged: boolean
  onPress: () => void
}) {
  return (
    <View className={flagged ? 'rounded-[10px] bg-amber-200/10' : undefined}>
      <Row onPress={onPress} label={`${label}, ${side}${flagged ? ', shown on the map' : ''}`}>
        <View className="min-w-0 flex-1 flex-row items-center gap-2">
          <Dot color={dot} />
          <Text numberOfLines={1} className={`shrink text-[13px] ${flagged ? 'font-bold text-amber-200' : 'text-slate-200'}`}>
            {label}
          </Text>
        </View>
        <Text style={[TABULAR, sideColor ? { color: sideColor } : null]} className="text-[13px] font-bold text-slate-200">
          {side}
        </Text>
      </Row>
    </View>
  )
}
