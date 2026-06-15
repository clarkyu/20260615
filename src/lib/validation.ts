export const MIN_PASSWORD_LENGTH = 8
export const MAX_NAME_LENGTH = 60

// Returns an i18n error key when the password is unacceptable, or null.
export function validatePassword(password: string): string | null {
  if (!password || password.length < MIN_PASSWORD_LENGTH) return 'err.pwTooShort'
  return null
}

// Optional display name. Empty/whitespace -> null (not provided). On success
// returns { value }; on failure { value: null, error: <i18n key> }.
export function validateName(raw: string | null): { value: string | null; error?: string } {
  const trimmed = (raw ?? '').trim()
  if (!trimmed) return { value: null }
  if (trimmed.length > MAX_NAME_LENGTH) return { value: null, error: 'err.nameTooLong' }
  return { value: trimmed }
}
