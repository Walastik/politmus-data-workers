import { useHostedAuth } from '@clerk/expo/hosted-auth'
import { Pressable, Text } from 'react-native'

export default function SignUpLink() {
  const { startHostedAuth } = useHostedAuth()
  return (
    <Pressable onPress={() => void startHostedAuth({ mode: 'sign-up' })} accessibilityRole="button" className="rounded-lg bg-blue-600 px-6 py-3 active:bg-blue-500">
      <Text className="font-semibold text-white">Create a free account</Text>
    </Pressable>
  )
}
