import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'

export type ModalName =
  | 'transactionForm'
  | 'transactionDetail'
  | 'groupForm'
  | 'shareModal'
  | 'memberInvite'
  | 'archivedGroups'
  | 'archivePrompt'
  | 'paymentSourceForm'
  | 'paymentSourceManage'
  | 'settleUp'
  | 'balanceBreakdown'
  | 'calendar'
  | 'dateFilter'
  | 'addAction'
  | 'settings'

export type Theme = 'light' | 'dark' | 'system'

interface UIState {
  selectedGroupId: string | null
  setSelectedGroupId: (id: string | null) => void

  theme: Theme
  setTheme: (theme: Theme) => void

  openModals: Partial<Record<ModalName, boolean>>
  openModal: (name: ModalName) => void
  closeModal: (name: ModalName) => void
}

export const useAppStore = create<UIState>()(
  devtools(
    persist(
      (set) => ({
        selectedGroupId: null,
        setSelectedGroupId: (id) => set({ selectedGroupId: id }),

        theme: 'system',
        setTheme: (theme) => set({ theme }),

        openModals: {},
        openModal: (name) => set((s) => ({ openModals: { ...s.openModals, [name]: true } })),
        closeModal: (name) => set((s) => ({ openModals: { ...s.openModals, [name]: false } })),
      }),
      {
        name: 'app-ui',
        // Persist only lightweight, safe UI state
        partialize: (s) => ({ 
          selectedGroupId: s.selectedGroupId, 
          openModals: s.openModals,
          theme: s.theme 
        }),
        version: 1,
      }
    ),
    { name: 'app-ui' }
  )
)
