const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const

export const formatBytes = (bytes: number): string => {
  if (bytes === 0) {
    return '0 B'
  }

  const index = Math.floor(Math.log(bytes) / Math.log(1024))
  const value = bytes / Math.pow(1024, index)
  return `${value.toFixed(1)} ${BYTE_UNITS[index]}`
}

export const toIsoOrNull = (date: Date | undefined): string | null => date?.toISOString() ?? null

export const toNullableString = (value: string | undefined): string | null => value ?? null

export const withFallback = (value: string | undefined, fallback: string): string => value ?? fallback

export const toNumberOrZero = (value: number | undefined): number => value ?? 0

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

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
