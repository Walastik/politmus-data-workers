import { useHostedAuth } from '@clerk/expo/hosted-auth'
import { Text } from 'react-native'

export default function SignInLink({ label }: { label: string }) {
  const { startHostedAuth } = useHostedAuth()
  return (
    <Text onPress={() => void startHostedAuth({ mode: 'sign-in' })} accessibilityRole="button" className="text-xs font-semibold text-slate-400">
      {label}
    </Text>
  )
}
