import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import HomeScreen from '../../../components/HomeScreen'
import { Group, Transaction, Person } from '../../../types'

// Mock the calculations module
vi.mock('../../../utils/calculations', () => ({
  calculateShares: vi.fn(() => new Map()),
  calculateGroupBalances: vi.fn(() => new Map()),
}))

// Mock the icons
vi.mock('../../../components/icons/Icons', () => ({
  PlusIcon: () => <div data-testid="plus-icon">+</div>
}))

// Mock the GroupSummaryCard component
vi.mock('../../../components/GroupSummaryCard', () => ({
  default: ({ group, onSelect }: { group: Group; onSelect: () => void }) => (
    <div data-testid={`group-card-${group.id}`} onClick={onSelect}>
      {group.name}
    </div>
  )
}))

describe('HomeScreen', () => {
  const mockGroups: Group[] = [
    {
      id: 'g1',
      name: 'Test Group 1',
      currency: 'USD',
      members: ['p1', 'p2'],
      groupType: 'household'
    },
    {
      id: 'g2',
      name: 'Test Group 2',
      currency: 'EUR',
      members: ['p1', 'p3'],
      groupType: 'trip',
      tripStartDate: '2024-01-01',
      tripEndDate: '2024-01-07'
    }
  ]

  const mockPeople: Person[] = [
    {
      id: 'p1',
      name: 'John Doe',
      avatarUrl: 'https://example.com/avatar1.jpg'
    },
    {
      id: 'p2',
      name: 'Jane Smith',
      avatarUrl: 'https://example.com/avatar2.jpg'
    },
    {
      id: 'p3',
      name: 'Bob Johnson',
      avatarUrl: 'https://example.com/avatar3.jpg'
    }
  ]

  const mockTransactions: Transaction[] = [
    {
      id: 't1',
      groupId: 'g1',
      description: 'Test Transaction 1',
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
    },
    {
      id: 't2',
      groupId: 'g2',
      description: 'Test Transaction 2',
      amount: 200,
      paidById: 'p2',
      date: '2024-01-02',
      tag: 'Travel',
      split: {
        mode: 'equal',
        participants: [
          { personId: 'p1', value: 1 },
          { personId: 'p3', value: 1 }
        ]
      },
      type: 'expense'
    }
  ]

  const defaultProps = {
    groups: mockGroups,
    transactions: mockTransactions,
    people: mockPeople,
    currentUserId: 'p1',
    onSelectGroup: vi.fn(),
    onAddGroup: vi.fn()
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render home screen with groups', () => {
    render(<HomeScreen {...defaultProps} />)
    
    expect(screen.getByText('Your Groups')).toBeInTheDocument()
    expect(screen.getByText('Test Group 1')).toBeInTheDocument()
    expect(screen.getByText('Test Group 2')).toBeInTheDocument()
  })

  it('should render add group button', () => {
    render(<HomeScreen {...defaultProps} />)
    
    const addButton = screen.getByRole('button', { name: /add group/i })
    expect(addButton).toBeInTheDocument()
    expect(screen.getByTestId('plus-icon')).toBeInTheDocument()
  })

  it('should call onAddGroup when add button is clicked', () => {
    render(<HomeScreen {...defaultProps} />)
    screen.debug();
    const addButton = screen.getByRole('button', { name: /add group/i })
    fireEvent.click(addButton)
    
    expect(defaultProps.onAddGroup).toHaveBeenCalledOnce()
  })

  it('should render group summary cards', () => {
    render(<HomeScreen {...defaultProps} />)
    
    expect(screen.getByTestId('group-card-g1')).toBeInTheDocument()
    expect(screen.getByTestId('group-card-g2')).toBeInTheDocument()
  })

  it('should call onSelectGroup when group card is clicked', () => {
    render(<HomeScreen {...defaultProps} />)
    
    const groupCard = screen.getByTestId('group-card-g1')
    fireEvent.click(groupCard)
    
    expect(defaultProps.onSelectGroup).toHaveBeenCalledWith('g1')
  })

  it('should render balance information', () => {
    // Mock calculateShares to return specific values
    const { calculateShares } = require('../../utils/calculations')
    calculateShares.mockImplementation((transaction: Transaction) => {
      const shares = new Map<string, number>()
      if (transaction.id === 't1') {
        shares.set('p1', 50)
        shares.set('p2', 50)
      } else if (transaction.id === 't2') {
        shares.set('p1', 100)
        shares.set('p3', 100)
      }
      return shares
    })

    render(<HomeScreen {...defaultProps} />)
    
    // User paid t1 (100) and is owed 50 from p2, so owedToUser = 50
    // User owes 100 for t2, so userOwes = 100
    // Net balance = 50 - 100 = -50
    expect(screen.getByText('$50.00')).toBeInTheDocument() // owedToUser
    expect(screen.getByText('$100.00')).toBeInTheDocument() // userOwes
    expect(screen.getByText('-$50.00')).toBeInTheDocument() // netBalance
  })

  it('should handle empty groups list', () => {
    render(<HomeScreen {...defaultProps} groups={[]} />)
    
    expect(screen.getByText('Your Groups')).toBeInTheDocument()
    expect(screen.getByText('No groups yet')).toBeInTheDocument()
  })

  it('should handle empty transactions list', () => {
    render(<HomeScreen {...defaultProps} transactions={[]} />)
    
    expect(screen.getByText('$0.00')).toBeInTheDocument() // All balances should be 0
  })

  it('should format currency correctly', () => {
    const { calculateShares } = require('../../utils/calculations')
    calculateShares.mockReturnValue(new Map())
    
    render(<HomeScreen {...defaultProps} />)
    
    // Should show formatted currency with 2 decimal places
    const balanceElements = screen.getAllByText(/\$\d+\.\d{2}/)
    expect(balanceElements.length).toBeGreaterThan(0)
  })

  it('should handle different currencies in groups', () => {
    render(<HomeScreen {...defaultProps} />)
    
    // Should render groups with different currencies
    expect(screen.getByText('Test Group 1')).toBeInTheDocument()
    expect(screen.getByText('Test Group 2')).toBeInTheDocument()
  })

  it('should render group type labels', () => {
    render(<HomeScreen {...defaultProps} />)
    
    // The GroupSummaryCard should show group types
    expect(screen.getByTestId('group-card-g1')).toBeInTheDocument()
    expect(screen.getByTestId('group-card-g2')).toBeInTheDocument()
  })
})
