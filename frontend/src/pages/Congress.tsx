import { SignedIn } from '@clerk/clerk-react'
import { ChevronDown, ChevronRight, Search, Sparkles } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import { apiUrl } from '../api'
import MemberCard, { partyFillClass } from '../components/MemberCard'
import PageHeader, { PageContainer } from '../components/PageHeader'
import PositionsProgressPanel from '../components/PositionsProgressPanel'
import {
  PARTY_FILTERS,
  ROSTER_STATUS_FILTERS,
  STATE_OPTIONS,
  officialName,
  partyShort,
  type Official,
  type RosterStatusFilter,
} from '../types'
import { useDrawerLinks } from '../useDrawerLinks'

type View = 'senate' | 'house' | 'list'
const VIEWS: { key: View; label: string }[] = [
  { key: 'senate', label: 'Senate' },
  { key: 'house', label: 'House' },
  { key: 'list', label: 'All members' },
]
const NON_VOTING_OFFICES = new Set(['Delegate', 'Resident Commissioner'])
const PARTY_ORDER = ['D', 'I', 'R']

type Load<T> = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ok'; data: T }

export default function Congress() {
  const { openOfficial } = useDrawerLinks()
  const [searchParams, setSearchParams] = useSearchParams()
  const rawView = searchParams.get('view')
  const view: View = VIEWS.some((v) => v.key === rawView) ? (rawView as View) : 'senate'
  const [party, setParty] = useState('')
  const [stateName, setStateName] = useState('')
  const [nameQuery, setNameQuery] = useState('')
  const query = useDebounced(nameQuery.trim(), 200)
  const members = useCurrentMembers()

  function setView(next: View) {
    const params = new URLSearchParams(searchParams)
    params.set('view', next)
    params.delete('official')
    params.delete('bill')
    setSearchParams(params)
  }

  const current = members.status === 'ok' ? members.data : []
  const senators = current.filter((m) => m.office === 'Senator')
  const house = current.filter((m) => m.office !== 'Senator')
  const matches = (m: Official) =>
    (!party || partyShort(m.party) === party) &&
    (!stateName || m.state === stateName) &&
    (!query || officialName(m).toLowerCase().includes(query.toLowerCase()) || m.name.toLowerCase().includes(query.toLowerCase()))

  return (
    <PageContainer>
      <PageHeader
        title="Congress"
        description={
          <>
            Every current member of the Senate and House, with their Politmus Score. Running this cycle?{' '}
            <Link to="/candidates" className="text-blue-400 hover:text-blue-300">
              See the candidates
            </Link>
            .
          </>
        }
      />

      {members.status === 'ok' ? (
        <div className="mb-6 grid grid-cols-1 gap-3 md:grid-cols-2">
          <ChamberSummary title="Senate" members={senators} />
          <ChamberSummary
            title="House"
            members={house.filter((m) => !NON_VOTING_OFFICES.has(m.office ?? ''))}
            note={`plus ${house.filter((m) => NON_VOTING_OFFICES.has(m.office ?? '')).length} non-voting delegates`}
          />
        </div>
      ) : null}

      <div className="mb-4 flex flex-col gap-3">
        <div className="inline-flex self-start rounded-lg border border-slate-700 bg-slate-800/60 p-1" role="tablist" aria-label="Congress views">
          {VIEWS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={view === key}
              onClick={() => setView(key)}
              className={`rounded-md px-4 py-1.5 text-sm font-medium transition ${
                view === key ? 'bg-blue-600 text-white' : 'text-slate-300 hover:text-white'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <Filters
          party={party}
          onParty={setParty}
          stateName={stateName}
          onState={setStateName}
          nameQuery={nameQuery}
          onNameQuery={setNameQuery}
        />
      </div>

      {view === 'list' ? (
        <MemberList party={party} stateName={stateName} query={query} onSelect={openOfficial} />
      ) : members.status === 'loading' ? (
        <p className="text-slate-400">Loading Congress…</p>
      ) : members.status === 'error' ? (
        <p className="text-red-400">{members.message}. Check that the API is reachable and refresh.</p>
      ) : view === 'senate' ? (
        <SenateView members={senators.filter(matches)} onSelect={openOfficial} />
      ) : (
        <HouseView members={house.filter(matches)} expandAll={Boolean(stateName || query)} onSelect={openOfficial} />
      )}
    </PageContainer>
  )
}

function useCurrentMembers(): Load<Official[]> {
  const [load, setLoad] = useState<Load<Official[]>>({ status: 'loading' })
  useEffect(() => {
    const controller = new AbortController()
    fetchOfficials(new URLSearchParams({ level: 'federal', current_member: 'true' }), controller.signal)
      .then((data) => setLoad({ status: 'ok', data }))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        setLoad({ status: 'error', message: err instanceof Error ? err.message : 'Failed to load Congress' })
      })
    return () => controller.abort()
  }, [])
  return load
}

async function fetchOfficials(params: URLSearchParams, signal: AbortSignal): Promise<Official[]> {
  const res = await fetch(apiUrl(`/api/officials?${params.toString()}`), { signal })
  if (!res.ok) {
    throw new Error(`Failed to load officials (${res.status})`)
  }
  const data = await res.json()
  return Array.isArray(data) ? data : []
}

function ChamberSummary({ title, members, note }: { title: string; members: Official[]; note?: string }) {
  const counts = { D: 0, R: 0, I: 0 }
  for (const member of members) {
    const key = partyShort(member.party) as keyof typeof counts
    counts[key in counts ? key : 'I'] += 1
  }
  const total = members.length || 1
  const scored = members.filter((m) => m.score_matches).length
  const segments = [
    { key: 'D', label: 'Democrat', count: counts.D, bar: 'bg-blue-500', text: 'text-blue-300' },
    { key: 'I', label: 'Independent', count: counts.I, bar: 'bg-emerald-500', text: 'text-emerald-300' },
    { key: 'R', label: 'Republican', count: counts.R, bar: 'bg-red-500', text: 'text-red-300' },
  ]
  return (
    <section className="rounded-xl border border-slate-700 bg-slate-800/40 p-4" aria-label={`${title} makeup`}>
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300">{title}</h2>
        <p className="text-xs text-slate-500">
          {members.length} members{note ? ` · ${note}` : ''}
        </p>
      </div>
      <div className="mt-3 flex h-3 overflow-hidden rounded-full bg-slate-700" aria-hidden="true">
        {segments.map((s) =>
          s.count ? <div key={s.key} className={s.bar} style={{ width: `${(s.count / total) * 100}%` }} /> : null,
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {segments.map((s) =>
          s.count ? (
            <span key={s.key} className={s.text}>
              <span className="font-semibold tabular-nums">{s.count}</span> {s.label}
              {s.count === 1 ? '' : 's'}
            </span>
          ) : null,
        )}
      </div>
      <p className="mt-2 text-xs text-slate-500">
        {scored} of {members.length} have a Politmus Score so far.
      </p>
    </section>
  )
}

function Filters({
  party,
  onParty,
  stateName,
  onState,
  nameQuery,
  onNameQuery,
}: {
  party: string
  onParty: (value: string) => void
  stateName: string
  onState: (value: string) => void
  nameQuery: string
  onNameQuery: (value: string) => void
}) {
  return (
    <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
      <label className="relative block min-w-0 flex-1">
        <span className="sr-only">Search members by name</span>
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500"
          aria-hidden="true"
        />
        <input
          type="search"
          value={nameQuery}
          onChange={(event) => onNameQuery(event.target.value)}
          placeholder="Search by name"
          className="w-full rounded-md border border-slate-700 bg-slate-800 py-2 pr-3 pl-9 text-sm text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
        />
      </label>
      <label className="lg:w-56">
        <span className="sr-only">Filter by state</span>
        <select
          value={stateName}
          onChange={(event) => onState(event.target.value)}
          className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 focus:border-blue-500 focus:outline-none"
        >
          <option value="">All states</option>
          {STATE_OPTIONS.map((state) => (
            <option key={state.abbr} value={state.name}>
              {state.name}
            </option>
          ))}
        </select>
      </label>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by party">
        {PARTY_FILTERS.map(({ value, label }) => (
          <Chip key={label} active={party === value} onClick={() => onParty(value)}>
            {label}
          </Chip>
        ))}
      </div>
    </div>
  )
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold uppercase tracking-wider transition ${
        active ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
      }`}
    >
      {children}
    </button>
  )
}

function byState(members: Official[]) {
  const groups = new Map<string, Official[]>()
  for (const member of members) {
    const list = groups.get(member.state) ?? []
    list.push(member)
    groups.set(member.state, list)
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))
}

