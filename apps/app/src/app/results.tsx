import { ScrollView } from 'react-native'

import ElectionResults from '@/components/results/ElectionResults'
import { pageMetadata } from '@/lib/metadata'

export function generateMetadata() {
  return pageMetadata('/results')
}

// Election night results from state election offices: a map to explore, the
// races and counties behind it, and what stands out.
export default function ResultsScreen() {
  return (
    <ScrollView className="flex-1 bg-slate-900">
      <ElectionResults />
    </ScrollView>
  )
}
