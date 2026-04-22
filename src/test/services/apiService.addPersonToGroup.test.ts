import { describe, it, expect, vi, beforeEach } from 'vitest'
import { addPersonToGroup } from '../../../services/apiService'
import * as supabaseApi from '../../../services/supabaseApiService'

// `vi.mock` factories run before any top-level `const` initializers because
// Vitest hoists them. Anything a factory references must also be hoisted via
// `vi.hoisted` — otherwise we hit a TDZ error at module load.
const h = vi.hoisted(() => {
  // `from()` must return the same object on every call so the `insert` spy
  // the test wires up (`mockSupabase.from().insert.mockResolvedValue(...)`)
  // is the same one production code hits (`supabase.from('x').insert(...)`).
  const fromResult = {
    insert: vi.fn().mockResolvedValue({ error: null }),
    select: vi.fn().mockReturnThis() as any,
    update: vi.fn().mockReturnThis() as any,
    delete: vi.fn().mockReturnThis() as any,
    eq: vi.fn().mockReturnThis() as any,
    single: vi.fn(),
  }
  const mockSupabase = {
    from: vi.fn(() => fromResult),
  }
  return { mockSupabase, fromResult }
})

// Mock the supabaseApi module
vi.mock('../../../services/supabaseApiService', () => ({
  addPerson: vi.fn(),
}))

vi.mock('../../../lib/supabase', () => ({
  supabase: h.mockSupabase,
}))

const mockSupabase = h.mockSupabase

describe('addPersonToGroup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should add person to group with custom avatar URL', async () => {
    const groupId = 'g1'
    const personData = {
      name: 'John Doe',
      avatarUrl: 'https://custom-avatar.com/john.jpg'
    }
    
    const mockPerson = {
      id: 'p1',
      name: 'John Doe',
      avatarUrl: 'https://custom-avatar.com/john.jpg'
    }
    
    vi.mocked(supabaseApi.addPerson).mockResolvedValue(mockPerson)
    mockSupabase.from().insert.mockResolvedValue({ error: null })
    
    const result = await addPersonToGroup(groupId, personData)
    
    expect(supabaseApi.addPerson).toHaveBeenCalledWith({
      name: 'John Doe',
      email: undefined,
      avatarUrl: 'https://custom-avatar.com/john.jpg',
      source: 'manual',
    })

    expect(mockSupabase.from).toHaveBeenCalledWith('group_members')
    expect(mockSupabase.from().insert).toHaveBeenCalledWith({
      group_id: groupId,
      person_id: 'p1'
    })

    expect(result).toEqual(mockPerson)
  })

  it('should add person to group with generated avatar URL', async () => {
    const groupId = 'g1'
    const personData = {
      name: 'Jane Smith'
    }
    
    const mockPerson = {
      id: 'p2',
      name: 'Jane Smith',
      avatarUrl: 'https://i.pravatar.cc/150?u=Jane%20Smith'
    }
    
    vi.mocked(supabaseApi.addPerson).mockResolvedValue(mockPerson)
    mockSupabase.from().insert.mockResolvedValue({ error: null })
    
    const result = await addPersonToGroup(groupId, personData)
    
    expect(supabaseApi.addPerson).toHaveBeenCalledWith({
      name: 'Jane Smith',
      email: undefined,
      avatarUrl: 'https://i.pravatar.cc/150?u=Jane%20Smith',
      source: 'manual',
    })
    
    expect(mockSupabase.from).toHaveBeenCalledWith('group_members')
    expect(mockSupabase.from().insert).toHaveBeenCalledWith({
      group_id: groupId,
      person_id: 'p2'
    })
    
    expect(result).toEqual(mockPerson)
  })

  it('should handle special characters in name for avatar URL generation', async () => {
    const groupId = 'g1'
    const personData = {
      name: 'José María'
    }
    
    const mockPerson = {
      id: 'p3',
      name: 'José María',
      avatarUrl: 'https://i.pravatar.cc/150?u=Jos%C3%A9%20Mar%C3%ADa'
    }
    
    vi.mocked(supabaseApi.addPerson).mockResolvedValue(mockPerson)
    mockSupabase.from().insert.mockResolvedValue({ error: null })
    
    const result = await addPersonToGroup(groupId, personData)
    
    expect(supabaseApi.addPerson).toHaveBeenCalledWith({
      name: 'José María',
      email: undefined,
      avatarUrl: 'https://i.pravatar.cc/150?u=Jos%C3%A9%20Mar%C3%ADa',
      source: 'manual',
    })
    
    expect(result).toEqual(mockPerson)
  })

  it('should throw error if person creation fails', async () => {
    const groupId = 'g1'
    const personData = {
      name: 'John Doe'
    }
    
    const error = new Error('Failed to create person')
    vi.mocked(supabaseApi.addPerson).mockRejectedValue(error)
    
    await expect(addPersonToGroup(groupId, personData)).rejects.toThrow('Failed to create person')
    
    expect(supabaseApi.addPerson).toHaveBeenCalledWith({
      name: 'John Doe',
      email: undefined,
      avatarUrl: 'https://i.pravatar.cc/150?u=John%20Doe',
      source: 'manual',
    })

    // Should not attempt to insert group membership if person creation fails
    expect(mockSupabase.from).not.toHaveBeenCalled()
  })

  it('should throw error if group membership insertion fails', async () => {
    const groupId = 'g1'
    const personData = {
      name: 'John Doe'
    }
    
    const mockPerson = {
      id: 'p1',
      name: 'John Doe',
      avatarUrl: 'https://i.pravatar.cc/150?u=John%20Doe'
    }
    
    const error = new Error('Failed to add person to group')
    vi.mocked(supabaseApi.addPerson).mockResolvedValue(mockPerson)
    mockSupabase.from().insert.mockResolvedValue({ error })
    
    await expect(addPersonToGroup(groupId, personData)).rejects.toThrow('Failed to add person to group')
    
    expect(supabaseApi.addPerson).toHaveBeenCalledWith({
      name: 'John Doe',
      email: undefined,
      avatarUrl: 'https://i.pravatar.cc/150?u=John%20Doe',
      source: 'manual',
    })

    expect(mockSupabase.from).toHaveBeenCalledWith('group_members')
    expect(mockSupabase.from().insert).toHaveBeenCalledWith({
      group_id: groupId,
      person_id: 'p1'
    })
  })

  it('should handle empty name', async () => {
    const groupId = 'g1'
    const personData = {
      name: ''
    }
    
    const mockPerson = {
      id: 'p1',
      name: '',
      avatarUrl: 'https://i.pravatar.cc/150?u='
    }
    
    vi.mocked(supabaseApi.addPerson).mockResolvedValue(mockPerson)
    mockSupabase.from().insert.mockResolvedValue({ error: null })
    
    const result = await addPersonToGroup(groupId, personData)
    
    expect(supabaseApi.addPerson).toHaveBeenCalledWith({
      name: '',
      email: undefined,
      avatarUrl: 'https://i.pravatar.cc/150?u=',
      source: 'manual',
    })
    
    expect(result).toEqual(mockPerson)
  })
})
