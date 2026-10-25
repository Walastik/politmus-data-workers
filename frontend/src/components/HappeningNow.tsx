import {
  CalendarPlus,
  Check,
  ChevronRight,
  Clock,
  ExternalLink,
  MapPin,
  MapPinHouse,
  Navigation,
  Pencil,
  Search,
  Sparkles,
  Vote,
} from 'lucide-react'
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'

import { apiUrl } from '../api'
import { buildElectionIcs, downloadIcs, formatElectionDate } from '../calendar'
import {
  earlyVotingPhase,
  formatShortDate,
  getEarlyVotingWindow,
  localToday,
  nextCalendarElection,
  statesWithEarlyVotingOpen,
  type EarlyVotingInfo,
  type EarlyVotingPhase,
} from '../earlyVoting'
import { daysUntil } from '../feed'
import { splitPollingHours } from '../pollingHours'
import {
  getVoterResources,
  incumbencyLabel,
  officialFromRaceCandidate,
  partyBadgeClass,
  partyShort,
  type CivicLookup,
  type Official,
  type Race,
  type RaceCandidate,
  type RacesPage,
  type VoterInfo,
  type VoterLocation,
} from '../types'
import { sameAddress, useSavedAddress } from '../useSavedAddress'
import { directionsUrl, formatMiles, locationAddress, rankSites, type RankedSite } from '../votingSites'
import { formatCompactMoney } from '../campaignFinance'
import { UnlistedNomineeCard } from './CandidatesPanel'
import OfficialPhoto from './OfficialPhoto'

const CLOSEST_SITES_SHOWN = 3

type Load<T> = { status: 'idle' } | { status: 'loading' } | { status: 'error'; message: string } | { status: 'ok'; data: T }

