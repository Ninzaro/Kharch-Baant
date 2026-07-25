import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import Avatar, { getInitials, isStockAvatarUrl } from '../../../components/Avatar'

describe('getInitials', () => {
  it('uses first and last name letters', () => {
    expect(getInitials('Ninad Sapre')).toBe('NS')
  })

  it('uses first two letters of a single name', () => {
    expect(getInitials('Alice')).toBe('AL')
  })

  it('returns ? for empty', () => {
    expect(getInitials('')).toBe('?')
    expect(getInitials(undefined)).toBe('?')
  })
})

describe('isStockAvatarUrl', () => {
  it('detects pravatar and ui-avatars hosts', () => {
    expect(isStockAvatarUrl('https://i.pravatar.cc/150?u=abc')).toBe(true)
    expect(isStockAvatarUrl('https://ui-avatars.com/api/?name=A')).toBe(true)
  })

  it('allows data URLs and custom hosts', () => {
    expect(isStockAvatarUrl('data:image/png;base64,abc')).toBe(false)
    expect(isStockAvatarUrl('https://cdn.example.com/me.jpg')).toBe(false)
    expect(isStockAvatarUrl('')).toBe(false)
    expect(isStockAvatarUrl(null)).toBe(false)
  })
})

describe('Avatar', () => {
  it('renders initials when avatarUrl is empty', () => {
    render(<Avatar id="p1" name="Ninad Sapre" avatarUrl="" size="md" />)
    expect(screen.getByTitle('Ninad Sapre')).toHaveTextContent('NS')
  })

  it('renders initials for stock pravatar URLs', () => {
    render(
      <Avatar
        id="p2"
        name="Alice Wonder"
        avatarUrl="https://i.pravatar.cc/150?u=alice"
        size="sm"
      />
    )
    expect(screen.getByTitle('Alice Wonder')).toHaveTextContent('AW')
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('renders an image for a real photo URL inside a fixed shell', () => {
    render(
      <Avatar
        id="p3"
        name="Bob"
        avatarUrl="data:image/png;base64,abc123"
        size="lg"
      />
    )
    const shell = screen.getByTitle('Bob')
    expect(shell).toHaveClass('overflow-hidden', 'shrink-0', 'rounded-full')
    const img = shell.querySelector('img')
    expect(img).toHaveAttribute('src', 'data:image/png;base64,abc123')
    expect(img).toHaveClass('object-cover')
  })

  it('falls back to initials when image fails to load', () => {
    render(
      <Avatar
        id="p4"
        name="Cara Diaz"
        avatarUrl="https://cdn.example.com/broken.jpg"
        size="xs"
      />
    )
    const shell = screen.getByTitle('Cara Diaz')
    const img = shell.querySelector('img')
    expect(img).toBeTruthy()
    fireEvent.error(img!)
    expect(screen.getByTitle('Cara Diaz')).toHaveTextContent('CD')
  })
})
