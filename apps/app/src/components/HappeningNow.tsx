import { formatCompactMoney } from '@politmus/core/campaignFinance'
import { formatElectionDate } from '@politmus/core/calendar'
import { formatShortDate, type EarlyVotingInfo, type EarlyVotingPhase } from '@politmus/core/earlyVoting'
import { daysUntil, groupFeed } from '@politmus/core/feed'
import {
  FEED_PREVIEW_SIZE,
  UNCONFIRMED_CANDIDATES_SHOWN,
  beforeYouVoteLinks,
  candidateBackground,
  daysAwayLabel,
  electionHeadline,
  errorMessage,
  formatClockTime,
  formatCountdown,
  incompleteRaceReason,
  moreSitesNote,
  noSitesMessage,
  uniqueCandidates,
  votingSitesView,
  type PollsClose,
} from '@politmus/core/happeningNow'
import { splitPollingHours } from '@politmus/core/pollingHours'
import {
  getVoterResources,
  incumbencyLabel,
  officialFromRaceCandidate,
  partyBadgeClass,
  partyShort,
  type BallotNominee,
  type Race,
  type RaceCandidate,
  type VoterInfo,
} from '@politmus/core/types'
import { directionsUrl, formatMiles, locationAddress, type RankedSite } from '@politmus/core/votingSites'
import { router } from 'expo-router'
import { useEffect, useState } from 'react'
import { Pressable, Text, View } from 'react-native'

import { addToCalendar, canAddToCalendar } from '@/lib/calendar'
import { openProfile, openUrl } from '@/lib/links'
import { useFeedPreview } from '@/lib/queries'

import FeedItemRow from './FeedItemRow'
import { Icons } from './icons'
import OfficialPhoto from './OfficialPhoto'
import { LinkAction, Muted, Section } from './ui'

// The pieces of the Happening Now screen; what they say comes from
// @politmus/core/happeningNow, the same as the web page.

export function QuietHero({ placeName }: { placeName: string | null }) {
  return (
    <View className="rounded-xl border border-slate-700 bg-slate-800/60 p-5">
      <Text className="text-xs font-semibold uppercase tracking-wider text-emerald-400">Happening now</Text>
      <Text accessibilityRole="header" className="mt-1 text-2xl font-bold tracking-tight text-slate-50">
        No election coming up{placeName ? ` in ${placeName}` : ''}
      </Text>
      <Text className="mt-1 text-sm text-slate-300">
        Here’s what Congress has been doing lately, and how the people who represent you voted.
      </Text>
    </View>
  )
}

