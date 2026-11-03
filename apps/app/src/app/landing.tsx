import { HOME_PATH } from '@politmus/core/site'
import { Redirect, type Href } from 'expo-router'

import { pageMetadata } from '@/lib/metadata'

export function generateMetadata() {
  return pageMetadata('/landing')
}

export default function OldLanding() {
  return <Redirect href={HOME_PATH as Href} />
}
