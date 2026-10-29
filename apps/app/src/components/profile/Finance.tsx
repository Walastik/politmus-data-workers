import {
  EXPLAINERS,
  FUNDING_MIX_COLORS,
  HOME_STATE_COLOR,
  OUT_OF_STATE_COLOR,
  PAC_CATEGORY_COLORS,
  SIZE_LABELS,
  electionChipLabel,
  electionKey,
  financeSelection,
  formatCompactMoney,
  formatMoney,
  formatShare,
  noComparisonNote,
  noTotalsMessage,
  pacTotalGap,
  partyBarClass,
  peerLines,
  raceCandidateDetail,
} from '@politmus/core/campaignFinance'
import { partyShort, raceTitle, type FinanceElection, type OutsideSpender, type PeerComparison, type Race } from '@politmus/core/types'
import { router } from 'expo-router'
import { useState } from 'react'
import { Pressable, Text, View } from 'react-native'

import { openUrl } from '@/lib/links'
import { useFinance, usePacSummary } from '@/lib/queries'

import { Icons } from '../icons'
import { Collapsible, Explainer, LegendSwatch, StackedBar, SubHeading } from './parts'

// Campaign Finance on the member profile; native counterpart of the web
// CampaignFinanceSection. The full PAC explorer is still web-only.
export default function FinanceSection({ officialId }: { officialId: string }) {
  return (
    <Collapsible
      title="Campaign Finance (preview)"
      icon={<Icons.DollarSign size={16} colorClassName="accent-emerald-400" />}
      tone="text-emerald-300"
      chevronAccent="accent-emerald-400"
      boxClassName="rounded-xl border border-emerald-500/30 bg-emerald-950/10 p-4"
    >
      <FinanceBody officialId={officialId} />
    </Collapsible>
  )
}

// Mounted only once the section is open, so the fetch waits for it.
function FinanceBody({ officialId }: { officialId: string }) {
  const finance = useFinance(officialId, true)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const { elections, selected, compared, race, raced } = financeSelection(finance.data ?? null, selectedKey)

  if (finance.isError) return <Text className="mt-2 text-xs text-rose-300">{finance.error.message}</Text>
  if (!finance.data) return <Text className="mt-2 text-xs text-slate-400">Loading…</Text>
  if (!selected) return <Text className="mt-2 text-xs text-slate-400">{noTotalsMessage(finance.data, officialId, race)}</Text>

  return (
    <View>
      <View className="mt-3 flex-row flex-wrap gap-1.5">
        {elections.map((election) => {
          const active = electionKey(election) === electionKey(selected)
          return (
            <Pressable
              key={electionKey(election)}
              onPress={() => setSelectedKey(electionKey(election))}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              className={`rounded-full border px-2.5 py-0.5 ${active ? 'border-emerald-400 bg-emerald-500/20' : 'border-slate-700'}`}
            >
              <Text className={`text-xs ${active ? 'text-emerald-100' : 'text-slate-300'}`}>{electionChipLabel(election, elections)}</Text>
            </Pressable>
          )
        })}
      </View>
      <ElectionView officialId={officialId} election={selected} comparison={compared} race={raced} />
      <View className="mt-4 border-t border-slate-800 pt-3">
        <Text className="text-[11px] text-slate-500">
          Source: {finance.data.source}
          {finance.data.opensecrets_url ? (
            <>
              {' · '}
              <Text onPress={() => openUrl(finance.data.opensecrets_url!)} className="text-emerald-400">
                OpenSecrets
              </Text>
            </>
          ) : null}
        </Text>
      </View>
    </View>
  )
}

function ElectionView({
  officialId,
  election,
  comparison,
  race,
}: {
  officialId: string
  election: FinanceElection
  comparison: PeerComparison | null
  race: Race | null
}) {
  const peers = (key: string) =>
    comparison ? peerLines(comparison.metrics.find((metric) => metric.key === key), comparison) : []
  const inProgress = election.election_year >= new Date().getFullYear()
  return (
    <View className="mt-3 gap-5">
      <View>
        <Text className="text-[11px] text-slate-500">
          {inProgress ? 'Race in progress · ' : ''}
          {election.coverage_start_date ?? '?'} → {election.coverage_end_date ?? '?'} ·{' '}
          <Text onPress={() => openUrl(election.fec_url)} className="font-mono text-emerald-400">
            {election.fec_candidate_id}
          </Text>
        </Text>
        <View className="mt-2 flex-row gap-2">
          <StatTile label="Raised" value={formatCompactMoney(election.receipts)} peers={peers('receipts')} />
          <StatTile label="From small donors" value={formatShare(election.small_donor_share)} peers={peers('small_donor_share')} />
          <StatTile label={`From ${election.home_state ?? 'home state'}`} value={formatShare(election.in_state_share)} peers={peers('in_state_share')} />
        </View>
        {comparison ? (
          <Explainer label="How are these compared?">{EXPLAINERS.peers}</Explainer>
        ) : race ? null : (
          <Text className="mt-2 text-[11px] text-slate-500">{noComparisonNote(election)}</Text>
        )}
      </View>
      {race ? <RaceComparison race={race} officialId={officialId} /> : null}
      <FundingMix election={election} />
      <PacSummaryView officialId={officialId} election={election} />
      <HomeState election={election} />
      <OutsideSpendingView election={election} />
      <SpendingAndSizes election={election} />
    </View>
  )
}

