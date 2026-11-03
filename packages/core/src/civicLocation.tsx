import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'

import type { ApiClient } from './api'
import { reverseGeocode, roundCoordinate, type Point } from './geo'
import type { CivicLookup } from './types'

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
  // False where the device has no location service at all.
  canLocate: boolean
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

// What each platform supplies: device storage and location (localStorage and
// navigator.geolocation on web, SecureStore and expo-location on native).
export interface CivicLocationPlatform {
  // The last address typed on this device. Synchronous, so the first render
  // already knows it.
  readStoredAddress: () => string | null
  writeStoredAddress: (value: string | null) => void
  canLocate: () => boolean
  // True only when location is already allowed, so asking won't prompt.
  locationGranted: () => Promise<boolean>
  // May prompt for permission.
  currentPosition: () => Promise<Point>
  locationErrorMessage: (err: unknown) => string
}

// The signed-in user's saved address (Clerk unsafeMetadata on both platforms).
export interface SavedAddress {
  isLoaded: boolean
  canSave: boolean
  savedAddress: string | null
  saveAddress: (address: string) => Promise<void>
}

const CURRENT_LOCATION_LABEL = 'your current location'

const CivicLocationContext = createContext<CivicLocation | null>(null)

// One location for the whole app, so Happening Now and My Reps agree and share
// a single lookup. Order: what the visitor picked this session, then their
// saved address (signed in), then the last address typed on this device, then
// the device location if it's already allowed.
export function CivicLocationProvider({
  api,
  platform,
  saved,
  children,
}: {
  api: ApiClient
  platform: CivicLocationPlatform
  saved: SavedAddress
  children: ReactNode
}) {
  const { isLoaded, canSave, savedAddress, saveAddress: persistAddress } = saved
  const [chosen, setChosen] = useState<Place | null>(null)
  const [stored, setStored] = useState<string | null>(platform.readStoredAddress)
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
    locateDevice(platform, { onlyIfGranted: true })
      .then((found) => {
        if (seq !== pickSeq.current) return
        setAutoPoint(found ? { status: 'ok', data: found } : { status: 'error', message: '' })
      })
      .catch(() => setAutoPoint({ status: 'error', message: '' }))
  }, [needsAuto, autoPoint.status, platform])

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
    api
      .json<CivicLookup>(lookupPath(place), { signal: controller.signal })
      .then((data) => {
        cache.current.set(key, data)
        setLookup({ status: 'ok', data })
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

  const setAddress = useCallback(
    (address: string) => {
      const trimmed = address.trim()
      if (!trimmed) return
      pickSeq.current += 1
      setLocating(false)
      setLocationError(null)
      setChosen({ kind: 'address', address: trimmed })
      setStored(trimmed)
      platform.writeStoredAddress(trimmed)
    },
    [platform],
  )

  const locateMe = useCallback(async () => {
    const seq = ++pickSeq.current
    setLocating(true)
    setLocationError(null)
    try {
      const found = await locateDevice(platform, { onlyIfGranted: false })
      if (seq !== pickSeq.current || !found) return false
      setChosen(found)
      // Next visit should follow the device again, not an old typed address.
      setStored(null)
      platform.writeStoredAddress(null)
      return true
    } catch (err) {
      if (seq === pickSeq.current) setLocationError(platform.locationErrorMessage(err))
      return false
    } finally {
      if (seq === pickSeq.current) setLocating(false)
    }
  }, [platform])

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
    canLocate: platform.canLocate(),
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

export function sameAddress(a: string | null | undefined, b: string | null | undefined) {
  const normalize = (value: string | null | undefined) => (value ?? '').replace(/\s+/g, ' ').trim().toLowerCase()
  return normalize(a) === normalize(b)
}

// GET /api/lookup for a place: coordinates when we have them, else the address.
export function lookupPath(place: Place): string {
  const query =
    place.kind === 'point'
      ? `lat=${roundCoordinate(place.point.lat)}&lon=${roundCoordinate(place.point.lon)}`
      : `address=${encodeURIComponent(place.address)}`
  return `/api/lookup?${query}`
}

export function placeLabel(place: Place) {
  if (place.kind === 'address') return place.address
  return place.address ? `${CURRENT_LOCATION_LABEL} (near ${place.address})` : CURRENT_LOCATION_LABEL
}

function placeKey(place: Place) {
  return place.kind === 'point'
    ? `point:${roundCoordinate(place.point.lat)},${roundCoordinate(place.point.lon)}`
    : `address:${place.address.replace(/\s+/g, ' ').trim().toLowerCase()}`
}

async function locateDevice(
  platform: CivicLocationPlatform,
  { onlyIfGranted }: { onlyIfGranted: boolean },
): Promise<Place | null> {
  if (!platform.canLocate()) return null
  if (onlyIfGranted && !(await platform.locationGranted())) return null
  const point = await platform.currentPosition()
  return { kind: 'point', point, address: await reverseGeocode(point) }
}
