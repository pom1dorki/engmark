import type { AdminApi, ApiError } from './api/admin'
import { draftFromChangeset } from './changeset'
import { type Draft, draftCounts } from './draft/draft'
import { type CardData, type ChangesetBody, pickCard } from './types'

export type RevertResult =
  | { kind: 'draft'; draft: Draft }
  | { kind: 'nothing' }
  | { kind: 'stale' }
  | { kind: 'error'; error: ApiError }

function touchedIds(body: ChangesetBody): number[] {
  const ids = new Set<number>()
  for (const item of body.update) ids.add(item.id)
  for (const ref of body.archive) ids.add(ref.id)
  for (const ref of body.restore) ids.add(ref.id)
  return [...ids]
}

function versionsOf(body: ChangesetBody): Map<number, number> {
  const versions = new Map<number, number>()
  for (const item of body.update) versions.set(item.id, item.baseVersion)
  for (const ref of [...body.archive, ...body.restore]) versions.set(ref.id, ref.baseVersion)
  return versions
}

export async function prepareRevert(api: AdminApi, deckId: number, rev: number, signal?: AbortSignal): Promise<RevertResult> {
  const [built, changes] = await Promise.all([api.revertDraft(rev, { signal }), api.changes(rev, { signal })])
  if (!built.ok) return { kind: 'error', error: built.error }
  if (!changes.ok) return { kind: 'error', error: changes.error }

  const body = built.value
  const ids = touchedIds(body)
  if (ids.length === 0 && body.create.length === 0) return { kind: 'nothing' }
  if (changes.value.revision !== body.baseRevision) return { kind: 'stale' }

  const bases: Record<number, CardData> = {}
  const current = new Map(changes.value.items.map((item) => [item.current.id, item.current]))
  const expected = versionsOf(body)
  for (const id of ids) {
    const card = current.get(id)
    if (!card || card.version !== expected.get(id)) return { kind: 'stale' }
    bases[id] = pickCard(card)
  }
  return { kind: 'draft', draft: draftFromChangeset(body, deckId, bases) }
}

export function revertSummary(draft: Draft): string {
  const counts = draftCounts(draft)
  const parts: string[] = []
  if (counts.updated > 0) parts.push(`изменено ${counts.updated}`)
  if (counts.restored > 0) parts.push(`вернётся из архива ${counts.restored}`)
  if (counts.archived > 0) parts.push(`уйдёт в архив ${counts.archived}`)
  if (counts.created > 0) parts.push(`новых ${counts.created}`)
  return parts.join(', ')
}