function StatTile({ label, value, peers }: { label: string; value: string; peers: string[] }) {
  return (
    <View className="flex-1 rounded-lg border border-slate-800 bg-slate-950/40 p-2">
      <Text className="text-[11px] text-slate-400">{label}</Text>
      <Text className="text-lg font-semibold text-slate-100">{value}</Text>
      {peers.map((line) => (
        <Text key={line} className="text-[10px] leading-tight text-slate-400">
          {line}
        </Text>
      ))}
    </View>
  )
}

function RaceComparison({ race, officialId }: { race: Race; officialId: string }) {
  const top = Math.max(...race.candidates.map((candidate) => candidate.receipts ?? 0), 1)
  return (
    <View>
      <SubHeading>The race · {raceTitle(race)}</SubHeading>
      <View className="mt-2 gap-1.5">
        {race.candidates.map((candidate) => {
          const self = candidate.official_id === officialId
          return (
            <View key={candidate.fec_candidate_id} className={`rounded p-2 ${self ? 'border border-emerald-500/40 bg-emerald-500/5' : 'bg-slate-950/30'}`}>
              <View className="flex-row items-baseline justify-between gap-2">
                <Text className="min-w-0 flex-1 text-xs font-medium text-slate-100" numberOfLines={1}>
                  {candidate.name}
                  {candidate.party ? <Text className="text-slate-400"> ({partyShort(candidate.party)})</Text> : null}
                </Text>
                <Text className="text-xs text-slate-200">{formatCompactMoney(candidate.receipts)}</Text>
              </View>
              <View className="mt-1 h-1.5 overflow-hidden rounded bg-slate-900">
                <View className={`h-full ${partyBarClass(candidate.party)}`} style={{ width: `${((candidate.receipts ?? 0) / top) * 100}%` }} />
              </View>
              <Text className="mt-1 text-[10px] text-slate-400">{raceCandidateDetail(candidate)}</Text>
            </View>
          )
        })}
      </View>
      <Explainer label="What's in this comparison?">{EXPLAINERS.race}</Explainer>
    </View>
  )
}

function LegendRow({ color, label, share, amount }: { color: string; label: string; share: string; amount: string }) {
  return (
    <View className="flex-row items-center gap-2">
      <LegendSwatch color={color} />
      <Text className="min-w-0 flex-1 text-xs text-slate-300">{label}</Text>
      <Text className="text-xs text-slate-400">{share}</Text>
      <Text className="w-20 text-right text-xs text-slate-200">{amount}</Text>
    </View>
  )
}

function FundingMix({ election }: { election: FinanceElection }) {
  const slices = (election.funding_mix ?? []).filter((slice) => slice.amount > 0)
  if (slices.length === 0) return null
  const color = (key: string) => FUNDING_MIX_COLORS[key] ?? FUNDING_MIX_COLORS.other
  return (
    <View>
      <SubHeading>Where the money came from</SubHeading>
      <StackedBar
        label={slices.map((slice) => `${slice.label} ${formatShare(slice.share)}`).join(', ')}
        segments={slices.map((slice) => ({ key: slice.key, share: slice.share ?? 0, color: color(slice.key) }))}
      />
      <View className="mt-2 gap-0.5">
        {slices.map((slice) => (
          <LegendRow key={slice.key} color={color(slice.key)} label={slice.label} share={formatShare(slice.share)} amount={formatMoney(slice.amount)} />
        ))}
      </View>
      <Explainer>{EXPLAINERS.fundingMix}</Explainer>
    </View>
  )
}

