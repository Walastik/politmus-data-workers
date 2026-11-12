import { HOME_PATH } from '@politmus/core/site'
import { Redirect } from 'expo-router'
import { Platform, Text, View } from 'react-native'

import AccountButton from '@/components/AccountButton'
import AsciiArt from '@/components/AsciiArt'
import { pageMetadata } from '@/lib/metadata'

export function generateMetadata() {
  return pageMetadata('/')
}

// The app opens on Happening Now. On the website, until launch (HOME_PATH
// isn't '/'), the root is the Work in Progress page with a hidden sign-in,
// like the Vite site's WipLanding.
export default function Root() {
  if (Platform.OS !== 'web') return <Redirect href="/now" />
  if (HOME_PATH === '/') return <Redirect href="/home" />
  return (
    <View className="flex-1 items-center justify-center bg-slate-900 px-8 py-16">
      <AsciiArt />
      <Text accessibilityRole="header" className="mb-4 text-4xl font-display tracking-tight text-slate-100 md:text-5xl">
        Politmus
      </Text>
      <Text className="font-sans text-xl text-slate-400">Work in Progress</Text>
      <View className="absolute top-4 right-0">
        <AccountButton subtle />
      </View>
    </View>
  )
}
