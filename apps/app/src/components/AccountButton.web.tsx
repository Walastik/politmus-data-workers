import { Show } from '@clerk/expo'
import { SignInButton, SignUpButton, UserButton } from '@clerk/expo/web'
import { MapPin } from 'lucide-react-native'
import { View } from 'react-native'

import LocationSettings from './LocationSettings'

// Clerk's own buttons and menu on web, like the Vite site's header.
export default function AccountButton({ subtle = false }: { subtle?: boolean }) {
  return (
    <View className="mr-4 flex-row items-center gap-2">
      <Show when="signed-in">
        <UserButton>
          <UserButton.UserProfilePage label="Location Settings" url="location" labelIcon={<MapPin size={16} color="currentColor" />}>
            <LocationSettings />
          </UserButton.UserProfilePage>
        </UserButton>
      </Show>
      <Show when="signed-out">
        <SignInButton mode="modal">
          <button
            type="button"
            className={
              subtle
                ? 'rounded-md bg-blue-600 px-6 py-2.5 font-sans-semibold text-white opacity-0 transition-opacity duration-300 hover:opacity-100'
                : 'rounded-md px-3 py-1.5 text-sm font-sans-medium text-slate-300 transition hover:bg-slate-800 hover:text-white'
            }
          >
            Sign in
          </button>
        </SignInButton>
        {subtle ? null : (
          <SignUpButton mode="modal">
            <button type="button" className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-sans-semibold text-white transition hover:bg-blue-500">
              Sign up
            </button>
          </SignUpButton>
        )}
      </Show>
    </View>
  )
}