function PacSummaryView({ officialId, election }: { officialId: string; election: FinanceElection }) {
  const query = usePacSummary(officialId, election)
  const summary = query.data
  const heading = <SubHeading>PAC contributions</SubHeading>
  if (query.isError) {
    return (
      <View>
        {heading}
        <Text className="mt-1 text-xs text-rose-300">{query.error.message}</Text>
      </View>
    )
  }
  if (!summary || !summary.synced || summary.gift_count === 0) {
    return (
      <View>
        {heading}
        <Text className="mt-1 text-xs text-slate-400">
          {!summary
            ? 'Loading…'
            : !summary.synced
              ? "PAC details haven't been loaded for this member yet (fec_client.py pacs)."
              : 'No PAC gifts were reported for this election.'}
        </Text>
      </View>
    )
  }
  const gap = pacTotalGap(summary.total, summary.reported_total)
  const color = (key: string) => PAC_CATEGORY_COLORS[key] ?? PAC_CATEGORY_COLORS.other
  return (
    <View>
      {heading}
      <Text className="mt-1 text-sm text-slate-200">
        <Text className="font-semibold">{formatCompactMoney(summary.total)}</Text> from {summary.pac_count} PACs and committees ({summary.gift_count} gifts)
      </Text>
      {gap ? (
        <Text className="mt-0.5 text-[11px] text-amber-300">
          FEC reports {formatMoney(summary.reported_total)} in PAC money through {summary.reported_through ?? 'its latest report'}, {formatShare(gap)}{' '}
          different from the itemized gifts here, which run through {summary.itemized_through ?? 'an earlier date'}. FEC takes a few weeks to
          process the gifts in a new report; this catches up on its own.
        </Text>
      ) : null}
      <StackedBar
        label={summary.categories.map((c) => `${c.label} ${formatShare(c.share)}`).join(', ')}
        segments={summary.categories.map((category) => ({ key: category.key, share: category.share ?? 0, color: color(category.key) }))}
      />
      <View className="mt-2 gap-0.5">
        {summary.categories.map((category) => (
          <LegendRow
            key={category.key}
            color={color(category.key)}
            label={`${category.label} · ${category.pac_count}`}
            share={formatShare(category.share)}
            amount={formatCompactMoney(category.total)}
          />
        ))}
      </View>
      <Text className="mt-3 text-[11px] font-semibold text-slate-400">Top {summary.top_pacs.length}</Text>
      <View className="mt-1 gap-1">
        {summary.top_pacs.map((pac, index) => (
          <View key={pac.pac_key} className="flex-row items-start gap-2">
            <Text className="w-4 text-right text-xs text-slate-500">{index + 1}</Text>
            <View className="mt-1">
              <LegendSwatch color={color(pac.category)} />
            </View>
            <View className="min-w-0 flex-1">
              <Text className="text-xs text-slate-200" numberOfLines={1}>
                {pac.name}
              </Text>
              <Text className="text-[10px] text-slate-500">
                {pac.category_label} · {pac.gift_count} {pac.gift_count === 1 ? 'gift' : 'gifts'}
              </Text>
            </View>
            <Text className="text-xs text-slate-200">{formatMoney(pac.total)}</Text>
          </View>
        ))}
      </View>
      <Pressable
        onPress={() =>
          router.push({
            pathname: '/member/[id]/pacs',
            params: { id: officialId, candidate: election.fec_candidate_id, year: String(election.election_year) },
          })
        }
        accessibilityRole="button"
        className="mt-3 flex-row items-center gap-1.5 self-start rounded-md border border-emerald-500/40 px-2.5 py-1"
      >
        <Icons.ListFilter size={14} colorClassName="accent-emerald-300" />
        <Text className="text-xs font-medium text-emerald-300">View all {summary.pac_count} PACs</Text>
      </Pressable>
      <Explainer>{EXPLAINERS.pacs}</Explainer>
    </View>
  )
}

function HomeState({ election }: { election: FinanceElection }) {
  const share = election.in_state_share
  if (share == null) return null
  const home = election.home_state ?? 'their home state'
  const outOfState = (election.top_states ?? []).filter((state) => state.state !== election.home_state)
  return (
    <View>
      <SubHeading>Home state vs. out of state</SubHeading>
      <Text className="mt-1 text-sm text-slate-200">
        <Text className="font-semibold">{formatShare(share)}</Text> of itemized individual money came from {home};{' '}
        <Text className="font-semibold">{formatShare(1 - share)}</Text> came from out of state.
      </Text>
      <StackedBar
        label={`${home} ${formatShare(share)}, out of state ${formatShare(1 - share)}`}
        segments={[
          { key: 'home', share, color: HOME_STATE_COLOR },
          { key: 'out', share: 1 - share, color: OUT_OF_STATE_COLOR },
        ]}
      />
      <View className="mt-1.5 flex-row gap-4">
        <View className="flex-row items-center gap-1.5">
          <LegendSwatch color={HOME_STATE_COLOR} />
          <Text className="text-[11px] text-slate-400">{home}</Text>
        </View>
        <View className="flex-row items-center gap-1.5">
          <LegendSwatch color={OUT_OF_STATE_COLOR} />
          <Text className="text-[11px] text-slate-400">Out of state</Text>
        </View>
      </View>
      {outOfState.length > 0 ? (
        <Text className="mt-2 text-xs text-slate-300">
          Biggest out-of-state sources: {outOfState.map((state) => `${state.state} ${formatCompactMoney(state.total)}`).join(' · ')}
        </Text>
      ) : null}
      <Explainer>{EXPLAINERS.homeState}</Explainer>
    </View>
  )
}

