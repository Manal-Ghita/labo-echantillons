export type Role = 'ADMIN' | 'RESEARCHER'
export type UserProfile = {
  id: string
  name: string
  email: string
  role: Role
  createdAt: string
  isActive: boolean
}
export type LoginResponse = {
  access_token: string
  token_type: 'Bearer'
  expires_in: number
}
export type StoredSession = { token: string; expiresAt: number }
