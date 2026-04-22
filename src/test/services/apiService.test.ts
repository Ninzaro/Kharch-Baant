import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as apiService from '../../../services/apiService'
import * as supabaseApi from '../../../services/supabaseApiService'
import { Group, Transaction, PaymentSource, Person } from '../../../types'

// Mock the supabaseApi module
vi.mock('../../../services/supabaseApiService', () => ({
  getGroups: vi.fn(),
  addGroup: vi.fn(),
  updateGroup: vi.fn(),
  getTransactions: vi.fn(),
  addTransaction: vi.fn(),
  updateTransaction: vi.fn(),
  deleteTransaction: vi.fn(),
  getPaymentSources: vi.fn(),
  addPaymentSource: vi.fn(),
  deletePaymentSource: vi.fn(),
  archivePaymentSource: vi.fn(),
  getPeople: vi.fn(),
  addPerson: vi.fn()
}))

// Mock the supabase client
vi.mock('../../../lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn()
    }))
  }
}))

describe('apiService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Groups API', () => {
    it('should get groups', async () => {
      const mockGroups: Group[] = [
        {
          id: 'g1',
          name: 'Test Group',
          currency: 'USD',
          members: ['p1', 'p2'],
          groupType: 'trip',
          tripStartDate: '2024-01-01',
          tripEndDate: '2024-01-07'
        }
      ]
      
      vi.mocked(supabaseApi.getGroups).mockResolvedValue(mockGroups)
      
      const result = await apiService.getGroups()
      
      expect(supabaseApi.getGroups).toHaveBeenCalledOnce()
      expect(result).toEqual(mockGroups)
    })

    it('should add group', async () => {
      const groupData: Omit<Group, 'id'> = {
        name: 'New Group',
        currency: 'EUR',
        members: ['p1'],
        groupType: 'household'
      }
      
      const mockGroup: Group = {
        id: 'g2',
        ...groupData
      }
      
      vi.mocked(supabaseApi.addGroup).mockResolvedValue(mockGroup)
      
      const result = await apiService.addGroup(groupData)
      
      expect(supabaseApi.addGroup).toHaveBeenCalledWith(groupData, undefined)
      expect(result).toEqual(mockGroup)
    })

    it('should update group', async () => {
      const groupId = 'g1'
      const groupData: Omit<Group, 'id'> = {
        name: 'Updated Group',
        currency: 'GBP',
        members: ['p1', 'p2', 'p3'],
        groupType: 'trip'
      }
      
      const mockGroup: Group = {
        id: groupId,
        ...groupData
      }
      
      vi.mocked(supabaseApi.updateGroup).mockResolvedValue(mockGroup)
      
      const result = await apiService.updateGroup(groupId, groupData)
      
      expect(supabaseApi.updateGroup).toHaveBeenCalledWith(groupId, groupData)
      expect(result).toEqual(mockGroup)
    })
  })

  describe('Transactions API', () => {
    it('should get transactions', async () => {
      const mockTransactions: Transaction[] = [
        {
          id: 't1',
          groupId: 'g1',
          description: 'Test Transaction',
          amount: 100,
          paidById: 'p1',
          date: '2024-01-01',
          tag: 'Food',
          split: {
            mode: 'equal',
            participants: [{ personId: 'p1', value: 1 }]
          },
          type: 'expense'
        }
      ]
      
      vi.mocked(supabaseApi.getTransactions).mockResolvedValue(mockTransactions)
      
      const result = await apiService.getTransactions()
      
      expect(supabaseApi.getTransactions).toHaveBeenCalledOnce()
      expect(result).toEqual(mockTransactions)
    })

    it('should add transaction', async () => {
      const groupId = 'g1'
      const transactionData: Omit<Transaction, 'id' | 'groupId'> = {
        description: 'New Transaction',
        amount: 50,
        paidById: 'p1',
        date: '2024-01-02',
        tag: 'Travel',
        split: {
          mode: 'equal',
          participants: [{ personId: 'p1', value: 1 }]
        },
        type: 'expense'
      }
      
      const mockTransaction: Transaction = {
        id: 't2',
        groupId,
        ...transactionData
      }
      
      vi.mocked(supabaseApi.addTransaction).mockResolvedValue(mockTransaction)
      
      const result = await apiService.addTransaction(groupId, transactionData)
      
      expect(supabaseApi.addTransaction).toHaveBeenCalledWith(groupId, transactionData)
      expect(result).toEqual(mockTransaction)
    })

    it('should update transaction', async () => {
      const transactionId = 't1'
      const transactionData: Partial<Omit<Transaction, 'id' | 'groupId'>> = {
        description: 'Updated Transaction',
        amount: 150
      }
      
      const mockTransaction: Transaction = {
        id: transactionId,
        groupId: 'g1',
        description: 'Updated Transaction',
        amount: 150,
        paidById: 'p1',
        date: '2024-01-01',
        tag: 'Food',
        split: {
          mode: 'equal',
          participants: [{ personId: 'p1', value: 1 }]
        },
        type: 'expense'
      }
      
      vi.mocked(supabaseApi.updateTransaction).mockResolvedValue(mockTransaction)
      
      const result = await apiService.updateTransaction(transactionId, transactionData)
      
      expect(supabaseApi.updateTransaction).toHaveBeenCalledWith(transactionId, transactionData)
      expect(result).toEqual(mockTransaction)
    })

    it('should delete transaction', async () => {
      const transactionId = 't1'
      const mockResult = { success: true }
      
      vi.mocked(supabaseApi.deleteTransaction).mockResolvedValue(mockResult)
      
      const result = await apiService.deleteTransaction(transactionId)
      
      expect(supabaseApi.deleteTransaction).toHaveBeenCalledWith(transactionId, undefined)
      expect(result).toEqual(mockResult)
    })
  })

  describe('Payment Sources API', () => {
    it('should get payment sources', async () => {
      const mockPaymentSources: PaymentSource[] = [
        {
          id: 'ps1',
          name: 'Credit Card',
          type: 'card',
          details: { last4: '1234' },
          isActive: true
        }
      ]
      
      vi.mocked(supabaseApi.getPaymentSources).mockResolvedValue(mockPaymentSources)
      
      const result = await apiService.getPaymentSources()
      
      expect(supabaseApi.getPaymentSources).toHaveBeenCalledWith(undefined)
      expect(result).toEqual(mockPaymentSources)
    })

    it('should get payment sources with options', async () => {
      const mockPaymentSources: PaymentSource[] = [
        {
          id: 'ps1',
          name: 'Credit Card',
          type: 'card',
          details: { last4: '1234' },
          isActive: true
        },
        {
          id: 'ps2',
          name: 'Old Card',
          type: 'card',
          details: { last4: '5678' },
          isActive: false
        }
      ]
      
      vi.mocked(supabaseApi.getPaymentSources).mockResolvedValue(mockPaymentSources)
      
      const result = await apiService.getPaymentSources({ includeArchived: true })
      
      expect(supabaseApi.getPaymentSources).toHaveBeenCalledWith({ includeArchived: true })
      expect(result).toEqual(mockPaymentSources)
    })

    it('should add payment source', async () => {
      const sourceData: Omit<PaymentSource, 'id'> = {
        name: 'New Card',
        type: 'card',
        details: { last4: '9999' },
        isActive: true
      }
      
      const mockPaymentSource: PaymentSource = {
        id: 'ps2',
        ...sourceData
      }
      
      vi.mocked(supabaseApi.addPaymentSource).mockResolvedValue(mockPaymentSource)
      
      const result = await apiService.addPaymentSource(sourceData)
      
      expect(supabaseApi.addPaymentSource).toHaveBeenCalledWith(sourceData, undefined)
      expect(result).toEqual(mockPaymentSource)
    })

    it('should delete payment source', async () => {
      const paymentSourceId = 'ps1'
      const mockResult = { success: true }
      
      vi.mocked(supabaseApi.deletePaymentSource).mockResolvedValue(mockResult)
      
      const result = await apiService.deletePaymentSource(paymentSourceId)
      
      expect(supabaseApi.deletePaymentSource).toHaveBeenCalledWith(paymentSourceId)
      expect(result).toEqual(mockResult)
    })

    it('should archive payment source', async () => {
      const paymentSourceId = 'ps1'
      const mockResult = { success: true }
      
      vi.mocked(supabaseApi.archivePaymentSource).mockResolvedValue(mockResult)
      
      const result = await apiService.archivePaymentSource(paymentSourceId)
      
      expect(supabaseApi.archivePaymentSource).toHaveBeenCalledWith(paymentSourceId)
      expect(result).toEqual(mockResult)
    })
  })

  describe('People API', () => {
    it('should get people', async () => {
      const mockPeople: Person[] = [
        {
          id: 'p1',
          name: 'John Doe',
          avatarUrl: 'https://example.com/avatar1.jpg'
        }
      ]
      
      vi.mocked(supabaseApi.getPeople).mockResolvedValue(mockPeople)
      
      const result = await apiService.getPeople()
      
      expect(supabaseApi.getPeople).toHaveBeenCalledOnce()
      expect(result).toEqual(mockPeople)
    })

    it('should add person', async () => {
      const personData: Omit<Person, 'id'> = {
        name: 'Jane Doe',
        avatarUrl: 'https://example.com/avatar2.jpg'
      }
      
      const mockPerson: Person = {
        id: 'p2',
        ...personData
      }
      
      vi.mocked(supabaseApi.addPerson).mockResolvedValue(mockPerson)
      
      const result = await apiService.addPerson(personData)
      
      expect(supabaseApi.addPerson).toHaveBeenCalledWith(personData)
      expect(result).toEqual(mockPerson)
    })
  })

  describe('Utility Functions', () => {
    it('should check connection successfully', async () => {
      vi.mocked(supabaseApi.getGroups).mockResolvedValue([])
      
      const result = await apiService.checkConnection()
      
      expect(result).toBe(true)
      expect(supabaseApi.getGroups).toHaveBeenCalledOnce()
    })

    it('should check connection with error', async () => {
      vi.mocked(supabaseApi.getGroups).mockRejectedValue(new Error('Connection failed'))
      
      const result = await apiService.checkConnection()
      
      expect(result).toBe(false)
    })

    it('should assert Supabase environment with missing variables', () => {
      // assertSupabaseEnvironment falls back to process.env when import.meta.env
      // is empty, so we have to stub both sources. Otherwise the test-setup env
      // still satisfies the check and no warning fires.
      const originalEnv = import.meta.env
      const originalProcUrl = process.env.VITE_SUPABASE_URL
      const originalProcKey = process.env.VITE_SUPABASE_ANON_KEY
      Object.defineProperty(import.meta, 'env', {
        value: {},
        writable: true
      })
      delete process.env.VITE_SUPABASE_URL
      delete process.env.VITE_SUPABASE_ANON_KEY

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      apiService.assertSupabaseEnvironment()

      expect(consoleSpy).toHaveBeenCalledWith(
        '[Supabase] Missing environment variables:',
        'VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY'
      )

      consoleSpy.mockRestore()
      Object.defineProperty(import.meta, 'env', {
        value: originalEnv,
        writable: true
      })
      if (originalProcUrl !== undefined) process.env.VITE_SUPABASE_URL = originalProcUrl
      if (originalProcKey !== undefined) process.env.VITE_SUPABASE_ANON_KEY = originalProcKey
    })

    it('should assert Supabase environment with present variables', () => {
      // Mock environment variables as present
      const originalEnv = import.meta.env
      Object.defineProperty(import.meta, 'env', {
        value: {
          VITE_SUPABASE_URL: 'https://test.supabase.co',
          VITE_SUPABASE_ANON_KEY: 'test-key'
        },
        writable: true
      })
      
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      
      apiService.assertSupabaseEnvironment()
      
      expect(consoleSpy).not.toHaveBeenCalled()
      
      consoleSpy.mockRestore()
      Object.defineProperty(import.meta, 'env', {
        value: originalEnv,
        writable: true
      })
    })
  })
})
