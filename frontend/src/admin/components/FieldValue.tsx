import { POS_FULL } from '../labels'
import type { CardField } from '../types'

export function FieldValue({ field, value }: { field: CardField; value: string }) {
  if (value === '') return <i>пусто</i>
  return <>{field === 'pos' ? (POS_FULL[value] ?? value) : value}</>
}
