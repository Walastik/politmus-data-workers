import { Check, LocateFixed, MapPinHouse, Search, Users, Vote } from 'lucide-react'
import { useState, useEffect, useRef, type FormEvent, type KeyboardEvent } from 'react'

import { apiUrl } from './api'
import LookupResults from './LookupResults'
import VotingLocations from './components/VotingLocations'
import type { CivicLookup, Official, VoterInfo } from './types'
import { sameAddress, useSavedAddress } from './useSavedAddress'

function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value)

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])

  return debouncedValue
}

type Tab = 'representatives' | 'voting'

interface PhotonResult {
  formattedAddress: string
  coordinates: [number, number]
}

interface Point {
  lat: number
  lon: number
}

const CURRENT_LOCATION_LABEL = 'your current location'
const REVERSE_GEOCODE_TIMEOUT_MS = 5000

function formatPhotonFeature(feature: any): PhotonResult {
  const props = feature.properties
  const addressLine1 = [props.housenumber, props.street].filter(Boolean).join(' ')
  const parts = [addressLine1, props.city, props.state, props.postcode].filter(Boolean)
  return {
    formattedAddress: parts.join(', '),
    coordinates: feature.geometry.coordinates,
  }
}

// ~1 m precision is plenty for district lookup and avoids sending more than needed.
function roundCoordinate(value: number) {
  return Math.round(value * 1e5) / 1e5
}

function getCurrentPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) =>
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 300000,
    }),
  )
}

function geolocationErrorMessage(err: unknown) {
  if (err && typeof err === 'object' && 'code' in err) {
    if (err.code === 1) {
      return 'Location access was blocked. Enter your address instead.'
    }
    if (err.code === 3) {
      return 'Finding your location took too long. Try again or enter your address.'
    }
  }
  return "Couldn't determine your location. Enter your address instead."
}

// Best effort: the street address only fills the search box and feeds the
// Voting Locations tab. Representatives come from the coordinates themselves.
async function reverseGeocode(point: Point): Promise<string | null> {
  try {
    const res = await fetch(
      `https://photon.komoot.io/reverse?lat=${point.lat}&lon=${point.lon}&limit=1`,
      { signal: AbortSignal.timeout(REVERSE_GEOCODE_TIMEOUT_MS) },
    )
    if (!res.ok) return null
    const data = await res.json()
    const feature = data.features?.[0]
    if (!feature || feature.properties?.countrycode !== 'US') return null
    const { formattedAddress } = formatPhotonFeature(feature)
    // A house number is what lets Google Civic find a polling place.
    return feature.properties.housenumber && formattedAddress ? formattedAddress : null
  } catch (err) {
    console.error('Photon reverse lookup failed', err)
    return null
  }
}

