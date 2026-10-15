import { type Ref, useId } from 'react'
import { POS_FULL } from '../labels'
import { POS_VALUES } from '../types'

interface BaseProps {
  name: string
  label: string
  required?: boolean
  value: string
  onChange: (value: string) => void
  changed: boolean
  error?: string
  hint?: string
  readOnly?: boolean
}

interface TextProps extends BaseProps {
  multiline?: boolean
  rows?: number
  placeholder?: string
  lang?: string
  inputRef?: Ref<HTMLInputElement>
}

function fieldClass(changed: boolean, error: string | undefined): string {
  return ['f', changed ? 'changed' : '', error ? 'err' : ''].filter(Boolean).join(' ')
}

function Head({ id, label, required, changed }: { id: string; label: string; required?: boolean; changed: boolean }) {
  return (
    <div className="f-head">
      <label htmlFor={id} className={required ? 'req' : undefined}>
        {label}
      </label>
      {changed && <span className="chg">изменено</span>}
    </div>
  )
}

export function TextField({ name, label, required, value, onChange, changed, error, hint, readOnly, multiline, rows, placeholder, lang, inputRef }: TextProps) {
  const id = `${useId()}-${name}`
  const messageId = `${id}-msg`
  const message = error ?? hint
  const aria = {
    'aria-invalid': error ? true : undefined,
    'aria-describedby': message ? messageId : undefined,
    'aria-required': required ? true : undefined,
  }
  return (
    <div className={fieldClass(changed, error)} data-field={name}>
      <Head id={id} label={label} required={required} changed={changed} />
      {multiline ? (
        <textarea id={id} rows={rows ?? 2} value={value} readOnly={readOnly} lang={lang} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} {...aria} />
      ) : (
        <input id={id} ref={inputRef} type="text" value={value} readOnly={readOnly} lang={lang} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} {...aria} />
      )}
      {message && (
        <span id={messageId} className="hint">
          {message}
        </span>
      )}
    </div>
  )
}

export function PosField({ name, label, required, value, onChange, changed, error, readOnly }: BaseProps) {
  const id = `${useId()}-${name}`
  const messageId = `${id}-msg`
  const known = (POS_VALUES as readonly string[]).includes(value)
  return (
    <div className={fieldClass(changed, error)} data-field={name}>
      <Head id={id} label={label} required={required} changed={changed} />
      <select
        id={id}
        value={value}
        disabled={readOnly}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? messageId : undefined}
        aria-required={required ? true : undefined}
      >
        {!known && <option value={value}>{value === '' ? 'не выбрано' : value}</option>}
        {POS_VALUES.map((pos) => (
          <option key={pos} value={pos}>
            {POS_FULL[pos]}
          </option>
        ))}
      </select>
      {error && (
        <span id={messageId} className="hint">
          {error}
        </span>
      )}
    </div>
  )
}
