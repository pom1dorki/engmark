import { describe, expect, it } from 'vitest'
import { emptyDraft } from '../draft/draft'
import { toChangeset } from '../changeset'
import { makeCard } from '../testkit'
import { type ApiError, createAdminApi, describeError, parseError } from './admin'

interface Call {
  url: string
  init: RequestInit
}

type Responder = (call: Call) => Response | Promise<Response>

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })
}

function errorBody(code: string, message = '', details?: unknown) {
  return { error: { code, message, details }, request_id: 'req-1' }
}

function setup(responder: Responder, timeoutMs?: number) {
  const calls: Call[] = []
  const api = createAdminApi({
    timeoutMs,
    fetch: async (url, init = {}) => {
      const call = { url, init }
      calls.push(call)
      return responder(call)
    },
  })
  return { api, calls }
}

function headerOf(call: Call, name: string): string | undefined {
  return (call.init.headers as Record<string, string>)[name]
}

describe('parseError', () => {
  const cases: [string, number, unknown, ApiError][] = [
    ['revision_mismatch', 412, errorBody('revision_mismatch', 'x', { baseRevision: 42, currentRevision: 43 }), { kind: 'revision_mismatch', base: 42, current: 43 }],
    ['version_mismatch', 409, errorBody('version_mismatch', 'x', { id: 102, expected: 2, actual: 3 }), { kind: 'version_mismatch', id: 102, expected: 2, actual: 3 }],
    ['duplicate_card', 409, errorBody('duplicate_card', 'x', { section: 'create', index: 1 }), { kind: 'duplicate_card', section: 'create', index: 1, id: null }],
    ['invalid_argument', 400, errorBody('invalid_argument', 'bad', { errors: [{ section: 'create', index: 0, field: 'word', code: 'required', message: 'm' }] }), { kind: 'validation', code: 'invalid_argument', message: 'bad', errors: [{ section: 'create', index: 0, field: 'word', code: 'required', message: 'm' }] }],
    ['empty_changeset', 400, errorBody('empty_changeset', 'empty'), { kind: 'validation', code: 'empty_changeset', message: 'empty', errors: [] }],
    ['no_changes', 400, errorBody('no_changes', 'same', { errors: [] }), { kind: 'validation', code: 'no_changes', message: 'same', errors: [] }],
    ['unauthenticated', 401, errorBody('unauthenticated'), { kind: 'unauthenticated' }],
    ['forbidden_origin', 403, errorBody('forbidden_origin'), { kind: 'forbidden_origin' }],
    ['too_many_requests', 429, errorBody('too_many_requests'), { kind: 'too_many_requests' }],
    ['precondition_required', 428, errorBody('precondition_required'), { kind: 'precondition_required' }],
    ['payload_too_large', 413, errorBody('payload_too_large'), { kind: 'payload_too_large' }],
    ['not_found', 404, errorBody('not_found', 'no card'), { kind: 'not_found', message: 'no card' }],
    ['401 without a body', 401, null, { kind: 'unauthenticated' }],
    ['403 without a body', 403, null, { kind: 'forbidden_origin' }],
    ['404 without a body', 404, null, { kind: 'not_found', message: '' }],
    ['413 without a body', 413, null, { kind: 'payload_too_large' }],
    ['428 without a body', 428, null, { kind: 'precondition_required' }],
    ['429 without a body', 429, null, { kind: 'too_many_requests' }],
    ['502 from a proxy', 502, '<html>bad gateway</html>', { kind: 'server', status: 502, message: '' }],
    ['unknown code on a 500', 500, errorBody('internal', 'boom'), { kind: 'server', status: 500, message: 'boom' }],
  ]
  for (const [name, status, body, want] of cases) {
    it(name, () => expect(parseError(status, body)).toEqual(want))
  }

  it('tolerates a details object of the wrong shape', () => {
    expect(parseError(412, errorBody('revision_mismatch', '', 'oops'))).toEqual({ kind: 'revision_mismatch', base: 0, current: 0 })
    expect(parseError(400, errorBody('invalid_argument', 'bad', { errors: 'nope' }))).toEqual({ kind: 'validation', code: 'invalid_argument', message: 'bad', errors: [] })
  })
})

