export const MIN_PASSWORD_LENGTH = 8
export const MAX_NAME_LENGTH = 60

// Returns an error message when the password is unacceptable, or null when it
// passes. Kept deliberately simple (length only) so it is easy to test and to
// reason about; tighten here if the product needs stronger rules.
export function validatePassword(password: string): string | null {
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`
  }
  return null
}

// Optional display name. Empty/whitespace is treated as "not provided" (null).
// Returns { value } on success or { error } when too long.
export function validateName(raw: string | null): { value: string | null; error?: string } {
  const trimmed = (raw ?? '').trim()
  if (!trimmed) return { value: null }
  if (trimmed.length > MAX_NAME_LENGTH) {
    return { value: null, error: `Name must be at most ${MAX_NAME_LENGTH} characters` }
  }
  return { value: trimmed }
}
