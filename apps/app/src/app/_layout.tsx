import '../global.css'

import { ClerkProvider } from '@clerk/expo'
import { tokenCache } from '@clerk/expo/token-cache'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { DarkTheme, Stack, ThemeProvider } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { useState } from 'react'
import { Platform } from 'react-native'

import { ApiProvider } from '@/lib/api'

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

export default function RootLayout() {
  const [queryClient] = useState(() => new QueryClient())

  return (
    // The browser keeps its own session on web; SecureStore is native only.
    <ClerkProvider publishableKey={PUBLISHABLE_KEY} tokenCache={Platform.OS === 'web' ? undefined : tokenCache}>
      <QueryClientProvider client={queryClient}>
        <ApiProvider>
          <ThemeProvider value={theme}>
            <StatusBar style="light" />
            <Stack screenOptions={{ headerShown: false }} />
          </ThemeProvider>
        </ApiProvider>
      </QueryClientProvider>
    </ClerkProvider>
  )
}
