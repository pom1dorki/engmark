import { useRef, useState } from 'react'
import type { AdminApi } from '../api/admin'
import type { SaveFailure } from '../components/SaveDialog'
import { type Draft, type DraftAction, isDraftEmpty } from '../draft/draft'
import { applyChoices, type MergeResult } from '../merge/merge'
import { type Rejection, type SaveOutcome, describeFailure, runSave, suggestedMessage } from '../saveFlow'
import { useLatest } from './useLatest'

export type SaveState =
  | { step: 'closed' }
  | { step: 'review'; message: string; failure: SaveFailure | null; resumed: boolean; busy: boolean }
  | { step: 'conflict'; id: number; message: string; merge: MergeResult; baseRevision: number; serverRevision: number; busy: boolean }

type StoredState =
  | { step: 'closed' }
  | { step: 'review'; message: string; failure: SaveFailure | null; lostAt: number | null; busy: boolean }
  | Extract<SaveState, { step: 'conflict' }>

const SESSION_LOST = 'Сессия закончилась, ничего не записано. Войдите снова: черновик на месте.'

type Saved = Extract<SaveOutcome, { kind: 'saved' }>

interface Options {
  api: AdminApi
  draft: Draft
  dispatch: (action: DraftAction) => void
  epoch: number
  onSaved: (outcome: Saved) => void
  onRejected: (rejection: Rejection, draft: Draft) => boolean
  onLater: () => void
  onNothingLeft: (revision: number) => void
}

const CLOSED: StoredState = { step: 'closed' }

export function useSave(options: Options) {
  const [stored, setState] = useState<StoredState>(CLOSED)
  const latest = useLatest(options)
  const running = useRef(false)
  const counter = useRef(0)

  const toReview = (message: string, failure: SaveFailure | null): StoredState => ({ step: 'review', message, failure, lostAt: null, busy: false })

  const state: SaveState =
    stored.step === 'review'
      ? {
          step: 'review',
          message: stored.message,
          busy: stored.busy,
          resumed: stored.lostAt !== null && stored.lostAt !== options.epoch,
          failure: stored.lostAt !== null && stored.lostAt === options.epoch ? { kind: 'failed', text: SESSION_LOST } : stored.failure,
        }
      : stored

  const finish = (outcome: SaveOutcome, target: Draft, message: string) => {
    const { onSaved, onRejected } = latest.current
    switch (outcome.kind) {
      case 'saved':
        setState(CLOSED)
        onSaved(outcome)
        return
      case 'conflict':
        counter.current += 1
        setState({
          step: 'conflict',
          id: counter.current,
          message,
          merge: outcome.merge,
          baseRevision: target.baseRevision,
          serverRevision: outcome.serverRevision,
          busy: false,
        })
        return
      case 'stale':
        setState(
          toReview(message, {
            kind: 'stale',
            text:
              outcome.error.kind === 'version_mismatch' && outcome.error.id !== null
                ? `Сервер говорит, что версия карточки №${outcome.error.id} не совпала (на сервере v${outcome.error.actual}, в черновике основа v${outcome.error.expected}), хотя колода не менялась. Откройте эту карточку в черновике и уберите её оттуда, затем внесите правку заново.`
                : 'Сервер отказал из-за версии карточки, хотя колода не менялась. Черновик не тронут.',
          }),
        )
        return
      case 'rejected': {
        const handled = onRejected(outcome.rejection, target)
        setState(handled ? CLOSED : toReview(message, { kind: 'rejected', lines: outcome.rejection.general }))
        return
      }
      case 'unauthenticated':
        setState({ step: 'review', message, failure: null, lostAt: latest.current.epoch, busy: false })
        return
      case 'failed':
        setState(toReview(message, { kind: 'failed', text: describeFailure(outcome.error) }))
        return
      case 'aborted':
        return
    }
  }

  const perform = async (target: Draft, message: string) => {
    if (running.current) return
    running.current = true
    setState((prev) => (prev.step === 'review' ? { ...prev, busy: true, failure: null, lostAt: null } : prev.step === 'conflict' ? { ...prev, busy: true } : prev))
    try {
      finish(await runSave(latest.current.api, target, message), target, message)
    } finally {
      running.current = false
    }
  }

  return {
    state,
    open() {
      setState(toReview(suggestedMessage(latest.current.draft), null))
    },
    close() {
      if (!running.current) setState(CLOSED)
    },
    setMessage(message: string) {
      setState((prev) => (prev.step === 'review' ? { ...prev, message } : prev))
    },
    save() {
      if (stored.step !== 'review') return
      void perform(latest.current.draft, stored.message)
    },
    apply(choices: Record<string, string>) {
      if (stored.step !== 'conflict') return
      const resolved = applyChoices(stored.merge.rebasedDraft, stored.merge.conflicts, choices)
      latest.current.dispatch({ type: 'rebase', baseRevision: resolved.baseRevision, items: resolved.items })
      if (isDraftEmpty(resolved)) {
        setState(CLOSED)
        latest.current.onNothingLeft(resolved.baseRevision)
        return
      }
      void perform(resolved, stored.message)
    },
    later() {
      if (running.current) return
      setState(CLOSED)
      latest.current.onLater()
    },
  }
}
