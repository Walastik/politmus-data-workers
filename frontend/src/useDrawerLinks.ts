import { useCallback } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'

import { billStub, officialStub, type Bill, type Official } from './types'

// Rows the user clicked, kept in history state so a drawer header renders
// immediately instead of waiting on its detail fetch. `drawerPush` marks entries
// we pushed, so closing that drawer can step back instead of adding an entry.
type LinkState = {
  drawerPush?: boolean
  official?: Official
  bill?: Bill
} | null

// Member and bill drawers live in the URL on every page so they can be shared,
// bookmarked and driven by back/forward: ?official=<id>&bill=<id>. The page's
// own params (filters, views) are kept alongside them.
export function useDrawerLinks() {
  const [searchParams, setSearchParams] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const state = location.state as LinkState

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

  const openOfficial = useCallback(
    (next: Official) => {
      const params = new URLSearchParams(searchParams)
      params.set('official', next.id)
      params.delete('bill')
      setSearchParams(params, { state: { drawerPush: true, official: next } })
    },
    [searchParams, setSearchParams],
  )

  const openBill = useCallback(
    (next: Bill) => {
      const params = new URLSearchParams(searchParams)
      params.set('bill', next.id)
      setSearchParams(params, {
        state: { official: state?.official, drawerPush: true, bill: next },
      })
    },
    [searchParams, setSearchParams, state],
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
    official,
    openOfficial,
    closeOfficial,
    bill,
    openBill,
    closeBill,
  }
}
