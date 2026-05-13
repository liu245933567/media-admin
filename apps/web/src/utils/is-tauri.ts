import { isTauri as isTauriEnv } from '@tauri-apps/api/core'

export function isTauri(): boolean {
  return isTauriEnv()
}
