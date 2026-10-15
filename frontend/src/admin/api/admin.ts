import type {
  CardList,
  CardVersion,
  Changes,
  ChangesetBody,
  ChangesetError,
  DeckInfo,
  RevisionDetail,
  RevisionInfo,
  SaveResult,
  ServerCard,
  ValidationReport,
} from '../types'

export type ApiError =
  | { kind: 'revision_mismatch'; base: number; current: number }
  | { kind: 'version_mismatch'; id: number | null; expected: number | null; actual: number | null }
  | { kind: 'duplicate_card'; section: string | null; index: number | null; id: number | null }
  | { kind: 'validation'; code: 'invalid_argument' | 'empty_changeset' | 'no_changes'; message: string; errors: ChangesetError[] }
  | { kind: 'unauthenticated' }
  | { kind: 'forbidden_origin' }
  | { kind: 'too_many_requests' }
  | { kind: 'precondition_required' }
  | { kind: 'payload_too_large' }
  | { kind: 'not_found'; message: string }
  | { kind: 'server'; status: number; message: string }
  | { kind: 'network' }
  | { kind: 'aborted' }

export type ApiResult<T> =
  | { ok: true; value: T; etag: string | null; notModified: boolean }
  | { ok: false; error: ApiError }

export interface RequestOptions {
  signal?: AbortSignal
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export interface AdminApiOptions {
  fetch?: FetchLike
  baseUrl?: string
  timeoutMs?: number
}

export interface CardsQuery {
  q?: string
  pos?: string
  state?: 'active' | 'archived' | 'incomplete'
  limit?: number
  offset?: number
}

interface SendOptions extends RequestOptions {
  body?: unknown
  headers?: Record<string, string>
  cache?: boolean
  as?: 'json' | 'text'
}

function num(value: unknown): number | null {
  return typeof value === 'number' ? value : null
}

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

export function parseError(status: number, body: unknown): ApiError {
  const error = asRecord(asRecord(body).error)
  const code = str(error.code)
  const message = str(error.message) ?? ''
  const details = asRecord(error.details)

  switch (code) {
    case 'revision_mismatch':
      return { kind: 'revision_mismatch', base: num(details.baseRevision) ?? 0, current: num(details.currentRevision) ?? 0 }
    case 'version_mismatch':
      return { kind: 'version_mismatch', id: num(details.id), expected: num(details.expected), actual: num(details.actual) }
    case 'duplicate_card':
      return { kind: 'duplicate_card', section: str(details.section), index: num(details.index), id: num(details.id) }
    case 'invalid_argument':
    case 'empty_changeset':
    case 'no_changes':
      return {
        kind: 'validation',
        code,
        message,
        errors: Array.isArray(details.errors) ? (details.errors as ChangesetError[]) : [],
      }
    case 'unauthenticated':
      return { kind: 'unauthenticated' }
    case 'forbidden_origin':
      return { kind: 'forbidden_origin' }
    case 'too_many_requests':
      return { kind: 'too_many_requests' }
    case 'precondition_required':
      return { kind: 'precondition_required' }
    case 'payload_too_large':
      return { kind: 'payload_too_large' }
    case 'not_found':
      return { kind: 'not_found', message }
  }

  switch (status) {
    case 401:
      return { kind: 'unauthenticated' }
    case 403:
      return { kind: 'forbidden_origin' }
    case 404:
      return { kind: 'not_found', message }
    case 413:
      return { kind: 'payload_too_large' }
    case 428:
      return { kind: 'precondition_required' }
    case 429:
      return { kind: 'too_many_requests' }
  }
  return { kind: 'server', status, message }
}

export function describeError(error: ApiError): string {
  switch (error.kind) {
    case 'revision_mismatch':
      return `Колода изменилась: на сервере r${error.current}, вы начали с r${error.base}. Ничего не записано.`
    case 'version_mismatch':
      return 'Карточку изменили, пока вы работали. Ничего не записано.'
    case 'duplicate_card':
      return 'Такая карточка уже есть (слово, часть речи и перевод совпадают).'
    case 'validation':
      return error.code === 'empty_changeset'
        ? 'В черновике нет изменений.'
        : error.code === 'no_changes'
          ? 'Карточка не отличается от сохранённой.'
          : error.message || 'Сервер не принял данные.'
    case 'unauthenticated':
      return 'Нужно войти.'
    case 'forbidden_origin':
      return 'Запрос отклонён: чужой адрес страницы.'
    case 'too_many_requests':
      return 'Неверный пароль или слишком много попыток. Подождите минуту.'
    case 'precondition_required':
      return 'Не хватает заголовка If-Match.'
    case 'payload_too_large':
      return 'Слишком большой объём данных (предел 4 МБ).'
    case 'not_found':
      return 'Не найдено.'
    case 'network':
      return 'Нет связи с сервером.'
    case 'aborted':
      return 'Запрос отменён.'
    case 'server':
      return error.message || `Ошибка сервера (${error.status}).`
  }
}

export function createAdminApi(options: AdminApiOptions = {}) {
  const baseUrl = options.baseUrl ?? '/api/v1/admin'
  const timeoutMs = options.timeoutMs ?? 30_000
  const doFetch: FetchLike = options.fetch ?? ((input, init) => fetch(input, init))
  const cache = new Map<string, { etag: string; value: unknown }>()

  async function send<T>(method: string, path: string, opts: SendOptions = {}): Promise<ApiResult<T>> {
    if (opts.signal?.aborted) return { ok: false, error: { kind: 'aborted' } }

    const controller = new AbortController()
    const forward = () => controller.abort()
    opts.signal?.addEventListener('abort', forward, { once: true })
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    const headers: Record<string, string> = { Accept: 'application/json', ...opts.headers }
    let body: string | undefined
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json'
      body = JSON.stringify(opts.body)
    }
    const cached = opts.cache ? cache.get(path) : undefined
    if (cached) headers['If-None-Match'] = cached.etag

    try {
      const response = await doFetch(baseUrl + path, {
        method,
        headers,
        body,
        credentials: 'same-origin',
        signal: controller.signal,
      })
      const etag = response.headers.get('ETag')

      if (response.status === 304 && cached) {
        return { ok: true, value: cached.value as T, etag: cached.etag, notModified: true }
      }
      const text = await response.text()

      if (!response.ok) {
        let parsed: unknown = null
        try {
          parsed = text ? JSON.parse(text) : null
        } catch {
          parsed = null
        }
        return { ok: false, error: parseError(response.status, parsed) }
      }

      let value: unknown
      if (opts.as === 'text') value = text
      else if (text === '') value = undefined
      else {
        try {
          value = JSON.parse(text)
        } catch {
          return { ok: false, error: { kind: 'server', status: response.status, message: 'invalid JSON in response' } }
        }
      }
      if (opts.cache && etag) cache.set(path, { etag, value })
      return { ok: true, value: value as T, etag, notModified: false }
    } catch {
      return { ok: false, error: opts.signal?.aborted ? { kind: 'aborted' } : { kind: 'network' } }
    } finally {
      clearTimeout(timer)
      opts.signal?.removeEventListener('abort', forward)
    }
  }

