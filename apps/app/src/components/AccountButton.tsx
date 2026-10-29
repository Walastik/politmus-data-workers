import { useAuth } from '@clerk/expo'
import { useHostedAuth } from '@clerk/expo/hosted-auth'
import { Pressable, Text } from 'react-native'

// Sign in through Clerk's hosted page in an in-app browser (works in Expo Go).
// The web build uses Clerk's own modal instead: AccountButton.web.tsx.
// `subtle` is for the web Work in Progress page; native ignores it.
export default function AccountButton(_props: { subtle?: boolean }) {
  const { isLoaded, isSignedIn, signOut } = useAuth()
  const { startHostedAuth } = useHostedAuth()
  if (!isLoaded) return null

  return isSignedIn ? (
    <Pressable onPress={() => signOut()} accessibilityRole="button" className="mr-4 rounded-md px-3 py-1.5">
      <Text className="text-sm font-medium text-slate-300">Sign out</Text>
    </Pressable>
  ) : (
    <Pressable
      onPress={() => startHostedAuth({ mode: 'sign-in' })}
      accessibilityRole="button"
      className="mr-4 rounded-md bg-blue-600 px-3 py-1.5"
    >
      <Text className="text-sm font-semibold text-white">Sign in</Text>
    </Pressable>
  )
}
