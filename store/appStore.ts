import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'

export type Theme = 'light' | 'dark' | 'system'

interface UIState {
  selectedGroupId: string | null
  setSelectedGroupId: (id: string | null) => void

  theme: Theme
  setTheme: (theme: Theme) => void
}

export const useAppStore = create<UIState>()(
  devtools(
    persist(
      (set) => ({
        selectedGroupId: null,
        setSelectedGroupId: (id) => set({ selectedGroupId: id }),

        theme: 'system',
        setTheme: (theme) => set({ theme }),
      }),
      {
        name: 'app-ui',
        partialize: (s) => ({
          selectedGroupId: s.selectedGroupId,
          theme: s.theme,
        }),
        version: 2,
        // Called when persisted version < current version.
        // v0→v1→v2: openModals was removed; just carry forward the fields we still use.
        migrate: (old: unknown) => {
          const s = (old ?? {}) as Record<string, unknown>
          return {
            selectedGroupId: typeof s.selectedGroupId === 'string' ? s.selectedGroupId : null,
            theme: ['light', 'dark', 'system'].includes(s.theme as string)
              ? (s.theme as Theme)
              : 'system',
          }
        },
      }
    ),
    { name: 'app-ui' }
  )
)
