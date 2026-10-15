import { FIELD_LABELS, plural } from './labels'
import { CARD_FIELDS, type CardData, type CardField, type CardVersion, type RevisionChange, type RevisionInfo } from './types'

export const REVISIONS_PAGE = 30

export const CHANGES_PAGE = 100

export function authorLabel(author: string): string {
  if (author === 'admin') return 'Вы'
  if (author === 'system') return 'система'
  return author
}

export function revisionTitle(rev: RevisionInfo): string {
  const message = rev.message.trim()
  if (message !== '') return message
  const files = rev.importedFiles.map((file) => file.name)
  switch (rev.source) {
    case 'seed':
      return 'Начальная загрузка из data/cards.json'
    case 'import':
      return files.length > 0 ? `Импорт: ${files.join(', ')}` : 'Импорт'
    case 'revert':
      return 'Откат'
    default:
      return files.length > 0 ? `Импорт: ${files.join(', ')} и правки` : 'Правки карточек'
  }
}

export interface RevisionBadges {
  added: number
  changed: number
  archived: number
}

export function revisionBadges(rev: RevisionInfo): RevisionBadges {
  return { added: rev.created + rev.restored, changed: rev.updated, archived: rev.archived }
}

export function addedHint(rev: RevisionInfo): string {
  const parts = [`новых ${rev.created}`]
  if (rev.restored > 0) parts.push(`возвращено из архива ${rev.restored}`)
  return parts.join(', ')
}

export function baseLabel(rev: RevisionInfo): string {
  return rev.baseRevision > 0 ? `основа r${rev.baseRevision}` : 'первая ревизия'
}

export function importedFileText(file: RevisionInfo['importedFiles'][number]): string {
  return file.skipped > 0 ? `${file.name} · +${file.added}, пропущено ${file.skipped}` : `${file.name} · +${file.added}`
}

export function mergeRevisions(current: RevisionInfo[], incoming: RevisionInfo[]): RevisionInfo[] {
  const byNumber = new Map<number, RevisionInfo>()
  for (const rev of current) byNumber.set(rev.revision, rev)
  for (const rev of incoming) byNumber.set(rev.revision, rev)
  return [...byNumber.values()].sort((a, b) => b.revision - a.revision)
}

export function hasOlderRevisions(items: RevisionInfo[]): boolean {
  const oldest = items[items.length - 1]
  return oldest !== undefined && oldest.revision > 1
}

export function exportFileName(revision: number): string {
  return `engmark-r${revision}.json`
}

export function revisionFromEtag(etag: string | null): number | null {
  const match = etag === null ? null : /^(?:W\/)?"r(\d+)"$/.exec(etag.trim())
  return match ? Number(match[1]) : null
}

export const CHANGE_KIND_LABEL: Record<RevisionChange['kind'], string> = {
  created: 'Новая',
  updated: 'Изменена',
  archived: 'В архив',
  restored: 'Возврат',
}

export function changeKindClass(kind: RevisionChange['kind']): string {
  switch (kind) {
    case 'created':
    case 'restored':
      return 'tag new'
    case 'archived':
      return 'tag del'
    default:
      return 'tag mod'
  }
}

export function cardsCountText(n: number): string {
  return `${n} ${plural(n, 'карточка', 'карточки', 'карточек')}`
}


const FORM_ORDER: CardField[] = [
  'word',
  'pos',
  'translation',
  'ipa',
  'pronunciation',
  'stressNote',
  'grammar',
  'usage',
  'example',
  'exampleHighlight',
  'exampleTranslation',
]

if (FORM_ORDER.length !== CARD_FIELDS.length || !CARD_FIELDS.every((field) => FORM_ORDER.includes(field))) {
  throw new Error('history.ts: FORM_ORDER не совпадает с CARD_FIELDS')
}

export function differingFields(a: CardData, b: CardData): CardField[] {
  return FORM_ORDER.filter((field) => a[field] !== b[field])
}

export interface VersionDiffRow {
  field: CardField
  label: string
  then: string
  now: string
}

export function versionDiff(version: CardVersion, current: CardVersion): VersionDiffRow[] {
  return differingFields(version.card, current.card).map((field) => ({
    field,
    label: FIELD_LABELS[field],
    then: version.card[field],
    now: current.card[field],
  }))
}

export function versionLabel(version: CardVersion): string {
  return `v${version.version} · r${version.revision}`
}

export function newestFirst(versions: CardVersion[]): CardVersion[] {
  return [...versions].sort((a, b) => b.version - a.version)
}
