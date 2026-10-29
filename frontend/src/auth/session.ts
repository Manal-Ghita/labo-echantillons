import type { StoredSession } from './types'

export const SESSION_KEY = 'labo.session'
export function clearSession() {
  try {
    sessionStorage.removeItem(SESSION_KEY)
  } catch {
    /* Memory-only session if storage is unavailable. */
  }
}
export function readSession(): StoredSession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY)
    const value: unknown = raw ? JSON.parse(raw) : null
    if (
      typeof value === 'object' &&
      value !== null &&
      'token' in value &&
      typeof value.token === 'string' &&
      value.token &&
      'expiresAt' in value &&
      typeof value.expiresAt === 'number' &&
      Number.isFinite(value.expiresAt) &&
      value.expiresAt > Date.now()
    ) {
      return { token: value.token, expiresAt: value.expiresAt }
    }
  } catch {
    /* Corrupt or unavailable storage is not a valid identity. */
  }
  clearSession()
  return null
}
export function storeSession(session: StoredSession) {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session))
  } catch {
    /* Continue in memory. */
  }
}
