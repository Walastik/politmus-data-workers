import { useUser } from '@clerk/expo'
import { CivicLocationProvider as SharedCivicLocationProvider, type SavedAddress } from '@politmus/core/civicLocation'
import { useCallback, type ReactNode } from 'react'

import { useApi } from './api'
import { locationPlatform } from './locationPlatform'

export { useCivicLocation, type Load } from '@politmus/core/civicLocation'

// The signed-in user's lookup address, kept in Clerk unsafeMetadata like the
// web app, so it follows them between devices.
function useSavedAddress(): SavedAddress {
  const { user, isLoaded } = useUser()
  const raw = user?.unsafeMetadata?.savedAddress
  const savedAddress = typeof raw === 'string' && raw.trim() ? raw.trim() : null

  const saveAddress = useCallback(
    async (address: string) => {
      if (!user) return
      await user.update({ unsafeMetadata: { ...user.unsafeMetadata, savedAddress: address } })
    },
    [user],
  )

  return { isLoaded, canSave: Boolean(user), savedAddress, saveAddress }
}

export function CivicLocationProvider({ children }: { children: ReactNode }) {
  const api = useApi()
  const saved = useSavedAddress()
  return (
    <SharedCivicLocationProvider api={api} platform={locationPlatform} saved={saved}>
      {children}
    </SharedCivicLocationProvider>
  )
}
