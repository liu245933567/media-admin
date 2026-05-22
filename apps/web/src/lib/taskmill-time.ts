import dayjs from 'dayjs'

export function formatTaskmillTime(value: string | null | undefined): string {
  if (!value) {
    return '—'
  }

  const parsed = dayjs(value)
  if (!parsed.isValid()) {
    return value
  }

  return parsed.format('YYYY-MM-DD HH:mm:ss')
}
