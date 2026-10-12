import { Search, Users, Vote } from 'lucide-react'
import { useState, useEffect, useRef, type FormEvent } from 'react'
import { useUser } from '@clerk/clerk-react'

import { apiUrl } from './api'
import LookupResults from './LookupResults'
import MemberDrawer from './MemberDrawer'
import VotingLocations from './components/VotingLocations'
import type { CivicLookup, Official, VoterInfo } from './types'

function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value)

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])

  return debouncedValue
}

interface PhotonResult {
  formattedAddress: string
  coordinates: [number, number]
}

export default function AddressLookup() {
  const [address, setAddress] = useState('')
  const debouncedAddress = useDebounce(address, 300)
  const [suggestions, setSuggestions] = useState<PhotonResult[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [_coordinates, setCoordinates] = useState<[number, number] | null>(null)

  const [lookup, setLookup] = useState<CivicLookup | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedOfficial, setSelectedOfficial] = useState<Official | null>(null)
  const [hasAutoLoaded, setHasAutoLoaded] = useState(false)

  // Voter info state (independent from representative lookup)
  const [voterInfo, setVoterInfo] = useState<VoterInfo | null>(null)
  const [voterInfoLoading, setVoterInfoLoading] = useState(false)
  const [voterInfoError, setVoterInfoError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'representatives' | 'voting'>('representatives')
  const activeVoterInfoControllerRef = useRef<AbortController | null>(null)

  const { user, isLoaded: userLoaded } = useUser()
  const savedAddress = user?.unsafeMetadata?.savedAddress as string | undefined

  async function fetchVoterInfo(targetAddress: string, signal: AbortSignal) {
    try {
      const response = await fetch(apiUrl('/api/voter-info'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: targetAddress }),
        signal,
      })
      const data = await readJson(response)
      if (signal.aborted) {
        return
      }

      if (!response.ok) {
        setVoterInfo({
          uiState: 'unavailable',
          upstreamStatus: data?.upstreamStatus || `http_${response.status}`,
          election: null,
          mailOnly: false,
          pollingLocations: [],
          earlyVoteSites: [],
          dropOffLocations: [],
          adminBodies: { state: null, local: null },
          otherElections: [],
          fetchedAt: new Date().toISOString(),
          detail: apiDetail(data, `Voting info lookup failed (${response.status})`),
        })
        return
      }

      setVoterInfo(data as VoterInfo)
    } catch (err: unknown) {
      if (signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) {
        return
      }
      console.error('Voter info fetch failed', err)
      setVoterInfo({
        uiState: 'unavailable',
        upstreamStatus: 'network_error',
        election: null,
        mailOnly: false,
        pollingLocations: [],
        earlyVoteSites: [],
        dropOffLocations: [],
        adminBodies: { state: null, local: null },
        otherElections: [],
        fetchedAt: new Date().toISOString(),
        detail:
          err instanceof Error
            ? err.message
            : 'Could not reach the voting information service.',
      })
    } finally {
      if (!signal.aborted) {
        setVoterInfoLoading(false)
      }
    }
  }

  // Extract fetch logic into a standalone function
  async function performLookup(targetAddress: string) {
    const trimmed = targetAddress.trim()
    if (!trimmed) {
      setError('Enter a U.S. street address.')
      setLookup(null)
      setVoterInfo(null)
      return
    }

    setLoading(true)
    setError(null)
    setSelectedOfficial(null)

    // Reset voter-info state and abort any active prior voter-info request
    activeVoterInfoControllerRef.current?.abort()
    const voterController = new AbortController()
    activeVoterInfoControllerRef.current = voterController
    setVoterInfo(null)
    setVoterInfoLoading(true)
    setVoterInfoError(null)

    // Fire voter info concurrently without blocking representative lookup
    fetchVoterInfo(trimmed, voterController.signal)

    try {
      const response = await fetch(
        apiUrl(`/api/lookup?address=${encodeURIComponent(trimmed)}`),
      )
      const body = await readJson(response)
      if (!response.ok) {
        throw new Error(apiDetail(body, `Lookup failed (${response.status})`))
      }
      setLookup(body as CivicLookup)
    } catch (err: unknown) {
      console.error(err)
      setLookup(null)
      setError(
        err instanceof Error
          ? err.message
          : 'Could not look up that address. Try again.',
      )
    } finally {
      setLoading(false)
    }
  }


  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setShowSuggestions(false)
    await performLookup(address)
  }

  // Auto-load saved address when component mounts and user loads
  useEffect(() => {
    if (userLoaded && savedAddress && !hasAutoLoaded && !lookup && !loading) {
      setHasAutoLoaded(true)
      performLookup(savedAddress)
    }
  }, [userLoaded, savedAddress, hasAutoLoaded, lookup, loading])

  useEffect(() => {
    async function fetchSuggestions() {
      if (!debouncedAddress.trim()) {
        setSuggestions([])
        return
      }
      try {
        const res = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(debouncedAddress)}&countrycode=US&limit=5`)
        const data = await res.json()
        const parsed = (data.features || []).map((feature: any) => {
          const props = feature.properties
          const addressLine1 = [props.housenumber, props.street].filter(Boolean).join(' ')
          const parts = [
            addressLine1,
            props.city,
            props.state,
            props.postcode
          ].filter(Boolean)
          
          return {
            formattedAddress: parts.join(', '),
            coordinates: feature.geometry.coordinates
          }
        })
        setSuggestions(parsed)
      } catch (err) {
        console.error('Photon lookup failed', err)
      }
    }
    fetchSuggestions()
  }, [debouncedAddress])

  return (
    <div>
      <form
        onSubmit={onSubmit}
        className="flex flex-col gap-3 sm:flex-row"
        role="search"
      >
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">Street address</span>
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500"
            aria-hidden="true"
          />
          <input
            type="text"
            name="address"
            autoComplete="street-address"
            value={address}
            onChange={(event) => {
              setAddress(event.target.value)
              setShowSuggestions(true)
            }}
            onFocus={() => setShowSuggestions(true)}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
            placeholder="1600 Pennsylvania Avenue NW, Washington, DC"
            className="w-full rounded border border-slate-700 bg-slate-800 py-2 pr-3 pl-9 text-sm text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
          />
          {showSuggestions && suggestions.length > 0 && (
            <ul className="absolute z-10 w-full mt-1 bg-slate-800 border border-slate-700 rounded shadow-lg max-h-60 overflow-auto text-left">
              {suggestions.map((s, i) => (
                <li
                  key={i}
                  className="px-4 py-2 hover:bg-slate-700 cursor-pointer text-sm text-slate-100"
                  onClick={() => {
                    setAddress(s.formattedAddress)
                    setCoordinates(s.coordinates)
                    setShowSuggestions(false)
                    performLookup(s.formattedAddress)
                  }}
                >
                  {s.formattedAddress}
                </li>
              ))}
            </ul>
          )}
        </label>
        <button
          type="submit"
          disabled={loading}
          className="rounded bg-blue-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? 'Looking up…' : 'Find representatives'}
        </button>
      </form>

      <div className="mt-8" aria-live="polite">
        {error ? <p className="text-red-400">{error}</p> : null}
        {loading && !lookup ? (
          <p className="text-slate-400">Looking up that address…</p>
        ) : null}
        {lookup ? (
          <div>
            <div
              className="mb-6 flex border-b border-slate-700"
              role="tablist"
              aria-label="Address lookup results views"
            >
              <button
                type="button"
                role="tab"
                id="tab-representatives"
                aria-controls="panel-representatives"
                aria-selected={activeTab === 'representatives'}
                onClick={() => setActiveTab('representatives')}
                className={`inline-flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-semibold transition ${
                  activeTab === 'representatives'
                    ? 'border-blue-500 text-blue-400'
                    : 'border-transparent text-slate-400 hover:border-slate-600 hover:text-slate-200'
                }`}
              >
                <Users className="h-4 w-4" aria-hidden="true" />
                <span>Representatives</span>
              </button>
              <button
                type="button"
                role="tab"
                id="tab-voting"
                aria-controls="panel-voting"
                aria-selected={activeTab === 'voting'}
                onClick={() => setActiveTab('voting')}
                className={`inline-flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-semibold transition ${
                  activeTab === 'voting'
                    ? 'border-blue-500 text-blue-400'
                    : 'border-transparent text-slate-400 hover:border-slate-600 hover:text-slate-200'
                }`}
              >
                <Vote className="h-4 w-4" aria-hidden="true" />
                <span>Voting Locations</span>
                {voterInfoLoading && (
                  <span
                    className="h-2 w-2 rounded-full bg-blue-400 animate-pulse"
                    title="Loading voting info"
                  />
                )}
              </button>
            </div>

            <div
              id="panel-representatives"
              role="tabpanel"
              aria-labelledby="tab-representatives"
              hidden={activeTab !== 'representatives'}
            >
              {activeTab === 'representatives' && (
                <LookupResults
                  lookup={lookup}
                  onSelectOfficial={setSelectedOfficial}
                />
              )}
            </div>

            <div
              id="panel-voting"
              role="tabpanel"
              aria-labelledby="tab-voting"
              hidden={activeTab !== 'voting'}
            >
              {activeTab === 'voting' && (
                <VotingLocations
                  voterInfo={voterInfo}
                  loading={voterInfoLoading}
                  error={voterInfoError}
                  stateCode={lookup.normalized_input?.state}
                />
              )}
            </div>
          </div>
        ) : null}
      </div>


      {selectedOfficial ? (
        <MemberDrawer
          official={selectedOfficial}
          onClose={() => setSelectedOfficial(null)}
        />
      ) : null}
    </div>
  )
}

async function readJson(response: Response) {
  try {
    return await response.json()
  } catch {
    return null
  }
}

function apiDetail(body: unknown, fallback: string) {
  if (!body || typeof body !== 'object' || !('detail' in body)) {
    return fallback
  }
  const detail = (body as { detail: unknown }).detail
  if (typeof detail === 'string' && detail.trim()) {
    return detail
  }
  if (Array.isArray(detail) && detail[0] && typeof detail[0] === 'object') {
    const first = detail[0] as { msg?: unknown }
    if (typeof first.msg === 'string' && first.msg.trim()) {
      return first.msg
    }
  }
  return fallback
}
