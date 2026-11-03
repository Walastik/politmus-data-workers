import {
  earlyVotingPhase,
  getEarlyVotingWindow,
  localToday,
  nextCalendarElection,
  statesWithEarlyVotingOpen,
} from '@politmus/core/earlyVoting'
import { daysUntil } from '@politmus/core/feed'
import {
  ballotRacesFor,
  ballotUrlFrom,
  districtLabel,
  errorMessage,
  houseDistrict,
  isElectionFocus,
  pollsCloseFor,
} from '@politmus/core/happeningNow'
import { getVoterResources } from '@politmus/core/types'
import { router } from 'expo-router'
import { ScrollView, Text } from 'react-native'

import {
  BeforeYouVote,
  ElectionHero,
  FeedPreview,
  OnYourBallot,
  QuietHero,
  WhereToVote,
} from '@/components/HappeningNow'
import { Icons } from '@/components/icons'
import LocationBar from '@/components/LocationBar'
import { FederalRepsStrip } from '@/components/Representatives'
import { LinkAction, Section } from '@/components/ui'
import { useCivicLocation } from '@/lib/civicLocation'
import { pageMetadata } from '@/lib/metadata'
import { useRaces, useVoterInfo } from '@/lib/queries'

export function generateMetadata() {
  return pageMetadata('/now')
}

// What's going on in the visitor's election right now, where to vote, who is
// on the ballot, who represents them, and the latest from the feed.
export default function NowScreen() {
  const location = useCivicLocation()
  const { address, lookup } = location
  const lookupData = lookup.status === 'ok' ? lookup.data : null
  const stateCode = lookupData?.normalized_input?.state ?? null

  const today = localToday()
  const voterQuery = useVoterInfo(address, stateCode, Boolean(lookupData))
  const voterData = voterQuery.data ?? null
  const electionDate = voterData?.election?.date ?? nextCalendarElection(today)
  const daysToElection = electionDate ? daysUntil(electionDate) : null
  const electionFocus = isElectionFocus(daysToElection)
  const electionDay = daysToElection === 0
  const window = getEarlyVotingWindow(stateCode, electionDate)
  const phase = window ? earlyVotingPhase(window, today) : null
  const district = houseDistrict(lookupData)
  const racesQuery = useRaces(electionFocus ? stateCode : null)
  const hasPlace = Boolean(location.place) && lookup.status !== 'error'
  const pollsClose = electionDay && hasPlace ? pollsCloseFor(voterData, lookupData?.point ?? null, electionDate) : null

  // Voting sites need a street address; a device location without one only
  // gets the races and representatives.
  const voterInfo = !address
    ? {
        status: 'error' as const,
        message: 'We couldn’t find a street address for your location. Enter your address to see voting sites.',
      }
    : voterQuery.isError
      ? { status: 'error' as const, message: errorMessage(voterQuery.error, 'Voting locations are unavailable.') }
      : voterData
        ? { status: 'ok' as const, data: voterData }
        : { status: 'loading' as const }
  const races = !stateCode
    ? { status: 'error' as const, message: 'We need your state to find your races.' }
    : racesQuery.isError
      ? { status: 'error' as const, message: errorMessage(racesQuery.error, 'Candidates are unavailable.') }
      : racesQuery.data
        ? { status: 'ok' as const }
        : { status: 'loading' as const }

  return (
    <ScrollView className="flex-1 bg-slate-900" contentContainerClassName="gap-6 px-4 py-5" keyboardShouldPersistTaps="handled">
      {!location.ready ? (
        <Text className="text-slate-400">Loading…</Text>
      ) : (
        <>
          {electionFocus ? (
            <ElectionHero
              electionDate={electionDate}
              electionName={voterData?.election?.name ?? null}
              stateCode={stateCode}
              window={window}
              phase={phase}
              openStateCount={electionDate && !stateCode ? statesWithEarlyVotingOpen(electionDate, today).length : 0}
              electionDay={electionDay}
              pollsClose={pollsClose}
            />
          ) : (
            <QuietHero placeName={stateCode ? getVoterResources(stateCode).name : null} />
          )}

          <LocationBar
            prompt={
              electionFocus
                ? 'Enter an address, or use your location, to see what’s happening in that community: your voting sites, the candidates on your ballot and who represents you.'
                : 'Enter an address, or use your location, to see who represents you and what’s on your ballot next.'
            }
            submitLabel="Show my election"
            detail={districtLabel(stateCode, district)}
          />

          {lookup.status === 'error' ? <Text className="text-red-400">{lookup.message}</Text> : null}
          {hasPlace && lookup.status === 'loading' ? <Text className="text-slate-400">Looking up your area…</Text> : null}

          {hasPlace && lookupData && electionFocus ? (
            <>
              <WhereToVote voterInfo={voterInfo} point={lookupData.point ?? null} stateCode={stateCode} phase={phase} electionDay={electionDay} />
              <OnYourBallot
                races={races}
                ballotRaces={racesQuery.data ? ballotRacesFor(racesQuery.data, district) : []}
                stateCode={stateCode}
                ballotUrl={ballotUrlFrom(voterData)}
              />
              <BeforeYouVote voterInfo={voterData} stateCode={stateCode} />
            </>
          ) : null}

          {hasPlace && lookupData ? (
            <Section
              icon={<Icons.Users size={16} colorClassName="accent-blue-400" />}
              title="Who represents you"
              action={<LinkAction label="All your representatives" onPress={() => router.navigate('/reps')} />}
            >
              <FederalRepsStrip lookup={lookupData} />
            </Section>
          ) : null}

          <FeedPreview lead={!electionFocus} />
        </>
      )}
    </ScrollView>
  )
}
