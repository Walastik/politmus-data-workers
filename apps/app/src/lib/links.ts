import type { Official } from '@politmus/core/types'
import * as WebBrowser from 'expo-web-browser'
import { Linking } from 'react-native'

const SITE = 'https://politmus.com'

// Web pages open in an in-app browser; tel: and the like go to the system.
export function openUrl(url: string) {
  if (/^https?:/i.test(url)) {
    void WebBrowser.openBrowserAsync(url)
  } else {
    void Linking.openURL(url)
  }
}

// Member and candidate profiles aren't ported yet; the site opens the same
// drawer from ?official=.
export function openProfile(official: Official) {
  openUrl(`${SITE}/reps?official=${encodeURIComponent(official.id)}`)
}

export function openSitePath(path: string) {
  openUrl(`${SITE}${path}`)
}
