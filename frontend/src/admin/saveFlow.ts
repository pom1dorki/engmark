import { type AdminApi, type ApiError, describeError } from './api/admin'
import { type BuiltChangeset, toChangeset } from './changeset'
import { type Draft, type DraftItem, draftCounts, isCreateKey } from './draft/draft'
import { FIELD_LABELS, plural } from './labels'
import { type Conflict, type MergeResult, mergeDraft } from './merge/merge'
import { CARD_FIELDS, type CardData, type CardField, type ChangesetBody, type ChangesetError, type RevisionInfo, type SaveResult } from './types'
import { FIELD_CODES, type FieldCode, MAX_FILE_NAME } from './validate/rules'
import { issueMessage } from './validate/validate'

export const MAX_MESSAGE = 500


export function generatedMessage(body: ChangesetBody): string {
  const names = body.imports.filter((file) => file.cards.length > 0).map((file) => file.fileName.trim())
  const importOnly = body.create.length + body.update.length + body.archive.length + body.restore.length === 0
  if (names.length > 0) return importOnly ? `Импорт: ${names.join(', ')}` : `Импорт: ${names.join(', ')} и правки`
  return 'Правки карточек'
}

export function suggestedMessage(draft: Draft): string {
  return draft.message?.trim() || generatedMessage(toChangeset(draft).body)
}

export interface ChangeSummary {
  added: number
  changed: number
  archived: number
}

export function changeSummary(draft: Draft): ChangeSummary {
  const counts = draftCounts(draft)
  return { added: counts.created + counts.imported + counts.restored, changed: counts.updated, archived: counts.archived }
}

export function summaryText(draft: Draft): string {
  const { added, changed, archived } = changeSummary(draft)
  return `r${draft.baseRevision} → r${draft.baseRevision + 1} · +${added} ~${changed} −${archived}`
}


export interface ReviewItem {
  key: string
  kind: DraftItem['kind']
  word: string
  translation: string
  version: string
  changed: string
}

export function changedFields(base: CardData, card: CardData): CardField[] {
  return CARD_FIELDS.filter((field) => base[field] !== card[field])
}

function createNumber(key: string): number {
  return Number(key.replace(/^tmp-/, ''))
}

export function reviewItems(draft: Draft): ReviewItem[] {
  const items: ReviewItem[] = []
  for (const [key, item] of Object.entries(draft.items)) {
    switch (item.kind) {
      case 'create':
        items.push({ key, kind: 'create', word: item.card.word, translation: item.card.translation, version: 'новая · v1', changed: '' })
        break
      case 'update':
        items.push({
          key,
          kind: 'update',
          word: item.card.word,
          translation: item.card.translation,
          version: `v${item.baseVersion} → v${item.baseVersion + 1}`,
          changed: changedFields(item.base, item.card).map((field) => FIELD_LABELS[field]).join(', '),
        })
        break
      case 'archive':
        items.push({ key, kind: 'archive', word: item.base.word, translation: item.base.translation, version: `v${item.baseVersion} → v${item.baseVersion + 1}`, changed: '' })
        break
      case 'restore': {
        const card = item.card ?? item.base
        items.push({
          key,
          kind: 'restore',
          word: card.word,
          translation: card.translation,
          version: `v${item.baseVersion} → v${item.baseVersion + 1}`,
          changed: item.card ? changedFields(item.base, item.card).map((field) => FIELD_LABELS[field]).join(', ') : '',
        })
        break
      }
    }
  }
  return items.sort((a, b) => {
    if (a.kind === 'create' && b.kind === 'create') return createNumber(a.key) - createNumber(b.key)
    if (a.kind === 'create') return -1
    if (b.kind === 'create') return 1
    return a.word.toLowerCase().localeCompare(b.word.toLowerCase()) || Number(a.key) - Number(b.key)
  })
}


export interface Problem {
  key: string
  messages: string[]
}

export interface Rejection {
  problems: Problem[]
  general: string[]
}

export const importProblemKey = (index: number) => `import:${index}`
export const isImportProblemKey = (key: string) => key.startsWith('import:')

function isFieldCode(code: string): code is FieldCode {
  return (FIELD_CODES as readonly string[]).includes(code)
}

