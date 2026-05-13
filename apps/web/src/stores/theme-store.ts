import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'

const STORAGE_KEY = 'media-admin-theme'

export type ThemeMode = 'dark' | 'light' | 'system'

export type ResolvedTheme = 'dark' | 'light'

function readStoredTheme(): ThemeMode {
  if (typeof window === 'undefined')
    return 'light'
  const v = localStorage.getItem(STORAGE_KEY)
  if (v === 'dark' || v === 'system')
    return v
  return 'light'
}

function getSystemPrefersDark(): boolean {
  if (typeof window === 'undefined')
    return false
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

function resolveTheme(theme: ThemeMode, systemPrefersDark: boolean): ResolvedTheme {
  if (theme === 'dark')
    return 'dark'
  if (theme === 'light')
    return 'light'
  return systemPrefersDark ? 'dark' : 'light'
}

function syncDocumentDatasetTheme(theme: ThemeMode, systemPrefersDark: boolean): void {
  if (typeof document === 'undefined')
    return
  document.documentElement.dataset.theme = resolveTheme(theme, systemPrefersDark)
}

interface ThemeState {
  theme: ThemeMode
  systemPrefersDark: boolean
  setTheme: (mode: ThemeMode) => void
  toggleTheme: () => void
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: readStoredTheme(),
  systemPrefersDark: getSystemPrefersDark(),
  setTheme: (mode) => {
    set({ theme: mode })
    if (typeof window !== 'undefined')
      localStorage.setItem(STORAGE_KEY, mode)
  },
  toggleTheme: () => {
    const prev = get().theme
    const order: ThemeMode[] = ['light', 'dark', 'system']
    const idx = order.indexOf(prev)
    const i = idx === -1 ? 0 : idx
    const next = order[(i + 1) % order.length]!
    set({ theme: next })
    if (typeof window !== 'undefined')
      localStorage.setItem(STORAGE_KEY, next)
  },
}))

useThemeStore.subscribe((state, prev) => {
  if (state.theme === prev.theme && state.systemPrefersDark === prev.systemPrefersDark)
    return
  syncDocumentDatasetTheme(state.theme, state.systemPrefersDark)
})

let systemThemeListenerAttached = false
function attachSystemThemeListener(): void {
  if (systemThemeListenerAttached || typeof window === 'undefined')
    return
  systemThemeListenerAttached = true
  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  useThemeStore.setState({ systemPrefersDark: mq.matches })
  mq.addEventListener('change', () => {
    useThemeStore.setState({ systemPrefersDark: mq.matches })
  })
}

attachSystemThemeListener()

if (typeof window !== 'undefined') {
  const { theme, systemPrefersDark } = useThemeStore.getState()
  syncDocumentDatasetTheme(theme, systemPrefersDark)
}

export interface ThemeControls {
  theme: ThemeMode
  resolvedTheme: ResolvedTheme
  setTheme: (mode: ThemeMode) => void
  toggleTheme: () => void
}

export function useTheme(): ThemeControls {
  return useThemeStore(
    useShallow(s => ({
      theme: s.theme,
      resolvedTheme: resolveTheme(s.theme, s.systemPrefersDark),
      setTheme: s.setTheme,
      toggleTheme: s.toggleTheme,
    })),
  )
}
