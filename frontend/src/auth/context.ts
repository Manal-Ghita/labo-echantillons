import { createContext, useContext } from 'react'
import type { ApiClient } from '../api/client'
import type { Role, UserProfile } from './types'

export type AuthContextValue = {
  status: 'anonymous' | 'checking' | 'authenticated'
  user: UserProfile | null
  notice: string | null
  api: ApiClient
  login: (email: string, password: string) => Promise<void>
  logout: () => void
  hasRole: (...roles: Role[]) => boolean
}
export const AuthContext = createContext<AuthContextValue | null>(null)
export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth doit être utilisé dans AuthProvider.')
  return value
}