// The landing view after sign-in: what's going on in the voter's election right
// now (early voting, Election Day), where to vote, and who is on the ballot.
export default function HappeningNow({
  onSelectOfficial,
  onSeeAllLocations,
  onSeeCandidates,
}: {
  onSelectOfficial: (official: Official) => void
  onSeeAllLocations: (address: string) => void
  onSeeCandidates: () => void
}) {
  const { isLoaded, canSave, savedAddress, saveAddress } = useSavedAddress()
  const [typedAddress, setTypedAddress] = useState<string | null>(null)
  const address = typedAddress ?? savedAddress
  const [editing, setEditing] = useState(false)

  const [lookup, setLookup] = useState<Load<CivicLookup>>({ status: 'idle' })
  const [voterInfo, setVoterInfo] = useState<Load<VoterInfo>>({ status: 'idle' })
  const [races, setRaces] = useState<Load<Race[]>>({ status: 'idle' })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!address) {
      setLookup({ status: 'idle' })
      setVoterInfo({ status: 'idle' })
      setRaces({ status: 'idle' })
      return
    }
    const controller = new AbortController()
    const { signal } = controller
    setLookup({ status: 'loading' })
    setVoterInfo({ status: 'loading' })
    setRaces({ status: 'loading' })

    async function load(target: string) {
      let state: string | null | undefined
      try {
        const data = await getJson<CivicLookup>(
          apiUrl(`/api/lookup?address=${encodeURIComponent(target)}`),
          { signal },
        )
        state = data.normalized_input?.state
        setLookup({ status: 'ok', data })
      } catch (err) {
        if (signal.aborted) return
        setLookup({ status: 'error', message: errorMessage(err, 'Could not look up that address.') })
      }

      // Both need the state from the lookup; they don't depend on each other.
      const voter = getJson<VoterInfo>(apiUrl('/api/voter-info'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: target, state: state || undefined }),
        signal,
      })
        .then((data) => setVoterInfo({ status: 'ok', data }))
        .catch((err) => {
          if (!signal.aborted) {
            setVoterInfo({ status: 'error', message: errorMessage(err, 'Voting locations are unavailable.') })
          }
        })
      const ballot = state
        ? getJson<RacesPage>(apiUrl(`/api/candidates/races?state=${encodeURIComponent(state)}&limit=100`), {
            signal,
          })
            .then((data) => setRaces({ status: 'ok', data: data.items ?? [] }))
            .catch((err) => {
              if (!signal.aborted) {
                setRaces({ status: 'error', message: errorMessage(err, 'Candidates are unavailable.') })
              }
            })
        : null
      if (!state) {
        setRaces({ status: 'error', message: 'We need your state to find your races.' })
      }
      await Promise.all([voter, ballot])
    }

    load(address)
    return () => controller.abort()
  }, [address])

  const lookupData = lookup.status === 'ok' ? lookup.data : null
  const voterData = voterInfo.status === 'ok' ? voterInfo.data : null
  const stateCode = lookupData?.normalized_input?.state ?? null
  const district = houseDistrict(lookupData)
  const today = localToday()
  const electionDate = voterData?.election?.date ?? nextCalendarElection(today)
  const window = getEarlyVotingWindow(stateCode, electionDate)
  const phase = window ? earlyVotingPhase(window, today) : null
  const ballotRaces =
    races.status === 'ok'
      ? races.data.filter((race) => race.office === 'S' || (race.office === 'H' && race.district === district))
      : []

  async function saveTypedAddress() {
    if (!typedAddress) return
    setSaving(true)
    try {
      await saveAddress(typedAddress)
      setTypedAddress(null)
    } catch (err) {
      console.error('Failed to save address:', err)
    } finally {
      setSaving(false)
    }
  }

  if (!isLoaded) {
    return <p className="text-slate-400">Loading…</p>
  }

  return (
    <div className="space-y-6">
      <ElectionHero
        electionDate={electionDate}
        electionName={voterData?.election?.name ?? null}
        stateCode={stateCode}
        window={window}
        phase={phase}
        today={today}
      />

      {!address || editing ? (
        <AddressPrompt
          initial={address ?? ''}
          hasAddress={Boolean(address)}
          onCancel={() => setEditing(false)}
          onSubmit={(next) => {
            setEditing(false)
            setTypedAddress(sameAddress(next, savedAddress) ? null : next)
          }}
        />
      ) : (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-slate-400">
          <span className="inline-flex items-center gap-1.5">
            <MapPinHouse className="h-4 w-4 text-slate-500" aria-hidden="true" />
            For <span className="font-medium text-slate-200">{address}</span>
            {district !== null && stateCode ? (
              <span className="text-slate-500">
                · {stateCode}-{district === 0 ? 'AL' : district}
              </span>
            ) : null}
          </span>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="inline-flex items-center gap-1 text-xs font-semibold text-blue-400 hover:text-blue-300"
          >
            <Pencil className="h-3 w-3" aria-hidden="true" />
            Change
          </button>
          {typedAddress && canSave ? (
            <button
              type="button"
              onClick={saveTypedAddress}
              disabled={saving}
              className="inline-flex items-center gap-1 text-xs font-semibold text-blue-400 hover:text-blue-300 disabled:opacity-60"
            >
              <Check className="h-3 w-3" aria-hidden="true" />
              {saving ? 'Saving…' : 'Save as my address'}
            </button>
          ) : null}
        </div>
      )}

      {lookup.status === 'error' ? <p className="text-red-400">{lookup.message}</p> : null}

      {address && lookup.status !== 'error' ? (
        <>
          <WhereToVote
            voterInfo={voterInfo}
            point={lookupData?.point ?? null}
            stateCode={stateCode}
            phase={phase}
            onSeeAll={() => onSeeAllLocations(address)}
          />
          <OnYourBallot
            races={races}
            ballotRaces={ballotRaces}
            stateCode={stateCode}
            ballotUrl={voterData?.adminBodies.local?.ballotInfoUrl ?? voterData?.adminBodies.state?.ballotInfoUrl ?? null}
            onSelectOfficial={onSelectOfficial}
            onSeeCandidates={onSeeCandidates}
          />
          <BeforeYouVote voterInfo={voterData} stateCode={stateCode} />
        </>
      ) : null}
    </div>
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
  const endLabel = window
    ? window.end === window.electionDate
      ? 'Election Day'
      : formatShortDate(window.end)
    : null
  const daysLeft = window ? daysUntil(window.end) : null

  let headline: string
  let detail: string | null = null
  if (window && phase?.phase === 'open') {
    headline = `Early voting is open in ${stateName}`
    detail = `Vote in person any day through ${endLabel}${
      daysLeft === 0 ? ' (today is the last day)' : daysLeft !== null ? ` · ${daysLeft + 1} days left` : ''
    }.`
  } else if (window && phase?.phase === 'upcoming') {
    headline = `Early voting in ${stateName} starts ${formatShortDate(window.start)}`
    detail = phase.daysUntil === 1 ? 'That’s tomorrow.' : `That’s in ${phase.daysUntil} days.`
  } else if (window && phase?.phase === 'ended') {
    headline = `Early voting in ${stateName} has ended`
    detail = 'You can still vote at your polling place on Election Day.'
  } else if (openStates.length > 0) {
    headline = `Early voting is open in ${openStates.length} states`
    detail = 'Add your address to see your dates, closest voting sites and who is on your ballot.'
  } else {
    headline = electionName ?? 'Election Day is coming up'
  }

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
            {daysToElection !== null && daysToElection >= 0 ? (
              <p className="text-sm font-semibold text-blue-300">
                {daysToElection === 0 ? 'Today' : daysToElection === 1 ? 'Tomorrow' : `${daysToElection} days away`}
              </p>
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

function AddressPrompt({
  initial,
  hasAddress,
  onSubmit,
  onCancel,
}: {
  initial: string
  hasAddress: boolean
  onSubmit: (address: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState(initial)
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (value.trim()) onSubmit(value.trim())
  }
  return (
    <section className="rounded-xl border border-blue-900/60 bg-blue-950/20 p-4">
      {hasAddress ? null : (
        <p className="mb-3 text-sm text-slate-300">
          Enter your address to see your closest voting locations and the candidates on your ballot.
        </p>
      )}
      <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row" role="search">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">Your street address</span>
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500"
            aria-hidden="true"
          />
          <input
            type="text"
            autoComplete="street-address"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="1100 Congress Ave, Austin, TX 78701"
            className="w-full rounded border border-slate-700 bg-slate-800 py-2 pr-3 pl-9 text-sm text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
          />
        </label>
        <button
          type="submit"
          className="rounded bg-blue-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-blue-500"
        >
          Show my election
        </button>
        {hasAddress ? (
          <button
            type="button"
            onClick={onCancel}
            className="rounded border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800"
          >
            Cancel
          </button>
        ) : null}
      </form>
      <p className="mt-2 text-xs text-slate-500">
        Your address is sent to the Census geocoder and Google’s Civic Information API to find your
        districts and voting sites.
      </p>
    </section>
  )
}

function WhereToVote({
  voterInfo,
  point,
  stateCode,
  phase,
  onSeeAll,
}: {
  voterInfo: Load<VoterInfo>
  point: { lat: number; lon: number } | null
  stateCode: string | null
  phase: EarlyVotingPhase | null
  onSeeAll: () => void
}) {
  const resources = getVoterResources(stateCode)
  const data = voterInfo.status === 'ok' ? voterInfo.data : null
  // Early voting sites while early voting is on (or ahead); Election Day
  // polling places once it's over or when no early sites are listed.
  const preferEarly = phase?.phase !== 'ended'
  const early = data?.earlyVoteSites ?? []
  const polling = data?.pollingLocations ?? []
  const [kind, locations]: ['early' | 'polling', VoterLocation[]] =
    preferEarly && early.length > 0
      ? ['early', early]
      : polling.length > 0
        ? ['polling', polling]
        : ['early', early]
  const ranked = rankSites(locations, point)
  const shown = ranked.slice(0, CLOSEST_SITES_SHOWN)
  const sorted = shown.some((site) => site.miles !== null)
  const totalSites = early.length + polling.length + (data?.dropOffLocations.length ?? 0)

  const title = kind === 'early' ? 'Early voting sites' : 'Election Day polling places'

  return (
    <Section
      icon={<MapPin className="h-4 w-4 text-blue-400" aria-hidden="true" />}
      title={sorted ? `Closest ${title.toLowerCase()}` : title}
      action={
        data && data.uiState !== 'unavailable' ? (
          <LinkButton onClick={onSeeAll}>
            {totalSites > 0 ? `See all ${totalSites} locations` : 'Voting details'}
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
          message={
            data?.mailOnly
              ? `${resources.name} votes by mail. Return your ballot by mail or at a drop-off site.`
              : `${resources.name} hasn’t published voting sites for your address to Google yet.`
          }
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
          {ranked.length > shown.length ? (
            <p className="mt-2 text-xs text-slate-500">
              {sorted
                ? `By straight-line distance from your address. ${ranked.length - shown.length} more ${
                    kind === 'early' ? 'early voting sites' : 'polling places'
                  } nearby.`
                : `Showing ${shown.length} of ${ranked.length}.`}
            </p>
          ) : null}
        </>
      )}
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
  onSeeCandidates,
}: {
  races: Load<Race[]>
  ballotRaces: Race[]
  stateCode: string | null
  ballotUrl: string | null
  onSelectOfficial: (official: Official) => void
  onSeeCandidates: () => void
}) {
  const awaitingBallot = ballotRaces.some((race) => !race.ballot_filtered)
  const ballotSource = ballotRaces.find((race) => race.ballot_source)?.ballot_source
  return (
    <Section
      icon={<Vote className="h-4 w-4 text-blue-400" aria-hidden="true" />}
      title="On your ballot"
      action={<LinkButton onClick={onSeeCandidates}>All candidates</LinkButton>}
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
            <BallotRace key={race.key} race={race} onSelectOfficial={onSelectOfficial} />
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

// Candidates per race before "Show all", while the ballot isn't confirmed and a
// race can still list a dozen primary candidates.
const UNCONFIRMED_CANDIDATES_SHOWN = 6

function BallotRace({ race, onSelectOfficial }: { race: Race; onSelectOfficial: (official: Official) => void }) {
  const [showAll, setShowAll] = useState(false)
  // FEC sometimes lists one campaign under two candidate IDs; show it once.
  const seen = new Set<string>()
  const candidates = race.candidates.filter((candidate) => {
    const key = `${(candidate.name ?? candidate.fec_candidate_id).toLowerCase()}|${candidate.party ?? ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  const limit = race.ballot_filtered || showAll ? candidates.length : UNCONFIRMED_CANDIDATES_SHOWN
  const shown = candidates.slice(0, limit)
  return (
    <div>
      <h4 className="mb-2 text-sm font-semibold text-slate-200">{race.label}</h4>
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

function BeforeYouVote({ voterInfo, stateCode }: { voterInfo: VoterInfo | null; stateCode: string | null }) {
  const resources = getVoterResources(stateCode)
  const local = voterInfo?.adminBodies.local
  const state = voterInfo?.adminBodies.state
  const links = [
    {
      label: 'Check that you’re registered',
      url:
        local?.electionRegistrationConfirmationUrl ??
        state?.electionRegistrationConfirmationUrl ??
        resources.registrationStatusUrl ??
        resources.checkRegistrationUrl,
    },
    { label: 'See your sample ballot', url: local?.ballotInfoUrl ?? state?.ballotInfoUrl ?? null },
    {
      label: 'Official polling place lookup',
      url: local?.votingLocationFinderUrl ?? state?.votingLocationFinderUrl ?? resources.pollingPlaceUrl ?? null,
    },
    { label: 'Voting by mail', url: local?.absenteeVotingInfoUrl ?? state?.absenteeVotingInfoUrl ?? null },
  ].filter((link): link is { label: string; url: string } => Boolean(link.url))
  const office = local ?? state

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

function LinkButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-0.5 text-sm font-semibold text-blue-400 hover:text-blue-300"
    >
      {children}
      <ChevronRight className="h-4 w-4" aria-hidden="true" />
    </button>
  )
}

// The House district from the lookup's divisions (".../cd:7"; 0 is at-large).
function houseDistrict(lookup: CivicLookup | null): number | null {
  for (const division of lookup?.divisions ?? []) {
    const match = /\/cd:(\d+)$/.exec(division.ocd_id)
    if (match) return Number(match[1])
  }
  return null
}

async function getJson<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  let body: unknown = null
  try {
    body = await response.json()
  } catch {
    // fall through to the status check
  }
  if (!response.ok) {
    const detail = body && typeof body === 'object' && 'detail' in body ? (body as { detail: unknown }).detail : null
    throw new Error(typeof detail === 'string' && detail ? detail : `Request failed (${response.status})`)
  }
  return body as T
}

function errorMessage(err: unknown, fallback: string) {
  return err instanceof Error && err.message ? err.message : fallback
}

// Occupations too generic to tell a voter anything.
const GENERIC_BACKGROUND = new Set(['politician'])

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
  const background = (candidate.background ?? [])
    .filter((item) => !GENERIC_BACKGROUND.has(item.toLowerCase()))
    .slice(0, 2)
    .map((item) => item.charAt(0).toUpperCase() + item.slice(1))
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
