import '../global.css'

import { ClerkProvider } from '@clerk/expo'
import { tokenCache } from '@clerk/expo/token-cache'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CLERK_LOCALIZATION, HOME_PATH } from '@politmus/core/site'
import { DarkTheme, router, Stack, ThemeProvider, useGlobalSearchParams } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { useEffect, useState } from 'react'
import { Platform, Pressable, Text } from 'react-native'

import Monogram from '@/components/Monogram'
import { ApiProvider } from '@/lib/api'
import { CivicLocationProvider } from '@/lib/civicLocation'

const PUBLISHABLE_KEY: string = (() => {
  const key = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY
  if (!key) throw new Error('Missing EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY (see apps/app/.env.example)')
  return key
})()

// Same slate-900 shell as the web app.
const theme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: '#0f172a', card: '#0f172a', border: '#1e293b', primary: '#60a5fa' },
}

// Web-only Clerk settings, as on the Vite site: our password copy and where
// sign-in, sign-up and sign-out land.
const WEB_CLERK_PROPS =
  Platform.OS === 'web'
    ? {
        localization: CLERK_LOCALIZATION,
        // Tailwind v4 uses cascade layers; see the @layer order in global.css.
        appearance: { cssLayerName: 'clerk' },
        afterSignOutUrl: HOME_PATH,
        signInFallbackRedirectUrl: '/now',
        signUpFallbackRedirectUrl: '/now',
      }
    : {}

export default function RootLayout() {
  const [queryClient] = useState(() => new QueryClient())

  return (
    // The browser keeps its own session on web; SecureStore is native only.
    <ClerkProvider publishableKey={PUBLISHABLE_KEY} tokenCache={Platform.OS === 'web' ? undefined : tokenCache} {...WEB_CLERK_PROPS}>
      <QueryClientProvider client={queryClient}>
        <ApiProvider>
          <CivicLocationProvider>
            <ThemeProvider value={theme}>
              <StatusBar style="light" />
              <Stack
                screenOptions={({ navigation }) => ({
                  headerShown: false,
                  // A profile opened from a shared link has nothing to go back to.
                  headerLeft: Platform.OS === 'web' && !navigation.canGoBack() ? () => <HomeLink /> : undefined,
                })}
              />
              <DrawerLinks />
            </ThemeProvider>
          </CivicLocationProvider>
        </ApiProvider>
      </QueryClientProvider>
    </ClerkProvider>
  )
}

// Links from the Vite site open a profile drawer with ?official= or ?bill= on
// any page; open the profile screen instead, so shared links keep working.
function DrawerLinks() {
  const { official, bill } = useGlobalSearchParams<{ official?: string; bill?: string }>()
  useEffect(() => {
    if (Platform.OS !== 'web') return
    if (official) router.replace({ pathname: '/member/[id]', params: { id: official } })
    if (bill) router.push({ pathname: '/bill/[id]', params: { id: bill } })
  }, [official, bill])
  return null
}

function HomeLink() {
  return (
    <Pressable onPress={() => router.replace('/now')} accessibilityRole="link" className="ml-2 flex-row items-center gap-1.5 px-2 py-1">
      <Monogram size={22} />
      <Text className="text-base font-bold text-slate-50">Politmus</Text>
    </Pressable>
  )
}

