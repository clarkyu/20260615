import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Returns the normalized email (trimmed + lower-cased) when it looks valid,
// or null when it is empty or malformed.
export function normalizeEmail(email: string): string | null {
  const trimmed = email.trim().toLowerCase()
  if (!trimmed) return null
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed) ? trimmed : null
}