describe('describeError', () => {
  it('has a Russian text for every kind', () => {
    const errors: ApiError[] = [
      { kind: 'revision_mismatch', base: 42, current: 43 },
      { kind: 'version_mismatch', id: 1, expected: 1, actual: 2 },
      { kind: 'duplicate_card', section: null, index: null, id: null },
      { kind: 'validation', code: 'invalid_argument', message: '', errors: [] },
      { kind: 'validation', code: 'empty_changeset', message: '', errors: [] },
      { kind: 'validation', code: 'no_changes', message: '', errors: [] },
      { kind: 'unauthenticated' },
      { kind: 'forbidden_origin' },
      { kind: 'too_many_requests' },
      { kind: 'precondition_required' },
      { kind: 'payload_too_large' },
      { kind: 'not_found', message: '' },
      { kind: 'server', status: 500, message: '' },
      { kind: 'network' },
      { kind: 'aborted' },
    ]
    for (const error of errors) expect(describeError(error)).toMatch(/[А-Яа-я]/)
  })

  it('names both revisions on a revision mismatch', () => {
    const text = describeError({ kind: 'revision_mismatch', base: 42, current: 43 })
    expect(text).toContain('r42')
    expect(text).toContain('r43')
  })
})

describe('createAdminApi requests', () => {
  it('saves a changeset with a matching If-Match, JSON body and same-origin credentials', async () => {
    const { api, calls } = setup(() => json({ revision: 43, created: [], updated: [], imports: [] }, 201, { ETag: '"r43"' }))
    const { body } = toChangeset({ ...emptyDraft(1, 42), items: { 'tmp-1': { kind: 'create', card: makeCard({ word: 'luggage' }) } } }, 'Правки')
    const result = await api.save(body)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.revision).toBe(43)
      expect(result.etag).toBe('"r43"')
    }
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('/api/v1/admin/changesets')
    expect(calls[0].init.method).toBe('POST')
    expect(calls[0].init.credentials).toBe('same-origin')
    expect(headerOf(calls[0], 'If-Match')).toBe('"r42"')
    expect(headerOf(calls[0], 'Content-Type')).toBe('application/json')
    expect(JSON.parse(calls[0].init.body as string)).toEqual(body)
  })

  it('maps a 412 to revision_mismatch', async () => {
    const { api } = setup(() => json(errorBody('revision_mismatch', 'changed', { baseRevision: 42, currentRevision: 44 }), 412))
    const { body } = toChangeset({ ...emptyDraft(1, 42), items: { 'tmp-1': { kind: 'create', card: makeCard() } } })
    const result = await api.save(body)
    expect(result).toEqual({ ok: false, error: { kind: 'revision_mismatch', base: 42, current: 44 } })
  })

  it('does not send a body or Content-Type on GET', async () => {
    const { api, calls } = setup(() => json({ id: 1, slug: 'default', title: 'Default', revision: 42, activeCards: 1, archivedCards: 0 }))
    await api.deck()
    expect(calls[0].init.method).toBe('GET')
    expect(calls[0].init.body).toBeUndefined()
    expect(headerOf(calls[0], 'Content-Type')).toBeUndefined()
  })

  it('sends the password as JSON on login', async () => {
    const { api, calls } = setup(() => json({ expiresAt: '2026-10-10T00:00:00Z' }))
    await api.login('secret')
    expect(calls[0].url).toBe('/api/v1/admin/session')
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ password: 'secret' })
  })

  it('builds the cards query without empty parameters', async () => {
    const { api, calls } = setup(() => json({ revision: 42, items: [], total: 0, limit: 50, offset: 0 }))
    await api.cards({ q: 'when', pos: '', state: 'incomplete', limit: 50, offset: 0 })
    const url = new URL(calls[0].url, 'http://x')
    expect(url.pathname).toBe('/api/v1/admin/cards')
    expect(Object.fromEntries(url.searchParams)).toEqual({ q: 'when', state: 'incomplete', limit: '50', offset: '0' })
    await api.cards()
    expect(calls[1].url).toBe('/api/v1/admin/cards')
  })

  it('requests changes, revisions and card versions on the contract paths', async () => {
    const { api, calls } = setup(() => json({}))
    await api.changes(42)
    await api.revisions({ limit: 30, before: 40 })
    await api.revision(41)
    await api.cardVersions(102)
    await api.cardVersion(102, 2)
    await api.revertDraft(40)
    await api.card(102)
    expect(calls.map((c) => `${c.init.method} ${c.url}`)).toEqual([
      'GET /api/v1/admin/changes?since=42',
      'GET /api/v1/admin/revisions?limit=30&before=40',
      'GET /api/v1/admin/revisions/41',
      'GET /api/v1/admin/cards/102/versions',
      'GET /api/v1/admin/cards/102/versions/2',
      'POST /api/v1/admin/revisions/40/revert-draft',
      'GET /api/v1/admin/cards/102',
    ])
  })

  it('returns exports as raw text', async () => {
    const text = '[\n  {"word": "when"}\n]\n'
    const { api, calls } = setup(() => new Response(text, { status: 200, headers: { 'Content-Type': 'application/json' } }))
    const result = await api.exportRevision(40)
    expect(result.ok && result.value).toBe(text)
    expect(calls[0].url).toBe('/api/v1/admin/revisions/40/export')
  })

  it('treats an empty 204 as success without a value', async () => {
    const { api } = setup(() => new Response(null, { status: 204 }))
    const result = await api.logout()
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toBeUndefined()
  })

  it('reports a malformed success body as a server error', async () => {
    const { api } = setup(() => new Response('<html>', { status: 200 }))
    const result = await api.deck()
    expect(!result.ok && result.error.kind).toBe('server')
  })
})

