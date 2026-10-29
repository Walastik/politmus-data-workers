import { partyBadgeClass, partyShort, voteShort, voteTextClass, type VoteChamber } from '@politmus/core/types'
import { Stack, useLocalSearchParams } from 'expo-router'
import { FlatList, Text, View } from 'react-native'

import { useBillVoters } from '@/lib/queries'

// How each member of one party voted in one chamber; native counterpart of
// the web VotePartyList overlay.
export default function VotersScreen() {
  const { id, chamber, party } = useLocalSearchParams<{ id: string; chamber: VoteChamber; party: string }>()
  const voters = useBillVoters(id, chamber, party)
  const chamberLabel = chamber === 'senate' ? 'Senate' : 'House'

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: `${chamberLabel} · ${partyShort(party)}`, presentation: 'modal' }} />
      <FlatList
        className="flex-1 bg-slate-900"
        contentInsetAdjustmentBehavior="automatic"
        contentContainerClassName="w-full md:max-w-[960px] md:self-center px-5 pb-8"
        data={voters.data ?? []}
        keyExtractor={(voter) => voter.official_id}
        ListHeaderComponent={
          <View className="py-5">
            <Text className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{chamberLabel} votes</Text>
            <View className="mt-2 flex-row items-center gap-2">
              <View className={`rounded px-1.5 py-0.5 ${partyBadgeClass(party)}`}>
                <Text className={`text-xs font-semibold ${partyBadgeClass(party)}`}>{partyShort(party)}</Text>
              </View>
              <Text className="text-lg font-semibold text-slate-100">{party}</Text>
            </View>
          </View>
        }
        ListEmptyComponent={
          <Text className={`text-sm ${voters.isError ? 'text-red-400' : 'text-slate-400'}`}>
            {voters.isError
              ? voters.error.message
              : voters.isPending
                ? 'Loading votes…'
                : `No recorded votes for this party in the ${chamberLabel.toLowerCase()}.`}
          </Text>
        }
        renderItem={({ item }) => (
          <View className="flex-row items-baseline justify-between gap-3 py-1">
            <Text className="min-w-0 flex-1 font-mono text-sm text-slate-200" numberOfLines={1}>
              {item.name}
            </Text>
            <Text className={`w-8 text-right font-mono text-sm font-semibold ${voteTextClass(item.position)}`}>{voteShort(item.position)}</Text>
          </View>
        )}
      />
    </>
  )
}
