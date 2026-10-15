export type IconName = 'words' | 'history' | 'download' | 'upload' | 'plus' | 'search' | 'close' | 'warn' | 'info' | 'logout'

const PATHS: Record<IconName, string[]> = {
  words: ['M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z', 'M7 9h10M7 13h6'],
  history: ['M3 12a9 9 0 1 0 3-6.7L3 8', 'M3 3v5h5M12 7v5l3 2'],
  download: ['M12 3v12M7 10l5 5 5-5M4 21h16'],
  upload: ['M12 15V3M7 8l5-5 5 5M4 21h16'],
  plus: ['M12 5v14M5 12h14'],
  search: ['M20 20l-3.5-3.5', 'M18 11a7 7 0 1 1-14 0 7 7 0 0 1 14 0z'],
  close: ['M6 6l12 12M18 6L6 18'],
  warn: ['M12 9v4M12 17h.01', 'M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z'],
  info: ['M12 8h.01M11 12h1v5h1', 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z'],
  logout: ['M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4', 'M16 17l5-5-5-5M21 12H9'],
}

export function Icon({ name }: { name: IconName }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  )
}
