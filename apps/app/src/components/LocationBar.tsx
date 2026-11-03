import { suggestAddresses, type PhotonResult } from '@politmus/core/geo'
import { useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native'

import { useCivicLocation } from '@/lib/civicLocation'

import { Icons } from './icons'
import SignInLink from './SignInLink'

// Which place a screen is showing, with Change and Save; the address prompt
// when there is no place yet. Native counterpart of the web LocationBar.
export default function LocationBar({
  prompt,
  submitLabel,
  detail,
}: {
  prompt: string
  submitLabel: string
  // Extra context after the address, such as the House district.
  detail?: string | null
}) {
  const location = useCivicLocation()
  const [editing, setEditing] = useState(false)

  if (!location.place || editing) {
    return (
      <View className="rounded-xl border border-blue-900/60 bg-blue-950/20 p-4">
        {location.place ? null : <Text className="mb-3 text-sm text-slate-300">{prompt}</Text>}
        <LocationPicker
          submitLabel={submitLabel}
          initial={editing ? (location.address ?? '') : ''}
          autoFocus={editing}
          onDone={() => setEditing(false)}
          onCancel={location.place ? () => setEditing(false) : undefined}
        />
      </View>
    )
  }

  const unsaved = location.place.kind === 'address' && !location.isSaved
  return (
    <View className="gap-2">
      <View className="flex-row items-start gap-1.5">
        <Icons.MapPinHouse size={16} colorClassName="accent-slate-500" />
        <Text className="flex-1 text-sm text-slate-400">
          For <Text className="font-medium text-slate-200">{location.label}</Text>
          {detail ? <Text className="text-slate-500"> · {detail}</Text> : null}
        </Text>
      </View>
      <View className="flex-row flex-wrap items-center gap-x-4 gap-y-2">
        <Pressable onPress={() => setEditing(true)} accessibilityRole="button" className="flex-row items-center gap-1">
          <Icons.Pencil size={12} colorClassName="accent-blue-400" />
          <Text className="text-xs font-semibold text-blue-400">Change</Text>
        </Pressable>
        {unsaved && location.canSave ? (
          <Pressable
            onPress={() => void location.saveAddress()}
            disabled={location.saving}
            accessibilityRole="button"
            className="flex-row items-center gap-1"
          >
            <Icons.Check size={12} colorClassName="accent-blue-400" />
            <Text className="text-xs font-semibold text-blue-400">{location.saving ? 'Saving…' : 'Save as my address'}</Text>
          </Pressable>
        ) : null}
        {unsaved && !location.canSave ? <SignInLink label="Sign in to save this address" /> : null}
      </View>
    </View>
  )
}

// Address box with suggestions and a "Use my location" button; `onDone` runs
// once a place is set (e.g. to leave the landing page).
export function LocationPicker({
  submitLabel,
  initial = '',
  onDone,
  onCancel,
  autoFocus = false,
}: {
  submitLabel: string
  initial?: string
  onDone?: () => void
  onCancel?: () => void
  autoFocus?: boolean
}) {
  const { setAddress, locateMe, canLocate, locating, locationError } = useCivicLocation()
  const [value, setValue] = useState(initial)
  const [suggestions, setSuggestions] = useState<PhotonResult[]>([])
  const query = useDebounce(value.trim(), 300)

  useEffect(() => {
    if (!query || query === initial.trim()) {
      setSuggestions([])
      return
    }
    const controller = new AbortController()
    suggestAddresses(query, controller.signal)
      .then(setSuggestions)
      .catch((err: unknown) => {
        if (!controller.signal.aborted) console.error('Photon lookup failed', err)
      })
    return () => controller.abort()
  }, [query, initial])

  function choose(address: string) {
    setSuggestions([])
    if (!address.trim()) return
    setAddress(address)
    onDone?.()
  }

  async function locate() {
    setSuggestions([])
    if (await locateMe()) onDone?.()
  }

  return (
    <View className="gap-2">
      <View className="flex-row items-center gap-2 rounded-md border border-slate-700 bg-slate-800 px-3">
        <Icons.Search size={16} colorClassName="accent-slate-500" />
        <TextInput
          value={value}
          onChangeText={setValue}
          onSubmitEditing={() => choose(value)}
          autoFocus={autoFocus}
          autoComplete="street-address"
          textContentType="fullStreetAddress"
          returnKeyType="search"
          placeholder="1100 Congress Ave, Austin, TX 78701"
          placeholderTextColorClassName="accent-slate-500"
          accessibilityLabel="Street address"
          className="flex-1 py-2.5 text-sm text-slate-100"
        />
      </View>
      {suggestions.length > 0 ? (
        <View className="overflow-hidden rounded-md border border-slate-700 bg-slate-800">
          {suggestions.map((suggestion, index) => (
            <Pressable
              key={index}
              onPress={() => {
                setValue(suggestion.formattedAddress)
                choose(suggestion.formattedAddress)
              }}
              accessibilityRole="button"
              className="border-b border-slate-700/60 px-4 py-2.5 active:bg-slate-700"
            >
              <Text className="text-sm text-slate-100">{suggestion.formattedAddress}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      <View className="flex-row flex-wrap gap-2">
        <Pressable onPress={() => choose(value)} accessibilityRole="button" className="rounded-md bg-blue-600 px-5 py-2.5 active:bg-blue-500">
          <Text className="text-sm font-semibold text-white">{submitLabel}</Text>
        </Pressable>
        {canLocate ? (
          <Pressable
            onPress={() => void locate()}
            disabled={locating}
            accessibilityRole="button"
            className={`flex-row items-center gap-2 rounded-md border border-slate-700 bg-slate-800 px-4 py-2.5 ${locating ? 'opacity-60' : ''}`}
          >
            {locating ? <ActivityIndicator size="small" colorClassName="accent-slate-300" /> : <Icons.LocateFixed size={16} colorClassName="accent-slate-200" />}
            <Text className="text-sm font-semibold text-slate-200">{locating ? 'Locating…' : 'Use my location'}</Text>
          </Pressable>
        ) : null}
        {onCancel ? (
          <Pressable onPress={onCancel} accessibilityRole="button" className="rounded-md border border-slate-700 px-4 py-2.5">
            <Text className="text-sm text-slate-300">Cancel</Text>
          </Pressable>
        ) : null}
      </View>
      {locationError ? <Text className="text-sm text-red-400">{locationError}</Text> : null}
      <Text className="text-xs text-slate-500">
        Addresses go to the Census geocoder and Google’s Civic Information API to find your districts and voting sites.
        Your device location is only used to look these up.
      </Text>
    </View>
  )
}

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return debounced
}
