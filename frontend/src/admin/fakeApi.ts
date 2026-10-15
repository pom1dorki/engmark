import type { AdminApi, ApiError, ApiResult, CardsQuery, RequestOptions } from './api/admin'
import {
  CARD_FIELDS,
  type CardData,
  type CardList,
  type CardVersion,
  type Changes,
  type ChangesetBody,
  type ChangesetError,
  type DeckInfo,
  type ImportReport,
  type RevisionChange,
  type RevisionDetail,
  type RevisionInfo,
  type SaveResult,
  type ServerCard,
  type ValidationReport,
  cardKey,
  pickCard,
  sameCard,
} from './types'
import { trimCard, validateCard } from './validate/validate'

const POS_CYCLE = ['verb', 'noun', 'adj', 'adv'] as const
const SYLLABLES = ['ba', 'ko', 'mi', 'ra', 'su', 'te', 'no', 'li']

function wordFor(index: number): string {
  let n = index
  let out = ''
  do {
    out += SYLLABLES[n % SYLLABLES.length]
    n = Math.floor(n / SYLLABLES.length)
  } while (n > 0)
  return out
}

export function seedCards(count: number): ServerCard[] {
  const cards: ServerCard[] = []
  for (let i = 0; i < count; i++) {
    const word = wordFor(i)
    const incomplete = i % 3 === 2
    cards.push({
      word,
      translation: `перевод ${i + 1}`,
      ipa: incomplete ? '' : `/${word}/`,
      pronunciation: incomplete ? '' : `[${word}]`,
      stressNote: 'один слог',
      pos: POS_CYCLE[i % POS_CYCLE.length],
      grammar: 'Грамматика.',
      usage: 'Контекст.',
      example: `I like the ${word} very much.`,
      exampleHighlight: word,
      exampleTranslation: 'Пример.',
      id: 101 + i,
      version: 1 + (i % 3),
      archived: false,
      archivedAt: null,
      createdRevision: 1,
      updatedRevision: 1,
      updatedAt: '2026-10-01T10:00:00Z',
    })
  }
  return cards
}

interface StoredVersion {
  version: number
  revision: number
  archived: boolean
  card: CardData
}

export interface FakeOptions {
  cards?: ServerCard[]
  revision?: number
  password?: string
  authed?: boolean
  latency?: number
}

export interface FakeApi {
  api: AdminApi
  calls: { method: string; args: unknown[] }[]
  callsOf(method: string): unknown[][]
  revision(): number
  card(id: number): ServerCard
  editCard(id: number, patch: Partial<CardData>): number
  addCard(card: Partial<CardData>): number
  archiveCard(id: number): number
  setAuthed(value: boolean): void
  failNext(method: string, error: ApiError, times?: number): void
  loseNextResponse(method: string, error: ApiError, times?: number): void
  revisionLog(): RevisionInfo[]
  timeline(): RevisionInfo[]
}

function ok<T>(value: T, etag: string | null = null): ApiResult<T> {
  return { ok: true, value, etag, notModified: false }
}

function fail<T>(error: ApiError): ApiResult<T> {
  return { ok: false, error }
}

function incomplete(card: CardData): boolean {
  return [card.ipa, card.pronunciation, card.stressNote, card.grammar, card.usage, card.example, card.exampleHighlight, card.exampleTranslation].some((v) => v === '')
}