export function describeIssue(error: ChangesetError): string {
  const field = error.field
  if (field && (CARD_FIELDS as readonly string[]).includes(field) && isFieldCode(error.code)) {
    return `${FIELD_LABELS[field as CardField]}: ${issueMessage(field as CardField, error.code)}`
  }
  switch (error.code) {
    case 'no_changes':
      return 'Карточка не отличается от сохранённой.'
    case 'empty_changeset':
      return 'В черновике нет изменений.'
    case 'duplicate_card':
      return 'Такая новая карточка уже есть среди ваших новых (слово, часть речи и перевод совпадают).'
    case 'too_long':
      return field === 'message' ? `Комментарий слишком длинный (не больше ${MAX_MESSAGE} символов).` : error.message
    case 'invalid_file':
      return `Имя файла должно быть от 1 до ${MAX_FILE_NAME} символов.`
  }
  return error.message
}

function keyForSection(built: BuiltChangeset, section: string, index: number): string | null {
  switch (section) {
    case 'create':
      return built.createKeys[index] ?? null
    case 'update':
      return built.updateKeys[index] ?? null
    case 'archive':
      return built.archiveKeys[index] ?? null
    case 'restore':
      return built.restoreKeys[index] ?? null
  }
  return null
}

function addProblem(problems: Problem[], key: string, message: string) {
  const found = problems.find((problem) => problem.key === key)
  if (found) {
    if (!found.messages.includes(message)) found.messages.push(message)
  } else problems.push({ key, messages: [message] })
}

export function rejectionFrom(error: ApiError, built: BuiltChangeset): Rejection {
  const problems: Problem[] = []
  const general: string[] = []

  if (error.kind === 'duplicate_card') {
    const key = error.section !== null && error.index !== null ? keyForSection(built, error.section, error.index) : null
    const text = 'Такая карточка уже есть в колоде: слово, часть речи и перевод совпадают с активной карточкой.'
    if (key) addProblem(problems, key, text)
    else general.push(text)
    return { problems, general }
  }

  if (error.kind === 'validation') {
    for (const item of error.errors) {
      const text = describeIssue(item)
      if (item.section === 'imports') {
        const at = built.body.imports.findIndex((file) => file.fileName === item.file)
        const draftIndex = built.importIndexes[at]
        if (draftIndex === undefined) general.push(`Файл «${item.file ?? ''}»: ${text}`)
        else addProblem(problems, importProblemKey(draftIndex), item.field ? `Строка ${item.index + 1}. ${text}` : text)
        continue
      }
      const key = keyForSection(built, item.section, item.index)
      if (key) addProblem(problems, key, text)
      else if (!general.includes(text)) general.push(text)
    }
    if (problems.length === 0 && general.length === 0) general.push(describeError(error))
  }
  return { problems, general }
}

export interface ProblemState {
  problems: Problem[]
  general: string[]
  marks: Record<string, unknown>
}

export function markProblems(draft: Draft, rejection: Rejection): ProblemState {
  const marks: Record<string, unknown> = {}
  for (const problem of rejection.problems) {
    marks[problem.key] = isImportProblemKey(problem.key) ? draft.imports[Number(problem.key.slice('import:'.length))] : draft.items[problem.key]
  }
  return { problems: rejection.problems, general: rejection.general, marks }
}

export function activeProblems(state: ProblemState | null, draft: Draft): { problems: Problem[]; general: string[] } {
  if (!state) return { problems: [], general: [] }
  const problems = state.problems.filter((problem) => {
    const now = isImportProblemKey(problem.key) ? draft.imports[Number(problem.key.slice('import:'.length))] : draft.items[problem.key]
    return now !== undefined && now === state.marks[problem.key]
  })
  return { problems, general: state.general }
}

export function problemLabel(draft: Draft, key: string): string {
  if (isImportProblemKey(key)) {
    const file = draft.imports[Number(key.slice('import:'.length))]
    return file ? `Файл «${file.fileName}»` : 'Файл'
  }
  const item = draft.items[key]
  if (!item) return key
  switch (item.kind) {
    case 'create':
    case 'update':
      return item.card.word
    case 'archive':
      return item.base.word
    case 'restore':
      return (item.card ?? item.base).word
  }
}

