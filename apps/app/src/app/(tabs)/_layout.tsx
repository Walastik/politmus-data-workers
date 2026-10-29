import { Tabs } from 'expo-router'

import AccountButton from '@/components/AccountButton'
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
      screenOptions={{
        headerTintColor: '#f8fafc',
        headerRight: () => <AccountButton />,
        tabBarActiveTintColor: '#f8fafc',
        tabBarInactiveTintColor: '#94a3b8',
        // Desktop web: nav down the side with full labels, content centered.
        ...(wide
          ? {
              tabBarPosition: 'left' as const,
              tabBarVariant: 'material' as const,
              tabBarLabelPosition: 'beside-icon' as const,
              tabBarActiveBackgroundColor: '#1e293b',
              sceneStyle: wideContentStyle,
            }
          : {}),
      }}
    >
      {TABS.map(({ name, title, short, Icon }) => (
        <Tabs.Screen
          key={name}
          name={name}
          options={{
            title,
            tabBarLabel: wide ? title : short,
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
