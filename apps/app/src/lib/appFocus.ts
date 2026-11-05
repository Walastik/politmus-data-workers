import { focusManager } from '@tanstack/react-query'
import { useEffect } from 'react'
import { AppState, Platform, type AppStateStatus } from 'react-native'

// React Query knows when a browser tab is in focus, but not when a native
// app goes to the background. Tell it, so polling (election results refresh
// every minute) stops while the app is away and stale data refreshes when
// it comes back.
export function useAppFocus() {
  useEffect(() => {
    if (Platform.OS === 'web') return
    const onChange = (status: AppStateStatus) => focusManager.setFocused(status === 'active')
    const subscription = AppState.addEventListener('change', onChange)
    return () => subscription.remove()
  }, [])
}
