import { describe, expect, it } from 'vitest'
import { STATE_VOTER_RESOURCES, getVoterResources } from './types'

describe('STATE_VOTER_RESOURCES and getVoterResources', () => {
  const EXPECTED_STATES = [
    'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
    'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
    'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
    'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
    'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
    'DC',
  ]

  it('covers all 50 states plus DC (51 total)', () => {
    expect(Object.keys(STATE_VOTER_RESOURCES).length).toBe(51)
    for (const code of EXPECTED_STATES) {
      expect(STATE_VOTER_RESOURCES[code]).toBeDefined()
      expect(STATE_VOTER_RESOURCES[code].name).toBeTruthy()
    }
  })

  it('every state resource produces valid https URLs', () => {
    for (const [code, res] of Object.entries(STATE_VOTER_RESOURCES)) {
      expect(res.voteGovUrl, `${code} voteGovUrl`).toMatch(/^https:\/\//)
      expect(() => new URL(res.voteGovUrl)).not.toThrow()

      expect(res.checkRegistrationUrl, `${code} checkRegistrationUrl`).toMatch(/^https:\/\//)
      expect(() => new URL(res.checkRegistrationUrl)).not.toThrow()

      expect(res.registerUrl, `${code} registerUrl`).toMatch(/^https:\/\//)
      expect(() => new URL(res.registerUrl)).not.toThrow()
    }
  })

  it('getVoterResources resolves case-insensitively', () => {
    const upper = getVoterResources('TX')
    const lower = getVoterResources('tx')
    expect(upper.name).toBe('Texas')
    expect(lower.name).toBe('Texas')
    expect(upper.voteGovUrl).toBe('https://vote.gov')
    expect(upper.registerUrl).toBe('https://www.vote.org/register-to-vote/texas/')
  })

  it('getVoterResources falls back gracefully for unknown or undefined state codes', () => {
    const unknown = getVoterResources('ZZ')
    expect(unknown.name).toBe('ZZ')
    expect(unknown.voteGovUrl).toBe('https://vote.gov')
    expect(unknown.checkRegistrationUrl).toBe('https://www.vote.org/am-i-registered-to-vote/')
    expect(unknown.registerUrl).toBe('https://www.vote.org/register-to-vote/')

    const empty = getVoterResources('')
    expect(empty.name).toBe('United States')
    expect(empty.voteGovUrl).toBe('https://vote.gov')

    const undef = getVoterResources(undefined)
    expect(undef.name).toBe('United States')
    expect(undef.voteGovUrl).toBe('https://vote.gov')
  })

  it('every state has official https polling-place and registration-status links', () => {
    for (const [code, res] of Object.entries(STATE_VOTER_RESOURCES)) {
      for (const key of ['pollingPlaceUrl', 'registrationStatusUrl'] as const) {
        const url = res[key]
        expect(url, `${code} ${key}`).toMatch(/^https:\/\//)
        expect(new URL(url!).hostname, `${code} ${key}`).not.toMatch(/vote\.org$/)
      }
    }
  })

  it('nationwide fallback has no state-specific official links', () => {
    const us = getVoterResources(null)
    expect(us.pollingPlaceUrl).toBeUndefined()
    expect(us.registrationStatusUrl).toBeUndefined()
  })
})

