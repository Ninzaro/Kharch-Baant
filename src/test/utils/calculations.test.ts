import { describe, it, expect } from 'vitest'
import { 
  calculateShares, 
  distributeRounding, 
  validateSplit, 
  materializeSplit 
} from '../../../utils/calculations'
import { Transaction, SplitMode, SplitParticipant } from '../../../types'

describe('calculateShares', () => {
  it('should return empty map for zero amount', () => {
    const transaction: Transaction = {
      id: '1',
      groupId: 'g1',
      description: 'Test',
      amount: 0,
      paidById: 'p1',
      date: '2024-01-01',
      tag: 'Food',
      split: {
        mode: 'equal',
        participants: [{ personId: 'p1', value: 1 }]
      },
      type: 'expense'
    }
    
    const result = calculateShares(transaction)
    expect(result.size).toBe(0)
  })

  it('should return empty map for no participants', () => {
    const transaction: Transaction = {
      id: '1',
      groupId: 'g1',
      description: 'Test',
      amount: 100,
      paidById: 'p1',
      date: '2024-01-01',
      tag: 'Food',
      split: {
        mode: 'equal',
        participants: []
      },
      type: 'expense'
    }
    
    const result = calculateShares(transaction)
    expect(result.size).toBe(0)
  })

  it('should calculate equal shares correctly', () => {
    const transaction: Transaction = {
      id: '1',
      groupId: 'g1',
      description: 'Test',
      amount: 100,
      paidById: 'p1',
      date: '2024-01-01',
      tag: 'Food',
      split: {
        mode: 'equal',
        participants: [
          { personId: 'p1', value: 1 },
          { personId: 'p2', value: 1 }
        ]
      },
      type: 'expense'
    }
    
    const result = calculateShares(transaction)
    expect(result.get('p1')).toBe(50)
    expect(result.get('p2')).toBe(50)
  })

  it('should calculate unequal shares correctly', () => {
    const transaction: Transaction = {
      id: '1',
      groupId: 'g1',
      description: 'Test',
      amount: 100,
      paidById: 'p1',
      date: '2024-01-01',
      tag: 'Food',
      split: {
        mode: 'unequal',
        participants: [
          { personId: 'p1', value: 60 },
          { personId: 'p2', value: 40 }
        ]
      },
      type: 'expense'
    }
    
    const result = calculateShares(transaction)
    expect(result.get('p1')).toBe(60)
    expect(result.get('p2')).toBe(40)
  })

  it('should calculate percentage shares correctly', () => {
    const transaction: Transaction = {
      id: '1',
      groupId: 'g1',
      description: 'Test',
      amount: 200,
      paidById: 'p1',
      date: '2024-01-01',
      tag: 'Food',
      split: {
        mode: 'percentage',
        participants: [
          { personId: 'p1', value: 30 },
          { personId: 'p2', value: 70 }
        ]
      },
      type: 'expense'
    }
    
    const result = calculateShares(transaction)
    expect(result.get('p1')).toBe(60) // 200 * 0.30
    expect(result.get('p2')).toBe(140) // 200 * 0.70
  })

  it('should calculate shares mode correctly', () => {
    const transaction: Transaction = {
      id: '1',
      groupId: 'g1',
      description: 'Test',
      amount: 120,
      paidById: 'p1',
      date: '2024-01-01',
      tag: 'Food',
      split: {
        mode: 'shares',
        participants: [
          { personId: 'p1', value: 2 },
          { personId: 'p2', value: 1 }
        ]
      },
      type: 'expense'
    }
    
    const result = calculateShares(transaction)
    expect(result.get('p1')).toBe(80) // 120 * (2/3)
    expect(result.get('p2')).toBe(40) // 120 * (1/3)
  })
})

describe('distributeRounding', () => {
  it('should distribute rounding correctly for simple case', () => {
    const rawShares = [33.33, 33.33, 33.34]
    const total = 100
    const result = distributeRounding(rawShares, total)
    
    expect(result).toHaveLength(3)
    expect(result.reduce((sum, val) => sum + val, 0)).toBeCloseTo(total, 2)
  })

  it('should handle zero remainder', () => {
    const rawShares = [50, 50]
    const total = 100
    const result = distributeRounding(rawShares, total)
    
    expect(result).toEqual([50, 50])
  })

  it('should distribute single remainder to largest fractional part', () => {
    const rawShares = [33.33, 33.33, 33.33]
    const total = 100
    const result = distributeRounding(rawShares, total)
    
    expect(result.reduce((sum, val) => sum + val, 0)).toBeCloseTo(total, 2)
    expect(result.some(val => val === 33.34)).toBe(true)
  })
})