  function withQuery(path: string, params: Record<string, string | number | undefined>): string {
    const search = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== '') search.set(key, String(value))
    }
    const query = search.toString()
    return query ? `${path}?${query}` : path
  }

  return {
    login: (password: string, o?: RequestOptions) =>
      send<{ expiresAt: string }>('POST', '/session', { ...o, body: { password } }),
    session: (o?: RequestOptions) => send<{ expiresAt: string }>('GET', '/session', o),
    logout: (o?: RequestOptions) => send<undefined>('DELETE', '/session', o),

    deck: (o?: RequestOptions) => send<DeckInfo>('GET', '/deck', { ...o, cache: true }),
    cards: (query: CardsQuery = {}, o?: RequestOptions) =>
      send<CardList>('GET', withQuery('/cards', { ...query }), { ...o, cache: true }),
    card: (id: number, o?: RequestOptions) => send<ServerCard>('GET', `/cards/${id}`, o),
    cardVersions: (id: number, o?: RequestOptions) =>
      send<{ items: CardVersion[] }>('GET', `/cards/${id}/versions`, o),
    cardVersion: (id: number, version: number, o?: RequestOptions) =>
      send<CardVersion>('GET', `/cards/${id}/versions/${version}`, o),
    changes: (since: number, o?: RequestOptions) => send<Changes>('GET', `/changes?since=${since}`, o),

    validate: (body: Partial<ChangesetBody>, o?: RequestOptions) =>
      send<ValidationReport>('POST', '/changesets/validate', { ...o, body }),
    save: (body: ChangesetBody, o?: RequestOptions) =>
      send<SaveResult>('POST', '/changesets', { ...o, body, headers: { 'If-Match': `"r${body.baseRevision}"` } }),

    revisions: (query: { limit?: number; before?: number } = {}, o?: RequestOptions) =>
      send<{ items: RevisionInfo[] }>('GET', withQuery('/revisions', { ...query }), o),
    revision: (rev: number, o?: RequestOptions) => send<RevisionDetail>('GET', `/revisions/${rev}`, o),
    revertDraft: (rev: number, o?: RequestOptions) =>
      send<ChangesetBody>('POST', `/revisions/${rev}/revert-draft`, o),
    exportCurrent: (o?: RequestOptions) => send<string>('GET', '/export', { ...o, as: 'text' }),
    exportRevision: (rev: number, o?: RequestOptions) =>
      send<string>('GET', `/revisions/${rev}/export`, { ...o, as: 'text' }),
  }
}

export type AdminApi = ReturnType<typeof createAdminApi>
