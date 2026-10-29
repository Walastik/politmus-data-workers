import type { Bill, Official } from '@politmus/core/types'
import { router } from 'expo-router'
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

export function openProfile(official: Pick<Official, 'id'>) {
  router.push({ pathname: '/member/[id]', params: { id: official.id } })
}

export function openBill(bill: Pick<Bill, 'id'>) {
  router.push({ pathname: '/bill/[id]', params: { id: bill.id } })
}

// The same profile on the website, for sharing (opens the drawer there).
export function profileShareUrl(kind: 'official' | 'bill', id: string) {
  return `${SITE}/reps?${kind}=${encodeURIComponent(id)}`
}

export function openSitePath(path: string) {
  openUrl(`${SITE}${path}`)
}