describe('createAdminApi caching', () => {
  const deck = { id: 1, slug: 'default', title: 'Default', revision: 42, activeCards: 1, archivedCards: 0 }

  it('revalidates deck with If-None-Match and returns the cached copy on 304', async () => {
    let n = 0
    const { api, calls } = setup(() => (++n === 1 ? json(deck, 200, { ETag: '"r42"' }) : new Response(null, { status: 304 })))

    const first = await api.deck()
    expect(first.ok && first.notModified).toBe(false)
    expect(headerOf(calls[0], 'If-None-Match')).toBeUndefined()

    const second = await api.deck()
    expect(headerOf(calls[1], 'If-None-Match')).toBe('"r42"')
    expect(second.ok && second.notModified).toBe(true)
    expect(second.ok && second.value).toEqual(deck)
  })

  it('replaces the cache when the deck changes', async () => {
    let n = 0
    const { api, calls } = setup(() => (++n === 1 ? json(deck, 200, { ETag: '"r42"' }) : json({ ...deck, revision: 43 }, 200, { ETag: '"r43"' })))
    await api.deck()
    await api.deck()
    await api.deck()
    expect(headerOf(calls[2], 'If-None-Match')).toBe('"r43"')
  })

  it('keeps separate cache entries per query', async () => {
    const { api, calls } = setup(() => json({ revision: 42, items: [], total: 0, limit: 50, offset: 0 }, 200, { ETag: '"r42"' }))
    await api.cards({ q: 'a' })
    await api.cards({ q: 'b' })
    expect(headerOf(calls[1], 'If-None-Match')).toBeUndefined()
    await api.cards({ q: 'a' })
    expect(headerOf(calls[2], 'If-None-Match')).toBe('"r42"')
  })

  it('never caches writes', async () => {
    const { api, calls } = setup(() => json({ revision: 43, created: [], updated: [], imports: [] }, 201, { ETag: '"r43"' }))
    const { body } = toChangeset({ ...emptyDraft(1, 42), items: { 'tmp-1': { kind: 'create', card: makeCard() } } })
    await api.save(body)
    await api.save(body)
    expect(headerOf(calls[1], 'If-None-Match')).toBeUndefined()
  })
})

describe('createAdminApi failures', () => {
  it('network failure', async () => {
    const api = createAdminApi({
      fetch: async () => {
        throw new TypeError('Failed to fetch')
      },
    })
    expect(await api.deck()).toEqual({ ok: false, error: { kind: 'network' } })
  })

  it('an already aborted signal does not hit the network', async () => {
    const { api, calls } = setup(() => json({}))
    const controller = new AbortController()
    controller.abort()
    expect(await api.deck({ signal: controller.signal })).toEqual({ ok: false, error: { kind: 'aborted' } })
    expect(calls).toHaveLength(0)
  })

  it('aborting a request in flight is reported as aborted, not as a network error', async () => {
    const api = createAdminApi({
      fetch: (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
        }),
    })
    const controller = new AbortController()
    const pending = api.cards({}, { signal: controller.signal })
    controller.abort()
    expect(await pending).toEqual({ ok: false, error: { kind: 'aborted' } })
  })

  it('a request that never answers times out as a network error', async () => {
    const api = createAdminApi({
      timeoutMs: 20,
      fetch: (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
        }),
    })
    expect(await api.deck()).toEqual({ ok: false, error: { kind: 'network' } })
  })

  it('maps error responses through parseError', async () => {
    const { api } = setup(() => json(errorBody('unauthenticated'), 401))
    expect(await api.session()).toEqual({ ok: false, error: { kind: 'unauthenticated' } })
  })

  it('survives an error response with a non-JSON body', async () => {
    const { api } = setup(() => new Response('<html>Bad gateway</html>', { status: 502 }))
    expect(await api.deck()).toEqual({ ok: false, error: { kind: 'server', status: 502, message: '' } })
  })
})
