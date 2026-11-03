import { useEffect, useState } from 'react'

import { FRAMES, HOLD_MS, MORPH_TICKS, TICK_MS, morphFrame } from '@politmus/core/asciiArt'

export default function AsciiAnimation() {
  const [text, setText] = useState(FRAMES[0])

  useEffect(() => {
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    if (motion.matches) {
      return
    }

    let frameIndex = 0
    let morphTick = 0
    let holdTimer = 0
    let morphTimer = 0

    const startMorph = () => {
      const fromIndex = frameIndex
      const toIndex = (frameIndex + 1) % FRAMES.length
      morphTick = 0

      morphTimer = window.setInterval(() => {
        morphTick += 1
        const progress = morphTick / MORPH_TICKS
        setText(morphFrame(FRAMES[fromIndex], FRAMES[toIndex], progress))

        if (progress >= 1) {
          window.clearInterval(morphTimer)
          frameIndex = toIndex
          setText(FRAMES[toIndex])
          holdTimer = window.setTimeout(startMorph, HOLD_MS)
        }
      }, TICK_MS)
    }

    holdTimer = window.setTimeout(startMorph, HOLD_MS)

    return () => {
      window.clearTimeout(holdTimer)
      window.clearInterval(morphTimer)
    }
  }, [])

  return (
    <pre
      aria-hidden="true"
      className="mb-8 select-none text-left font-mono text-[11px] leading-[1.15] text-blue-400 whitespace-pre sm:text-sm"
    >
      {text}
    </pre>
  )
}
