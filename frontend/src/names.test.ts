import { describe, expect, it } from 'vitest'

import { displayName } from './types'

describe('displayName', () => {
  it('puts the first name and middle initial before the last name', () => {
    expect(displayName('Adams, Alma S.')).toBe('Alma S. Adams')
    expect(displayName('Cruz, Ted')).toBe('Ted Cruz')
    expect(displayName('Van Drew, Jefferson')).toBe('Jefferson Van Drew')
  })

  it('keeps a suffix at the end', () => {
    expect(displayName('Bishop, Sanford D., Jr.')).toBe('Sanford D. Bishop Jr.')
  })

  it('leaves names already in display order alone', () => {
    expect(displayName('Alma S. Adams')).toBe('Alma S. Adams')
    expect(displayName('')).toBe('')
  })
})
