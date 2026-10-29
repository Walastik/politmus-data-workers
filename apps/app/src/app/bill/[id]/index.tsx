import { billDates, cosponsorLine, sponsorText } from '@politmus/core/billProfile'
import type { VoteChamber } from '@politmus/core/types'
import { tallyRollCall } from '@politmus/core/voteContext'
import { useAuth } from '@clerk/expo'
import { router, Stack, useLocalSearchParams } from 'expo-router'
import { ScrollView, Text, View } from 'react-native'

import {
  AiClassification,
  BillContext,
  BillTags,
  ChamberDivergence,
  CrsSummary,
  Debate,
  RollCalls,
} from '@/components/profile/BillSections'
import { SectionHeading, ShareButton } from '@/components/profile/parts'
import VoteTally from '@/components/profile/VoteTally'
import { profileShareUrl } from '@/lib/links'
import { useBill } from '@/lib/queries'

// The bill profile; native counterpart of the web BillDrawer.
export default function BillScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { isSignedIn } = useAuth()
  const bill = useBill(id)
  const view = bill.data
  const sponsor = view ? sponsorText(view) : null
  const dates = view ? billDates(view) : null
  const cosponsors = view ? cosponsorLine(view) : null

  const showVoters = (chamber: VoteChamber, party: string) =>
    router.push({ pathname: '/bill/[id]/voters', params: { id, chamber, party } })

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: id,
          headerBackTitle: 'Back',
          headerRight: () => <ShareButton url={profileShareUrl('bill', id)} title={view?.title ?? id} />,
        }}
      />
      <ScrollView className="flex-1 bg-slate-900" contentInsetAdjustmentBehavior="automatic" contentContainerClassName="gap-6 px-5 py-5">
        {!view ? (
          <Text className={`text-sm ${bill.isError ? 'text-red-400' : 'text-slate-400'}`}>
            {bill.isError ? bill.error.message : 'Loading bill details…'}
          </Text>
        ) : (
          <>
            <View className="border-b border-slate-800 pb-5">
              <Text accessibilityRole="header" className="text-xl font-semibold leading-snug text-slate-100">
                {view.title || 'Untitled bill'}
              </Text>
              <BillTags bill={view} />
              <Text className={`mt-2 text-xs ${sponsor?.name ? 'text-slate-400' : 'text-slate-500'}`}>
                {sponsor?.name ?? 'No sponsor listed'}
                {sponsor?.notInRoster ? <Text className="text-slate-500"> (not in roster)</Text> : null}
              </Text>
              {cosponsors ? <Text className="mt-1 text-xs text-slate-400">{cosponsors}</Text> : null}
              {dates ? (
                <View className="mt-3 flex-row flex-wrap gap-x-4 gap-y-1">
                  {dates.introduced ? (
                    <Text className="text-xs text-slate-500">
                      Introduced <Text className="text-slate-300">{dates.introduced}</Text>
                    </Text>
                  ) : null}
                  {dates.voted ? (
                    <Text className="text-xs text-slate-500">
                      Voted <Text className="text-slate-300">{dates.voted}</Text>
                    </Text>
                  ) : null}
                  {dates.velocity ? (
                    <Text accessibilityLabel={dates.velocity.description} className="text-xs text-slate-300">
                      {dates.velocity.text}
                    </Text>
                  ) : null}
                  {dates.latestAction ? (
                    <Text className="w-full text-xs text-slate-500">
                      Latest action <Text className="text-slate-300">{dates.latestAction}</Text>
                    </Text>
                  ) : null}
                </View>
              ) : null}
            </View>

            <View>
              <VoteTally
                summary={view.votes_summary}
                byParty={view.votes_by_party}
                rollCalls={{ house: tallyRollCall(view, 'house'), senate: tallyRollCall(view, 'senate') }}
                onPartyPress={showVoters}
              />
              <ChamberDivergence bill={view} />
            </View>
            <RollCalls rollCalls={view.roll_calls} />
            {isSignedIn ? (
              <>
                <Debate debate={view.debate} />
                <AiClassification metadata={view.classification_metadata} model={view.classification_model} />
              </>
            ) : null}
            <BillContext bill={view} />
            <View>
              <SectionHeading>CRS summary</SectionHeading>
              {view.summary ? (
                <CrsSummary text={view.summary} />
              ) : (
                <Text className="mt-3 text-sm text-slate-400">No CRS summary has been ingested for this bill.</Text>
              )}
            </View>
          </>
        )}
      </ScrollView>
    </>
  )
}
