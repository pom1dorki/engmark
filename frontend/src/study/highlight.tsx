export function highlightExample(example: string, needle: string) {
  if (!needle) return example
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const parts = example.split(new RegExp(`(${escaped})`, "ig"))
  return parts.map((part, index) =>
    part.toLowerCase() === needle.toLowerCase()
      ? <span className="card__example-word" key={index}>{part}</span>
      : <span key={index}>{part}</span>,
  )
}
