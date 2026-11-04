import { Pressable, Text, View } from 'react-native'

import { openUrl } from '@/lib/links'

// The results explorer is web-only for now; the apps link to it.
export default function ElectionResults() {
  return (
    <View className="flex-1 items-center justify-center gap-3 bg-slate-900 p-6">
      <Text className="text-center text-lg font-bold text-slate-100">Election results</Text>
      <Text className="text-center text-sm text-slate-300">
        The interactive results map is on politmus.com while we bring it to the app.
      </Text>
      <Pressable onPress={() => openUrl('https://politmus.com/results')} accessibilityRole="link">
        <Text className="text-sm font-semibold text-blue-400">Open the results map</Text>
      </Pressable>
    </View>
  )
}
