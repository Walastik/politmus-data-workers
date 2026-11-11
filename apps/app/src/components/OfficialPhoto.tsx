import { initials, partyBadgeClass } from '@politmus/core/types'
import { Image } from 'expo-image'
import { useState } from 'react'
import { Text, View } from 'react-native'
import { withUniwind } from 'uniwind'

const StyledImage = withUniwind(Image)

const SIZE_CLASS = {
  sm: 'h-8 w-8',
  md: 'h-12 w-12',
  lg: 'h-20 w-20',
} as const

const TEXT_CLASS = { sm: 'text-[10px]', md: 'text-sm', lg: 'text-xl' } as const

// Congress.gov portraits; a missing or broken image falls back to the
// member's initials on their party colour (same as the web OfficialPhoto).
export default function OfficialPhoto({
  url,
  name,
  party,
  size = 'md',
}: {
  url?: string | null
  name: string
  party?: string | null
  size?: keyof typeof SIZE_CLASS
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const frame = `${SIZE_CLASS[size]} shrink-0 overflow-hidden rounded-full border-2 ${partyRingClass(party)}`

  if (url && failedUrl !== url) {
    return (
      <StyledImage
        source={{ uri: url }}
        accessibilityLabel={name ? `Portrait of ${name}` : 'Portrait'}
        contentFit="cover"
        contentPosition="top"
        onError={() => setFailedUrl(url)}
        className={`${frame} bg-slate-800`}
      />
    )
  }

  return (
    <View className={`${frame} items-center justify-center ${partyBadgeClass(party ?? '')}`}>
      <Text className={`font-sans-semibold ${TEXT_CLASS[size]} ${partyBadgeClass(party ?? '')}`}>{initials(name)}</Text>
    </View>
  )
}

function partyRingClass(party?: string | null) {
  if (party === 'Democratic' || party === 'D') return 'border-blue-500/50'
  if (party === 'Republican' || party === 'R') return 'border-red-500/50'
  return 'border-emerald-500/50'
}
