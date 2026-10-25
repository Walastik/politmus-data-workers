import { Search } from 'lucide-react'
import { useEffect, useState } from 'react'

import { apiUrl } from '../api'
import { formatCompactMoney, partyBarClass } from '../campaignFinance'
import {
  PARTY_FILTERS,
  STATE_OPTIONS,
  formatBillDate,
  incumbencyLabel,
  officialFromRaceCandidate,
  partyBadgeClass,
  partyShort,
  raceTitle,
  type BallotNominee,
  type Official,
  type Race,
  type RaceCandidate,
  type RacesPage,
} from '../types'
import OfficialPhoto from './OfficialPhoto'

const PAGE_SIZE = 20

const OFFICE_FILTERS = [
  { value: '', label: 'All' },
  { value: 'S', label: 'Senate' },
  { value: 'H', label: 'House' },
] as const

// Everyone running for Congress this cycle (fec_client.py candidates), grouped
// by race. Candidates open in the member drawer; members running again open
// their own roster entry.
export default function CandidatesPanel({
  onSelectOfficial,
}: {
  onSelectOfficial: (official: Official) => void
}) {
  const [filterState, setFilterState] = useState('')
  const [filterOffice, setFilterOffice] = useState('')
  const [filterParty, setFilterParty] = useState('')
  const [showAll, setShowAll] = useState(false)
  const [nameQuery, setNameQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [pages, setPages] = useState(1)
  const [page, setPage] = useState<RacesPage | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Any filter change starts the list over at one page.
  const resetting =
    <T,>(setter: (value: T) => void) =>
    (value: T) => {
      setter(value)
      setPages(1)
    }

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedQuery(nameQuery.trim())
      setPages(1)
    }, 200)
    return () => window.clearTimeout(timeout)
  }, [nameQuery])

  useEffect(() => {
    const controller = new AbortController()
    const params = new URLSearchParams({ limit: String(PAGE_SIZE * pages) })
    if (filterState) params.set('state', filterState)
    if (filterOffice) params.set('office', filterOffice)
    if (filterParty) params.set('party', filterParty)
    if (debouncedQuery) params.set('q', debouncedQuery)
    if (showAll) params.set('all', 'true')

    setLoading(true)
    setError(null)
    fetch(apiUrl(`/api/candidates/races?${params.toString()}`), { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`Failed to load candidates (${res.status})`)
        }
        return res.json() as Promise<RacesPage>
      })
      .then((data) => {
        setPage(data)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return
        }
        console.error(err)
        setError(err instanceof Error ? err.message : 'Failed to load candidates')
        setLoading(false)
      })
    return () => controller.abort()
  }, [debouncedQuery, filterOffice, filterParty, filterState, pages, showAll])

  const races = page?.items ?? []
  const electionDate = races[0] ? formatBillDate(races[0].election_date) : null
  const awaitingBallot = races.some((race) => !race.ballot_filtered)
  // States whose November ballot comes from services/ballot_nominees.py, not FEC.
  const curated = [
    ...new Map(
      races.filter((race) => race.ballot_source).map((race) => [race.state_name, race.ballot_source]),
    ),
  ]

  return (
    <div>
      <div className="mb-5 flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <FilterChips
            label="Office"
            options={OFFICE_FILTERS}
            value={filterOffice}
            onChange={resetting(setFilterOffice)}
          />
          <FilterChips
            label="Party"
            options={PARTY_FILTERS}
            value={filterParty}
            onChange={resetting(setFilterParty)}
          />
          <button
            type="button"
            onClick={() => resetting(setShowAll)(!showAll)}
            aria-pressed={showAll}
            className={`rounded px-3 py-1.5 text-xs font-semibold uppercase tracking-wider transition sm:ml-2 ${
              showAll ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            Show all filers
          </button>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <label className="relative block min-w-0 flex-1">
            <span className="sr-only">Search candidates by name</span>
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500"
              aria-hidden="true"
            />
            <input
              type="search"
              value={nameQuery}
              onChange={(event) => setNameQuery(event.target.value)}
              placeholder="Search candidates by name"
              className="w-full rounded border border-slate-700 bg-slate-800 py-2 pr-3 pl-9 text-sm text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
            />
          </label>
          <label className="sm:w-64">
            <span className="sr-only">Filter candidates by state</span>
            <select
              value={filterState}
              onChange={(event) => resetting(setFilterState)(event.target.value)}
              className="w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 focus:border-blue-500 focus:outline-none"
            >
              <option value="">All states</option>
              {STATE_OPTIONS.map((state) => (
                <option key={state.abbr} value={state.abbr}>
                  {state.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {error ? (
        <p className="text-red-400">{error}. Check that the API is reachable and refresh.</p>
      ) : !page && loading ? (
        <p className="text-slate-400">Loading candidates...</p>
      ) : races.length === 0 ? (
        <p className="text-slate-400">No races match this filter.</p>
      ) : (
        <>
          <p className="mb-1 text-sm text-slate-400">
            {page?.total_count} race{page?.total_count === 1 ? '' : 's'}
            {electionDate ? ` · General election ${electionDate}` : ''}
            {filterState ? '' : ' · Most expensive first'}
          </p>
          <p className="mb-4 text-xs text-slate-500">
            Source: {page?.source}.{' '}
            {awaitingBallot
              ? 'FEC does not record primary results, so until pre-general reports are in, races list everyone who raised at least $5,000, including candidates who lost a primary.'
              : 'Races list the campaigns that filed a pre-general report, the ones on the November ballot.'}
            {curated.map(([state, source]) => ` ${state} races list the November nominees (${source}).`)}
          </p>
          <div className="space-y-4">
            {races.map((race) => (
              <RaceCard key={race.key} race={race} showAll={showAll} onSelect={onSelectOfficial} />
            ))}
          </div>
          {page && races.length < page.total_count ? (
            <button
              type="button"
              disabled={loading}
              onClick={() => setPages(pages + 1)}
              className="mt-4 w-full rounded border border-slate-700 bg-slate-800 py-2 text-sm text-slate-300 transition hover:bg-slate-700 disabled:opacity-60"
            >
              {loading ? 'Loading…' : `Show more races (${page.total_count - races.length} left)`}
            </button>
          ) : null}
        </>
      )}
    </div>
  )
}

function FilterChips({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: readonly { value: string; label: string }[]
  value: string
  onChange: (value: string) => void
}) {
  return (
    <>
      <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">{label}</span>
      <div className="flex flex-wrap gap-2" role="group" aria-label={`Filter by ${label.toLowerCase()}`}>
        {options.map((option) => (
          <button
            key={option.label}
            type="button"
            aria-pressed={value === option.value}
            onClick={() => onChange(option.value)}
            className={`rounded px-3 py-1.5 text-xs font-semibold uppercase tracking-wider transition ${
              value === option.value
                ? 'bg-blue-600 text-white'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </>
  )
}

function RaceCard({
  race,
  showAll,
  onSelect,
}: {
  race: Race
  showAll: boolean
  onSelect: (official: Official) => void
}) {
  const top = Math.max(...race.candidates.map((candidate) => candidate.receipts ?? 0), 1)
  return (
    <section
      className="rounded-xl border border-slate-700 bg-slate-800/40 p-4"
      aria-label={raceTitle(race)}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-base font-semibold">{raceTitle(race)}</h3>
        <p className="text-xs text-slate-400">
          {formatCompactMoney(race.total_receipts)} raised by {race.candidates.length} candidate
          {race.candidates.length === 1 ? '' : 's'}
        </p>
      </div>
      <ul className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {race.candidates.map((candidate) => (
          <li key={candidate.fec_candidate_id}>
            <CandidateCard
              candidate={candidate}
              share={(candidate.receipts ?? 0) / top}
              showBallot={!race.ballot_filtered}
              onClick={() => onSelect(officialFromRaceCandidate(candidate, race))}
            />
          </li>
        ))}
        {(race.unlisted_nominees ?? []).map((nominee) => (
          <li key={nominee.name}>
            <UnlistedNomineeCard nominee={nominee} />
          </li>
        ))}
      </ul>
      {race.hidden_count > 0 && !showAll ? (
        <p className="mt-3 text-xs text-slate-500">
          {race.hidden_count} more filer{race.hidden_count === 1 ? '' : 's'} not shown
          {race.ballot_source
            ? ': not on the November ballot.'
            : race.ballot_filtered
              ? ': no pre-general report, so not on the November ballot.'
              : ': raised under $5,000.'}
        </p>
      ) : null}
    </section>
  )
}

function CandidateCard({
  candidate,
  share,
  showBallot,
  onClick,
}: {
  candidate: RaceCandidate
  share: number
  showBallot: boolean
  onClick: () => void
}) {
  const name = candidate.name ?? candidate.fec_candidate_id
  const party = candidate.party ?? ''
  const incumbency = incumbencyLabel(candidate.incumbent_challenge)
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-full w-full flex-col rounded-lg border border-slate-700 bg-slate-800 p-3 text-left transition hover:border-slate-500 hover:bg-slate-800/80"
    >
      <div className="flex items-center gap-3">
        <OfficialPhoto url={candidate.photo_url} name={name} party={party} />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {party ? (
              <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${partyBadgeClass(party)}`}>
                {partyShort(party)}
              </span>
            ) : null}
            <span className="truncate text-sm font-semibold">{name}</span>
          </div>
          <div className="mt-1 flex flex-wrap gap-1">
            {incumbency === 'Incumbent' ? <Tag tone="amber">Incumbent</Tag> : null}
            {candidate.current_member && incumbency !== 'Incumbent' ? (
              <Tag tone="slate">In Congress</Tag>
            ) : null}
            {showBallot && candidate.in_general_election ? (
              <Tag tone="emerald">On Nov. ballot</Tag>
            ) : null}
          </div>
        </div>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div>
          <dt className="text-slate-500">Raised</dt>
          <dd className="font-semibold tabular-nums text-slate-100">
            {formatCompactMoney(candidate.receipts)}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">Cash on hand</dt>
          <dd className="font-semibold tabular-nums text-slate-100">
            {formatCompactMoney(candidate.cash_on_hand)}
          </dd>
        </div>
      </dl>
      <div className="mt-2 h-1.5 overflow-hidden rounded bg-slate-900" aria-hidden="true">
        <div className={`h-full ${partyBarClass(party)}`} style={{ width: `${share * 100}%` }} />
      </div>
    </button>
  )
}

// A nominee on the hand-maintained ballot with no FEC filings, so no profile to open.
export function UnlistedNomineeCard({ nominee }: { nominee: BallotNominee }) {
  return (
    <div className="flex h-full flex-col rounded-lg border border-dashed border-slate-700 bg-slate-800/50 p-3">
      <div className="flex items-center gap-3">
        <OfficialPhoto url={null} name={nominee.name} party={nominee.party} />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${partyBadgeClass(nominee.party)}`}>
              {partyShort(nominee.party)}
            </span>
            <span className="truncate text-sm font-semibold">{nominee.name}</span>
          </div>
          <p className="mt-1 text-xs text-slate-500">No FEC filings, so no profile yet.</p>
        </div>
      </div>
    </div>
  )
}

function Tag({ tone, children }: { tone: 'amber' | 'emerald' | 'slate'; children: string }) {
  const tones = {
    amber: 'border-amber-500/40 bg-amber-900/30 text-amber-200',
    emerald: 'border-emerald-500/40 bg-emerald-900/30 text-emerald-200',
    slate: 'border-slate-600 bg-slate-900/60 text-slate-300',
  }
  return (
    <span className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${tones[tone]}`}>
      {children}
    </span>
  )
}
