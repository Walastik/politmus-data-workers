import { Redirect } from 'expo-router'

// Feed is the first screen ported; switch to /now once Happening Now is.
export default function Index() {
  return <Redirect href="/feed" />
}
