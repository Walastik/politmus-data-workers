import type { BottomTabBarProps } from 'expo-router/tabs'
import { Pressable, Text, View } from 'react-native'

import AccountButton from './AccountButton'
import Monogram from './Monogram'
import { Icons } from './icons'

export interface NavItem {
  name: string
  title: string
  Icon: (typeof Icons)[keyof typeof Icons]
}

// Desktop web's one top bar, like the Vite site's header: brand (home), the
// sections with the current one highlighted, and the account buttons. Replaces
// both the tab bar and the per-screen header on wide windows.
export default function DesktopNav({ state, navigateToTab, items }: BottomTabBarProps & { items: readonly NavItem[] }) {
  const current = state.routes[state.index]?.name
  const go = (name: string) => {
    const route = state.routes.find((r) => r.name === name)
    if (route) navigateToTab(route.key)
  }
  return (
    <View className="border-b border-slate-800 bg-slate-900">
      <View className="h-14 w-full max-w-6xl flex-row items-center gap-6 self-center px-6">
        <Pressable onPress={() => go('home')} accessibilityRole="link" className="flex-row items-center gap-2">
          <Monogram size={26} />
          <Text className="text-lg font-bold tracking-tight text-slate-50">Politmus</Text>
        </Pressable>
        <View accessibilityRole="tablist" accessibilityLabel="Primary" className="flex-1 flex-row items-center gap-1">
          {items.map(({ name, title, Icon }) => {
            const active = current === name
            return (
              <Pressable
                key={name}
                onPress={() => go(name)}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                className={`flex-row items-center gap-1.5 rounded-md px-3 py-1.5 ${active ? 'bg-slate-800' : 'hover:bg-slate-800/60'}`}
              >
                <Icon size={16} colorClassName={active ? 'accent-white' : 'accent-slate-400'} />
                <Text className={`text-sm font-medium ${active ? 'text-white' : 'text-slate-400'}`}>{title}</Text>
              </Pressable>
            )
          })}
        </View>
        <AccountButton />
      </View>
    </View>
  )
}
