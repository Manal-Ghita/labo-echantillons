import { useEffect } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router'
import { useAuth } from '../auth/context'
import './workspace.css'

export function AppLayout() {
  const { user, logout, hasRole } = useAuth()
  const location = useLocation()
  useEffect(() => {
    document.getElementById('main-content')?.focus({ preventScroll: true })
  }, [location.pathname])
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Aller au contenu
      </a>
      <header className="app-header">
        <Link to="/samples" className="brand">
          <img className="app-logo" src="/images/logo-labo.png" alt="" />
          <strong>LIMS Salle Blanche</strong>
        </Link>
        <nav aria-label="Navigation principale">
          <NavLink to="/samples">Échantillons</NavLink>
          <NavLink to="/step-types">Catalogue</NavLink>
          {hasRole('ADMIN') && <NavLink to="/users">Comptes</NavLink>}
        </nav>
        <div className="account">
          <div>
            <strong>{user?.name}</strong>
            <span className="role-label">
              {user?.role === 'ADMIN'
                ? 'Administration'
                : 'Personnel de recherche'}
            </span>
          </div>
          <button
            className="button button-secondary"
            type="button"
            onClick={logout}
          >
            Se déconnecter
          </button>
        </div>
      </header>
      <main id="main-content" tabIndex={-1} className="workspace">
        <Outlet />
      </main>
    </div>
  )
}
