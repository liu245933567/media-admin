import type { AppConfig } from '@/types'
import { get, put } from './utils'

export const appConfigQueryKey = ['settings', 'app-config'] as const

export function fetchAppConfig() {
  return get<AppConfig>('/settings/app-config')
}

export function updateAppConfig(body: AppConfig) {
  return put<AppConfig, AppConfig>('/settings/app-config', body)
}
