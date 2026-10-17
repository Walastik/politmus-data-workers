import { useRef, useState, type UIEvent } from 'react'

// Tracks whether `targetRef`'s element has scrolled fully above the top of the
// scroll container that `onScroll` is attached to. Drawers use it to move their
// title into the top bar once it's out of view.
export function useScrolledPast<T extends HTMLElement>() {
  const targetRef = useRef<T>(null)
  const [scrolledPast, setScrolledPast] = useState(false)

  function onScroll(event: UIEvent<HTMLElement>) {
    const target = targetRef.current
    if (!target) return
    const past =
      target.getBoundingClientRect().bottom <= event.currentTarget.getBoundingClientRect().top
    if (past !== scrolledPast) setScrolledPast(past)
  }

  return { targetRef, scrolledPast, onScroll }
}