export function firstCardProblem(problems: Problem[]): Problem | null {
  return problems.find((problem) => !isImportProblemKey(problem.key)) ?? null
}


export type LostResponse =
  | { kind: 'applied'; revision: number }
  | { kind: 'not_applied' }
  | { kind: 'moved'; current: number }
  | { kind: 'unknown' }

function sameFiles(info: RevisionInfo, body: ChangesetBody): boolean {
  const sent = body.imports.filter((file) => file.cards.length > 0)
  if (info.importedFiles.length !== sent.length) return false
  return sent.every((file, i) => {
    const got = info.importedFiles[i]
    return got.name === file.fileName.trim() && got.added + got.skipped === file.cards.length
  })
}

export function revisionMatches(info: RevisionInfo, body: ChangesetBody): boolean {
  const importRows = body.imports.reduce((n, file) => n + file.cards.length, 0)
  const importOnly = body.create.length + body.update.length + body.archive.length + body.restore.length === 0
  const message = (body.message ?? '').trim() || generatedMessage(body)
  return (
    info.revision === body.baseRevision + 1 &&
    info.baseRevision === body.baseRevision &&
    info.author === 'admin' &&
    info.source === (importOnly && importRows > 0 ? 'import' : 'editor') &&
    info.message === message &&
    info.created >= body.create.length &&
    info.created <= body.create.length + importRows &&
    info.updated === body.update.length &&
    info.archived === body.archive.length &&
    info.restored === body.restore.length &&
    sameFiles(info, body)
  )
}

export async function checkLostResponse(api: AdminApi, body: ChangesetBody, signal?: AbortSignal): Promise<LostResponse> {
  const deck = await api.deck({ signal })
  if (!deck.ok) return { kind: 'unknown' }
  if (deck.value.revision <= body.baseRevision) return { kind: 'not_applied' }

  const list = await api.revisions({ limit: 1, before: body.baseRevision + 2 }, { signal })
  if (!list.ok) return { kind: 'unknown' }
  const info = list.value.items[0]
  if (info && revisionMatches(info, body)) return { kind: 'applied', revision: info.revision }
  return { kind: 'moved', current: deck.value.revision }
}


export type SaveOutcome =
  | { kind: 'saved'; revision: number; result: SaveResult | null; recovered: boolean; built: BuiltChangeset }
  | { kind: 'conflict'; merge: MergeResult; serverRevision: number; cause: 'revision' | 'version' }
  | { kind: 'stale'; error: ApiError }
  | { kind: 'rejected'; rejection: Rejection }
  | { kind: 'unauthenticated' }
  | { kind: 'failed'; error: ApiError }
  | { kind: 'aborted' }

async function resolveMismatch(api: AdminApi, draft: Draft, cause: 'revision' | 'version', error: ApiError, signal?: AbortSignal): Promise<SaveOutcome> {
  const changes = await api.changes(draft.baseRevision, { signal })
  if (!changes.ok) return changes.error.kind === 'aborted' ? { kind: 'aborted' } : changes.error.kind === 'unauthenticated' ? { kind: 'unauthenticated' } : { kind: 'failed', error: changes.error }
  if (changes.value.revision <= draft.baseRevision) return { kind: 'stale', error }
  return { kind: 'conflict', merge: mergeDraft(draft, changes.value), serverRevision: changes.value.revision, cause }
}

export async function runSave(api: AdminApi, draft: Draft, message: string, signal?: AbortSignal): Promise<SaveOutcome> {
  const built = toChangeset(draft, message)
  const sent = await api.save(built.body, { signal })
  if (sent.ok) return { kind: 'saved', revision: sent.value.revision, result: sent.value, recovered: false, built }

  const error = sent.error
  switch (error.kind) {
    case 'aborted':
      return { kind: 'aborted' }
    case 'unauthenticated':
      return { kind: 'unauthenticated' }
    case 'revision_mismatch':
      return resolveMismatch(api, draft, 'revision', error, signal)
    case 'version_mismatch':
      return resolveMismatch(api, draft, 'version', error, signal)
    case 'duplicate_card':
    case 'validation':
      return { kind: 'rejected', rejection: rejectionFrom(error, built) }
    case 'network':
      return afterLostResponse(api, draft, built, error, signal)
    case 'server':
      return error.status >= 500 ? afterLostResponse(api, draft, built, error, signal) : { kind: 'failed', error }
    default:
      return { kind: 'failed', error }
  }
}

