/** Match every search word against the visible metadata, ignoring case and spacing. */
export function matchesLibrarySearch(query: string, fields: Array<string | null | undefined>): boolean {
  const text = fields.filter(Boolean).join(' ').toLocaleLowerCase()
  return query.trim().toLocaleLowerCase().split(/\s+/).every(word => text.includes(word))
}
