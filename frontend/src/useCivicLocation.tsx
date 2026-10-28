import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'

import { apiUrl } from './api'
import {
  geolocationErrorMessage,
  geolocationGranted,
  getCurrentPosition,
  reverseGeocode,
  roundCoordinate,
  type Point,
} from './geo'
import type { CivicLookup } from './types'
import { sameAddress, useSavedAddress } from './useSavedAddress'

export type Load<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ok'; data: T }

// Where the visitor's civic info is for: a street address, or a device
// location with the nearby street address when one could be found.
export type Place =
  | { kind: 'address'; address: string }
  | { kind: 'point'; point: Point; address: string | null }

export interface CivicLocation {
  // False until we know whether there's a saved address or a granted location.
  ready: boolean
  place: Place | null
  // A street address for the place, when there is one (needed for voting sites).
  address: string | null
  label: string | null
  lookup: Load<CivicLookup>
  locating: boolean
  locationError: string | null
  setAddress: (address: string) => void
  // Resolves true once the device location is in use.
  locateMe: () => Promise<boolean>
  // Signed-in visitors can keep a typed address as their saved address.
  canSave: boolean
  isSaved: boolean
  saving: boolean
  saveAddress: () => Promise<void>
}

const CURRENT_LOCATION_LABEL = 'your current location'
const STORAGE_KEY = 'politmus:address'

const CivicLocationContext = createContext<CivicLocation | null>(null)

// One location for the whole app, so Happening Now and My Reps agree and share
// a single lookup. Order: what the visitor picked this session, then their
// saved address (signed in), then the last address typed on this device, then
// the device location if the browser already allows it.
export function CivicLocationProvider({ children }: { children: ReactNode }) {
  const { isLoaded, canSave, savedAddress, saveAddress: persistAddress } = useSavedAddress()
  const [chosen, setChosen] = useState<Place | null>(null)
  const [stored, setStored] = useState<string | null>(readStoredAddress)
  const [autoPoint, setAutoPoint] = useState<Load<Place>>({ status: 'idle' })
  const [locating, setLocating] = useState(false)
  const [locationError, setLocationError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [lookup, setLookup] = useState<Load<CivicLookup>>({ status: 'idle' })
  const cache = useRef(new Map<string, CivicLookup>())
  // Bumped by every pick, so a slow device lookup can't override a later typed address.
  const pickSeq = useRef(0)

  const fallback: Place | null = savedAddress
    ? { kind: 'address', address: savedAddress }
    : stored
      ? { kind: 'address', address: stored }
      : autoPoint.status === 'ok'
        ? autoPoint.data
        : null
  const place = chosen ?? fallback
  const needsAuto = isLoaded && !chosen && !savedAddress && !stored
  const ready = isLoaded && (!needsAuto || autoPoint.status === 'ok' || autoPoint.status === 'error')

  useEffect(() => {
    if (!needsAuto || autoPoint.status !== 'idle') return
    setAutoPoint({ status: 'loading' })
    const seq = pickSeq.current
    locateDevice({ onlyIfGranted: true })
      .then((found) => {
        if (seq !== pickSeq.current) return
        setAutoPoint(found ? { status: 'ok', data: found } : { status: 'error', message: '' })
      })
      .catch(() => setAutoPoint({ status: 'error', message: '' }))
  }, [needsAuto, autoPoint.status])

  const key = place ? placeKey(place) : null
  useEffect(() => {
    if (!place || !key) {
      setLookup({ status: 'idle' })
      return
    }
    const cached = cache.current.get(key)
    if (cached) {
      setLookup({ status: 'ok', data: cached })
      return
    }
    const controller = new AbortController()
    setLookup({ status: 'loading' })
    const query =
      place.kind === 'point'
        ? `lat=${roundCoordinate(place.point.lat)}&lon=${roundCoordinate(place.point.lon)}`
        : `address=${encodeURIComponent(place.address)}`
    fetch(apiUrl(`/api/lookup?${query}`), { signal: controller.signal })
      .then(async (response) => {
        const body = await readJson(response)
        if (!response.ok) {
          throw new Error(apiDetail(body, `Lookup failed (${response.status})`))
        }
        cache.current.set(key, body as CivicLookup)
        setLookup({ status: 'ok', data: body as CivicLookup })
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        setLookup({
          status: 'error',
          message: err instanceof Error && err.message ? err.message : 'Could not look up that address.',
        })
      })
    return () => controller.abort()
    // `key` identifies the place; `place` itself is rebuilt every render.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const setAddress = useCallback((address: string) => {
    const trimmed = address.trim()
    if (!trimmed) return
    pickSeq.current += 1
    setLocating(false)
    setLocationError(null)
    setChosen({ kind: 'address', address: trimmed })
    setStored(trimmed)
    writeStoredAddress(trimmed)
  }, [])

  const locateMe = useCallback(async () => {
    const seq = ++pickSeq.current
    setLocating(true)
    setLocationError(null)
    try {
      const found = await locateDevice({ onlyIfGranted: false })
      if (seq !== pickSeq.current || !found) return false
      setChosen(found)
      // Next visit should follow the device again, not an old typed address.
      setStored(null)
      writeStoredAddress(null)
      return true
    } catch (err) {
      if (seq === pickSeq.current) setLocationError(geolocationErrorMessage(err))
      return false
    } finally {
      if (seq === pickSeq.current) setLocating(false)
    }
  }, [])

  const address = place ? place.address : null
  const isSaved = Boolean(place?.kind === 'address' && sameAddress(place.address, savedAddress))

  const saveAddress = useCallback(async () => {
    if (!address) return
    setSaving(true)
    try {
      await persistAddress(address)
    } catch (err) {
      console.error('Failed to save address:', err)
    } finally {
      setSaving(false)
    }
  }, [address, persistAddress])

  const value: CivicLocation = {
    ready,
    place,
    address,
    label: place ? placeLabel(place) : null,
    lookup,
    locating,
    locationError,
    setAddress,
    locateMe,
    canSave,
    isSaved,
    saving,
    saveAddress,
  }

  return <CivicLocationContext.Provider value={value}>{children}</CivicLocationContext.Provider>
}

export function useCivicLocation(): CivicLocation {
  const value = useContext(CivicLocationContext)
  if (!value) {
    throw new Error('useCivicLocation must be used inside CivicLocationProvider')
  }
  return value
}

function placeLabel(place: Place) {
  if (place.kind === 'address') return place.address
  return place.address ? `${CURRENT_LOCATION_LABEL} (near ${place.address})` : CURRENT_LOCATION_LABEL
}

function placeKey(place: Place) {
  return place.kind === 'point'
    ? `point:${roundCoordinate(place.point.lat)},${roundCoordinate(place.point.lon)}`
    : `address:${place.address.replace(/\s+/g, ' ').trim().toLowerCase()}`
}

async function locateDevice({ onlyIfGranted }: { onlyIfGranted: boolean }): Promise<Place | null> {
  if (onlyIfGranted && !(await geolocationGranted())) return null
  const position = await getCurrentPosition()
  const point = { lat: position.coords.latitude, lon: position.coords.longitude }
  return { kind: 'point', point, address: await reverseGeocode(point) }
}

function readStoredAddress(): string | null {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY)
    return value && value.trim() ? value : null
  } catch {
    return null
  }
}

function writeStoredAddress(value: string | null) {
  try {
    if (value) window.localStorage.setItem(STORAGE_KEY, value)
    else window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Private mode or blocked storage: the address just won't survive a reload.
  }
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
