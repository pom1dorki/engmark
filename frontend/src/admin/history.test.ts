import { describe, expect, it } from 'vitest'
import {
  addedHint,
  authorLabel,
  baseLabel,
  cardsCountText,
  changeKindClass,
  differingFields,
  exportFileName,
  hasOlderRevisions,
  importedFileText,
  mergeRevisions,
  newestFirst,
  revisionBadges,
  revisionFromEtag,
  revisionTitle,
  versionDiff,
  versionLabel,
} from './history'
import { makeCard } from './testkit'
import type { CardVersion, RevisionInfo } from './types'

function rev(revision: number, overrides: Partial<RevisionInfo> = {}): RevisionInfo {
  return {
    revision,
    baseRevision: revision - 1,
    author: 'admin',
    message: '',
    source: 'editor',
    created: 0,
    updated: 0,
    archived: 0,
    restored: 0,
    importedFiles: [],
    createdAt: '2026-10-02T18:02:00Z',
    ...overrides,
  }
}

function version(n: number, revision: number, card = makeCard(), archived = false): CardVersion {
  return { cardId: 7, version: n, revision, archived, createdAt: '2026-10-02T18:02:00Z', card }
}

describe('revisionTitle', () => {
  it('prefers the comment and trims it', () => {
    expect(revisionTitle(rev(5, { message: '  Правки примеров ' }))).toBe('Правки примеров')
  })

  it('makes a title from the source when there is no comment', () => {
    expect(revisionTitle(rev(1, { source: 'seed' }))).toBe('Начальная загрузка из data/cards.json')
    expect(revisionTitle(rev(2, { source: 'import', importedFiles: [{ name: 'a.json', added: 3, skipped: 0 }, { name: 'b.json', added: 1, skipped: 0 }] }))).toBe('Импорт: a.json, b.json')
    expect(revisionTitle(rev(3, { source: 'import' }))).toBe('Импорт')
    expect(revisionTitle(rev(4))).toBe('Правки карточек')
    expect(revisionTitle(rev(5, { importedFiles: [{ name: 'a.json', added: 3, skipped: 0 }] }))).toBe('Импорт: a.json и правки')
    expect(revisionTitle(rev(6, { source: 'revert' }))).toBe('Откат')
  })
})

describe('labels of a revision', () => {
  it('names the author the way the mock-up does', () => {
    expect(authorLabel('admin')).toBe('Вы')
    expect(authorLabel('system')).toBe('система')
    expect(authorLabel('someone')).toBe('someone')
  })

  it('counts returns from the archive with the added cards, like the save window does', () => {
    const info = rev(9, { created: 7, restored: 1, updated: 2, archived: 3 })
    expect(revisionBadges(info)).toEqual({ added: 8, changed: 2, archived: 3 })
    expect(addedHint(info)).toBe('новых 7, возвращено из архива 1')
    expect(addedHint(rev(9, { created: 4 }))).toBe('новых 4')
  })

  it('tells the base revision or that it is the first one', () => {
    expect(baseLabel(rev(43))).toBe('основа r42')
    expect(baseLabel(rev(1, { baseRevision: 0 }))).toBe('первая ревизия')
  })

  it('writes an imported file with the number of skipped rows only when there are some', () => {
    expect(importedFileText({ name: 'travel.json', added: 7, skipped: 1 })).toBe('travel.json · +7, пропущено 1')
    expect(importedFileText({ name: 'travel.json', added: 7, skipped: 0 })).toBe('travel.json · +7')
  })

  it('uses the colours of the table states for the change kinds', () => {
    expect(changeKindClass('created')).toBe('tag new')
    expect(changeKindClass('restored')).toBe('tag new')
    expect(changeKindClass('updated')).toBe('tag mod')
    expect(changeKindClass('archived')).toBe('tag del')
  })

  it('declines «карточка»', () => {
    expect([1, 2, 5, 11, 21, 24].map(cardsCountText)).toEqual(['1 карточка', '2 карточки', '5 карточек', '11 карточек', '21 карточка', '24 карточки'])
  })
})

describe('the list of revisions', () => {
  it('merges a page without repeats, newest first', () => {
    const merged = mergeRevisions([rev(44), rev(43), rev(42)], [rev(43, { message: 'новее' }), rev(41), rev(45)])
    expect(merged.map((r) => r.revision)).toEqual([45, 44, 43, 42, 41])
    expect(merged.find((r) => r.revision === 43)?.message).toBe('новее')
  })

  it('knows when older revisions remain: they are numbered from r1 without gaps', () => {
    expect(hasOlderRevisions([])).toBe(false)
    expect(hasOlderRevisions([rev(44), rev(15)])).toBe(true)
    expect(hasOlderRevisions([rev(3), rev(1, { baseRevision: 0 })])).toBe(false)
  })
})

describe('export', () => {
  it('names the file engmark-rN.json', () => {
    expect(exportFileName(42)).toBe('engmark-r42.json')
  })

  it('reads the revision from the ETag of the answer', () => {
    expect(revisionFromEtag('"r42"')).toBe(42)
    expect(revisionFromEtag('W/"r7"')).toBe(7)
    expect(revisionFromEtag(null)).toBeNull()
    expect(revisionFromEtag('"v3"')).toBeNull()
    expect(revisionFromEtag('r42')).toBeNull()
  })
})

describe('versions of a card', () => {
  it('lists the differing fields in the order of the form, not of cards.json', () => {
    const a = makeCard()
    const b = makeCard({ exampleTranslation: 'иначе', translation: 'иначе', pos: 'noun', ipa: '/x/' })
    expect(differingFields(a, b)).toEqual(['pos', 'translation', 'ipa', 'exampleTranslation'])
    expect(differingFields(a, a)).toEqual([])
  })

  it('builds the table «field / vK / now» from the differing fields only', () => {
    const old = version(2, 40, makeCard({ translation: 'когда' }))
    const now = version(4, 42, makeCard({ translation: 'когда, в то время как', usage: 'новое' }))
    expect(versionDiff(old, now)).toEqual([
      { field: 'translation', label: 'Перевод', then: 'когда', now: 'когда, в то время как' },
      { field: 'usage', label: 'Контекст и стиль', then: '', now: 'новое' },
    ])
    expect(versionDiff(now, now)).toEqual([])
  })

  it('labels a version with its revision and sorts newest first', () => {
    expect(versionLabel(version(3, 42))).toBe('v3 · r42')
    expect(newestFirst([version(1, 1), version(3, 9), version(2, 5)]).map((v) => v.version)).toEqual([3, 2, 1])
  })
})
