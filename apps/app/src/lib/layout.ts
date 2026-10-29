import { Platform, useWindowDimensions } from 'react-native'

// Wide web windows get the desktop layout: a side nav and a centered column,
// instead of phone tabs stretched across the screen. Stack screens center
// their own content (md:max-w-[960px]), since the web stack ignores contentStyle.
export const CONTENT_MAX_WIDTH = 960

export function useWideLayout() {
  const { width } = useWindowDimensions()
  return Platform.OS === 'web' && width >= 768
}

export const wideContentStyle = { width: '100%', maxWidth: CONTENT_MAX_WIDTH, alignSelf: 'center' } as const
