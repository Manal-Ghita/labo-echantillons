import { useEffect } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router'
import { useAuth } from '../auth/context'

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
          <span className="brand-mark" aria-hidden="true">
            L.
          </span>
          <span>
            Les échantillons
            <br />
            <strong>du labo</strong>
          </span>
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
              {user?.role === 'ADMIN' ? 'Administration' : 'Recherche'}
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
      <footer className="app-footer">
        Les échantillons du labo <span>Suivi de fabrication · ISMIN 2026</span>
      </footer>
    </div>
  )
}
