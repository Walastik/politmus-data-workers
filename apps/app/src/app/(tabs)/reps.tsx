import { ScrollView, Text, View } from 'react-native'

import LocationBar from '@/components/LocationBar'
import PolitmusLoader from '@/components/PolitmusLoader'
import LookupResults from '@/components/Representatives'
import { useCivicLocation } from '@/lib/civicLocation'
import { pageMetadata } from '@/lib/metadata'

export function generateMetadata() {
  return pageMetadata('/reps')
}

export default function RepsScreen() {
  const { ready, place, lookup } = useCivicLocation()

  return (
    <ScrollView className="flex-1 bg-slate-900" contentContainerClassName="gap-6 px-4 py-5" keyboardShouldPersistTaps="handled">
      <View>
        <Text className="text-2xl font-bold tracking-tight text-slate-50">Who represents me</Text>
        <Text className="mt-1 text-sm text-slate-400">
          Your members of Congress and state officials, how they score, and how to reach them.
        </Text>
      </View>
      {!ready ? (
        <PolitmusLoader className="mt-10" label="Loading" />
      ) : (
        <>
          <LocationBar
            prompt="Enter your address, or use your location, to see who represents you."
            submitLabel="Find my representatives"
          />
          {!place ? null : lookup.status === 'loading' || lookup.status === 'idle' ? (
            <PolitmusLoader className="mt-6" label="Finding your representatives" />
          ) : lookup.status === 'error' ? (
            <Text className="text-red-400">{lookup.message}</Text>
          ) : (
            <LookupResults lookup={lookup.data} />
          )}
        </>
      )}
    </ScrollView>
  )
}
