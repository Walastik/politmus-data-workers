import { useEffect, useState } from 'react'

import { ASCII_FRAMES } from './asciiFrames'

const HOLD_MS = 1100
const TICK_MS = 40
const MORPH_TICKS = 16
const NOISE = ['.', '+', ' '] as const

function padFrames(frames: string[]): string[] {
  const lines = frames.map((frame) =>
    frame.replace(/^\n/, '').split('\n'),
  )
  const height = Math.max(...lines.map((frame) => frame.length))
  const width = Math.max(
    ...lines.flatMap((frame) => frame.map((line) => line.length)),
  )

  return lines.map((frame) => {
    const padded = [...frame]
    while (padded.length < height) {
      padded.push('')
    }
    return padded.map((line) => line.padEnd(width, ' ')).join('\n')
  })
}

const FRAMES = padFrames(ASCII_FRAMES)

function morphChar(
  from: string,
  to: string,
  progress: number,
  line: number,
  column: number,
): string {
  if (from === to) {
    return to
  }
  if (progress <= 0) {
    return from
  }
  if (progress >= 1) {
    return to
  }

  const offset = ((column * 13 + line * 29) % 47) / 47
  const local = Math.min(1, Math.max(0, (progress - offset * 0.4) / 0.6))
  if (local <= 0) {
    return from
  }
  if (local < 0.45) {
    return NOISE[(column + line) % NOISE.length]
  }
  return to
}

function morphFrame(from: string, to: string, progress: number): string {
  const fromLines = from.split('\n')
  const toLines = to.split('\n')

  return fromLines
    .map((line, lineIndex) => {
      const target = toLines[lineIndex] ?? ''
      let next = ''
      for (let column = 0; column < line.length; column += 1) {
        next += morphChar(
          line[column],
          target[column] ?? ' ',
          progress,
          lineIndex,
          column,
        )
      }
      return next
    })
    .join('\n')
}

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
