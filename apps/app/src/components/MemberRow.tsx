import { partyEdgeClass } from '@politmus/core/congress'
import { officialName, partyShort, type Official } from '@politmus/core/types'
import { Pressable, Text, View } from 'react-native'

import { openProfile } from '@/lib/links'

import OfficialPhoto from './OfficialPhoto'
import { ScoreChip } from './Score'

// A member on one line, like the web MemberCard's compact variant.
export default function MemberRow({ official, subtitle, status }: { official: Official; subtitle?: string; status?: string }) {
  const name = officialName(official)
  return (
    <Pressable
      onPress={() => openProfile(official)}
      accessibilityRole="button"
      accessibilityLabel={[name, partyShort(official.party), official.leadership_role, subtitle].filter(Boolean).join(', ')}
      className={`flex-row items-center gap-2.5 rounded-md border-l-2 bg-slate-800/70 px-2.5 py-2 active:bg-slate-700/70 ${partyEdgeClass(official.party)}`}
    >
      <OfficialPhoto url={official.photo_url} name={name} party={official.party} size="sm" />
      <View className="min-w-0 flex-1">
        <Text className="text-sm font-sans-medium text-slate-100" numberOfLines={1}>
          {name}
        </Text>
        <Text className="font-sans text-[11px] text-slate-400" numberOfLines={1}>
          {partyShort(official.party)}
          {official.leadership_role ? <Text className="text-slate-200"> · {official.leadership_role}</Text> : null}
          {subtitle ? ` · ${subtitle}` : ''}
          {status ? ` · ${status}` : ''}
        </Text>
      </View>
      <ScoreChip official={official} />
    </Pressable>
  )
}
