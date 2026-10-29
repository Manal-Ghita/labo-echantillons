import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ApiError, createApiClient, isAbortError } from '../api/client'
import { getProfile, loginCredentials } from './api'
import { AuthContext } from './context'
import { clearSession, readSession, storeSession } from './session'
import type { StoredSession, UserProfile } from './types'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [initialSession] = useState(readSession)
  const [session, setSession] = useState<StoredSession | null>(initialSession)
  const [user, setUser] = useState<UserProfile | null>(null)
  const [checking, setChecking] = useState(Boolean(initialSession))
  const [notice, setNotice] = useState<string | null>(null)
  const [api] = useState(() =>
    createApiClient({
      initialToken: initialSession?.token ?? null,
      onUnauthorized: () => {},
    }),
  )
  const epoch = useRef(0)
  const pending = useRef<AbortController | null>(null)
  const endSession = useCallback(
    (message: string | null = null) => {
      epoch.current += 1
      pending.current?.abort()
      api.setToken(null)
      clearSession()
      setSession(null)
      setUser(null)
      setChecking(false)
      setNotice(message)
    },
    [api],
  )
  useEffect(() => {
    api.setUnauthorizedHandler((expiredToken) => {
      // An old request must not disconnect a newer session.
      if (api.getToken() === expiredToken)
        endSession('Votre session a expiré. Veuillez vous reconnecter.')
    })
    return () => api.setUnauthorizedHandler(() => {})
  }, [api, endSession])
  useEffect(() => {
    if (!initialSession) return
    const controller = new AbortController()
    pending.current = controller
    const generation = ++epoch.current
    void getProfile(api, controller.signal)
      .then((profile) => {
        if (generation !== epoch.current || controller.signal.aborted) return
        setUser(profile)
        setChecking(false)
      })
      .catch((error) => {
        if (isAbortError(error) || generation !== epoch.current) return
        endSession(
          error instanceof ApiError
            ? error.message
            : 'Impossible de charger votre profil.',
        )
      })
    return () => controller.abort()
  }, [api, endSession, initialSession])
  useEffect(() => {
    if (!session) return
    const timer = window.setTimeout(
      () => {
        if (api.getToken() === session.token)
          endSession('Votre session a expiré. Veuillez vous reconnecter.')
      },
      Math.max(0, session.expiresAt - Date.now()),
    )
    return () => window.clearTimeout(timer)
  }, [api, session, endSession])
  useEffect(() => () => pending.current?.abort(), [])
  const login = useCallback(
    async (email: string, password: string) => {
      pending.current?.abort()
      const controller = new AbortController()
      pending.current = controller
      const generation = ++epoch.current
      setNotice(null)
      try {
        const result = await loginCredentials(
          api,
          email,
          password,
          controller.signal,
        )
        const expiresAt = Date.now() + result.expires_in * 1000
        if (generation !== epoch.current || controller.signal.aborted)
          throw new DOMException('Connexion annulée.', 'AbortError')
        api.setToken(result.access_token)
        const profile = await getProfile(api, controller.signal)
        if (generation !== epoch.current || controller.signal.aborted)
          throw new DOMException('Connexion annulée.', 'AbortError')
        if (expiresAt <= Date.now())
          throw new ApiError(
            401,
            'Votre session a expiré. Veuillez vous reconnecter.',
          )
        const next = { token: result.access_token, expiresAt }
        storeSession(next)
        setSession(next)
        setUser(profile)
        setChecking(false)
      } catch (error) {
        if (generation === epoch.current) {
          api.setToken(null)
          clearSession()
          setSession(null)
          setUser(null)
          setChecking(false)
        }
        throw error
      }
    },
    [api],
  )
  return (
    <AuthContext.Provider
      value={{
        status: checking ? 'checking' : user ? 'authenticated' : 'anonymous',
        user,
        notice,
        api,
        login,
        logout: () => endSession(),
        hasRole: (...roles) => Boolean(user && roles.includes(user.role)),
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}
