import type { Draft } from './draft/draft'
import { isCreateKey } from './draft/draft'
import { type CardData, type ServerCard, emptyCard, pickCard } from './types'

export type EditorTarget =
  | { kind: 'new' }
  | { kind: 'create'; key: string }
  | { kind: 'card'; id: number; version?: number }

export function targetKey(target: EditorTarget): string | null {
  switch (target.kind) {
    case 'new':
      return null
    case 'create':
      return target.key
    case 'card':
      return String(target.id)
  }
}

export function targetForKey(key: string): EditorTarget {
  return isCreateKey(key) ? { kind: 'create', key } : { kind: 'card', id: Number(key) }
}

export type EditorMode = 'edit' | 'archived' | 'archiving'

export interface EditorModel {
  key: string | null
  id: number | null
  mode: EditorMode
  base: CardData | null
  baseVersion: number | null
  initial: CardData
  inDraft: 'create' | 'update' | 'archive' | 'restore' | null
}

export function needsFetch(target: EditorTarget, draft: Draft): boolean {
  return target.kind === 'card' && !(String(target.id) in draft.items)
}

export function resolveEditor(target: EditorTarget, draft: Draft, fetched: ServerCard | null): EditorModel | null {
  if (target.kind === 'new') {
    return { key: null, id: null, mode: 'edit', base: null, baseVersion: null, initial: emptyCard(), inDraft: null }
  }

  const key = targetKey(target) as string
  const item = draft.items[key]

  if (item) {
    const id = isCreateKey(key) ? null : Number(key)
    switch (item.kind) {
      case 'create':
        return { key, id, mode: 'edit', base: null, baseVersion: null, initial: item.card, inDraft: 'create' }
      case 'update':
        return { key, id, mode: 'edit', base: item.base, baseVersion: item.baseVersion, initial: item.card, inDraft: 'update' }
      case 'archive':
        return { key, id, mode: 'archiving', base: item.base, baseVersion: item.baseVersion, initial: item.base, inDraft: 'archive' }
      case 'restore':
        return { key, id, mode: 'edit', base: item.base, baseVersion: item.baseVersion, initial: item.card ?? item.base, inDraft: 'restore' }
    }
  }

  if (!fetched) return null
  const base = pickCard(fetched)
  return {
    key,
    id: fetched.id,
    mode: fetched.archived ? 'archived' : 'edit',
    base,
    baseVersion: fetched.version,
    initial: base,
    inDraft: null,
  }
}

export function splitHighlight(example: string, highlight: string): [string, string, string] | null {
  if (highlight === '') return null
  const at = example.toLowerCase().indexOf(highlight.toLowerCase())
  if (at < 0) return null
  return [example.slice(0, at), example.slice(at, at + highlight.length), example.slice(at + highlight.length)]
}