export function createFakeApi(options: FakeOptions = {}): FakeApi {
  const password = options.password ?? 'secret'
  const latency = options.latency ?? 0
  let authed = options.authed ?? true
  let revision = options.revision ?? 1
  const cards = new Map<number, ServerCard>()
  const versions = new Map<number, StoredVersion[]>()
  const calls: FakeApi['calls'] = []
  const failures = new Map<string, { error: ApiError; times: number }>()
  const lostResponses = new Map<string, { error: ApiError; times: number }>()
  const history: RevisionInfo[] = []
  const feed: RevisionInfo[] = []
  let deckCache: DeckInfo | null = null
  let nextId = 1

  for (const card of options.cards ?? seedCards(120)) {
    cards.set(card.id, { ...card })
    versions.set(card.id, [{ version: card.version, revision: card.updatedRevision, archived: card.archived, card: pickCard(card) }])
    nextId = Math.max(nextId, card.id + 1)
  }

  for (let rev = 1; rev <= revision; rev++) {
    feed.unshift({
      revision: rev,
      baseRevision: rev - 1,
      author: rev === 1 ? 'system' : 'admin',
      message: rev === 1 ? 'Начальная загрузка из data/cards.json' : '',
      source: rev === 1 ? 'seed' : 'editor',
      created: rev === 1 ? cards.size : 0,
      updated: rev === 1 ? 0 : 1,
      archived: 0,
      restored: 0,
      importedFiles: [],
      createdAt: '2026-10-01T09:00:00Z',
    })
  }

  const wait = async (signal?: AbortSignal) => {
    if (latency > 0) await new Promise((resolve) => setTimeout(resolve, latency))
    else await Promise.resolve()
    return signal?.aborted === true
  }

  function endpoint<A extends unknown[], T>(name: string, run: (...args: A) => ApiResult<T>, needsAuth = true) {
    return async (...args: A): Promise<ApiResult<T>> => {
      calls.push({ method: name, args })
      const last = args[args.length - 1] as RequestOptions | undefined
      const signal = last && typeof last === 'object' && 'signal' in last ? last.signal : undefined
      if (await wait(signal)) return fail({ kind: 'aborted' })
      const planned = failures.get(name)
      if (planned && planned.times > 0) {
        planned.times--
        return fail(planned.error)
      }
      if (needsAuth && !authed) return fail({ kind: 'unauthenticated' })
      const result = run(...args)
      const lost = lostResponses.get(name)
      if (lost && lost.times > 0) {
        lost.times--
        return fail(lost.error)
      }
      return result
    }
  }

  function bump(counts: Partial<Pick<RevisionInfo, 'created' | 'updated' | 'archived'>>): number {
    revision += 1
    deckCache = null
    feed.unshift({
      revision,
      baseRevision: revision - 1,
      author: 'admin',
      message: '',
      source: 'editor',
      created: counts.created ?? 0,
      updated: counts.updated ?? 0,
      archived: counts.archived ?? 0,
      restored: 0,
      importedFiles: [],
      createdAt: '2026-10-02T09:00:00Z',
    })
    return revision
  }

  function versionAt(id: number, rev: number): StoredVersion | undefined {
    return [...(versions.get(id) ?? [])].reverse().find((v) => v.revision <= rev)
  }

  function record(card: ServerCard) {
    const list = versions.get(card.id) ?? []
    list.push({ version: card.version, revision: card.updatedRevision, archived: card.archived, card: pickCard(card) })
    versions.set(card.id, list)
  }

  const api = {
    login: endpoint(
      'login',
      (given: string) => {
        if (given !== password) return fail<{ expiresAt: string }>({ kind: 'unauthenticated' })
        authed = true
        return ok({ expiresAt: '2099-01-01T00:00:00Z' })
      },
      false,
    ),
    session: endpoint('session', () => (authed ? ok({ expiresAt: '2099-01-01T00:00:00Z' }) : fail<{ expiresAt: string }>({ kind: 'unauthenticated' })), false),
    logout: endpoint('logout', () => {
      authed = false
      return ok<undefined>(undefined)
    }),

    deck: endpoint('deck', () => {
      if (!deckCache) {
        const all = [...cards.values()]
        deckCache = {
          id: 1,
          slug: 'default',
          title: 'Default',
          revision,
          activeCards: all.filter((c) => !c.archived).length,
          archivedCards: all.filter((c) => c.archived).length,
        }
      }
      return ok(deckCache, `"r${revision}"`)
    }),

    cards: endpoint('cards', (query: CardsQuery = {}) => {
      const state = query.state ?? 'active'
      const q = (query.q ?? '').trim().toLowerCase()
      const limit = Math.min(query.limit ?? 50, 200)
      const offset = query.offset ?? 0
      const matched = [...cards.values()]
        .filter((c) => (state === 'archived' ? c.archived : !c.archived))
        .filter((c) => state !== 'incomplete' || incomplete(c))
        .filter((c) => !query.pos || c.pos === query.pos)
        .filter((c) => q === '' || c.word.toLowerCase().includes(q) || c.translation.toLowerCase().includes(q))
        .sort((a, b) => (a.word.toLowerCase() < b.word.toLowerCase() ? -1 : a.word.toLowerCase() > b.word.toLowerCase() ? 1 : a.id - b.id))
      const list: CardList = {
        revision,
        items: matched.slice(offset, offset + limit).map((c) => ({ ...c })),
        total: matched.length,
        limit,
        offset,
      }
      return ok(list, `"r${revision}"`)
    }),

    card: endpoint('card', (id: number) => {
      const found = cards.get(id)
      return found ? ok({ ...found }, `"v${found.version}"`) : fail<ServerCard>({ kind: 'not_found', message: 'card not found' })
    }),

    cardVersions: endpoint('cardVersions', (id: number) => {
      const list = versions.get(id)
      if (!list) return fail<{ items: CardVersion[] }>({ kind: 'not_found', message: 'card not found' })
      return ok({ items: list.map((v) => toVersion(id, v)) })
    }),

    cardVersion: endpoint('cardVersion', (id: number, version: number) => {
      const found = versions.get(id)?.find((v) => v.version === version)
      return found ? ok(toVersion(id, found)) : fail<CardVersion>({ kind: 'not_found', message: 'version not found' })
    }),

    changes: endpoint('changes', (since: number) => {
      const items: Changes['items'] = []
      for (const current of cards.values()) {
        if (current.updatedRevision <= since) continue
        const base = [...(versions.get(current.id) ?? [])].reverse().find((v) => v.revision <= since)
        items.push({ current: { ...current }, base: base ? toVersion(current.id, base) : null })
      }
      return ok<Changes>({ revision, since, items })
    }),

    validate: endpoint('validate', (body: Partial<ChangesetBody>) => {
      const files = (body.imports ?? []).filter((file) => file.cards.length > 0)
      if (files.length === 0) {
        return fail<ValidationReport>({ kind: 'validation', code: 'empty_changeset', message: 'changeset has no changes', errors: [] })
      }
      const taken = new Set([...cards.values()].filter((c) => !c.archived).map((c) => cardKey(c)))
      const imports: ImportReport[] = []
      for (const file of files) {
        const report: ImportReport = { fileName: file.fileName, added: 0, skipped: [] }
        file.cards.forEach((card, index) => {
          const key = cardKey(trimCard(card))
          if (taken.has(key)) report.skipped.push({ index, reason: 'duplicate' })
          else {
            taken.add(key)
            report.added++
          }
        })
        imports.push(report)
      }
      return ok<ValidationReport>({ revision, imports })
    }),
    save: endpoint('save', (body: ChangesetBody) => saveChangeset(body)),
    revisions: endpoint('revisions', (query: { limit?: number; before?: number } = {}) => {
      const before = query.before ?? 0
      const items = feed.filter((info) => before === 0 || info.revision < before).slice(0, query.limit ?? 30)
      return ok({ items: items.map((info) => ({ ...info, importedFiles: info.importedFiles.map((f) => ({ ...f })) })) })
    }),
    revision: endpoint('revision', (rev: number) => {
      const info = feed.find((item) => item.revision === rev)
      if (!info) return fail<RevisionDetail>({ kind: 'not_found', message: `revision r${rev} not found` })
      const changes: RevisionChange[] = []
      for (const [id, list] of [...versions].sort((a, b) => a[0] - b[0])) {
        for (const v of list) {
          if (v.revision !== rev) continue
          const previous = list.find((item) => item.version === v.version - 1)
          const kind: RevisionChange['kind'] = v.version === 1 ? 'created' : v.archived ? 'archived' : previous?.archived ? 'restored' : 'updated'
          changes.push({ cardId: id, version: v.version, kind, word: v.card.word, translation: v.card.translation })
        }
      }
      return ok<RevisionDetail>({ ...info, importedFiles: info.importedFiles.map((f) => ({ ...f })), changes })
    }),
    revertDraft: endpoint('revertDraft', (rev: number) => {
      if (rev < 1 || rev > revision) return fail<ChangesetBody>({ kind: 'not_found', message: `revision r${rev} not found` })
      const body: ChangesetBody = { baseRevision: revision, message: `Откат к r${rev}`, create: [], update: [], archive: [], restore: [], imports: [] }
      for (const current of [...cards.values()].sort((a, b) => a.id - b.id)) {
        if (current.updatedRevision <= rev) continue
        const then = versionAt(current.id, rev)
        if (!then || then.archived) {
          if (!current.archived) body.archive.push({ id: current.id, baseVersion: current.version })
          continue
        }
        if (current.archived) body.restore.push({ id: current.id, baseVersion: current.version })
        if (!sameCard(pickCard(current), then.card)) body.update.push({ id: current.id, baseVersion: current.version, card: { ...then.card } })
      }
      return ok(body)
    }),
    exportCurrent: endpoint('exportCurrent', () => {
      const active = [...cards.values()].filter((c) => !c.archived).sort((a, b) => a.id - b.id)
      return ok(JSON.stringify(active.map((c) => pickCard(c)), null, 2), `"r${revision}"`)
    }),
    exportRevision: endpoint('exportRevision', (rev: number) => {
      if (rev < 0 || rev > revision) return fail<string>({ kind: 'not_found', message: `revision r${rev} not found` })
      const state: CardData[] = []
      for (const id of [...versions.keys()].sort((a, b) => a - b)) {
        const then = versionAt(id, rev)
        if (then && !then.archived) state.push({ ...then.card })
      }
      return ok(JSON.stringify(state, null, 2), `"r${rev}"`)
    }),
  } as unknown as AdminApi

  function saveChangeset(body: ChangesetBody): ApiResult<SaveResult> {
    const invalid = (errors: ChangesetError[]) =>
      fail<SaveResult>({ kind: 'validation', code: 'invalid_argument', message: errors[0]?.message ?? 'invalid changeset', errors })

    if (body.baseRevision !== revision) return fail({ kind: 'revision_mismatch', base: body.baseRevision, current: revision })

    const importRows = body.imports.reduce((n, file) => n + file.cards.length, 0)
    if (body.create.length + body.update.length + body.archive.length + body.restore.length + importRows === 0) {
      return fail({ kind: 'validation', code: 'empty_changeset', message: 'changeset is empty', errors: [{ section: 'changeset', index: 0, code: 'empty_changeset', message: 'changeset is empty' }] })
    }

    const errors: ChangesetError[] = []
    const check = (section: string, index: number, card: CardData, extra: { id?: number; file?: string } = {}) => {
      for (const issue of validateCard(trimCard(card))) {
        errors.push({ section, index, ...extra, field: issue.field, code: issue.code, message: issue.message })
      }
    }
    body.create.forEach((card, i) => check('create', i, card))
    body.update.forEach((item, i) => check('update', i, item.card, { id: item.id }))
    body.imports.forEach((file) => file.cards.forEach((card, i) => check('imports', i, card, { file: file.fileName })))
    if ((body.message ?? '').trim().length > 500) errors.push({ section: 'changeset', index: 0, field: 'message', code: 'too_long', message: 'message too long' })
    if (errors.length > 0) return invalid(errors)

    const staged = new Map<number, ServerCard>()
    const current = (id: number) => staged.get(id) ?? cards.get(id)
    const pairedRestore = new Set(body.restore.map((ref) => ref.id))

    const noChanges: ChangesetError[] = []
    body.update.forEach((item, i) => {
      const card = cards.get(item.id)
      if (pairedRestore.has(item.id) || !card || card.version !== item.baseVersion || card.archived) return
      if (sameCard(pickCard(card), trimCard(item.card))) noChanges.push({ section: 'update', index: i, id: item.id, code: 'no_changes', message: `card ${item.id} is unchanged` })
    })
    if (noChanges.length > 0) return fail({ kind: 'validation', code: 'no_changes', message: noChanges[0].message, errors: noChanges })

    const taken = new Set([...cards.values()].filter((c) => !c.archived).map((c) => cardKey(pickCard(c))))
    const rev = revision + 1
    const touched: ServerCard[] = []
    const touch = (card: ServerCard, patch: Partial<ServerCard>) => {
      const next: ServerCard = { ...card, ...patch, version: card.version + 1, updatedRevision: rev, updatedAt: '2026-10-12T10:00:00Z' }
      staged.set(card.id, next)
      touched.push(next)
      return next
    }
    const load = (id: number, baseVersion: number): ServerCard | ApiError => {
      const card = current(id)
      if (!card) return { kind: 'not_found', message: 'card not found' }
      if (card.version !== baseVersion) return { kind: 'version_mismatch', id, expected: baseVersion, actual: card.version }
      return card
    }
    const isError = (value: ServerCard | ApiError): value is ApiError => 'kind' in value

    for (const ref of body.archive) {
      const card = load(ref.id, ref.baseVersion)
      if (isError(card)) return fail(card)
      if (card.archived) return invalid([{ section: 'archive', index: body.archive.indexOf(ref), id: ref.id, code: 'invalid_argument', message: 'card is already archived' }])
      taken.delete(cardKey(pickCard(card)))
      touch(card, { archived: true, archivedAt: '2026-10-12T10:00:00Z' })
    }

    for (const [i, item] of body.update.entries()) {
      if (pairedRestore.has(item.id)) continue
      const card = load(item.id, item.baseVersion)
      if (isError(card)) return fail(card)
      if (card.archived) return invalid([{ section: 'update', index: i, id: item.id, code: 'invalid_argument', message: 'card is archived' }])
      const next = trimCard(item.card)
      const was = cardKey(pickCard(card))
      const now = cardKey(next)
      if (was !== now) {
        taken.delete(was)
        if (taken.has(now)) return fail({ kind: 'duplicate_card', section: 'update', index: i, id: item.id })
        taken.add(now)
      }
      touch(card, next)
    }

    for (const [i, ref] of body.restore.entries()) {
      const card = load(ref.id, ref.baseVersion)
      if (isError(card)) return fail(card)
      if (!card.archived) return invalid([{ section: 'restore', index: i, id: ref.id, code: 'invalid_argument', message: 'card is not archived' }])
      const edit = body.update.find((item) => item.id === ref.id)
      const data = edit ? trimCard(edit.card) : pickCard(card)
      const key = cardKey(data)
      if (taken.has(key)) return fail({ kind: 'duplicate_card', section: 'restore', index: i, id: ref.id })
      taken.add(key)
      touch(card, { ...data, archived: false, archivedAt: null })
    }

    let id = nextId
    const created: SaveResult['created'] = []
    const fresh = (card: CardData): ServerCard => ({
      ...trimCard(card),
      id: id++,
      version: 1,
      archived: false,
      archivedAt: null,
      createdRevision: rev,
      updatedRevision: rev,
      updatedAt: '2026-10-12T10:00:00Z',
    })
    const added: ServerCard[] = []
    for (const [i, card] of body.create.entries()) {
      const key = cardKey(trimCard(card))
      if (taken.has(key)) return fail({ kind: 'duplicate_card', section: 'create', index: i, id: null })
      taken.add(key)
      const made = fresh(card)
      added.push(made)
      created.push({ tempIndex: i, id: made.id })
    }

    const imports: ImportReport[] = []
    for (const file of body.imports) {
      const report: ImportReport = { fileName: file.fileName, added: 0, skipped: [] }
      file.cards.forEach((card, index) => {
        const key = cardKey(trimCard(card))
        if (taken.has(key)) {
          report.skipped.push({ index, reason: 'duplicate' })
          return
        }
        taken.add(key)
        added.push(fresh(card))
        report.added++
      })
      imports.push(report)
    }

    for (const [cardId, card] of staged) cards.set(cardId, card)
    for (const card of added) cards.set(card.id, card)
    nextId = id
    revision = rev
    deckCache = null
    for (const card of [...touched, ...added]) record(card)

    const files = body.imports.filter((file) => file.cards.length > 0)
    const names = files.map((file) => file.fileName.trim())
    const onlyImport = body.create.length + body.update.length + body.archive.length + body.restore.length === 0
    const typed = (body.message ?? '').trim()
    const message = typed !== '' ? typed : names.length === 0 ? 'Правки карточек' : onlyImport ? `Импорт: ${names.join(', ')}` : `Импорт: ${names.join(', ')} и правки`
    const recorded: RevisionInfo = {
      revision: rev,
      baseRevision: body.baseRevision,
      author: 'admin',
      message,
      source: onlyImport && importRows > 0 ? 'import' : 'editor',
      created: body.create.length + imports.reduce((n, report) => n + report.added, 0),
      updated: body.update.length,
      archived: body.archive.length,
      restored: body.restore.length,
      importedFiles: imports.filter((report) => report.added + report.skipped.length > 0).map((report) => ({ name: report.fileName.trim(), added: report.added, skipped: report.skipped.length })),
      createdAt: '2026-10-12T10:00:00Z',
    }
    history.unshift(recorded)
    feed.unshift(recorded)

    return ok<SaveResult>(
      { revision: rev, created, updated: touched.map((card) => ({ id: card.id, version: card.version })), imports },
      `"r${rev}"`,
    )
  }

  function toVersion(id: number, v: StoredVersion): CardVersion {
    return { cardId: id, version: v.version, revision: v.revision, archived: v.archived, createdAt: '2026-10-01T10:00:00Z', card: { ...v.card } }
  }

  return {
    api,
    calls,
    callsOf: (method) => calls.filter((c) => c.method === method).map((c) => c.args),
    revision: () => revision,
    card: (id) => {
      const found = cards.get(id)
      if (!found) throw new Error(`fakeApi: нет карточки ${id}`)
      return { ...found }
    },
    editCard(id, patch) {
      const current = cards.get(id)
      if (!current) throw new Error(`fakeApi: нет карточки ${id}`)
      const rev = bump({ updated: 1 })
      const next: ServerCard = { ...current, ...patch, version: current.version + 1, updatedRevision: rev }
      for (const field of CARD_FIELDS) if (typeof next[field] !== 'string') next[field] = ''
      cards.set(id, next)
      record(next)
      return rev
    },
    addCard(card) {
      const rev = bump({ created: 1 })
      const created: ServerCard = {
        ...pickCard({ word: 'newword', translation: 'новое', pos: 'noun', ...card }),
        id: nextId++,
        version: 1,
        archived: false,
        archivedAt: null,
        createdRevision: rev,
        updatedRevision: rev,
        updatedAt: '2026-10-02T10:00:00Z',
      }
      cards.set(created.id, created)
      record(created)
      return rev
    },
    archiveCard(id) {
      const current = cards.get(id)
      if (!current) throw new Error(`fakeApi: нет карточки ${id}`)
      const rev = bump({ archived: 1 })
      const next: ServerCard = { ...current, archived: true, archivedAt: '2026-10-02T10:00:00Z', version: current.version + 1, updatedRevision: rev }
      cards.set(id, next)
      record(next)
      return rev
    },
    setAuthed(value) {
      authed = value
    },
    failNext(method, error, times = 1) {
      failures.set(method, { error, times })
    },
    loseNextResponse(method, error, times = 1) {
      lostResponses.set(method, { error, times })
    },
    revisionLog: () => history.map((info) => ({ ...info })),
    timeline: () => feed.map((info) => ({ ...info })),
  }
}
