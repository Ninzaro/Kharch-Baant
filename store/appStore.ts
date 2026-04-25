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
        version: 2, // bump version to clear persisted openModals from localStorage
      }
    ),
    { name: 'app-ui' }
  )
)
