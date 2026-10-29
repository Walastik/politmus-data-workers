import { FRAMES, HOLD_MS, MORPH_TICKS, TICK_MS, morphFrame } from '@politmus/core/asciiArt'
import { useEffect, useState } from 'react'
import { AccessibilityInfo, Text } from 'react-native'

// The morphing ASCII art from the web landing pages; holds still when the
// system asks for reduced motion.
export default function AsciiArt() {
  const [text, setText] = useState(FRAMES[0])

  useEffect(() => {
    let cancelled = false
    let frameIndex = 0
    let holdTimer: ReturnType<typeof setTimeout> | undefined
    let morphTimer: ReturnType<typeof setInterval> | undefined

    const startMorph = () => {
      const fromIndex = frameIndex
      const toIndex = (frameIndex + 1) % FRAMES.length
      let morphTick = 0
      morphTimer = setInterval(() => {
        morphTick += 1
        const progress = morphTick / MORPH_TICKS
        setText(morphFrame(FRAMES[fromIndex], FRAMES[toIndex], progress))
        if (progress >= 1) {
          clearInterval(morphTimer)
          frameIndex = toIndex
          setText(FRAMES[toIndex])
          holdTimer = setTimeout(startMorph, HOLD_MS)
        }
      }, TICK_MS)
    }

    void AccessibilityInfo.isReduceMotionEnabled().then((reduced) => {
      if (!reduced && !cancelled) holdTimer = setTimeout(startMorph, HOLD_MS)
    })

    return () => {
      cancelled = true
      clearTimeout(holdTimer)
      clearInterval(morphTimer)
    }
  }, [])

  return (
    <Text
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      selectable={false}
      className="mb-8 font-mono text-[11px] leading-[13px] text-blue-400 md:text-sm md:leading-4"
    >
      {text}
    </Text>
  )
}
