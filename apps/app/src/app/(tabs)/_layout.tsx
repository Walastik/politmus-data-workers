import { Tabs } from 'expo-router'

import AccountButton from '@/components/AccountButton'
import { Icons } from '@/components/icons'

// Same sections and order as the web app's NAV_ITEMS.
const TABS = [
  { name: 'now', title: 'Happening Now', short: 'Now', Icon: Icons.Radio },
  { name: 'feed', title: 'Feed', short: 'Feed', Icon: Icons.Rss },
  { name: 'reps', title: 'My Reps', short: 'My Reps', Icon: Icons.MapPinHouse },
  { name: 'congress', title: 'Congress', short: 'Congress', Icon: Icons.Landmark },
  { name: 'bills', title: 'Bills', short: 'Bills', Icon: Icons.ScrollText },
] as const

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerTintColor: '#f8fafc',
        headerRight: () => <AccountButton />,
        tabBarActiveTintColor: '#f8fafc',
        tabBarInactiveTintColor: '#94a3b8',
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
    </Tabs>
  )
}