export function ElectionHero({
  electionDate,
  electionName,
  stateCode,
  window,
  phase,
  openStateCount,
  electionDay,
  pollsClose,
}: {
  electionDate: string | null
  electionName: string | null
  stateCode: string | null
  window: EarlyVotingInfo | null
  phase: EarlyVotingPhase | null
  openStateCount: number
  electionDay: boolean
  pollsClose: PollsClose | null
}) {
  const stateName = stateCode ? getVoterResources(stateCode).name : null
  const daysAway = daysAwayLabel(electionDate ? daysUntil(electionDate) : null)
  const { headline, detail, endLabel } = electionHeadline({
    window,
    phase,
    stateName,
    openStateCount,
    electionName,
    electionDay,
    pollsClose,
  })
  const calendarElection = electionDate
    ? { id: `general-${electionDate}`, name: electionName ?? 'Election Day', date: electionDate }
    : null
  const infoUrl = getVoterResources(stateCode).pollingPlaceUrl ?? 'https://vote.gov'
  const open = electionDay || phase?.phase === 'open'
  const showWindow = window && phase?.phase !== 'ended' && !electionDay

  return (
    <View className={`gap-4 rounded-xl border p-5 ${open ? 'border-emerald-700/60 bg-emerald-950/30' : 'border-slate-700 bg-slate-800/60'}`}>
      <View>
        <View className="flex-row items-center gap-2">
          {open ? <View className="h-2 w-2 rounded-full bg-emerald-400" /> : null}
          <Text className="text-xs font-semibold uppercase tracking-wider text-emerald-400">Happening now</Text>
        </View>
        <Text accessibilityRole="header" className="mt-1 text-2xl font-bold tracking-tight text-slate-50">
          {headline}
        </Text>
        {detail ? <Text className="mt-1 text-sm text-slate-300">{detail}</Text> : null}
        {showWindow && window.note ? <Text className="mt-2 text-xs text-slate-400">{window.note}</Text> : null}
        {showWindow ? (
          <Text className="mt-2 text-xs text-slate-500">
            {formatShortDate(window.start)} – {endLabel} statewide; your county sets sites and hours. Source:{' '}
            <Text onPress={() => openUrl(window.sourceUrl)} className="text-slate-400 underline">
              {window.sourceName}
            </Text>
          </Text>
        ) : null}
      </View>
      {electionDay && pollsClose ? (
        <PollsCountdown pollsClose={pollsClose} />
      ) : electionDate ? (
        <View className="rounded-lg border border-slate-700 bg-slate-900/60 p-3">
          <Text className="text-xs font-semibold uppercase tracking-wider text-slate-500">Election Day</Text>
          <Text className="text-lg font-bold text-slate-100">{formatElectionDate(electionDate)}</Text>
          {daysAway ? <Text className="text-sm font-semibold text-blue-300">{daysAway}</Text> : null}
          {!electionDay && calendarElection && canAddToCalendar(calendarElection, infoUrl) ? (
            <Pressable
              onPress={() => addToCalendar(calendarElection, infoUrl)}
              accessibilityRole="button"
              className="mt-2 flex-row items-center gap-1.5 self-start rounded border border-slate-600 px-2.5 py-1"
            >
              <Icons.CalendarPlus size={14} colorClassName="accent-blue-400" />
              <Text className="text-xs text-slate-200">Add to calendar</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  )
}

// Time left before the visitor's closest polling place closes, ticking each second.
function PollsCountdown({ pollsClose }: { pollsClose: PollsClose }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  const left = formatCountdown(pollsClose.at.getTime() - now)
  const closesAt = formatClockTime(pollsClose.at)
  return (
    <View
      className="rounded-lg border border-emerald-700/60 bg-slate-900/60 p-3"
      accessibilityRole="timer"
      accessibilityLabel={left ? `Polls close in ${left}, at ${closesAt}` : `Polls closed at ${closesAt}`}
    >
      <Text className="text-xs font-semibold uppercase tracking-wider text-slate-500">
        {left ? 'Polls close in' : 'Polls have closed'}
      </Text>
      {left ? (
        <Text className="text-3xl font-bold tabular-nums text-emerald-300">{left}</Text>
      ) : (
        <Text className="text-sm text-slate-200">
          Your closest polling place closed at {closesAt}. If you were in line by then, stay in line: you can still vote.
        </Text>
      )}
      {left ? (
        <Text className="mt-1 text-xs text-slate-400">
          {closesAt} at {pollsClose.siteName || 'your closest polling place'}
        </Text>
      ) : null}
    </View>
  )
}

export function WhereToVote({
  voterInfo,
  point,
  stateCode,
  phase,
  electionDay,
}: {
  voterInfo: { status: 'loading' } | { status: 'error'; message: string } | { status: 'ok'; data: VoterInfo }
  point: { lat: number; lon: number } | null
  stateCode: string | null
  phase: EarlyVotingPhase | null
  electionDay: boolean
}) {
  const resources = getVoterResources(stateCode)
  const data = voterInfo.status === 'ok' ? voterInfo.data : null
  const sites = votingSitesView(data, phase, point, electionDay)
  const moreNote = moreSitesNote(sites)

  return (
    <Section
      icon={<Icons.MapPin size={16} colorClassName="accent-blue-400" />}
      title={sites.title}
      action={
        data && data.uiState !== 'unavailable' ? (
          <LinkAction
            label={sites.totalSites > 0 ? `See all ${sites.totalSites} locations` : 'Voting details'}
            onPress={() => router.push('/voting')}
          />
        ) : null
      }
    >
      {voterInfo.status === 'loading' ? (
        <Muted>Finding voting locations near you…</Muted>
      ) : voterInfo.status === 'error' || data?.uiState === 'unavailable' ? (
        <NoSites
          message={(voterInfo.status === 'error' ? voterInfo.message : data?.detail) ?? 'Voting locations are unavailable right now.'}
          lookupUrl={resources.pollingPlaceUrl}
        />
      ) : sites.shown.length === 0 ? (
        <NoSites message={noSitesMessage(data, stateCode)} lookupUrl={resources.pollingPlaceUrl} />
      ) : (
        <View className="gap-3">
          {sites.shown.map((site, index) => (
            <SiteCard key={index} site={site} electionDate={data?.election?.date} />
          ))}
          {moreNote ? <Text className="text-xs text-slate-500">{moreNote}</Text> : null}
        </View>
      )}
    </Section>
  )
}

function NoSites({ message, lookupUrl }: { message: string; lookupUrl?: string }) {
  return (
    <View className="gap-2">
      <Text className="text-sm text-slate-300">{message}</Text>
      {lookupUrl ? (
        <Pressable onPress={() => openUrl(lookupUrl)} accessibilityRole="link" className="flex-row items-center gap-1.5">
          <Text className="text-sm font-semibold text-blue-400">Find your site on the official state lookup</Text>
          <Icons.ExternalLink size={14} colorClassName="accent-blue-400" />
        </Pressable>
      ) : null}
    </View>
  )
}

function SiteCard({ site, electionDate }: { site: RankedSite; electionDate?: string | null }) {
  const { location, miles } = site
  const address = locationAddress(location)
  const directions = directionsUrl(location)
  const nextHours = location.pollingHours ? (splitPollingHours(location.pollingHours, { electionDate }).upcoming[0] ?? null) : null
  return (
    <View className="rounded-lg border border-slate-700 bg-slate-800 p-3">
      <View className="flex-row items-start justify-between gap-2">
        <Text className="flex-1 text-sm font-semibold text-slate-100">{location.locationName || 'Voting location'}</Text>
        {miles !== null ? (
          <Text className="rounded bg-slate-700 px-1.5 py-0.5 text-[11px] font-semibold text-slate-200">{formatMiles(miles)}</Text>
        ) : null}
      </View>
      {address ? <Text className="mt-1 text-xs text-slate-400">{address}</Text> : null}
      {nextHours ? (
        <View className="mt-2 flex-row items-start gap-1.5">
          <Icons.Clock size={14} colorClassName="accent-slate-500" />
          <Text className="flex-1 text-xs text-slate-300">{nextHours}</Text>
        </View>
      ) : null}
      {directions ? (
        <Pressable onPress={() => openUrl(directions)} accessibilityRole="link" className="mt-3 flex-row items-center gap-1.5">
          <Icons.Navigation size={14} colorClassName="accent-blue-400" />
          <Text className="text-xs font-semibold text-blue-400">Directions</Text>
        </Pressable>
      ) : null}
    </View>
  )
}

export function OnYourBallot({
  races,
  ballotRaces,
  stateCode,
  ballotUrl,
}: {
  races: { status: 'loading' } | { status: 'error'; message: string } | { status: 'ok' }
  ballotRaces: Race[]
  stateCode: string | null
  ballotUrl: string | null
}) {
  const awaitingBallot = ballotRaces.some((race) => !race.ballot_filtered)
  const ballotSource = ballotRaces.find((race) => race.ballot_source)?.ballot_source
  return (
    <Section
      icon={<Icons.Vote size={16} colorClassName="accent-blue-400" />}
      title="On your ballot"
      action={<LinkAction label="All candidates" onPress={() => router.push('/candidates')} />}
    >
      {races.status === 'loading' ? (
        <Muted>Loading your races…</Muted>
      ) : races.status === 'error' ? (
        <Muted>{races.message}</Muted>
      ) : ballotRaces.length === 0 ? (
        <Muted>
          We don’t have congressional candidates for {stateCode ? getVoterResources(stateCode).name : 'your area'} yet.
        </Muted>
      ) : (
        <View className="gap-5">
          {awaitingBallot ? (
            <Text className="rounded border border-amber-800/60 bg-amber-950/30 px-3 py-2 text-xs text-amber-200">
              The FEC hasn’t confirmed who is on the November ballot yet, so these lists can include candidates who lost a
              primary. They’re ordered by money raised.
            </Text>
          ) : null}
          {ballotRaces.map((race) => (
            <BallotRace key={race.key} race={race} ballotUrl={ballotUrl} />
          ))}
          <Text className="text-xs text-slate-500">
            “Full profile” has each candidate’s positions, voting record and campaign finance. These are your federal races
            {ballotSource ? ` (nominees per ${ballotSource})` : ''}; your ballot also has state and local contests
            {ballotUrl ? (
              <>
                {' ('}
                <Text onPress={() => openUrl(ballotUrl)} className="underline">
                  sample ballot
                </Text>
                {')'}
              </>
            ) : null}
            .
          </Text>
        </View>
      )}
    </Section>
  )
}

function BallotRace({ race, ballotUrl }: { race: Race; ballotUrl: string | null }) {
  const [showAll, setShowAll] = useState(false)
  const [showNote, setShowNote] = useState(false)
  const candidates = uniqueCandidates(race)
  const limit = race.ballot_filtered || showAll ? candidates.length : UNCONFIRMED_CANDIDATES_SHOWN
  const shown = candidates.slice(0, limit)
  return (
    <View className="gap-2">
      <View className="flex-row flex-wrap items-center gap-x-2 gap-y-1">
        <Text className="text-sm font-semibold text-slate-200">{race.label}</Text>
        {race.ballot_complete ? null : (
          <Pressable
            onPress={() => setShowNote(!showNote)}
            accessibilityRole="button"
            accessibilityState={{ expanded: showNote }}
            className="flex-row items-center gap-1 rounded-full border border-amber-800/60 px-2 py-0.5"
          >
            <Icons.Info size={12} colorClassName="accent-amber-300" />
            <Text className="text-[11px] font-medium text-amber-300">May be incomplete</Text>
          </Pressable>
        )}
      </View>
      {showNote ? (
        <Text className="text-xs leading-relaxed text-slate-300">
          This list may not include everyone on your ballot for this race. {incompleteRaceReason(race)}{' '}
          {ballotUrl ? (
            <>
              Your{' '}
              <Text onPress={() => openUrl(ballotUrl)} className="underline">
                sample ballot
              </Text>{' '}
              has the full list.
            </>
          ) : (
            'Your sample ballot has the full list.'
          )}
        </Text>
      ) : null}
      {shown.map((candidate) => (
        <BallotCandidateCard key={candidate.fec_candidate_id} candidate={candidate} race={race} />
      ))}
      {(race.unlisted_nominees ?? []).map((nominee) => (
        <UnlistedNomineeCard key={nominee.name} nominee={nominee} />
      ))}
      {candidates.length > shown.length || showAll ? (
        <Pressable onPress={() => setShowAll(!showAll)} accessibilityRole="button" accessibilityState={{ expanded: showAll }}>
          <Text className="text-sm font-semibold text-blue-400">
            {showAll ? 'Show fewer' : `Show all ${candidates.length} candidates`}
          </Text>
        </Pressable>
      ) : null}
    </View>
  )
}

// Who the candidate is and what they run on, readable without opening a profile.
function BallotCandidateCard({ candidate, race }: { candidate: RaceCandidate; race: Race }) {
  const name = candidate.name ?? candidate.fec_candidate_id
  const party = candidate.party ?? ''
  const incumbent = incumbencyLabel(candidate.incumbent_challenge) === 'Incumbent'
  const background = candidateBackground(candidate)
  const issues = candidate.top_issues ?? []

  return (
    <View className="rounded-lg border border-slate-700 bg-slate-800 p-3">
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
          {incumbent ? (
            <View className="mt-1 self-start rounded border border-amber-500/40 bg-amber-900/30 px-1.5 py-0.5">
              <Text className="text-[10px] font-semibold text-amber-200">Incumbent</Text>
            </View>
          ) : null}
        </View>
      </View>

      {background.length > 0 ? <Text className="mt-2 text-xs text-slate-400">{background.join(' · ')}</Text> : null}

      <View className="mt-3">
        <Text className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Running on</Text>
        {issues.length > 0 ? (
          <>
            <View className="mt-1 gap-1.5">
              {issues.map((issue) => (
                <View key={issue.label}>
                  <Text className="text-xs font-semibold text-slate-100">{issue.label}</Text>
                  {issue.summary ? (
                    <Text className="text-xs text-slate-300" numberOfLines={2}>
                      {issue.summary}
                    </Text>
                  ) : null}
                </View>
              ))}
            </View>
            <View className="mt-1.5 flex-row items-center gap-1">
              <Icons.Sparkles size={12} colorClassName="accent-purple-300" />
              <Text className="text-[10px] text-purple-300/80">AI summary of their campaign site</Text>
            </View>
          </>
        ) : (
          <Text className="mt-1 text-xs text-slate-500">Candidate platform data has not been processed.</Text>
        )}
      </View>

      <View className="mt-3 flex-row flex-wrap items-center gap-x-3 gap-y-1 border-t border-slate-700/60 pt-2">
        {candidate.website_url ? (
          <ExternalAction label="Campaign site" url={candidate.website_url} tone="text-blue-400 font-semibold" accent="accent-blue-400" />
        ) : null}
        {candidate.wikipedia_url ? (
          <ExternalAction label="Wikipedia" url={candidate.wikipedia_url} tone="text-slate-400" accent="accent-slate-400" />
        ) : null}
        <Pressable
          onPress={() => openProfile(officialFromRaceCandidate(candidate, race))}
          accessibilityRole="button"
          accessibilityLabel={`Full profile: ${name}`}
          className="ml-auto flex-row items-center gap-0.5"
        >
          <Text className="text-xs font-semibold text-slate-200">Full profile</Text>
          <Icons.ChevronRight size={14} colorClassName="accent-slate-200" />
        </Pressable>
      </View>
      {candidate.receipts ? (
        <Text className="mt-1 text-[11px] text-slate-500">Raised {formatCompactMoney(candidate.receipts)}</Text>
      ) : null}
    </View>
  )
}

function ExternalAction({ label, url, tone, accent }: { label: string; url: string; tone: string; accent: string }) {
  return (
    <Pressable onPress={() => openUrl(url)} accessibilityRole="link" className="flex-row items-center gap-1">
      <Text className={`text-xs ${tone}`}>{label}</Text>
      <Icons.ExternalLink size={12} colorClassName={accent} />
    </Pressable>
  )
}

export function UnlistedNomineeCard({ nominee }: { nominee: BallotNominee }) {
  return (
    <View className="flex-row items-center gap-3 rounded-lg border border-dashed border-slate-700 bg-slate-800/50 p-3">
      <OfficialPhoto url={null} name={nominee.name} party={nominee.party} />
      <View className="min-w-0 flex-1">
        <View className="flex-row items-center gap-2">
          <View className={`rounded px-1.5 py-0.5 ${partyBadgeClass(nominee.party)}`}>
            <Text className={`text-[10px] font-bold ${partyBadgeClass(nominee.party)}`}>{partyShort(nominee.party)}</Text>
          </View>
          <Text className="flex-1 text-sm font-semibold text-slate-100" numberOfLines={1}>
            {nominee.name}
          </Text>
        </View>
        <Text className="mt-1 text-xs text-slate-500">No FEC filings, so no profile yet.</Text>
      </View>
    </View>
  )
}

export function BeforeYouVote({ voterInfo, stateCode }: { voterInfo: VoterInfo | null; stateCode: string | null }) {
  const { links, office } = beforeYouVoteLinks(voterInfo, stateCode)
  return (
    <Section icon={<Icons.Check size={16} colorClassName="accent-blue-400" />} title="Before you vote">
      <View className="gap-2">
        {links.map((link) => (
          <Pressable
            key={link.label}
            onPress={() => openUrl(link.url)}
            accessibilityRole="link"
            className="flex-row items-center justify-between gap-2 rounded border border-slate-700 bg-slate-800 px-3 py-2.5 active:border-slate-500"
          >
            <Text className="text-sm text-slate-200">{link.label}</Text>
            <Icons.ExternalLink size={14} colorClassName="accent-slate-500" />
          </Pressable>
        ))}
      </View>
      {office?.name ? (
        <Text className="mt-3 text-xs text-slate-400">
          Questions? Contact {office.name}
          {office.phone ? (
            <>
              {' at '}
              <Text onPress={() => openUrl(`tel:${office.phone}`)} className="text-slate-300 underline">
                {office.phone}
              </Text>
            </>
          ) : null}
          .
        </Text>
      ) : null}
    </Section>
  )
}

// The latest feed items, as the next thing to read after the election.
export function FeedPreview({ lead }: { lead: boolean }) {
  const feed = useFeedPreview(FEED_PREVIEW_SIZE)
  const items = feed.data?.items ?? []
  return (
    <Section
      icon={<Icons.Rss size={16} colorClassName="accent-blue-400" />}
      title={lead ? 'Latest in Congress' : 'Next: catch up on Congress'}
      action={<LinkAction label="See the full Feed" onPress={() => router.navigate('/feed')} />}
    >
      {feed.isPending ? (
        <Muted>Loading the latest…</Muted>
      ) : feed.isError ? (
        <Muted>{errorMessage(feed.error, 'The feed is unavailable.')}</Muted>
      ) : items.length === 0 ? (
        <Muted>Nothing new yet.</Muted>
      ) : (
        <View className="-mx-4">
          {groupFeed(items).flatMap((group) => group.entries.map((entry) => <FeedItemRow key={entry.item.id} entry={entry} />))}
        </View>
      )}
    </Section>
  )
}
