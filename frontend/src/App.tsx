import { Landmark } from 'lucide-react'
import { useEffect, useState } from 'react'

interface Official {
  id: string
  name: string
  state: string
  party: string
}

const PARTY_FILTERS = [
  { value: '', label: 'All' },
  { value: 'D', label: 'D' },
  { value: 'R', label: 'R' },
  { value: 'I', label: 'I' },
] as const

function partyBadgeClass(party: string) {
  if (party === 'Democratic' || party === 'D') {
    return 'bg-blue-900/60 text-blue-300'
  }
  if (party === 'Republican' || party === 'R') {
    return 'bg-red-900/60 text-red-300'
  }
  return 'bg-emerald-900/60 text-emerald-300'
}

function partyShort(party: string) {
  if (party === 'Democratic') return 'D'
  if (party === 'Republican') return 'R'
  if (party === 'Independent') return 'I'
  return party
}

export default function App() {
  const [officials, setOfficials] = useState<Official[]>([])
  const [filterParty, setFilterParty] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
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
  }, [filterParty])

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 p-8">
      <header className="max-w-6xl mx-auto mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <Landmark className="mt-1 h-7 w-7 text-blue-400" aria-hidden="true" />
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Politmus Explorer</h1>
            <p className="text-slate-400 text-sm mt-1">
              Congressional Roster & Legislation Feed
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          {PARTY_FILTERS.map(({ value, label }) => (
            <button
              key={label}
              type="button"
              onClick={() => setFilterParty(value)}
              className={`px-3 py-1.5 rounded text-xs font-semibold uppercase tracking-wider transition ${
                filterParty === value
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </header>

      <main className="max-w-6xl mx-auto">
        {loading ? (
          <p className="text-slate-400">Loading congressional roster...</p>
        ) : error ? (
          <p className="text-red-400">
            {error}. Start the API on port 8000 and refresh.
          </p>
        ) : officials.length === 0 ? (
          <p className="text-slate-400">No officials match this filter.</p>
        ) : (
          <>
            <p className="text-slate-400 text-sm mb-4">
              Showing {officials.length} member{officials.length === 1 ? '' : 's'}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {officials.map((official) => (
                <div
                  key={official.id}
                  className="bg-slate-800 border border-slate-700 p-4 rounded-lg shadow-sm"
                >
                  <div className="flex justify-between items-start">
                    <span
                      className={`text-xs px-2 py-0.5 rounded font-bold ${partyBadgeClass(official.party)}`}
                    >
                      {partyShort(official.party)}
                    </span>
                    <span className="text-xs text-slate-400">{official.state}</span>
                  </div>
                  <h3 className="text-base font-semibold mt-2">{official.name}</h3>
                  <p className="text-xs text-slate-500 mt-1 font-mono">{official.id}</p>
                </div>
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  )
}
