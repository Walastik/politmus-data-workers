import '../global.css'

import { ClerkProvider } from '@clerk/expo'
import { tokenCache } from '@clerk/expo/token-cache'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CLERK_LOCALIZATION, HOME_PATH } from '@politmus/core/site'
import { DarkTheme, router, Stack, ThemeProvider, useGlobalSearchParams, usePathname } from 'expo-router'
import { useFonts } from 'expo-font'
import * as SplashScreen from 'expo-splash-screen'
import { StatusBar } from 'expo-status-bar'
import { useEffect, useState } from 'react'
import { Platform, Pressable, Text } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'

import Monogram from '@/components/Monogram'
import { ApiProvider } from '@/lib/api'
import { useAppFocus } from '@/lib/appFocus'
import { CivicLocationProvider } from '@/lib/civicLocation'
import { pageTitle } from '@/lib/metadata'
import { FONT_FILES, FONTS } from '@/lib/theme'

// Keep the native splash up until the brand fonts are in memory, so text never
// redraws in a fallback face. The website's pages are prerendered and shouldn't
// wait on fonts; the browser swaps them in when they arrive.
if (Platform.OS !== 'web') SplashScreen.preventAutoHideAsync()

const PUBLISHABLE_KEY: string = (() => {
  const key = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY
  if (!key) throw new Error('Missing EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY (see apps/app/.env.example)')
  return key
})()

// Same slate-900 shell as the web app.
const theme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: '#0f172a', card: '#0f172a', border: '#1e293b', primary: '#60a5fa' },
  // Header titles use `bold`, tab labels `medium`. Each font is a single
  // weight, so the weight stays normal (a bold on top would be synthetic).
  fonts: {
    regular: { fontFamily: FONTS.sans, fontWeight: 'normal' as const },
    medium: { fontFamily: FONTS.sansMedium, fontWeight: 'normal' as const },
    bold: { fontFamily: FONTS.displaySemiBold, fontWeight: 'normal' as const },
    heavy: { fontFamily: FONTS.displayBold, fontWeight: 'normal' as const },
  },
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
  useAppFocus()
  const [fontsLoaded, fontError] = useFonts(FONT_FILES)
  const fontsSettled = fontsLoaded || !!fontError

  useEffect(() => {
    if (Platform.OS !== 'web' && fontsSettled) SplashScreen.hideAsync()
  }, [fontsSettled])

  // A font that fails to load falls back to the system face rather than
  // leaving the app stuck on the splash screen.
  if (Platform.OS !== 'web' && !fontsSettled) return null

  return (
    // Gesture handler (the results map's pinch-to-zoom) needs a root view.
    <GestureHandlerRootView style={{ flex: 1 }}>
      {/* The browser keeps its own session on web; SecureStore is native only. */}
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
                <DocumentTitle />
              </ThemeProvider>
            </CivicLocationProvider>
          </ApiProvider>
        </QueryClientProvider>
      </ClerkProvider>
    </GestureHandlerRootView>
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

// Each page's static HTML carries its own <title> (generateMetadata), but moving
// between pages in the browser doesn't reload it, so keep the tab title in step.
function DocumentTitle() {
  const pathname = usePathname()
  useEffect(() => {
    if (Platform.OS === 'web') document.title = pageTitle(pathname)
  }, [pathname])
  return null
}

function HomeLink() {
  return (
    <Pressable onPress={() => router.replace('/now')} accessibilityRole="link" className="ml-2 flex-row items-center gap-1.5 px-2 py-1">
      <Monogram size={22} />
      <Text className="font-display text-base text-slate-50">Politmus</Text>
    </Pressable>
  )
}