async function afterLostResponse(api: AdminApi, draft: Draft, built: BuiltChangeset, error: ApiError, signal?: AbortSignal): Promise<SaveOutcome> {
  const lost = await checkLostResponse(api, built.body, signal)
  switch (lost.kind) {
    case 'applied':
      return { kind: 'saved', revision: lost.revision, result: null, recovered: true, built }
    case 'moved':
      return resolveMismatch(api, draft, 'revision', { kind: 'revision_mismatch', base: draft.baseRevision, current: lost.current }, signal)
    default:
      return { kind: 'failed', error }
  }
}


export interface ConflictGroup {
  key: string
  word: string
  serverVersion: number
  conflict: Conflict | null
  auto: CardField[]
}

export function conflictGroups(merge: MergeResult): ConflictGroup[] {
  const groups = new Map<string, ConflictGroup>()
  for (const conflict of merge.conflicts) {
    groups.set(conflict.key, {
      key: conflict.key,
      word: conflict.word,
      serverVersion: 'serverVersion' in conflict ? conflict.serverVersion : 0,
      conflict,
      auto: [],
    })
  }
  for (const auto of merge.autoMerged) {
    const group = groups.get(auto.key)
    if (group) group.auto = auto.fields
    else groups.set(auto.key, { key: auto.key, word: auto.word, serverVersion: auto.serverVersion, conflict: null, auto: auto.fields })
  }
  return [...groups.values()]
}

export interface ConflictCounts {
  fields: number
  cards: number
  auto: number
}

export function conflictCounts(merge: MergeResult): ConflictCounts {
  let fields = 0
  let cards = 0
  for (const conflict of merge.conflicts) {
    if (conflict.kind === 'fields') fields += conflict.fields.length
    else cards++
  }
  return { fields, cards, auto: merge.autoMerged.reduce((n, item) => n + item.fields.length, 0) }
}

export function conflictSummary(counts: ConflictCounts): string {
  const parts: string[] = []
  if (counts.fields > 0) parts.push(`В ${counts.fields} ${plural(counts.fields, 'поле', 'полях', 'полях')} вы и кто-то ещё внесли разные правки.`)
  if (counts.cards > 0) parts.push(`${counts.cards} ${plural(counts.cards, 'карточка требует', 'карточки требуют', 'карточек требуют')} отдельного решения.`)
  if (counts.fields + counts.cards > 0) parts.push('Выберите, что оставить.')
  else parts.push('Ваши правки ни с чем не пересеклись, выбирать ничего не нужно.')
  if (counts.auto > 0) {
    const n = counts.auto
    parts.push(`Ещё ${n} ${plural(n, 'поле', 'поля', 'полей')} с сервера ${plural(n, 'подтянется', 'подтянутся', 'подтянутся')} автоматически, вы ${plural(n, 'его', 'их', 'их')} не меняли.`)
  }
  return parts.join(' ')
}


export function savedMessage(outcome: Extract<SaveOutcome, { kind: 'saved' }>): string {
  const base = `Сохранено как r${outcome.revision}. Каталог для учеников обновлён`
  if (outcome.recovered) return `${base}. Ответ сервера потерялся по дороге, но запись нашлась в истории`
  const skipped = (outcome.result?.imports ?? []).filter((file) => file.skipped.length > 0)
  if (skipped.length === 0) return base
  const files = skipped.map((file) => `«${file.fileName}»: добавлено ${file.added}, пропущено как дубли ${file.skipped.length}`)
  return `${base}. ${files.join('; ')}`
}

export function createdIds(built: BuiltChangeset, result: SaveResult | null): Record<string, number> {
  const out: Record<string, number> = {}
  for (const created of result?.created ?? []) {
    const key = built.createKeys[created.tempIndex]
    if (key !== undefined && isCreateKey(key)) out[key] = created.id
  }
  return out
}

export function describeFailure(error: ApiError): string {
  return `Не удалось сохранить, черновик на месте. ${describeError(error)}`
}
