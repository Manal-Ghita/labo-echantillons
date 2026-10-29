import { Navigate, Outlet, useLocation } from 'react-router'
import { useAuth } from './context'
import type { Role } from './types'

export function RequireAuth({ roles }: { roles?: Role[] }) {
  const auth = useAuth()
  const location = useLocation()
  if (auth.status === 'checking')
    return (
      <main className="session-loading" role="status">
        Chargement de votre profil…
      </main>
    )
  if (!auth.user)
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: location.pathname + location.search + location.hash }}
      />
    )
  if (roles && !auth.hasRole(...roles))
    return (
      <main className="page">
        <h1>Accès non autorisé</h1>
        <p role="alert">
          Vous n’avez pas les droits nécessaires pour cette page.
        </p>
      </main>
    )
  return <Outlet />
}
