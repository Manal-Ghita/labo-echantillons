import { Navigate, Route, Routes } from 'react-router'
import { RequireAuth } from './auth/RequireAuth'
import { AppLayout } from './components/AppLayout'
import { LoginPage } from './pages/LoginPage'
import { PlaceholderPage } from './pages/PlaceholderPage'

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<AppLayout />}>
          <Route index element={<Navigate to="/samples" replace />} />
          <Route path="/samples" element={<PlaceholderPage kind="samples" />} />
          <Route
            path="/step-types"
            element={<PlaceholderPage kind="catalog" />}
          />
          <Route
            path="*"
            element={
              <section className="page">
                <p className="eyebrow">PAGE INTROUVABLE</p>
                <h1>Cette page n’existe pas.</h1>
                <p>Utilisez la navigation pour retrouver votre espace.</p>
              </section>
            }
          />
        </Route>
      </Route>
    </Routes>
  )
}