function OutsideSpendingView({ election }: { election: FinanceElection }) {
  const outside = election.outside_spending
  if (!outside) return null
  const none = outside.support_total === 0 && outside.oppose_total === 0
  return (
    <View>
      <SubHeading>Outside spending</SubHeading>
      {none ? (
        <Text className="mt-1 text-xs text-slate-400">No outside spending was reported for or against this candidate in this election.</Text>
      ) : (
        <>
          <Text className="mt-1 text-xs text-slate-400">
            Spent by independent groups, separate from the {formatCompactMoney(election.receipts)} the campaign raised.
          </Text>
          <View className="mt-2 flex-row gap-2">
            <SpendingSide title="Supporting" total={outside.support_total} count={outside.support_count} spenders={outside.top_support} />
            <SpendingSide title="Opposing" total={outside.oppose_total} count={outside.oppose_count} spenders={outside.top_oppose} />
          </View>
        </>
      )}
      <Explainer>{EXPLAINERS.outsideSpending}</Explainer>
    </View>
  )
}

function SpendingSide({ title, total, count, spenders }: { title: string; total: number; count: number; spenders: OutsideSpender[] }) {
  return (
    <View className="flex-1 rounded-lg border border-slate-800 bg-slate-950/40 p-2">
      <Text className="text-[11px] text-slate-400">{title}</Text>
      <Text className="text-lg font-semibold text-slate-100">{formatCompactMoney(total)}</Text>
      <Text className="text-[10px] text-slate-500">
        {count} {count === 1 ? 'group' : 'groups'}
      </Text>
      {spenders.length > 0 ? (
        <View className="mt-1.5 gap-0.5">
          {spenders.map((spender) => (
            <View key={spender.committee_id ?? spender.name} className="flex-row justify-between gap-2">
              <Text className="min-w-0 flex-1 text-[11px] text-slate-300" numberOfLines={1}>
                {spender.name}
              </Text>
              <Text className="text-[11px] text-slate-400">{formatCompactMoney(spender.total)}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  )
}

function SpendingAndSizes({ election }: { election: FinanceElection }) {
  const sizes = election.size_breakdown ?? []
  const sizeTotal = sizes.reduce((sum, bucket) => sum + bucket.total, 0)
  const rows: [string, number | null | undefined][] = [
    ['Spent', election.disbursements],
    ['Cash on hand', election.cash_on_hand],
    ['Debts', election.debts],
  ]
  return (
    <View>
      <SubHeading>Spending and cash</SubHeading>
      <View className="mt-1 gap-0.5">
        {rows.map(([label, value]) => (
          <View key={label} className="flex-row justify-between">
            <Text className="text-xs text-slate-400">{label}</Text>
            <Text className="text-xs text-slate-200">{formatMoney(value)}</Text>
          </View>
        ))}
      </View>
      {sizes.length > 0 ? (
        <View className="mt-4">
          <SubHeading>Individual gifts by size</SubHeading>
          <View className="mt-1 gap-1">
            {sizes.map((bucket) => (
              <View key={bucket.size}>
                <View className="flex-row justify-between">
                  <Text className="text-xs text-slate-300">{SIZE_LABELS[bucket.size] ?? `$${bucket.size}+`}</Text>
                  <Text className="text-xs text-slate-300">{formatMoney(bucket.total)}</Text>
                </View>
                <View className="mt-0.5 h-1.5 rounded bg-slate-800">
                  <View
                    className="h-1.5 rounded"
                    style={{ width: `${sizeTotal ? (bucket.total / sizeTotal) * 100 : 0}%`, backgroundColor: FUNDING_MIX_COLORS.small_donors }}
                  />
                </View>
              </View>
            ))}
          </View>
        </View>
      ) : null}
    </View>
  )
}
