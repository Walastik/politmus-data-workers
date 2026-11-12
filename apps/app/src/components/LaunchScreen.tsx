import * as SplashScreen from 'expo-splash-screen'
import { useEffect, useState } from 'react'
import { StyleSheet } from 'react-native'
import Animated, { FadeOut, useReducedMotion } from 'react-native-reanimated'

import PolitmusLoader, { LOOP_MS, RISE_MS } from '@/components/PolitmusLoader'
import { useCivicLocation } from '@/lib/civicLocation'
import { COLORS } from '@/lib/theme'

// The app's launch: the native splash is a still, dry P
// (assets/images/splash-icon.png, set in app.json). As soon as React draws,
// this covers the screen with the animated loader at the same size and spot
// and hides the native splash, so the dry P starts soaking up color without a
// visible cut. It fades out once sign-in and location have loaded.
//
// The root layout keeps the native splash up (preventAutoHideAsync) and draws
// nothing until the brand fonts load; this hides it, and is the only thing that
// does, so the splash can't go before the animation is on screen.
//
// Native only: LaunchScreen.web.tsx draws nothing, since the website's pages
// are prerendered and should show their content straight away.

// The native splash fits the image into an imageWidth (76) square, so the P is
// 76 tall there; the loader's size is its height.
const SIZE = 76
// Don't hold launch forever if sign-in can't load (offline): the screens have
// their own loading states.
const GIVE_UP_MS = 8000

export default function LaunchScreen() {
  const { ready } = useCivicLocation()
  const reduceMotion = useReducedMotion()
  const [mountedAt] = useState(() => Date.now())
  const [done, setDone] = useState(false)

  useEffect(() => {
    if (done) return
    const giveUp = setTimeout(() => setDone(true), GIVE_UP_MS - (Date.now() - mountedAt))
    if (!ready) return () => clearTimeout(giveUp)
    // Leave when the P is fully soaked (the loop's brief hold at the top), so
    // the app appears from a finished mark, not a half-wet one.
    const elapsed = Date.now() - mountedAt
    const wait = reduceMotion ? 0 : Math.ceil(Math.max(0, elapsed - RISE_MS) / LOOP_MS) * LOOP_MS + RISE_MS - elapsed
    const leave = setTimeout(() => setDone(true), wait)
    return () => {
      clearTimeout(giveUp)
      clearTimeout(leave)
    }
  }, [ready, done, mountedAt, reduceMotion])

  if (done) return null
  return (
    <Animated.View
      exiting={FadeOut.duration(320)}
      style={[StyleSheet.absoluteFill, { backgroundColor: COLORS.inkDark, alignItems: 'center', justifyContent: 'center' }]}
      onLayout={() => SplashScreen.hide()}
    >
      <PolitmusLoader size={SIZE} />
    </Animated.View>
  )
}