export default function AddressLookup({
  onSelectOfficial,
  savedAddressRequest = 0,
}: {
  onSelectOfficial: (official: Official) => void
  // Bumped by "My Representatives" to show the saved address's results.
  savedAddressRequest?: number
}) {
  const [address, setAddress] = useState('')
  const debouncedAddress = useDebounce(address, 300)
  const [suggestions, setSuggestions] = useState<PhotonResult[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [_coordinates, setCoordinates] = useState<[number, number] | null>(null)

  const [lookup, setLookup] = useState<CivicLookup | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [locating, setLocating] = useState(false)
  const canUseLocation = typeof navigator !== 'undefined' && 'geolocation' in navigator

  // Address of the most recent lookup, kept even when the representative lookup fails
  const [lookedUpAddress, setLookedUpAddress] = useState<string | null>(null)
  // Set when the last lookup was by location: whether a street address was found for it.
  const [locationLookup, setLocationLookup] = useState<{ hasAddress: boolean } | null>(null)
  const voterInfoAvailable = !locationLookup || locationLookup.hasAddress

  // Voter info state (independent from representative lookup). Fetched lazily: the
  // address is only sent to Google Civic once the Voting Locations tab is opened.
  const [voterInfo, setVoterInfo] = useState<VoterInfo | null>(null)
  const [voterInfoLoading, setVoterInfoLoading] = useState(false)
  const [activeTab, setActiveTab] = useState<Tab>('representatives')
  const activeVoterInfoControllerRef = useRef<AbortController | null>(null)
  const voterInfoAddressRef = useRef<string | null>(null)
  const lookupSeqRef = useRef(0)
  const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({
    representatives: null,
    voting: null,
  })

  const { isLoaded: userLoaded, canSave, savedAddress, saveAddress } = useSavedAddress()
  const handledSavedRequestRef = useRef<number | null>(null)
  const [savingAddress, setSavingAddress] = useState(false)
  const [justSaved, setJustSaved] = useState(false)

  async function fetchVoterInfo(
    targetAddress: string,
    stateHint: string | null | undefined,
    signal: AbortSignal,
  ) {
    try {
      const response = await fetch(apiUrl('/api/voter-info'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // The state (from the representative lookup) lets the backend pick
        // state-specific elections; without it, only nationwide ones match.
        body: JSON.stringify({ address: targetAddress, state: stateHint || undefined }),
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

  function startVoterInfoFetch(targetAddress: string, stateHint?: string | null) {
    activeVoterInfoControllerRef.current?.abort()
    const controller = new AbortController()
    activeVoterInfoControllerRef.current = controller
    voterInfoAddressRef.current = targetAddress
    setVoterInfo(null)
    setVoterInfoLoading(true)
    fetchVoterInfo(targetAddress, stateHint, controller.signal)
  }

  function resetVoterInfo() {
    activeVoterInfoControllerRef.current?.abort()
    activeVoterInfoControllerRef.current = null
    voterInfoAddressRef.current = null
    setVoterInfo(null)
    setVoterInfoLoading(false)
  }

  function selectTab(tab: Tab) {
    setActiveTab(tab)
    if (
      tab === 'voting' &&
      lookedUpAddress &&
      voterInfoAvailable &&
      voterInfoAddressRef.current !== lookedUpAddress
    ) {
      startVoterInfoFetch(lookedUpAddress, lookup?.normalized_input?.state)
    }
  }

  function onTabKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const tabs: Tab[] = ['representatives', 'voting']
    const index = tabs.indexOf(activeTab)
    let next: Tab | null = null
    if (event.key === 'ArrowRight') next = tabs[(index + 1) % tabs.length]
    else if (event.key === 'ArrowLeft') next = tabs[(index - 1 + tabs.length) % tabs.length]
    else if (event.key === 'Home') next = tabs[0]
    else if (event.key === 'End') next = tabs[tabs.length - 1]
    if (!next) return
    event.preventDefault()
    selectTab(next)
    tabRefs.current[next]?.focus()
  }

  // Looks up representatives for an address, or for a point when `point` is given.
  // With a point, `targetAddress` is the reverse-geocoded address ('' if none was
  // found) and is only used for display and the Voting Locations tab.
  async function performLookup(targetAddress: string, point?: Point) {
    const trimmed = targetAddress.trim()
    if (!trimmed && !point) {
      setError('Enter a U.S. street address.')
      setLookup(null)
      setLookedUpAddress(null)
      setLocationLookup(null)
      resetVoterInfo()
      return
    }

    setLoading(true)
    setError(null)
    setJustSaved(false)
    setLookedUpAddress(trimmed || CURRENT_LOCATION_LABEL)
    setLocationLookup(point ? { hasAddress: Boolean(trimmed) } : null)

    // Drop voter info for the previous address. If the user is already viewing the
    // Voting Locations tab, fetch for the new address once the representative
    // lookup settles (it supplies the state hint); otherwise wait for the tab.
    const lookupSeq = ++lookupSeqRef.current
    const votingTabOpen = activeTab === 'voting' && Boolean(trimmed)
    resetVoterInfo()
    if (votingTabOpen) {
      setVoterInfoLoading(true)
    }
    let lookupState: string | null | undefined

    const query = point
      ? `lat=${roundCoordinate(point.lat)}&lon=${roundCoordinate(point.lon)}`
      : `address=${encodeURIComponent(trimmed)}`

    try {
      const response = await fetch(apiUrl(`/api/lookup?${query}`))
      const body = await readJson(response)
      if (!response.ok) {
        throw new Error(apiDetail(body, `Lookup failed (${response.status})`))
      }
      setLookup(body as CivicLookup)
      lookupState = (body as CivicLookup).normalized_input?.state
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

    if (votingTabOpen && lookupSeq === lookupSeqRef.current) {
      startVoterInfoFetch(trimmed, lookupState)
    }
  }

  async function lookupMyLocation() {
    setShowSuggestions(false)
    setLocating(true)
    setError(null)
    // Claim a sequence number so a typed lookup made while we wait for the
    // browser or the reverse geocoder wins over this one.
    const seq = ++lookupSeqRef.current
    try {
      let position: GeolocationPosition
      try {
        position = await getCurrentPosition()
      } catch (err) {
        if (seq === lookupSeqRef.current) {
          setError(geolocationErrorMessage(err))
          setLookup(null)
          setLookedUpAddress(null)
          setLocationLookup(null)
          resetVoterInfo()
        }
        return
      }
      if (seq !== lookupSeqRef.current) return
      const point = { lat: position.coords.latitude, lon: position.coords.longitude }
      const resolvedAddress = await reverseGeocode(point)
      if (seq !== lookupSeqRef.current) return
      setAddress(resolvedAddress ?? '')
      setCoordinates([point.lon, point.lat])
      await performLookup(resolvedAddress ?? '', point)
    } finally {
      setLocating(false)
    }
  }


  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setShowSuggestions(false)
    await performLookup(address)
  }

  // Shows the saved address's results: once when Clerk has loaded (request 0),
  // then each time "My Representatives" bumps the request. Skipped when those
  // results are already showing, and on first load if the user got a lookup in
  // before Clerk finished loading.
  useEffect(() => {
    if (!userLoaded || !savedAddress) return
    if (handledSavedRequestRef.current === savedAddressRequest) return
    handledSavedRequestRef.current = savedAddressRequest

    const isFirstLoad = savedAddressRequest === 0
    if (isFirstLoad && (lookedUpAddress || loading || locating)) return
    if (!isFirstLoad) setActiveTab('representatives')
    setAddress(savedAddress)
    setShowSuggestions(false)
    if (lookup && !locationLookup && sameAddress(lookedUpAddress, savedAddress)) return

    performLookup(savedAddress)
    // Keyed on the request, so performLookup's closure is current when it runs.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [userLoaded, savedAddress, savedAddressRequest])

  async function saveLookedUpAddress() {
    if (!lookedUpAddress) return
    setSavingAddress(true)
    try {
      await saveAddress(lookedUpAddress)
      setJustSaved(true)
    } catch (err) {
      console.error('Failed to save address:', err)
    } finally {
      setSavingAddress(false)
    }
  }

  useEffect(() => {
    async function fetchSuggestions() {
      if (!debouncedAddress.trim()) {
        setSuggestions([])
        return
      }
      try {
        const res = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(debouncedAddress)}&countrycode=US&limit=5`)
        const data = await res.json()
        setSuggestions((data.features || []).map(formatPhotonFeature))
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
        {canUseLocation ? (
          <button
            type="button"
            onClick={lookupMyLocation}
            disabled={loading || locating}
            className="inline-flex items-center justify-center gap-2 rounded border border-slate-700 bg-slate-800 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-slate-500 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <LocateFixed className="h-4 w-4" aria-hidden="true" />
            <span>{locating ? 'Locating…' : 'Use my location'}</span>
          </button>
        ) : null}
        <button
          type="submit"
          disabled={loading || locating}
          className="rounded bg-blue-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? 'Looking up…' : 'Find representatives'}
        </button>
      </form>
      {canUseLocation ? (
        <p className="mt-2 text-xs text-slate-500">
          Your location is only used for this search to find your districts. It isn't saved.
        </p>
      ) : null}

      <div className="mt-8" aria-live="polite">
        {error && !lookedUpAddress ? <p className="text-red-400">{error}</p> : null}
        {locating && !loading ? (
          <p className="text-slate-400">Finding your location…</p>
        ) : null}
        {loading && !lookup ? (
          <p className="text-slate-400">
            {locationLookup ? 'Looking up your location…' : 'Looking up that address…'}
          </p>
        ) : null}
        {lookedUpAddress && (lookup || !loading) ? (
          <div>
            {justSaved ? (
              <p className="mb-4 inline-flex items-center gap-1.5 text-xs text-green-400">
                <Check className="h-3.5 w-3.5" aria-hidden="true" />
                Saved as your address
              </p>
            ) : canSave && lookup && !loading && !locationLookup &&
              !sameAddress(lookedUpAddress, savedAddress) ? (
              <button
                type="button"
                onClick={saveLookedUpAddress}
                disabled={savingAddress}
                className="mb-4 inline-flex items-center gap-1.5 rounded border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:border-slate-500 hover:bg-slate-700 disabled:opacity-60"
              >
                <MapPinHouse className="h-3.5 w-3.5" aria-hidden="true" />
                {savingAddress ? 'Saving…' : 'Save as my address'}
              </button>
            ) : null}
            <div
              className="mb-6 flex border-b border-slate-700"
              role="tablist"
              aria-label="Address lookup results views"
              onKeyDown={onTabKeyDown}
            >
              <button
                type="button"
                role="tab"
                id="tab-representatives"
                aria-controls="panel-representatives"
                aria-selected={activeTab === 'representatives'}
                tabIndex={activeTab === 'representatives' ? 0 : -1}
                ref={(el) => {
                  tabRefs.current.representatives = el
                }}
                onClick={() => selectTab('representatives')}
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
                tabIndex={activeTab === 'voting' ? 0 : -1}
                ref={(el) => {
                  tabRefs.current.voting = el
                }}
                onClick={() => selectTab('voting')}
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
              {activeTab === 'representatives' &&
                (lookup ? (
                  <LookupResults
                    lookup={lookup}
                    onSelectOfficial={onSelectOfficial}
                    locationLabel={
                      locationLookup
                        ? locationLookup.hasAddress
                          ? `${CURRENT_LOCATION_LABEL} (near ${lookedUpAddress})`
                          : CURRENT_LOCATION_LABEL
                        : null
                    }
                  />
                ) : error ? (
                  <p className="text-red-400">{error}</p>
                ) : null)}
            </div>

            <div
              id="panel-voting"
              role="tabpanel"
              aria-labelledby="tab-voting"
              hidden={activeTab !== 'voting'}
            >
              {activeTab === 'voting' && !voterInfoAvailable && (
                <p className="py-8 text-center text-slate-400">
                  We couldn't find a street address for your location. Enter your
                  address above to see polling places.
                </p>
              )}
              {activeTab === 'voting' && voterInfoAvailable && (
                <VotingLocations
                  voterInfo={voterInfo}
                  loading={voterInfoLoading}
                  stateCode={lookup?.normalized_input?.state}
                />
              )}
            </div>
          </div>
        ) : null}
      </div>
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
