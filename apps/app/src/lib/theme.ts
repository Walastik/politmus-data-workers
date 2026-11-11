import { SpaceGrotesk_600SemiBold } from '@expo-google-fonts/space-grotesk/600SemiBold'
import { SpaceGrotesk_700Bold } from '@expo-google-fonts/space-grotesk/700Bold'
import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular'
import { Inter_500Medium } from '@expo-google-fonts/inter/500Medium'
import { Inter_600SemiBold } from '@expo-google-fonts/inter/600SemiBold'
import { Inter_700Bold } from '@expo-google-fonts/inter/700Bold'
import { Inter_800ExtraBold } from '@expo-google-fonts/inter/800ExtraBold'
import { IBMPlexMono_400Regular } from '@expo-google-fonts/ibm-plex-mono/400Regular'
import { IBMPlexMono_600SemiBold } from '@expo-google-fonts/ibm-plex-mono/600SemiBold'

// Politmus brand tokens, shared with the Vite site (apps/web/src/index.css).
//
// React Native can't pick a weight out of one family, so every weight is its
// own font name. Use the matching className (font-display, font-sans-semibold,
// font-mono, ...; see global.css) or FONTS in a style, and don't combine them
// with font-bold / font-semibold: Android ignores the weight and iOS may fake it.

export const FONTS = {
  displaySemiBold: 'SpaceGrotesk-SemiBold',
  displayBold: 'SpaceGrotesk-Bold',
  sans: 'Inter-Regular',
  sansMedium: 'Inter-Medium',
  sansSemiBold: 'Inter-SemiBold',
  sansBold: 'Inter-Bold',
  sansExtraBold: 'Inter-ExtraBold',
  mono: 'IBMPlexMono-Regular',
  monoSemiBold: 'IBMPlexMono-SemiBold',
} as const

// Font files for useFonts, keyed by the names above.
export const FONT_FILES = {
  [FONTS.displaySemiBold]: SpaceGrotesk_600SemiBold,
  [FONTS.displayBold]: SpaceGrotesk_700Bold,
  [FONTS.sans]: Inter_400Regular,
  [FONTS.sansMedium]: Inter_500Medium,
  [FONTS.sansSemiBold]: Inter_600SemiBold,
  [FONTS.sansBold]: Inter_700Bold,
  [FONTS.sansExtraBold]: Inter_800ExtraBold,
  [FONTS.mono]: IBMPlexMono_400Regular,
  [FONTS.monoSemiBold]: IBMPlexMono_600SemiBold,
}

export const COLORS = {
  paperLight: '#F8F7F4',
  paperDry: '#E2E0D8',
  inkDark: '#0F172A',
  inkMuted: '#1E293B',
  litmusRed: '#DC2626',
  litmusViolet: '#7C3AED',
  litmusBlue: '#2563EB',
} as const
