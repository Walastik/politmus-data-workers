import { Stack } from 'expo-router'
import { useRef, type ComponentRef } from 'react'
import { ScrollView } from 'react-native'

import ElectionResults from '@/components/results/ElectionResults'
import { pageMetadata } from '@/lib/metadata'

export function generateMetadata() {
  return pageMetadata('/results')
}

// Election night results from state election offices: a map to explore, the
// races and counties behind it, and what stands out. The header gets back to
// the app: a back arrow from Happening Now, the Politmus link from a shared link.
export default function ResultsScreen() {
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null)
  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: 'Election results', headerBackTitle: 'Back' }} />
      <ScrollView ref={scroll} className="flex-1 bg-slate-900" contentInsetAdjustmentBehavior="automatic">
        {/* The native screen scrolls back to the map when a highlight opens a state; web ignores it. */}
        <ElectionResults scrollTo={(y) => scroll.current?.scrollTo({ y, animated: true })} />
      </ScrollView>
    </>
  )
}
