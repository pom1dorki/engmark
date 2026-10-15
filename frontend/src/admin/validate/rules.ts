
export const MAX_WORD = 80
export const MAX_TRANSLATION = 300
export const MAX_EXAMPLE = 400
export const MAX_NOTE = 500

export const WORD_PATTERN = /^[A-Za-z][A-Za-z'-]*(?: [A-Za-z][A-Za-z'-]*)*$/

export const MAX_CREATE_AND_UPDATE = 1000
export const MAX_IMPORT_ROWS = 5000
export const MAX_IMPORT_BYTES = 4 * 1024 * 1024
export const MAX_FILE_NAME = 200

export const FIELD_CODES = [
  'required',
  'invalid_chars',
  'too_long',
  'unsupported_pos',
  'highlight_not_found',
] as const

export type FieldCode = (typeof FIELD_CODES)[number]
