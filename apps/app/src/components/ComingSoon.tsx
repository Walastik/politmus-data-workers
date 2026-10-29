import * as WebBrowser from 'expo-web-browser'
import { Pressable, Text, View } from 'react-native'

// Placeholder for screens not ported yet; links to the same page on the site.
export default function ComingSoon({ title, webPath }: { title: string; webPath: string }) {
  return (
    <View className="flex-1 items-center justify-center bg-slate-900 px-8">
      <Text className="text-lg font-semibold text-slate-100">{title}</Text>
      <Text className="mt-2 text-center text-sm text-slate-400">This screen is coming to the app soon.</Text>
      <Pressable
        onPress={() => WebBrowser.openBrowserAsync(`https://politmus.com${webPath}`)}
        accessibilityRole="link"
        className="mt-4 rounded-md border border-slate-700 px-4 py-2"
      >
        <Text className="text-sm text-blue-400">Open on politmus.com</Text>
      </Pressable>
    </View>
  )
}
