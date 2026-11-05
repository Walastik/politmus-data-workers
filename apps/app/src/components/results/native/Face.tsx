import { PARTY_COLOR, partyKey, type CandidateProfile } from '@politmus/core/electionResults'
import { Image } from 'expo-image'
import { useState } from 'react'
import { Text, View } from 'react-native'

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter((part) => /^[A-Za-z]/.test(part))
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

// A candidate's photo in a party-colored ring, or their initials when
// there's no photo (Montana's Senate candidates, for one) or it fails.
export function Face({
  name,
  profile,
  party,
  size,
  ring = 2,
}: {
  name: string
  profile?: CandidateProfile | null
  party: string
  size: number
  ring?: number
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const url = profile?.photoUrl
  const frame = {
    width: size,
    height: size,
    borderRadius: size / 2,
    borderWidth: ring,
    borderColor: PARTY_COLOR[partyKey(party)],
    backgroundColor: '#1e293b',
    overflow: 'hidden' as const,
  }
  if (url && failedUrl !== url) {
    return (
      <Image
        source={{ uri: url }}
        style={frame}
        contentFit="cover"
        contentPosition={{ top: '20%', left: '50%' }}
        onError={() => setFailedUrl(url)}
        accessible={false}
      />
    )
  }
  return (
    <View style={frame} className="items-center justify-center" accessible={false}>
      <Text style={{ fontSize: Math.max(9, size * 0.36) }} className="font-extrabold text-slate-300">
        {initials(name)}
      </Text>
    </View>
  )
}
