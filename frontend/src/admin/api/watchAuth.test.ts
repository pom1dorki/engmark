import { describe, expect, it, vi } from 'vitest'
import { createFakeApi } from '../fakeApi'
import { watchAuth } from './watchAuth'

describe('watchAuth', () => {
  it('reports a lost session from any data request and still returns the result', async () => {
    const fake = createFakeApi({ authed: false })
    const onLost = vi.fn()
    const api = watchAuth(fake.api, onLost)
    const result = await api.deck()
    expect(result.ok).toBe(false)
    expect(onLost).toHaveBeenCalledTimes(1)
  })

  it('stays silent while the session is valid', async () => {
    const onLost = vi.fn()
    const api = watchAuth(createFakeApi().api, onLost)
    const result = await api.deck()
    expect(result.ok).toBe(true)
    expect(onLost).toHaveBeenCalledTimes(0)
  })

  it('does not treat a wrong password or the session probe as a lost session', async () => {
    const onLost = vi.fn()
    const api = watchAuth(createFakeApi({ authed: false }).api, onLost)
    const login = await api.login('wrong')
    const probe = await api.session()
    expect(login.ok).toBe(false)
    expect(probe.ok).toBe(false)
    expect(onLost).toHaveBeenCalledTimes(0)
  })

  it('passes arguments through', async () => {
    const fake = createFakeApi()
    await watchAuth(fake.api, () => undefined).cards({ q: 'ba', limit: 5 })
    expect(fake.callsOf('cards')[0][0]).toEqual({ q: 'ba', limit: 5 })
  })
})
