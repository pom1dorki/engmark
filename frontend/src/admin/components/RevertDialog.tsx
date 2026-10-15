import { type Draft, draftCounts } from '../draft/draft'
import { plural } from '../labels'
import { Modal } from './Modal'

interface Props {
  revision: number
  draft: Draft
  onConfirm: () => void
  onCancel: () => void
}

export function RevertDialog({ revision, draft, onConfirm, onCancel }: Props) {
  const counts = draftCounts(draft)
  const total = counts.created + counts.updated + counts.archived + counts.restored + counts.imported
  return (
    <Modal
      title={`Откатить к r${revision}?`}
      onClose={onCancel}
      footer={
        <>
          <div className="spacer" />
          <button type="button" className="btn" onClick={onCancel}>
            Не откатывать
          </button>
          <button type="button" className="btn pri" onClick={onConfirm}>
            Отменить черновик и откатить
          </button>
        </>
      }
    >
      <p className="mdesc">
        В черновике {total} {plural(total, 'несохранённая правка', 'несохранённые правки', 'несохранённых правок')}. Откат соберёт новый черновик на их месте, прежние правки пропадут.
      </p>
      <p className="mdesc">Сам откат ничего не записывает: сначала вы увидите, что изменится, и сохраните его как обычную ревизию.</p>
    </Modal>
  )
}
