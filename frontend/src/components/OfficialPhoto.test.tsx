import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { initials } from '../types'
import OfficialPhoto from './OfficialPhoto'

describe('OfficialPhoto', () => {
  it('renders the portrait with its credit line', () => {
    render(
      <OfficialPhoto
        url="https://www.congress.gov/img/member/s000033_200.jpg"
        name="Bernard Sanders"
        party="Independent"
        attribution="Image courtesy of the Member"
      />,
    )
    const img = screen.getByRole('img', { name: 'Portrait of Bernard Sanders' })
    expect(img).toHaveAttribute('src', 'https://www.congress.gov/img/member/s000033_200.jpg')
    expect(img).toHaveAttribute('title', 'Image courtesy of the Member')
  })

  it('falls back to initials without a URL', () => {
    const { container } = render(<OfficialPhoto url={null} name="Alma S. Adams" party="Democratic" />)
    expect(screen.queryByRole('img')).toBeNull()
    expect(container).toHaveTextContent('AA')
  })

  it('falls back to initials when the image fails to load', () => {
    const { container } = render(
      <OfficialPhoto url="https://example.test/broken.jpg" name="Ted Cruz" party="Republican" />,
    )
    fireEvent.error(screen.getByRole('img'))
    expect(screen.queryByRole('img')).toBeNull()
    expect(container).toHaveTextContent('TC')
  })
})

describe('initials', () => {
  it('handles direct and inverted names', () => {
    expect(initials('Alma S. Adams')).toBe('AA')
    expect(initials('Adams, Alma S.')).toBe('AA')
    expect(initials('Cher')).toBe('C')
    expect(initials('')).toBe('?')
  })
})
