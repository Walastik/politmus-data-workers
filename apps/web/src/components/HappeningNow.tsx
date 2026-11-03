import {
  CalendarPlus,
  Check,
  ChevronRight,
  Clock,
  ExternalLink,
  Info,
  MapPin,
  Navigation,
  Rss,
  Sparkles,
  Users,
  Vote,
} from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { apiJson } from '../api'
import { buildElectionIcs, formatElectionDate } from '@politmus/core/calendar'
import { racesPath } from '@politmus/core/candidates'
import { downloadIcs } from '../downloadIcs'
import {
  earlyVotingPhase,
  formatShortDate,
  getEarlyVotingWindow,
  localToday,
  nextCalendarElection,
  statesWithEarlyVotingOpen,
  type EarlyVotingInfo,
  type EarlyVotingPhase,
} from '@politmus/core/earlyVoting'
import { daysUntil, groupFeed } from '@politmus/core/feed'
import { FederalRepsStrip } from '../LookupResults'
import { splitPollingHours } from '@politmus/core/pollingHours'
import {
  getVoterResources,
  incumbencyLabel,
  officialFromRaceCandidate,
  partyBadgeClass,
  partyShort,
  type Bill,
  type FeedItem,
  type FeedPage,
  type Official,
  type Race,
  type RaceCandidate,
  type RacesPage,
  type VoterInfo,
} from '@politmus/core/types'
import { useCivicLocation, type Load } from '../useCivicLocation'
import { directionsUrl, formatMiles, locationAddress, type RankedSite } from '@politmus/core/votingSites'
import {
  FEED_PREVIEW_SIZE,
  UNCONFIRMED_CANDIDATES_SHOWN,
  ballotRacesFor,
  ballotUrlFrom,
  beforeYouVoteLinks,
  candidateBackground,
  daysAwayLabel,
  districtLabel,
  electionHeadline,
  errorMessage,
  houseDistrict,
  incompleteRaceReason,
  isElectionFocus,
  moreSitesNote,
  noSitesMessage,
  uniqueCandidates,
  votingSitesView,
} from '@politmus/core/happeningNow'
import { formatCompactMoney } from '@politmus/core/campaignFinance'
import { UnlistedNomineeCard } from './CandidatesPanel'
import FeedItemCard from './FeedItemCard'
import LocationBar from './LocationBar'
import OfficialPhoto from './OfficialPhoto'
import VotingLocations from './VotingLocations'

