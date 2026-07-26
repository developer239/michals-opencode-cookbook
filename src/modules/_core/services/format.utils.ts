export const groupByKey = <TItem>(items: TItem[], keyFn: (item: TItem) => string): Map<string, TItem[]> => {
  const grouped = new Map<string, TItem[]>()

  for (const item of items) {
    const key = keyFn(item)
    const current = grouped.get(key)
    if (current) {
      current.push(item)
    } else {
      grouped.set(key, [item])
    }
  }

  return grouped
}
