import { Landmark, ScrollText, Users } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'

import BillsFeed from './BillsFeed'
import MemberDrawer from './MemberDrawer'
import {
  PARTY_FILTERS,
  partyBadgeClass,
  partyShort,
  type Official,
} from './types'

type Tab = 'roster' | 'bills'

export default function App() {
  const [tab, setTab] = useState<Tab>('roster')
  const [officials, setOfficials] = useState<Official[]>([])
  const [filterParty, setFilterParty] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedOfficial, setSelectedOfficial] = useState<Official | null>(null)

  useEffect(() => {
    if (tab !== 'roster') {
      return
    }

    const controller = new AbortController()
    const params = new URLSearchParams()
    if (filterParty) {
      params.set('party', filterParty)
    }
    const query = params.toString()
    const url = query ? `/api/officials?${query}` : '/api/officials'

    setLoading(true)
    setError(null)

    fetch(url, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`Failed to load officials (${res.status})`)
        }
        return res.json() as Promise<Official[]>
      })
      .then((data) => {
        setOfficials(Array.isArray(data) ? data : [])
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return
        }
        console.error(err)
        setError(
          err instanceof Error
            ? err.message
            : 'Failed to load congressional roster',
        )
        setOfficials([])
        setLoading(false)
      })

    return () => controller.abort()
  }, [filterParty, tab])

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 p-8">
      <header className="mx-auto mb-8 max-w-6xl">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <Landmark className="mt-1 h-7 w-7 text-blue-400" aria-hidden="true" />
            <div>
              <h1 className="text-3xl font-bold tracking-tight">Politmus Explorer</h1>
              <p className="mt-1 text-sm text-slate-400">
                Congressional Roster & Legislation Feed
              </p>
            </div>
          </div>
          <nav className="flex gap-2" aria-label="Primary">
            <TabButton
              active={tab === 'roster'}
              icon={<Users className="h-3.5 w-3.5" />}
              label="Roster"
              onClick={() => setTab('roster')}
            />
            <TabButton
              active={tab === 'bills'}
              icon={<ScrollText className="h-3.5 w-3.5" />}
              label="Bills"
              onClick={() => {
                setSelectedOfficial(null)
                setTab('bills')
              }}
            />
          </nav>
        </div>

        {tab === 'roster' ? (
          <div className="mt-4 flex gap-2">
            {PARTY_FILTERS.map(({ value, label }) => (
              <button
                key={label}
                type="button"
                onClick={() => setFilterParty(value)}
                className={`rounded px-3 py-1.5 text-xs font-semibold uppercase tracking-wider transition ${
                  filterParty === value
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        ) : null}
      </header>

      <main className="mx-auto max-w-6xl">
        {tab === 'bills' ? (
          <BillsFeed />
        ) : loading ? (
          <p className="text-slate-400">Loading congressional roster...</p>
        ) : error ? (
          <p className="text-red-400">
            {error}. Start the API on port 8000 and refresh.
          </p>
        ) : officials.length === 0 ? (
          <p className="text-slate-400">No officials match this filter.</p>
        ) : (
          <>
            <p className="mb-4 text-sm text-slate-400">
              Showing {officials.length} member{officials.length === 1 ? '' : 's'}
            </p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
              {officials.map((official) => (
                <button
                  key={official.id}
                  type="button"
                  onClick={() => setSelectedOfficial(official)}
                  className="rounded-lg border border-slate-700 bg-slate-800 p-4 text-left shadow-sm transition hover:border-slate-500 hover:bg-slate-800/80"
                >
                  <div className="flex items-start justify-between">
                    <span
                      className={`rounded px-2 py-0.5 text-xs font-bold ${partyBadgeClass(official.party)}`}
                    >
                      {partyShort(official.party)}
                    </span>
                    <span className="text-xs text-slate-400">{official.state}</span>
                  </div>
                  <h3 className="mt-2 text-base font-semibold">{official.name}</h3>
                  <p className="mt-1 font-mono text-xs text-slate-500">{official.id}</p>
                </button>
              ))}
            </div>
          </>
        )}
      </main>

      {selectedOfficial ? (
        <MemberDrawer
          official={selectedOfficial}
          onClose={() => setSelectedOfficial(null)}
        />
      ) : null}
    </div>
  )
}

function TabButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean
  icon: ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-semibold uppercase tracking-wider transition ${
        active
          ? 'bg-blue-600 text-white'
          : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
      }`}
    >
      {icon}
      {label}
    </button>
  )
}