// The first page after sign-in (and open to everyone): what's going on in the
// visitor's election right now, where to vote, who is on the ballot, who
// represents them, and the latest from the feed when no election is close.
export default function HappeningNow({
  onSelectOfficial,
  onSelectBill,
}: {
  onSelectOfficial: (official: Official) => void
  onSelectBill: (bill: Bill) => void
}) {
  const location = useCivicLocation()
  const { address, lookup } = location

  const [voterInfo, setVoterInfo] = useState<Load<VoterInfo>>({ status: 'idle' })
  const [races, setRaces] = useState<Load<Race[]>>({ status: 'idle' })
  const [showAllSites, setShowAllSites] = useState(false)

  const lookupData = lookup.status === 'ok' ? lookup.data : null
  const stateCode = lookupData?.normalized_input?.state ?? null

  // Voting sites need a street address; a device location without one only
  // gets the races and representatives.
  useEffect(() => {
    setShowAllSites(false)
    if (!lookupData) {
      setVoterInfo({ status: lookup.status === 'error' ? 'idle' : lookup.status === 'loading' ? 'loading' : 'idle' })
      return
    }
    if (!address) {
      setVoterInfo({
        status: 'error',
        message: 'We couldn’t find a street address for your location. Enter your address to see voting sites.',
      })
      return
    }
    const controller = new AbortController()
    setVoterInfo({ status: 'loading' })
    apiJson<VoterInfo>('/api/voter-info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address, state: stateCode || undefined }),
      signal: controller.signal,
    })
      .then((data) => setVoterInfo({ status: 'ok', data }))
      .catch((err) => {
        if (!controller.signal.aborted) {
          setVoterInfo({ status: 'error', message: errorMessage(err, 'Voting locations are unavailable.') })
        }
      })
    return () => controller.abort()
    // Keyed on the lookup result and address; the status only matters with no data.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [lookupData, address])

  useEffect(() => {
    if (!lookupData) {
      setRaces({ status: lookup.status === 'loading' ? 'loading' : 'idle' })
      return
    }
    if (!stateCode) {
      setRaces({ status: 'error', message: 'We need your state to find your races.' })
      return
    }
    const controller = new AbortController()
    setRaces({ status: 'loading' })
    apiJson<RacesPage>(racesPath({ state: stateCode }, 100), {
      signal: controller.signal,
    })
      .then((data) => setRaces({ status: 'ok', data: data.items ?? [] }))
      .catch((err) => {
        if (!controller.signal.aborted) {
          setRaces({ status: 'error', message: errorMessage(err, 'Candidates are unavailable.') })
        }
      })
    return () => controller.abort()
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [lookupData, stateCode])

  const voterData = voterInfo.status === 'ok' ? voterInfo.data : null
  const district = houseDistrict(lookupData)
  const today = localToday()
  const electionDate = voterData?.election?.date ?? nextCalendarElection(today)
  const daysToElection = electionDate ? daysUntil(electionDate) : null
  const electionFocus = isElectionFocus(daysToElection)
  const window = getEarlyVotingWindow(stateCode, electionDate)
  const phase = window ? earlyVotingPhase(window, today) : null
  const ballotRaces = races.status === 'ok' ? ballotRacesFor(races.data, district) : []
  const hasPlace = Boolean(location.place) && lookup.status !== 'error'

  if (!location.ready) {
    return <p className="text-slate-400">Loading…</p>
  }

  return (
    <div className="space-y-6">
      {electionFocus ? (
        <ElectionHero
          electionDate={electionDate}
          electionName={voterData?.election?.name ?? null}
          stateCode={stateCode}
          window={window}
          phase={phase}
          today={today}
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

      {lookup.status === 'error' ? <p className="text-red-400">{lookup.message}</p> : null}

      {hasPlace && electionFocus ? (
        <>
          <WhereToVote
            voterInfo={voterInfo}
            point={lookupData?.point ?? null}
            stateCode={stateCode}
            phase={phase}
            expanded={showAllSites}
            onToggleAll={() => setShowAllSites(!showAllSites)}
          />
          <OnYourBallot
            races={races}
            ballotRaces={ballotRaces}
            stateCode={stateCode}
            ballotUrl={ballotUrlFrom(voterData)}
            onSelectOfficial={onSelectOfficial}
          />
          <BeforeYouVote voterInfo={voterData} stateCode={stateCode} />
        </>
      ) : null}

      {hasPlace && lookupData ? (
        <Section
          icon={<Users className="h-4 w-4 text-blue-400" aria-hidden="true" />}
          title="Who represents you"
          action={<LinkTo to="/reps">All your representatives</LinkTo>}
        >
          <FederalRepsStrip lookup={lookupData} onSelectOfficial={onSelectOfficial} />
        </Section>
      ) : null}

      <FeedPreview
        lead={!electionFocus}
        onSelectBill={onSelectBill}
        onSelectOfficial={onSelectOfficial}
      />
    </div>
  )
}

function QuietHero({ placeName }: { placeName: string | null }) {
  return (
    <section aria-labelledby="happening-now-heading" className="rounded-xl border border-slate-700 bg-slate-800/60 p-5">
      <p className="text-xs font-semibold uppercase tracking-wider text-emerald-400">Happening now</p>
      <h2 id="happening-now-heading" className="mt-1 text-2xl font-bold tracking-tight text-slate-50">
        No election coming up{placeName ? ` in ${placeName}` : ''}
      </h2>
      <p className="mt-1 text-sm text-slate-300">
        Here’s what Congress has been doing lately, and how the people who represent you voted.
      </p>
    </section>
  )
}

// The latest feed items, as the next thing to read after the election.
function FeedPreview({
  lead,
  onSelectBill,
  onSelectOfficial,
}: {
  // True when there's no election to show, so the feed is the main event.
  lead: boolean
  onSelectBill: (bill: Bill) => void
  onSelectOfficial: (official: Official) => void
}) {
  const [items, setItems] = useState<Load<FeedItem[]>>({ status: 'loading' })
  useEffect(() => {
    const controller = new AbortController()
    apiJson<FeedPage>(`/api/feed?limit=${FEED_PREVIEW_SIZE}`, { signal: controller.signal })
      .then((data) => setItems({ status: 'ok', data: data.items ?? [] }))
      .catch((err) => {
        if (!controller.signal.aborted) setItems({ status: 'error', message: errorMessage(err, 'The feed is unavailable.') })
      })
    return () => controller.abort()
  }, [])

  return (
    <Section
      icon={<Rss className="h-4 w-4 text-blue-400" aria-hidden="true" />}
      title={lead ? 'Latest in Congress' : 'Next: catch up on Congress'}
      action={<LinkTo to="/feed">See the full Feed</LinkTo>}
    >
      {items.status === 'loading' || items.status === 'idle' ? (
        <p className="text-sm text-slate-400">Loading the latest…</p>
      ) : items.status === 'error' ? (
        <p className="text-sm text-slate-400">{items.message}</p>
      ) : items.data.length === 0 ? (
        <p className="text-sm text-slate-400">Nothing new yet.</p>
      ) : (
        <div className="space-y-3">
          {groupFeed(items.data).flatMap((group) =>
            group.entries.map(({ item, related }) => (
              <FeedItemCard
                key={item.id}
                item={item}
                related={related}
                onSelectBill={onSelectBill}
                onSelectOfficial={onSelectOfficial}
              />
            )),
          )}
        </div>
      )}
    </Section>
  )
}

function ElectionHero({
  electionDate,
  electionName,
  stateCode,
  window,
  phase,
  today,
}: {
  electionDate: string | null
  electionName: string | null
  stateCode: string | null
  window: EarlyVotingInfo | null
  phase: EarlyVotingPhase | null
  today: string
}) {
  const stateName = stateCode ? getVoterResources(stateCode).name : null
  const daysToElection = electionDate ? daysUntil(electionDate) : null
  const ics = electionDate
    ? buildElectionIcs(
        { id: `general-${electionDate}`, name: electionName ?? 'Election Day', date: electionDate },
        { infoUrl: getVoterResources(stateCode).pollingPlaceUrl ?? 'https://vote.gov' },
      )
    : null
  const openStates = electionDate && !stateCode ? statesWithEarlyVotingOpen(electionDate, today) : []
  const { headline, detail, endLabel } = electionHeadline({
    window,
    phase,
    stateName,
    openStateCount: openStates.length,
    electionName,
  })

  return (
    <section
      aria-labelledby="happening-now-heading"
      className={`rounded-xl border p-5 ${
        phase?.phase === 'open'
          ? 'border-emerald-700/60 bg-emerald-950/30'
          : 'border-slate-700 bg-slate-800/60'
      }`}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-emerald-400">
            {phase?.phase === 'open' ? (
              <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" aria-hidden="true" />
            ) : null}
            Happening now
          </p>
          <h2 id="happening-now-heading" className="mt-1 text-2xl font-bold tracking-tight text-slate-50">
            {headline}
          </h2>
          {detail ? <p className="mt-1 text-sm text-slate-300">{detail}</p> : null}
          {window?.note && phase?.phase !== 'ended' ? (
            <p className="mt-2 text-xs text-slate-400">{window.note}</p>
          ) : null}
          {window && phase?.phase !== 'ended' ? (
            <p className="mt-2 text-xs text-slate-500">
              {formatShortDate(window.start)} – {endLabel} statewide; your county sets sites and hours.
              Source:{' '}
              <a
                href={window.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-slate-400 underline hover:text-blue-300"
              >
                {window.sourceName}
              </a>
            </p>
          ) : null}
        </div>
        {electionDate ? (
          <div className="shrink-0 rounded-lg border border-slate-700 bg-slate-900/60 p-3 sm:text-right">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Election Day</p>
            <p className="text-lg font-bold text-slate-100">{formatElectionDate(electionDate)}</p>
            {daysAwayLabel(daysToElection) ? (
              <p className="text-sm font-semibold text-blue-300">{daysAwayLabel(daysToElection)}</p>
            ) : null}
            {ics ? (
              <button
                type="button"
                onClick={() => downloadIcs(`election-${electionDate}.ics`, ics)}
                className="mt-2 inline-flex items-center gap-1.5 rounded border border-slate-600 px-2.5 py-1 text-xs text-slate-200 transition hover:border-blue-500 hover:text-blue-300"
              >
                <CalendarPlus className="h-3.5 w-3.5 text-blue-400" aria-hidden="true" />
                Add to calendar
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  )
}

function WhereToVote({
  voterInfo,
  point,
  stateCode,
  phase,
  expanded,
  onToggleAll,
}: {
  voterInfo: Load<VoterInfo>
  point: { lat: number; lon: number } | null
  stateCode: string | null
  phase: EarlyVotingPhase | null
  expanded: boolean
  onToggleAll: () => void
}) {
  const resources = getVoterResources(stateCode)
  const data = voterInfo.status === 'ok' ? voterInfo.data : null
  const sites = votingSitesView(data, phase, point)
  const { shown, totalSites } = sites
  const moreNote = moreSitesNote(sites)

  return (
    <Section
      icon={<MapPin className="h-4 w-4 text-blue-400" aria-hidden="true" />}
      title={sites.title}
      action={
        data && data.uiState !== 'unavailable' ? (
          <LinkButton onClick={onToggleAll} expanded={expanded}>
            {expanded ? 'Show fewer' : totalSites > 0 ? `See all ${totalSites} locations` : 'Voting details'}
          </LinkButton>
        ) : null
      }
    >
      {voterInfo.status === 'loading' || voterInfo.status === 'idle' ? (
        <p className="text-sm text-slate-400">Finding voting locations near you…</p>
      ) : voterInfo.status === 'error' || data?.uiState === 'unavailable' ? (
        <NoSites
          message={
            (voterInfo.status === 'error' ? voterInfo.message : data?.detail) ??
            'Voting locations are unavailable right now.'
          }
          lookupUrl={resources.pollingPlaceUrl}
        />
      ) : shown.length === 0 ? (
        <NoSites
          message={noSitesMessage(data, stateCode)}
          lookupUrl={resources.pollingPlaceUrl}
        />
      ) : (
        <>
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {shown.map((site, index) => (
              <li key={index}>
                <SiteCard site={site} electionDate={data?.election?.date} />
              </li>
            ))}
          </ul>
          {moreNote ? <p className="mt-2 text-xs text-slate-500">{moreNote}</p> : null}
        </>
      )}
      {expanded && data ? (
        <div className="mt-4 border-t border-slate-700 pt-4">
          <VotingLocations voterInfo={data} loading={false} stateCode={stateCode} />
        </div>
      ) : null}
    </Section>
  )
}

function NoSites({ message, lookupUrl }: { message: string; lookupUrl?: string }) {
  return (
    <div className="text-sm text-slate-300">
      <p>{message}</p>
      {lookupUrl ? (
        <a
          href={lookupUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold text-blue-400 hover:text-blue-300"
        >
          Find your site on the official state lookup
          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
        </a>
      ) : null}
    </div>
  )
}

function SiteCard({ site, electionDate }: { site: RankedSite; electionDate?: string | null }) {
  const { location, miles } = site
  const address = locationAddress(location)
  const directions = directionsUrl(location)
  const nextHours = location.pollingHours
    ? splitPollingHours(location.pollingHours, { electionDate }).upcoming[0] ?? null
    : null
  return (
    <div className="flex h-full flex-col rounded-lg border border-slate-700 bg-slate-800 p-3">
      <div className="flex items-start justify-between gap-2">
        <h4 className="text-sm font-semibold text-slate-100">{location.locationName || 'Voting location'}</h4>
        {miles !== null ? (
          <span className="shrink-0 rounded bg-slate-700 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-slate-200">
            {formatMiles(miles)}
          </span>
        ) : null}
      </div>
      {address ? <p className="mt-1 text-xs text-slate-400">{address}</p> : null}
      {nextHours ? (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-slate-300">
          <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden="true" />
          <span>{nextHours}</span>
        </p>
      ) : null}
      {directions ? (
        <a
          href={directions}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-auto inline-flex items-center gap-1.5 pt-3 text-xs font-semibold text-blue-400 hover:text-blue-300"
        >
          <Navigation className="h-3.5 w-3.5" aria-hidden="true" />
          Directions
        </a>
      ) : null}
    </div>
  )
}

function OnYourBallot({
  races,
  ballotRaces,
  stateCode,
  ballotUrl,
  onSelectOfficial,
}: {
  races: Load<Race[]>
  ballotRaces: Race[]
  stateCode: string | null
  ballotUrl: string | null
  onSelectOfficial: (official: Official) => void
}) {
  const awaitingBallot = ballotRaces.some((race) => !race.ballot_filtered)
  const ballotSource = ballotRaces.find((race) => race.ballot_source)?.ballot_source
  return (
    <Section
      icon={<Vote className="h-4 w-4 text-blue-400" aria-hidden="true" />}
      title="On your ballot"
      action={<LinkTo to="/candidates">All candidates</LinkTo>}
    >
      {races.status === 'loading' || races.status === 'idle' ? (
        <p className="text-sm text-slate-400">Loading your races…</p>
      ) : races.status === 'error' ? (
        <p className="text-sm text-slate-400">{races.message}</p>
      ) : ballotRaces.length === 0 ? (
        <p className="text-sm text-slate-400">
          We don’t have congressional candidates for {stateCode ? getVoterResources(stateCode).name : 'your area'} yet.
        </p>
      ) : (
        <div className="space-y-5">
          {awaitingBallot ? (
            <p className="rounded border border-amber-800/60 bg-amber-950/30 px-3 py-2 text-xs text-amber-200">
              The FEC hasn’t confirmed who is on the November ballot yet, so these lists can include
              candidates who lost a primary. They’re ordered by money raised.
            </p>
          ) : null}
          {ballotRaces.map((race) => (
            <BallotRace key={race.key} race={race} ballotUrl={ballotUrl} onSelectOfficial={onSelectOfficial} />
          ))}
          <p className="text-xs text-slate-500">
            “Full profile” has each candidate’s positions, voting record and campaign finance. These are your
            federal races{ballotSource ? ` (nominees per ${ballotSource})` : ''}; your ballot also
            has state and local contests
            {ballotUrl ? (
              <>
                {' '}
                (
                <a href={ballotUrl} target="_blank" rel="noopener noreferrer" className="underline hover:text-blue-300">
                  sample ballot
                </a>
                )
              </>
            ) : null}
            .
          </p>
        </div>
      )}
    </Section>
  )
}

function BallotRace({
  race,
  ballotUrl,
  onSelectOfficial,
}: {
  race: Race
  ballotUrl: string | null
  onSelectOfficial: (official: Official) => void
}) {
  const [showAll, setShowAll] = useState(false)
  const candidates = uniqueCandidates(race)
  const limit = race.ballot_filtered || showAll ? candidates.length : UNCONFIRMED_CANDIDATES_SHOWN
  const shown = candidates.slice(0, limit)
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1">
        <h4 className="text-sm font-semibold text-slate-200">{race.label}</h4>
        {race.ballot_complete ? null : <IncompleteRaceNote race={race} ballotUrl={ballotUrl} />}
      </div>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {shown.map((candidate) => (
          <li key={candidate.fec_candidate_id}>
            <BallotCandidateCard
              candidate={candidate}
              onOpenProfile={() => onSelectOfficial(officialFromRaceCandidate(candidate, race))}
            />
          </li>
        ))}
        {(race.unlisted_nominees ?? []).map((nominee) => (
          <li key={nominee.name}>
            <UnlistedNomineeCard nominee={nominee} />
          </li>
        ))}
      </ul>
      {candidates.length > shown.length || showAll ? (
        <button
          type="button"
          onClick={() => setShowAll(!showAll)}
          aria-expanded={showAll}
          className="mt-2 text-sm font-semibold text-blue-400 hover:text-blue-300"
        >
          {showAll ? 'Show fewer' : `Show all ${candidates.length} candidates`}
        </button>
      ) : null}
    </div>
  )
}

// Shown on any race whose list we can't vouch for as the whole ballot.
function IncompleteRaceNote({ race, ballotUrl }: { race: Race; ballotUrl: string | null }) {
  const [open, setOpen] = useState(false)
  const reason = incompleteRaceReason(race)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="inline-flex items-center gap-1 rounded-full border border-amber-800/60 px-2 py-0.5 text-[11px] font-medium text-amber-300 transition hover:text-amber-200"
      >
        <Info className="h-3 w-3" aria-hidden="true" />
        May be incomplete
      </button>
      {open ? (
        <p className="basis-full text-xs leading-relaxed text-slate-300">
          This list may not include everyone on your ballot for this race. {reason}{' '}
          {ballotUrl ? (
            <>
              Your{' '}
              <a href={ballotUrl} target="_blank" rel="noopener noreferrer" className="underline hover:text-blue-300">
                sample ballot
              </a>{' '}
              has the full list.
            </>
          ) : (
            'Your sample ballot has the full list.'
          )}
        </p>
      ) : null}
    </>
  )
}

function BeforeYouVote({ voterInfo, stateCode }: { voterInfo: VoterInfo | null; stateCode: string | null }) {
  const { links, office } = beforeYouVoteLinks(voterInfo, stateCode)

  return (
    <Section icon={<Check className="h-4 w-4 text-blue-400" aria-hidden="true" />} title="Before you vote">
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {links.map((link) => (
          <li key={link.label}>
            <a
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between gap-2 rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 transition hover:border-slate-500"
            >
              {link.label}
              <ExternalLink className="h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden="true" />
            </a>
          </li>
        ))}
      </ul>
      {office?.name ? (
        <p className="mt-3 text-xs text-slate-400">
          Questions? Contact {office.name}
          {office.phone ? (
            <>
              {' '}
              at{' '}
              <a href={`tel:${office.phone}`} className="text-slate-300 underline hover:text-blue-300">
                {office.phone}
              </a>
            </>
          ) : null}
          .
        </p>
      ) : null}
    </Section>
  )
}

function Section({
  icon,
  title,
  action,
  children,
}: {
  icon: ReactNode
  title: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="rounded-xl border border-slate-700 bg-slate-800/40 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-slate-300">
          {icon}
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  )
}

function LinkButton({
  onClick,
  expanded,
  children,
}: {
  onClick: () => void
  expanded?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={expanded}
      className="inline-flex items-center gap-0.5 text-sm font-semibold text-blue-400 hover:text-blue-300"
    >
      {children}
      <ChevronRight className="h-4 w-4" aria-hidden="true" />
    </button>
  )
}

function LinkTo({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="inline-flex items-center gap-0.5 text-sm font-semibold text-blue-400 hover:text-blue-300">
      {children}
      <ChevronRight className="h-4 w-4" aria-hidden="true" />
    </Link>
  )
}

// Who the candidate is and what they run on, readable without opening the drawer.
function BallotCandidateCard({
  candidate,
  onOpenProfile,
}: {
  candidate: RaceCandidate
  onOpenProfile: () => void
}) {
  const name = candidate.name ?? candidate.fec_candidate_id
  const party = candidate.party ?? ''
  const incumbent = incumbencyLabel(candidate.incumbent_challenge) === 'Incumbent'
  const background = candidateBackground(candidate)
  const issues = candidate.top_issues ?? []

  return (
    <article className="flex h-full flex-col rounded-lg border border-slate-700 bg-slate-800 p-3">
      <div className="flex items-center gap-3">
        <OfficialPhoto url={candidate.photo_url} name={name} party={party} />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {party ? (
              <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${partyBadgeClass(party)}`}>
                {partyShort(party)}
              </span>
            ) : null}
            <h5 className="truncate text-sm font-semibold">{name}</h5>
          </div>
          {incumbent ? (
            <span className="mt-1 inline-block rounded border border-amber-500/40 bg-amber-900/30 px-1.5 py-0.5 text-[10px] font-semibold text-amber-200">
              Incumbent
            </span>
          ) : null}
        </div>
      </div>

      {background.length > 0 ? <p className="mt-2 text-xs text-slate-400">{background.join(' · ')}</p> : null}

      <div className="mt-3 flex-1">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Running on</p>
        {issues.length > 0 ? (
          <>
            <ul className="mt-1 space-y-1.5">
              {issues.map((issue) => (
                <li key={issue.label} className="text-xs text-slate-300">
                  <span className="font-semibold text-slate-100">{issue.label}</span>
                  {issue.summary ? <span className="line-clamp-2">{issue.summary}</span> : null}
                </li>
              ))}
            </ul>
            <p className="mt-1.5 flex items-center gap-1 text-[10px] text-purple-300/80">
              <Sparkles className="h-3 w-3" aria-hidden="true" />
              AI summary of their campaign site
            </p>
          </>
        ) : (
          <p className="mt-1 text-xs text-slate-500">Candidate platform data has not been processed.</p>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-slate-700/60 pt-2 text-xs">
        {candidate.website_url ? (
          <a
            href={candidate.website_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 font-semibold text-blue-400 hover:text-blue-300"
          >
            Campaign site
            <ExternalLink className="h-3 w-3" aria-hidden="true" />
          </a>
        ) : null}
        {candidate.wikipedia_url ? (
          <a
            href={candidate.wikipedia_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-slate-400 hover:text-blue-300"
          >
            Wikipedia
            <ExternalLink className="h-3 w-3" aria-hidden="true" />
          </a>
        ) : null}
        <button
          type="button"
          onClick={onOpenProfile}
          aria-label={`Full profile: ${name}`}
          className="ml-auto inline-flex items-center gap-0.5 font-semibold text-slate-200 hover:text-blue-300"
        >
          Full profile
          <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
      {candidate.receipts ? (
        <p className="mt-1 text-[11px] text-slate-500">Raised {formatCompactMoney(candidate.receipts)}</p>
      ) : null}
    </article>
  )
}
