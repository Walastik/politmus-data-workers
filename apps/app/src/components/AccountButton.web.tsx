import { Show } from '@clerk/expo'
import { SignInButton, UserButton } from '@clerk/expo/web'
import { View } from 'react-native'

export default function AccountButton() {
  return (
    <View className="mr-4">
      <Show when="signed-in">
        <UserButton />
      </Show>
      <Show when="signed-out">
        <SignInButton mode="modal">
          <button
            type="button"
            className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-500"
          >
            Sign in
          </button>
        </SignInButton>
      </Show>
    </View>
  )
}
