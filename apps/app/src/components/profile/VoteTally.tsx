import {
  PARTY_PIES,
  chamberCounts,
  voteTotal,
  votePieDescription,
  votePieSlices,
} from '@politmus/core/billProfile'
import {
  partyBadgeClass,
  partyShort,
  type Bill,
  type BillRollCall,
  type BillVotePartySummary,
  type ChamberVoteSummary,
  type VoteChamber,
} from '@politmus/core/types'
import { voteKindNote } from '@politmus/core/voteContext'
import { Pressable, Text, View } from 'react-native'
import Svg, { Circle, Path } from 'react-native-svg'

// Native counterpart of the web VoteTallyBar: each chamber's yes/no bar and a
// pie per party (tap one for how its members voted).
export default function VoteTally({
  summary,
  byParty,
  rollCalls,
  onPartyPress,
  compact = false,
}: {
  summary: Bill['votes_summary']
  byParty?: BillVotePartySummary
  rollCalls?: Partial<Record<VoteChamber, BillRollCall | null>>
  onPartyPress?: (chamber: VoteChamber, party: string) => void
  // Lists show the chamber bars only; the profile adds the party pies.
  compact?: boolean
}) {
  if (voteTotal(summary) === 0) {
    return <Text className="font-sans text-xs text-slate-500">No recorded votes</Text>
  }
  return (
    <View className={compact ? 'gap-2' : 'gap-4'}>
      <ChamberTally
        label="House"
        chamber="house"
        summary={summary?.house}
        byParty={byParty?.house}
        rollCall={rollCalls?.house}
        onPartyPress={onPartyPress}
        compact={compact}
      />
      <ChamberTally
        label="Senate"
        chamber="senate"
        summary={summary?.senate}
        byParty={byParty?.senate}
        rollCall={rollCalls?.senate}
        onPartyPress={onPartyPress}
        compact={compact}
      />
      {compact ? null : (
        <Text className="font-sans text-[10px] text-slate-600">
          {rollCalls ? 'Latest vote on passage in each chamber, or the latest vote if none' : 'Latest roll call stored for each chamber'}
        </Text>
      )}
    </View>
  )
}

function ChamberTally({
  label,
  chamber,
  summary,
  byParty,
  rollCall,
  onPartyPress,
  compact,
}: {
  label: string
  chamber: VoteChamber
  summary: ChamberVoteSummary | undefined
  byParty: Record<string, ChamberVoteSummary> | undefined
  rollCall?: BillRollCall | null
  onPartyPress?: (chamber: VoteChamber, party: string) => void
  compact: boolean
}) {
  const { yes, no, present, notVoting, total, yesPct, noPct } = chamberCounts(summary)
  if (total === 0) {
    return (
      <View>
        <Text className="text-[10px] font-sans-semibold uppercase tracking-wider text-slate-500">{label}</Text>
        <Text className="font-sans mt-1 text-xs text-slate-500">No recorded votes</Text>
      </View>
    )
  }
  const note = rollCall ? voteKindNote(rollCall) : null
  return (
    <View>
      <Text className="text-[10px] font-sans-semibold uppercase tracking-wider text-slate-500">{label}</Text>
      {rollCall ? (
        note ? (
          <Text className="font-sans mt-1 rounded border border-sky-700/40 bg-sky-950/30 px-2 py-1 text-[11px] text-sky-200">
            <Text className="font-sans-semibold">{rollCall.vote_kind === 'amendment' ? 'Amendment vote.' : 'Procedural vote.'}</Text> {note}
          </Text>
        ) : (
          <Text className="font-sans mt-0.5 text-[11px] text-slate-500">Vote on passage</Text>
        )
      ) : null}
      <View className="mt-1.5 h-2 flex-row overflow-hidden rounded bg-slate-700">
        <View className="bg-emerald-500" style={{ width: `${yesPct}%` }} />
        <View className="bg-red-500" style={{ width: `${noPct}%` }} />
      </View>
      <View className="mt-1.5 flex-row flex-wrap gap-x-3 gap-y-1">
        <Text className="font-sans text-xs text-emerald-400">{yes} Yes</Text>
        <Text className="font-sans text-xs text-red-400">{no} No</Text>
        {present > 0 ? <Text className="font-sans text-xs text-slate-400">{present} Present</Text> : null}
        {notVoting > 0 ? <Text className="font-sans text-xs text-slate-400">{notVoting} NV</Text> : null}
      </View>
      {compact ? null : (
        <View className="mt-3 flex-row">
          {PARTY_PIES.map((party) => (
            <PartyPie key={party} chamber={chamber} party={party} summary={byParty?.[party] || {}} onPress={onPartyPress} />
          ))}
        </View>
      )}
    </View>
  )
}

function PartyPie({
  chamber,
  party,
  summary,
  onPress,
}: {
  chamber: VoteChamber
  party: string
  summary: ChamberVoteSummary
  onPress?: (chamber: VoteChamber, party: string) => void
}) {
  const yes = summary.Yes ?? 0
  const no = summary.No ?? 0
  return (
    <Pressable
      disabled={!onPress}
      onPress={() => onPress?.(chamber, party)}
      accessibilityRole={onPress ? 'button' : 'image'}
      accessibilityLabel={onPress ? `Show ${party} ${chamber} votes, ${yes} yes, ${no} no` : votePieDescription(party, yes, no)}
      className="flex-1 items-center gap-1 rounded-md py-1 active:bg-slate-800"
    >
      <Svg width={56} height={56} viewBox="0 0 36 36">
        {votePieSlices(yes, no).map((slice, index) =>
          slice.circle ? <Circle key={index} cx={18} cy={18} r={16} fill={slice.fill} /> : <Path key={index} d={slice.d} fill={slice.fill} />,
        )}
      </Svg>
      <View className={`rounded px-1.5 ${partyBadgeClass(party)}`}>
        <Text className={`text-[10px] font-sans-semibold ${partyBadgeClass(party)}`}>{partyShort(party)}</Text>
      </View>
      <Text className="font-sans text-[10px] text-slate-400">
        <Text className="text-emerald-400">{yes}Y</Text> · <Text className="text-red-400">{no}N</Text>
      </Text>
    </Pressable>
  )
}
