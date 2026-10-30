import { ApiError } from '../api/client'
import type { ApiClient } from '../api/client'
import type { LoginResponse, UserProfile } from './types'

export async function loginCredentials(
  api: ApiClient,
  email: string,
  password: string,
  signal: AbortSignal,
): Promise<LoginResponse> {
  const result = await api.request<Partial<LoginResponse>>('/auth/login', {
    method: 'POST',
    body: { email, password },
    authenticated: false,
    signal,
  })
  if (
    !result ||
    typeof result.access_token !== 'string' ||
    !result.access_token ||
    result.token_type !== 'Bearer' ||
    !Number.isSafeInteger(result.expires_in) ||
    (result.expires_in ?? 0) <= 0
  ) {
    throw new ApiError(0, 'La réponse de connexion est invalide.')
  }
  return result as LoginResponse
}

export async function getProfile(
  api: ApiClient,
  signal: AbortSignal,
): Promise<UserProfile> {
  const result = await api.request<Partial<UserProfile>>('/auth/me', { signal })
  if (
    !result ||
    typeof result.id !== 'string' ||
    typeof result.name !== 'string' ||
    typeof result.email !== 'string' ||
    typeof result.createdAt !== 'string' ||
    result.isActive !== true ||
    !['ADMIN', 'RESEARCHER'].includes(result.role ?? '')
  ) {
    throw new ApiError(0, 'Le profil renvoyé par le serveur est invalide.')
  }
  return {
    id: result.id,
    name: result.name,
    email: result.email,
    role: result.role as UserProfile['role'],
    createdAt: result.createdAt,
    isActive: result.isActive,
  }
}
