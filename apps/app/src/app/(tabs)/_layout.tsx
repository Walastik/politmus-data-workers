import { Tabs } from 'expo-router'
import { View } from 'react-native'

import AboutButton from '@/components/AboutButton'
import AccountButton from '@/components/AccountButton'
import DesktopNav from '@/components/DesktopNav'
import { Icons } from '@/components/icons'
import { useWideLayout, wideContentStyle } from '@/lib/layout'

// Same sections and order as the web app's NAV_ITEMS.
const TABS = [
  { name: 'now', title: 'Happening Now', short: 'Now', Icon: Icons.Radio },
  { name: 'feed', title: 'Feed', short: 'Feed', Icon: Icons.Rss },
  { name: 'reps', title: 'My Reps', short: 'My Reps', Icon: Icons.MapPinHouse },
  { name: 'congress', title: 'Congress', short: 'Congress', Icon: Icons.Landmark },
  { name: 'bills', title: 'Bills', short: 'Bills', Icon: Icons.ScrollText },
] as const

export default function TabLayout() {
  const wide = useWideLayout()
  return (
    <Tabs
      // Desktop web: one top bar with the sections (DesktopNav) and the page centered.
      tabBar={wide ? (props) => <DesktopNav {...props} items={TABS} /> : undefined}
      screenOptions={{
        headerTintColor: '#f8fafc',
        headerRight: () => (
          <View className="flex-row items-center">
            <AboutButton />
            <AccountButton />
          </View>
        ),
        tabBarActiveTintColor: '#f8fafc',
        tabBarInactiveTintColor: '#94a3b8',
        ...(wide ? { tabBarPosition: 'top' as const, headerShown: false, sceneStyle: wideContentStyle } : {}),
      }}
    >
      {TABS.map(({ name, title, short, Icon }) => (
        <Tabs.Screen
          key={name}
          name={name}
          options={{
            title,
            tabBarLabel: short,
            tabBarIcon: ({ color, size }) => <Icon color={color} size={size} />,
          }}
        />
      ))}
      {/* The website's landing page; reachable by URL but not a tab. href: null
          would hide it too, but on web that bounces /home to the first tab. */}
      <Tabs.Screen
        name="home"
        options={{ title: 'Politmus', tabBarItemStyle: { display: 'none' }, sceneStyle: { flex: 1 } }}
      />
    </Tabs>
  )
}
