import { Platform, useWindowDimensions } from 'react-native'

// Wide web windows get the desktop layout: a top nav bar and a centered column,
// instead of phone tabs stretched across the screen. Stack screens center
// their own content (md:max-w-[960px]), since the web stack ignores contentStyle.
export const CONTENT_MAX_WIDTH = 960

export function useWideLayout() {
  const { width } = useWindowDimensions()
  return Platform.OS === 'web' && width >= 768
}

export const wideContentStyle = { width: '100%', maxWidth: CONTENT_MAX_WIDTH, alignSelf: 'center' } as const

// Lists of small cards (Congress, Candidates) go three across on desktop web;
// phones, narrow windows and the native app keep one column.
export function useGridColumns() {
  return useWideLayout() ? 3 : 1
}

// One grid cell: a fraction of the row, with half the gap on each side (the
// list's content adds the other half at its edges).
export function gridCellStyle(columns: number) {
  return columns > 1 ? ({ width: `${100 / columns}%`, padding: 6 } as const) : undefined
}
