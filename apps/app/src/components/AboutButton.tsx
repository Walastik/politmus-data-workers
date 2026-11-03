import { router } from 'expo-router'
import { useState } from 'react'
import { Platform, Pressable } from 'react-native'

import { Icons } from './icons'
import OptionSheet from './OptionSheet'

const PAGES = [
  { value: '/privacy', label: 'Privacy Policy' },
  { value: '/terms', label: 'Terms of Service' },
] as const

// The app's way to the legal pages, which the website links from its landing
// page footer. Web has that footer, so this is native only.
export default function AboutButton() {
  const [open, setOpen] = useState(false)
  if (Platform.OS === 'web') return null

  return (
    <>
      <Pressable onPress={() => setOpen(true)} accessibilityRole="button" accessibilityLabel="About Politmus" hitSlop={8} className="px-2 py-1.5">
        <Icons.Info size={20} colorClassName="accent-slate-400" />
      </Pressable>
      <OptionSheet
        visible={open}
        title="About Politmus"
        options={[...PAGES]}
        value=""
        onSelect={(page) => router.push(page as (typeof PAGES)[number]['value'])}
        onClose={() => setOpen(false)}
      />
    </>
  )
}