describe('validateSplit', () => {
  it('should validate equal split as valid', () => {
    const result = validateSplit('equal', 100, [
      { personId: 'p1', value: 1 },
      { personId: 'p2', value: 1 }
    ])
    
    expect(result.valid).toBe(true)
    expect(result.reason).toBeUndefined()
  })

  it('should reject zero amount', () => {
    const result = validateSplit('equal', 0, [
      { personId: 'p1', value: 1 }
    ])
    
    expect(result.valid).toBe(false)
    expect(result.reason).toBe('Amount must be > 0')
  })

  it('should reject negative amount', () => {
    const result = validateSplit('equal', -10, [
      { personId: 'p1', value: 1 }
    ])
    
    expect(result.valid).toBe(false)
    expect(result.reason).toBe('Amount must be > 0')
  })

  it('should reject empty participants', () => {
    const result = validateSplit('equal', 100, [])
    
    expect(result.valid).toBe(false)
    expect(result.reason).toBe('At least one participant required')
  })

  it('should validate unequal split when values sum to amount', () => {
    const result = validateSplit('unequal', 100, [
      { personId: 'p1', value: 60 },
      { personId: 'p2', value: 40 }
    ])
    
    expect(result.valid).toBe(true)
  })

  it('should reject unequal split when values do not sum to amount', () => {
    const result = validateSplit('unequal', 100, [
      { personId: 'p1', value: 60 },
      { personId: 'p2', value: 50 }
    ])
    
    expect(result.valid).toBe(false)
    expect(result.reason).toContain('Unequal shares')
  })

  it('should validate percentage split when values sum to 100', () => {
    const result = validateSplit('percentage', 100, [
      { personId: 'p1', value: 30 },
      { personId: 'p2', value: 70 }
    ])
    
    expect(result.valid).toBe(true)
  })

  it('should reject percentage split when values do not sum to 100', () => {
    const result = validateSplit('percentage', 100, [
      { personId: 'p1', value: 30 },
      { personId: 'p2', value: 80 }
    ])
    
    expect(result.valid).toBe(false)
    expect(result.reason).toContain('Percentages')
  })

  it('should validate shares split when total shares > 0', () => {
    const result = validateSplit('shares', 100, [
      { personId: 'p1', value: 2 },
      { personId: 'p2', value: 3 }
    ])
    
    expect(result.valid).toBe(true)
  })

  it('should reject shares split when total shares <= 0', () => {
    const result = validateSplit('shares', 100, [
      { personId: 'p1', value: 0 },
      { personId: 'p2', value: 0 }
    ])
    
    expect(result.valid).toBe(false)
    expect(result.reason).toBe('Total shares must be > 0')
  })

  it('should reject unknown split mode', () => {
    const result = validateSplit('unknown' as SplitMode, 100, [
      { personId: 'p1', value: 1 }
    ])
    
    expect(result.valid).toBe(false)
    expect(result.reason).toBe('Unknown split mode')
  })
})

describe('materializeSplit', () => {
  it('should return empty map for no participants', () => {
    const result = materializeSplit('equal', 100, [])
    expect(result.size).toBe(0)
  })

  it('should materialize equal split with rounding', () => {
    const participants = [
      { personId: 'p1', value: 1 },
      { personId: 'p2', value: 1 },
      { personId: 'p3', value: 1 }
    ]
    const result = materializeSplit('equal', 100, participants)

    // distributeRounding assigns the leftover cent to the first participant
    // (largest-remainder method; stable sort resolves fraction-equality ties).
    expect(result.get('p1')).toBeCloseTo(33.34, 2)
    expect(result.get('p2')).toBeCloseTo(33.33, 2)
    expect(result.get('p3')).toBeCloseTo(33.33, 2)
    
    const total = Array.from(result.values()).reduce((sum, val) => sum + val, 0)
    expect(total).toBeCloseTo(100, 2)
  })

  it('should materialize shares split with rounding', () => {
    const participants = [
      { personId: 'p1', value: 2 },
      { personId: 'p2', value: 1 }
    ]
    const result = materializeSplit('shares', 100, participants)
    
    expect(result.get('p1')).toBeCloseTo(66.67, 2)
    expect(result.get('p2')).toBeCloseTo(33.33, 2)
    
    const total = Array.from(result.values()).reduce((sum, val) => sum + val, 0)
    expect(total).toBeCloseTo(100, 2)
  })

  it('should materialize percentage split with rounding', () => {
    const participants = [
      { personId: 'p1', value: 33.33 },
      { personId: 'p2', value: 33.33 },
      { personId: 'p3', value: 33.34 }
    ]
    const result = materializeSplit('percentage', 100, participants)
    
    expect(result.get('p1')).toBeCloseTo(33.33, 2)
    expect(result.get('p2')).toBeCloseTo(33.33, 2)
    expect(result.get('p3')).toBeCloseTo(33.34, 2)
    
    const total = Array.from(result.values()).reduce((sum, val) => sum + val, 0)
    expect(total).toBeCloseTo(100, 2)
  })

  it('should materialize unequal split with adjustment', () => {
    const participants = [
      { personId: 'p1', value: 33.33 },
      { personId: 'p2', value: 33.33 },
      { personId: 'p3', value: 33.33 }
    ]
    const result = materializeSplit('unequal', 100, participants)
    
    expect(result.get('p1')).toBeCloseTo(33.34, 2) // Adjusted for rounding
    expect(result.get('p2')).toBe(33.33)
    expect(result.get('p3')).toBe(33.33)
    
    const total = Array.from(result.values()).reduce((sum, val) => sum + val, 0)
    expect(total).toBeCloseTo(100, 2)
  })

  it('should handle zero total shares in shares mode', () => {
    const participants = [
      { personId: 'p1', value: 0 },
      { personId: 'p2', value: 0 }
    ]
    const result = materializeSplit('shares', 100, participants)
    
    expect(result.size).toBe(0)
  })
})
