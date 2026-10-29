import { useAuth } from '@clerk/expo'
import { Redirect } from 'expo-router'
import { Platform } from 'react-native'

import Landing from '@/components/Landing'

// The website's home (HOME_PATH): signed-in visitors start on Happening Now,
// everyone else sees what Politmus is. The app always opens on Happening Now.
export default function Home() {
  const { isLoaded, isSignedIn } = useAuth()
  if (Platform.OS !== 'web' || (isLoaded && isSignedIn)) return <Redirect href="/now" />
  return <Landing />
}
