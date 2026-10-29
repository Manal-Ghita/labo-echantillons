import { Navigate, Route, Routes } from 'react-router'
import { RequireAuth } from './auth/RequireAuth'
import { AppLayout } from './components/AppLayout'
import { LoginPage } from './pages/LoginPage'
import {
  CatalogueDetailPage,
  CataloguePage,
  CreateCataloguePage,
} from './catalogue/CataloguePages'
import {
  CreateSamplePage,
  SampleDetailPage,
  SamplesPage,
} from './samples/SamplesPages'

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<AppLayout />}>
          <Route index element={<Navigate to="/samples" replace />} />
          <Route path="/samples" element={<SamplesPage />} />
          <Route path="/samples/new" element={<CreateSamplePage />} />
          <Route path="/samples/:id" element={<SampleDetailPage />} />
          <Route path="/step-types" element={<CataloguePage />} />
          <Route element={<RequireAuth roles={['ADMIN']} />}>
            <Route path="/step-types/new" element={<CreateCataloguePage />} />
          </Route>
          <Route path="/step-types/:id" element={<CatalogueDetailPage />} />
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
