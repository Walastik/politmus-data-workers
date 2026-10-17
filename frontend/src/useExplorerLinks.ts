import { useCallback } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'

import { billStub, officialStub, type Bill, type Official } from './types'

export type ExplorerTab = 'lookup' | 'roster' | 'bills'

const TABS: readonly ExplorerTab[] = ['lookup', 'roster', 'bills']

// Rows the user clicked, kept in history state so a drawer header renders
// immediately instead of waiting on its detail fetch. `drawerPush` marks entries
// we pushed, so closing that drawer can step back instead of adding an entry.
type LinkState = {
  drawerPush?: boolean
  official?: Official
  bill?: Bill
} | null

// Explorer tab and drawer state lives in the URL so it can be shared,
// bookmarked and driven by back/forward: ?tab=…&official=<id>&bill=<id>
export function useExplorerLinks() {
  const [searchParams, setSearchParams] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const state = location.state as LinkState

  const rawTab = searchParams.get('tab')
  const tab: ExplorerTab = TABS.includes(rawTab as ExplorerTab)
    ? (rawTab as ExplorerTab)
    : 'lookup'
  const officialId = searchParams.get('official')
  const billId = searchParams.get('bill')

  const official = officialId
    ? state?.official?.id === officialId
      ? state.official
      : officialStub(officialId)
    : null
  const bill = billId
    ? state?.bill?.id === billId
      ? state.bill
      : billStub(billId)
    : null

  const setTab = useCallback(
    (next: ExplorerTab) => setSearchParams({ tab: next }),
    [setSearchParams],
  )

  const openOfficial = useCallback(
    (next: Official) => {
      const params = new URLSearchParams(searchParams)
      params.set('tab', tab)
      params.set('official', next.id)
      params.delete('bill')
      setSearchParams(params, { state: { drawerPush: true, official: next } })
    },
    [searchParams, setSearchParams, tab],
  )

  const openBill = useCallback(
    (next: Bill) => {
      const params = new URLSearchParams(searchParams)
      params.set('tab', tab)
      params.set('bill', next.id)
      setSearchParams(params, {
        state: { official: state?.official, drawerPush: true, bill: next },
      })
    },
    [searchParams, setSearchParams, state, tab],
  )

  const closeDrawer = useCallback(
    (key: 'official' | 'bill') => {
      // A drawer we opened in this session closes by stepping back, so back and
      // the close button agree. One restored from a link has nothing to step
      // back to, so drop its param in place.
      if (state?.drawerPush && (key === 'bill' || !billId)) {
        navigate(-1)
        return
      }
      const params = new URLSearchParams(searchParams)
      params.delete(key)
      if (key === 'official') {
        params.delete('bill')
      }
      setSearchParams(params, {
        replace: true,
        state: key === 'bill' ? { official: state?.official } : null,
      })
    },
    [billId, navigate, searchParams, setSearchParams, state],
  )

  const closeOfficial = useCallback(() => closeDrawer('official'), [closeDrawer])
  const closeBill = useCallback(() => closeDrawer('bill'), [closeDrawer])

  return {
    tab,
    setTab,
    official,
    openOfficial,
    closeOfficial,
    bill,
    openBill,
    closeBill,
  }
}
