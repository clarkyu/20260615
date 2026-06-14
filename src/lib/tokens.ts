import crypto from 'crypto'

// Opaque, URL-safe token handed to the user (in an email link). 32 random bytes
// gives 256 bits of entropy.
export function generateToken(): string {
  return crypto.randomBytes(32).toString('base64url')
}

// Only the hash is stored in the database, so a database leak does not expose
// usable verification / reset tokens.
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}
