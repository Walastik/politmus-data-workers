// The morphing ASCII art on the landing pages, shared by web and native.

import { ASCII_FRAMES } from './asciiFrames'

export const HOLD_MS = 1100
export const TICK_MS = 40
export const MORPH_TICKS = 16
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

export const FRAMES = padFrames(ASCII_FRAMES)

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

export function morphFrame(from: string, to: string, progress: number): string {
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