function SenateView({ members, onSelect }: { members: Official[]; onSelect: (official: Official) => void }) {
  if (members.length === 0) return <p className="text-slate-400">No senators match these filters.</p>
  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {byState(members).map(([state, senators]) => (
        <li key={state} className="rounded-lg border border-slate-700 bg-slate-800/40 p-3">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">{state}</h3>
          <div className="space-y-1.5">
            {senators.map((senator) => (
              <MemberCard key={senator.id} official={senator} onSelect={onSelect} variant="compact" />
            ))}
          </div>
        </li>
      ))}
    </ul>
  )
}

function districtLabel(member: Official) {
  if (NON_VOTING_OFFICES.has(member.office ?? '')) return member.office ?? 'Delegate'
  return !member.district || member.district === 98 ? 'At-large' : `District ${member.district}`
}

function HouseView({
  members,
  expandAll,
  onSelect,
}: {
  members: Official[]
  expandAll: boolean
  onSelect: (official: Official) => void
}) {
  const [open, setOpen] = useState<Set<string>>(new Set())
  if (members.length === 0) return <p className="text-slate-400">No House members match these filters.</p>
  const groups = byState(members)
  const allOpen = expandAll || groups.every(([state]) => open.has(state))

  return (
    <div>
      <div className="mb-2 flex justify-end">
        {expandAll ? null : (
          <button
            type="button"
            onClick={() => setOpen(allOpen ? new Set() : new Set(groups.map(([state]) => state)))}
            className="text-sm font-semibold text-blue-400 hover:text-blue-300"
          >
            {allOpen ? 'Collapse all' : 'Expand all'}
          </button>
        )}
      </div>
      <ul className="divide-y divide-slate-800 rounded-lg border border-slate-700 bg-slate-800/30">
        {groups.map(([state, delegation]) => {
          const isOpen = expandAll || open.has(state)
          const sorted = [...delegation].sort((a, b) => (a.district ?? 0) - (b.district ?? 0))
          const counts = ['D', 'R', 'I']
            .map((p) => [p, delegation.filter((m) => partyShort(m.party) === p).length] as const)
            .filter(([, n]) => n > 0)
          return (
            <li key={state}>
              <button
                type="button"
                aria-expanded={isOpen}
                onClick={() =>
                  setOpen((current) => {
                    const next = new Set(current)
                    if (next.has(state)) next.delete(state)
                    else next.add(state)
                    return next
                  })
                }
                className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-slate-800/60"
              >
                {isOpen ? (
                  <ChevronDown className="h-4 w-4 text-slate-500" aria-hidden="true" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-slate-500" aria-hidden="true" />
                )}
                <span className="flex-1 font-medium text-slate-100">{state}</span>
                <span className="hidden gap-0.5 sm:flex" aria-hidden="true">
                  {[...delegation]
                    .sort((a, b) => PARTY_ORDER.indexOf(partyShort(a.party)) - PARTY_ORDER.indexOf(partyShort(b.party)))
                    .map((m) => (
                      <span key={m.id} className={`h-3 w-1.5 rounded-sm ${partyFillClass(m.party)}`} />
                    ))}
                </span>
                <span className="w-36 shrink-0 whitespace-nowrap text-right text-xs text-slate-400">
                  {delegation.length} seat{delegation.length === 1 ? '' : 's'} ·{' '}
                  {counts.map(([p, n]) => `${n}${p}`).join(' ')}
                </span>
              </button>
              {isOpen ? (
                <div className="grid grid-cols-1 gap-1.5 px-4 pb-4 sm:grid-cols-2 lg:grid-cols-3">
                  {sorted.map((member) => (
                    <MemberCard
                      key={member.id}
                      official={member}
                      onSelect={onSelect}
                      variant="compact"
                      subtitle={districtLabel(member)}
                    />
                  ))}
                </div>
              ) : null}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

type SortKey = 'name' | 'score'

// The searchable roster: current or former members, filtered on the server.
function MemberList({
  party,
  stateName,
  query,
  onSelect,
}: {
  party: string
  stateName: string
  query: string
  onSelect: (official: Official) => void
}) {
  const [status, setStatus] = useState<RosterStatusFilter>('active')
  const [hasPositionsOnly, setHasPositionsOnly] = useState(false)
  const [sort, setSort] = useState<SortKey>('name')
  const [load, setLoad] = useState<Load<Official[]>>({ status: 'loading' })

  useEffect(() => {
    const controller = new AbortController()
    const params = new URLSearchParams()
    if (status === 'active') params.set('current_member', 'true')
    else if (status === 'former') params.set('current_member', 'false')
    params.set('level', 'federal')
    if (party) params.set('party', party)
    if (stateName) params.set('state', stateName)
    if (query) params.set('q', query)
    setLoad({ status: 'loading' })
    fetchOfficials(params, controller.signal)
      .then((data) => setLoad({ status: 'ok', data }))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        console.error(err)
        setLoad({ status: 'error', message: err instanceof Error ? err.message : 'Failed to load congressional roster' })
      })
    return () => controller.abort()
  }, [party, query, stateName, status])

  const visible = useMemo(() => {
    const rows = load.status === 'ok' ? load.data : []
    const filtered = hasPositionsOnly ? rows.filter((m) => m.positions_status === 'ok') : rows
    if (sort === 'name') return filtered
    return [...filtered].sort(
      (a, b) =>
        (b.score_matches ? 1 : 0) - (a.score_matches ? 1 : 0) ||
        (b.score_pct ?? -1) - (a.score_pct ?? -1) ||
        (b.score_points ?? 0) - (a.score_points ?? 0),
    )
  }, [hasPositionsOnly, load, sort])

  return (
    <div>
      <SignedIn>
        <PositionsProgressPanel onSelectOfficial={onSelect} />
      </SignedIn>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by member status">
          {ROSTER_STATUS_FILTERS.map(({ value, label }) => (
            <Chip key={value} active={status === value} onClick={() => setStatus(value)}>
              {label}
            </Chip>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setHasPositionsOnly(!hasPositionsOnly)}
          aria-pressed={hasPositionsOnly}
          className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold uppercase tracking-wider transition ${
            hasPositionsOnly ? 'bg-purple-600 text-white' : 'bg-slate-800 text-purple-300 hover:bg-slate-700'
          }`}
        >
          <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
          Has AI positions
        </button>
        <label className="ml-auto flex items-center gap-2 text-xs text-slate-400">
          Sort
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value as SortKey)}
            className="rounded-md border border-slate-700 bg-slate-800 px-2 py-1.5 text-sm text-slate-100 focus:border-blue-500 focus:outline-none"
          >
            <option value="name">Name</option>
            <option value="score">Politmus Score</option>
          </select>
        </label>
      </div>
      {load.status === 'loading' ? (
        <p className="text-slate-400">Loading congressional roster...</p>
      ) : load.status === 'error' ? (
        <p className="text-red-400">{load.message}. Check that the API is reachable and refresh.</p>
      ) : visible.length === 0 ? (
        <p className="text-slate-400">No officials match this filter.</p>
      ) : (
        <>
          <p className="mb-4 text-sm text-slate-400">
            Showing {visible.length} member{visible.length === 1 ? '' : 's'}
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {visible.map((official) => (
              <MemberCard key={official.id} official={official} onSelect={onSelect} showStatus={status !== 'active'} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay)
    return () => window.clearTimeout(timer)
  }, [value, delay])
  return debounced
}
