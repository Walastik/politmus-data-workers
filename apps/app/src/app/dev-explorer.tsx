import { legacyExplorerPath } from '@politmus/core/site'
import { Redirect, useLocalSearchParams, type Href } from 'expo-router'

// Old /dev-explorer?tab=… links from before the site had pages.
export default function DevExplorer() {
  const params = useLocalSearchParams<Record<string, string>>()
  const search = new URLSearchParams(Object.entries(params).filter(([, v]) => typeof v === 'string') as [string, string][]).toString()
  return <Redirect href={legacyExplorerPath(search) as Href} />
}
